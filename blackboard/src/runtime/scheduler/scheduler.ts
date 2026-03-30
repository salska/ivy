import { mkdirSync, openSync, closeSync, appendFileSync } from 'node:fs';
import { spawn as nodeSpawn } from 'node:child_process';
import type { Blackboard } from '../blackboard.ts';
import type { BlackboardWorkItem } from '../../kernel/types.ts';
import { getLauncher, resolveLogDir, logPathForSession, hasToolUsage, hasActionUsage } from './launcher.ts';
import { isMeaninglessHandover, parsePhaseReport } from '../parser/handover-parser.ts';
import { loadAlgorithmTemplate } from '../hooks/pre-session.ts';
import { buildPromptPreamble } from '../tool-adapter/index.ts';
import {
  isCleanBranch,
  stashIfDirty,
  popStash,
  getCurrentBranch,
  createWorktree,
  removeWorktree,
  resolveWorktreePath,
  commitAll,
  pushBranch,
  createPR,
  mergePR,
  pullMain,
  getDiffSummary,
  buildCommentPrompt,
} from './worktree.ts';
import { parseSpecFlowMeta } from './specflow-types.ts';
import { runSpecFlowPhase, SpecFlowError } from './specflow-runner.ts';
import { parseMergeFixMeta, createMergeFixWorkItem, runMergeFix } from './merge-fix.ts';
import { selectPersona } from './persona-loader.ts';
import { updateWorkItemMetadata } from '../../kernel/work.ts';
import type {
  DispatchOptions,
  DispatchResult,
  DispatchedItem,
  SkippedItem,
} from './types.ts';

/**
 * Resolve the path to the ivy-heartbeat binary.
 * Uses process.execPath for compiled binaries, falls back to bun + src/cli.ts.
 *
 * In compiled Bun binaries, process.argv[0] is just "bun" (unhelpful),
 * but process.execPath is the actual compiled binary path.
 */
function resolveWorkerBinary(): string[] {
  const ep = process.execPath;
  // If running as a compiled binary (not bun itself)
  if (ep && !ep.endsWith('/bun') && !ep.endsWith('/node')) {
    return [ep];
  }
  // Running from source: bun run src/cli.ts
  return ['bun', 'run', `${import.meta.dir}/../cli.ts`];
}

/**
 * Count currently active dispatch agents (active or idle) on the blackboard.
 * Excludes the heartbeat orchestrator agent (name='ivy-heartbeat') which
 * runs checks but is not a work-processing agent.
 */
function countActiveAgents(bb: Blackboard): number {
  const row = bb.db
    .query("SELECT COUNT(*) as count FROM agents WHERE status IN ('active', 'idle') AND agent_name != 'ivy-heartbeat'")
    .get() as { count: number };
  return row.count;
}

/**
 * Parse work item metadata to extract GitHub-specific fields.
 */
function parseGithubMeta(metadata: string | null): {
  isGithub: boolean;
  issueNumber?: number;
  repo?: string;
  author?: string;
  humanReviewRequired?: boolean;
} {
  if (!metadata) return { isGithub: false };
  try {
    const parsed = JSON.parse(metadata);
    if (parsed.github_issue_number && parsed.github_repo) {
      return {
        isGithub: true,
        issueNumber: parsed.github_issue_number,
        repo: parsed.github_repo,
        author: parsed.author,
        humanReviewRequired: parsed.human_review_required !== false,
      };
    }
  } catch {
    // Invalid metadata JSON
  }
  return { isGithub: false };
}

/**
 * Cross-project dependency instructions injected into agent prompts.
 */
const CROSS_PROJECT_DEPENDENCY_INSTRUCTIONS = `
## Cross-Project Dependencies

If you discover that completing this task requires changes in another project:
1. Create a GitHub issue in the target project: \`gh issue create --repo owner/repo --title "..." --body "..."\`
2. Output a structured dependency marker at the end of your summary:
   CROSS_PROJECT_DEPENDENCY:
   repo: owner/repo
   issue: <number>
   reason: <why this is needed>
   resume_context: <what to do when resolved>
3. Your current work item will be paused until the dependency resolves.
`;

/**
 * Build the prompt for an agent session working on a work item.
 * Selects the best-fit persona via bidding, then injects the PAI Hybrid
 * Algorithm template with project-specific learnings.
 */
function buildPrompt(item: BlackboardWorkItem, sessionId: string, db: import('bun:sqlite').Database): { prompt: string; personaName: string | null } {
  const persona = selectPersona(item.metadata, item.title, item.description ?? '');

  const parts: string[] = [];

  // Inject tool name mapping preamble for non-Claude providers
  const preamble = buildPromptPreamble();
  if (preamble) {
    parts.push(preamble);
  }

  parts.push(
    persona
      ? `${persona.identityBlock}\n\n---\n\nYour current task: ${item.title}`
      : `You are an autonomous agent working on: ${item.title}`,
  );

  if (persona) {
    console.log(`[persona] Selected "${persona.name}" for work item "${item.title}"`);
  }

  if (item.description) {
    parts.push(`\nDescription: ${item.description}`);
  }

  parts.push(
    `\nWork item ID: ${item.item_id}`,
    `Session ID: ${sessionId}`,
    CROSS_PROJECT_DEPENDENCY_INSTRUCTIONS,
  );

  // Inject the Hybrid Algorithm with project-specific learnings
  try {
    const algorithmBlock = loadAlgorithmTemplate(db, item.project_id ?? undefined);
    parts.push('\n## PAI Hybrid Algorithm\n', algorithmBlock);
  } catch (err) {
    // Non-fatal: if template fails to load, proceed without it
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[hybrid-algorithm] Failed to load template: ${msg}`);
  }

  // Inject handover context from previous agent if present
  if (item.handover_context) {
    try {
      const handover = JSON.parse(item.handover_context);
      parts.push(
        `\n## Handover Context (from previous agent)\n`,
        `The previous agent handed this task over with the following context:`,
        `- **Progress:** ${handover.progress ?? 'Not specified'}`,
        `- **Next Steps:** ${handover.next_steps ?? 'Not specified'}`,
        handover.blockers ? `- **Blockers:** ${handover.blockers}` : '',
        handover.notes ? `- **Notes:** ${handover.notes}` : '',
        `\nPlease continue from where the previous agent left off.\n`,
      );
    } catch {
      parts.push(`\n## Handover Context\n\n${item.handover_context}\n`);
    }
  } else {
    // If no explicit handover context, try to recover logs from a previous crashed agent
    const { getPreviousAgentLogs } = require('./launcher.ts');
    const previousLogs = getPreviousAgentLogs(db, item.item_id, sessionId);
    if (previousLogs) {
      parts.push(
        `\n## Previous Attempt Recovery\n`,
        `A previous agent was working on this task but crashed or was interrupted.`,
        `To avoid repeating their work, here are the final logs from their session:\n`,
        `\`\`\`\n${previousLogs}\n\`\`\`\n`,
        `Please review these logs to understand what they had already accomplished, and pick up where they left off.\n`
      );
    }
  }

  parts.push(
    `When you are done, summarize what you accomplished.`,
    `If you cannot complete the task and need to hand it off, output a string exactly starting with HANDOVER_CONTEXT: on its own line.`,
    `Below that line, provide three fields: progress:, next_steps:, and blockers: (if any).`,
    `Make sure the values for these fields are on the same line as the key or on following lines.`,
    `Do not wrap this in a code block unless necessary.`
  );

  return { prompt: parts.join('\n'), personaName: persona?.name ?? null };
}

/**
 * Dispatch available work items to Claude Code sessions.
 *
 * Pipeline:
 * 1. Query blackboard for available work, ordered by priority
 * 2. Filter by project/priority if specified
 * 3. Check concurrency limits
 * 4. For each item (up to maxItems):
 *    a. Look up project local_path
 *    b. Register agent + claim work
 *    c. Launch Claude Code session
 *    d. On success: complete work + deregister
 *    e. On failure: release work + deregister
 */
export async function dispatch(
  bb: Blackboard,
  opts: DispatchOptions
): Promise<DispatchResult> {
  const result: DispatchResult = {
    timestamp: new Date().toISOString(),
    dispatched: [],
    skipped: [],
    errors: [],
    dryRun: opts.dryRun,
  };

  // Query available work items
  let items = bb.listWorkItems({
    status: 'available',
    priority: opts.priority,
    project: opts.project,
  });

  // Filter out items that are stagnated/failed by the globally running personas/agents
  // Note: we can only truly filter them out before selecting a persona, so we 
  // do a best-effort pass here if we know the agent session ID in worker mode, 
  // but wait, the dispatcher spawns *new* sessions. 
  // Instead, the best we can do is skip them inside the loop if the selected 
  // persona matches a failed_by entry.


  if (items.length === 0) {
    return result;
  }

  // Check concurrency limit (pre-existing agents, not ones we'll create)
  if (!opts.dryRun) {
    const activeCount = countActiveAgents(bb);
    if (activeCount >= opts.maxConcurrent) {
      for (const item of items) {
        result.skipped.push({
          itemId: item.item_id,
          title: item.title,
          reason: `concurrency limit reached (${activeCount}/${opts.maxConcurrent} active)`,
        });
      }
      return result;
    }
  }

  // Cap by maxItems only — sequential processing means each completion frees the slot
  const itemsToProcess = items.slice(0, opts.maxItems);
  const itemsSkipped = items.slice(opts.maxItems);

  // Skip remaining items beyond limit
  for (const item of itemsSkipped) {
    result.skipped.push({
      itemId: item.item_id,
      title: item.title,
      reason: 'exceeds max items per run',
    });
  }

  // Dry run: report what would be dispatched
  if (opts.dryRun) {
    for (const item of itemsToProcess) {
      const project = item.project_id ? bb.getProject(item.project_id) : null;
      const workDir = project?.local_path ?? process.env.HOME ?? '/tmp';
      result.dispatched.push({
        itemId: item.item_id,
        title: item.title,
        projectId: item.project_id ?? '(none)',
        sessionId: '(dry-run)',
        exitCode: 0,
        completed: false,
        durationMs: 0,
      });
    }
    return result;
  }

  // Dispatch items
  for (const item of itemsToProcess) {
    // Resolve project (may be null for general tasks like tana todos)
    const project = item.project_id ? bb.getProject(item.project_id) : null;
    const resolvedWorkDir = project?.local_path ?? process.env.HOME ?? '/tmp';

    // Register agent and claim work
    let sessionId: string;
    try {
      // ─── Pre-flight: Work Directory check ───
      // If the directory doesn't exist, skip instead of claiming and immediately crashing.
      const { existsSync } = require('node:fs');
      if (!existsSync(resolvedWorkDir)) {
        result.skipped.push({
          itemId: item.item_id,
          title: item.title,
          reason: `work directory does not exist: ${resolvedWorkDir}`,
        });
        bb.appendEvent({
          actorId: 'scheduler',
          targetId: item.item_id,
          summary: `Skipped dispatch: work directory does not exist: ${resolvedWorkDir}`,
          metadata: { itemId: item.item_id, projectId: item.project_id, workDir: resolvedWorkDir },
        });
        continue;
      }

      const agent = bb.registerAgent({
        name: `dispatch-${item.item_id}`,
        project: item.project_id ?? 'general',
        work: item.item_id,
      });
      sessionId = agent.session_id;

      // Store log path in agent metadata
      const logPath = logPathForSession(sessionId);
      bb.db
        .query("UPDATE agents SET metadata = ? WHERE session_id = ?")
        .run(JSON.stringify({ logPath }), sessionId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push({
        itemId: item.item_id,
        title: item.title,
        error: `Failed to register agent: ${msg}`,
      });
      continue;
    }

    const claimResult = bb.claimWorkItem(item.item_id, sessionId);
    if (!claimResult.claimed) {
      result.skipped.push({
        itemId: item.item_id,
        title: item.title,
        reason: 'could not claim (already claimed by another agent)',
      });
      bb.deregisterAgent(sessionId);
      continue;
    }

    // ─── Stagnation-Aware Persona Selection (applies to ALL dispatch modes) ───
    // Extract failed_by to enable persona rotation instead of outright blocking.
    let failedBy: string[] = [];
    if (item.metadata) {
      try {
        const metaObj = JSON.parse(item.metadata);
        if (Array.isArray(metaObj.failed_by)) {
          failedBy = metaObj.failed_by;
        }
      } catch { /* ignore */ }
    }

    // Select persona with exclusion — will rotate to a different persona if available
    {
      const persona = selectPersona(item.metadata, item.title, item.description ?? '', failedBy);
      const identifier = persona?.name ?? sessionId;

      // Only block if the rotated persona is still in the failed list
      // (meaning all personas have been tried, or no rotation happened)
      if (failedBy.length > 0 && failedBy.includes(identifier)) {
        try {
          bb.releaseWorkItem(item.item_id, sessionId, { reason: "All personas exhausted — no untried persona available" });
        } catch { /* best effort */ }

        result.skipped.push({
          itemId: item.item_id,
          title: item.title,
          reason: `all personas exhausted (tried: ${failedBy.join(', ')})`,
        });

        bb.deregisterAgent(sessionId);
        continue;
      }
    }

    // Log dispatch event
    bb.appendEvent({
      actorId: sessionId,
      targetId: item.item_id,
      summary: `Dispatching "${item.title}" to Claude Code in ${resolvedWorkDir}`,
      metadata: {
        itemId: item.item_id,
        projectId: item.project_id,
        priority: item.priority,
        workDir: resolvedWorkDir,
        fireAndForget: !!opts.fireAndForget,
      },
    });

    if (opts.fireAndForget) {
      // Fire-and-forget: spawn a detached worker process and return immediately.
      // The worker handles its own lifecycle (run claude, complete/release, deregister).
      try {
        const bin = resolveWorkerBinary();
        const args = [...bin];

        // --db is a global option on the parent command, so it goes before the subcommand
        const dbPath = bb.db.filename;
        if (dbPath) {
          args.push('--db', dbPath);
        }

        args.push(
          'dispatch-worker',
          '--session-id', sessionId,
          '--item-id', item.item_id,
          '--timeout-ms', String(opts.timeout * 60 * 1000),
        );

        // Redirect worker stderr to the session log file so startup crashes
        // are captured instead of silently discarded.
        const logDir = resolveLogDir();
        mkdirSync(logDir, { recursive: true });
        const logPath = logPathForSession(sessionId);

        appendFileSync(logPath, [
          `=== Worker Spawned ===`,
          `Time: ${new Date().toISOString()}`,
          `Item: ${item.item_id} — ${item.title}`,
          `Work Dir: ${resolvedWorkDir}`,
          `===`,
          '',
        ].join('\n'));

        const logFd = openSync(logPath, 'a');
        try {
          const proc = nodeSpawn(args[0]!, args.slice(1), {
            cwd: resolvedWorkDir,
            stdio: ['ignore', 'ignore', logFd],
            env: process.env, // explicitly forward environment variables
            detached: true,
          });
          proc.unref();
        } finally {
          // Close parent's copy; child inherits its own fd
          closeSync(logFd);
        }

        result.dispatched.push({
          itemId: item.item_id,
          title: item.title,
          projectId: item.project_id ?? '(none)',
          sessionId,
          exitCode: 0,
          completed: false, // Not yet — worker will handle it
          durationMs: 0,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        // Clean up on spawn failure
        try { bb.releaseWorkItem(item.item_id, sessionId); } catch { /* best effort */ }
        try { bb.deregisterAgent(sessionId); } catch { /* best effort */ }
        result.errors.push({
          itemId: item.item_id,
          title: item.title,
          error: `Failed to spawn worker: ${msg}`,
        });
      }
    } else {
      // Synchronous mode: run launcher inline and wait for completion.
      const launcher = getLauncher();
      const startTime = Date.now();

      // SpecFlow detection: delegate to specflow runner
      const sfMeta = parseSpecFlowMeta(item.metadata);
      if (sfMeta) {
        try {
          const success = await runSpecFlowPhase(bb, item, {
            project_id: item.project_id!,
            local_path: project?.local_path ?? resolvedWorkDir,
          }, sessionId);

          const durationMs = Date.now() - startTime;

          if (success) {
            bb.completeWorkItem(item.item_id, sessionId);
            bb.appendEvent({
              actorId: sessionId,
              targetId: item.item_id,
              summary: `SpecFlow phase "${sfMeta.specflow_phase}" completed for ${sfMeta.specflow_feature_id} (${Math.round(durationMs / 1000)}s)`,
              metadata: { phase: sfMeta.specflow_phase, durationMs },
            });

            result.dispatched.push({
              itemId: item.item_id,
              title: item.title,
              projectId: item.project_id!,
              sessionId,
              exitCode: 0,
              completed: true,
              durationMs,
            });
          } else {
            try { bb.releaseWorkItem(item.item_id, sessionId); } catch { /* best effort */ }
            bb.appendEvent({
              actorId: sessionId,
              targetId: item.item_id,
              summary: `SpecFlow phase "${sfMeta.specflow_phase}" failed for ${sfMeta.specflow_feature_id} (${Math.round(durationMs / 1000)}s)`,
              metadata: { phase: sfMeta.specflow_phase, durationMs },
            });

            result.errors.push({
              itemId: item.item_id,
              title: item.title,
              error: `SpecFlow phase "${sfMeta.specflow_phase}" failed`,
            });
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          const noProgress = err instanceof SpecFlowError ? err.noProgress : true; // assume no progress for other errors

          try {
            bb.releaseWorkItem(item.item_id, sessionId, { reason: `SpecFlow error: ${msg}`, noProgress });
          } catch { /* best effort */ }

          bb.appendEvent({
            actorId: sessionId,
            targetId: item.item_id,
            summary: `SpecFlow phase "${sfMeta.specflow_phase}" error: ${msg}`,
            metadata: { error: msg, durationMs: Date.now() - startTime },
          });

          result.errors.push({
            itemId: item.item_id,
            title: item.title,
            error: msg,
          });
        } finally {
          bb.deregisterAgent(sessionId);
        }
        continue;
      }

      // Determine if this is a merge-fix recovery work item
      const mfMeta = parseMergeFixMeta(item.metadata);
      if (mfMeta && project) {
        const mfProjectPath = project.local_path ?? resolvedWorkDir;
        const mfWorktreePath = resolveWorktreePath(mfProjectPath, mfMeta.branch, mfMeta.project_id);
        try {
          await runMergeFix(bb, item, mfMeta, project, sessionId, launcher, opts.timeout * 60 * 1000);
          bb.completeWorkItem(item.item_id, sessionId);

          const durationMs = Date.now() - startTime;
          bb.appendEvent({
            actorId: sessionId,
            targetId: item.item_id,
            summary: `Merge-fix completed for PR #${mfMeta.pr_number} (${Math.round(durationMs / 1000)}s)`,
            metadata: { prNumber: mfMeta.pr_number, durationMs },
          });

          result.dispatched.push({
            itemId: item.item_id,
            title: item.title,
            projectId: item.project_id ?? '(none)',
            sessionId,
            exitCode: 0,
            completed: true,
            durationMs,
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          const durationMs = Date.now() - startTime;

          try {
            bb.releaseWorkItem(item.item_id, sessionId, {
              reason: `Merge-fix failed: ${msg}`,
              noProgress: true
            });
          } catch { /* best effort */ }

          bb.appendEvent({
            actorId: sessionId,
            targetId: item.item_id,
            summary: `Merge-fix failed for PR #${mfMeta.pr_number}: ${msg}`,
            metadata: { error: msg, durationMs },
          });
          result.errors.push({
            itemId: item.item_id,
            title: item.title,
            error: `Merge-fix failed: ${msg}`,
          });
        } finally {
          try { await removeWorktree(mfProjectPath, mfWorktreePath); } catch { /* best effort */ }
          bb.deregisterAgent(sessionId);
        }
        continue;
      }

      const { prompt, personaName } = buildPrompt(item, sessionId, bb.db);

      // Write selected persona back to work item metadata so the dashboard can display it
      if (personaName) {
        try {
          updateWorkItemMetadata(bb.db, item.item_id, { agent_persona: personaName });
        } catch {
          // Non-fatal: best effort metadata update
        }
      }



      // Worktree setup for GitHub items
      const ghMeta = parseGithubMeta(item.metadata);
      let workDir = resolvedWorkDir;
      let worktreePath: string | null = null;
      let branch: string | null = null;
      let mainBranch: string | null = null;

      let didStash = false;

      const ghProjectPath = project?.local_path ?? resolvedWorkDir;
      if (ghMeta.isGithub && ghMeta.issueNumber) {
        try {
          didStash = await stashIfDirty(ghProjectPath);
          if (didStash) {
            bb.appendEvent({
              actorId: sessionId,
              targetId: item.item_id,
              summary: `Auto-stashed uncommitted changes in ${ghProjectPath} before worktree creation`,
            });
          }

          mainBranch = await getCurrentBranch(ghProjectPath);
          branch = `fix/issue-${ghMeta.issueNumber}`;
          worktreePath = await createWorktree(ghProjectPath, branch, item.project_id ?? undefined);
          workDir = worktreePath;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          result.errors.push({
            itemId: item.item_id,
            title: item.title,
            error: `Failed to create worktree: ${msg}`,
          });
          bb.releaseWorkItem(item.item_id, sessionId);
          bb.deregisterAgent(sessionId);
          continue;
        }
      }

      // Validate that the resolved work directory actually exists
      if (!require('node:fs').existsSync(resolvedWorkDir)) {
        const msg = `Project directory does not exist: ${resolvedWorkDir}`;
        bb.appendEvent({
          actorId: sessionId,
          targetId: item.item_id,
          summary: `Dispatch worker failed: ${msg}`,
          metadata: { error: msg, missingDir: resolvedWorkDir },
        });
        try { bb.releaseWorkItem(item.item_id, sessionId, { reason: msg, noProgress: true, actorId: personaName ?? sessionId }); } catch { /* best effort */ }

        result.errors.push({
          itemId: item.item_id,
          title: item.title,
          error: msg,
        });

        // Cleanup any partial github setups
        if (worktreePath) {
          try { await removeWorktree(ghProjectPath, worktreePath); } catch { /* best effort */ }
        }
        if (didStash) {
          await popStash(ghProjectPath);
        }

        bb.deregisterAgent(sessionId);
        continue;
      }

      try {
        const launchResult = await launcher({
          workDir,
          prompt,
          timeoutMs: opts.timeout * 60 * 1000,
          sessionId,
          disableMcp: true,
        });

        const durationMs = Date.now() - startTime;

        if (launchResult.exitCode === 0) {
          // Post-agent git operations for GitHub items
          if (ghMeta.isGithub && worktreePath && branch && mainBranch) {
            try {
              const sha = await commitAll(
                worktreePath,
                `Fix #${ghMeta.issueNumber}: ${item.title}`
              );

              if (sha) {
                await pushBranch(worktreePath, branch);

                const prBody = [
                  `Fixes #${ghMeta.issueNumber}`,
                  '',
                  `Automated fix for: ${item.title}`,
                ].join('\n');

                const pr = await createPR(
                  worktreePath,
                  `Fix #${ghMeta.issueNumber}: ${item.title}`,
                  prBody,
                  mainBranch
                );

                bb.appendEvent({
                  actorId: sessionId,
                  targetId: item.item_id,
                  summary: `Created PR #${pr.number} for "${item.title}"`,
                  metadata: { prNumber: pr.number, prUrl: pr.url, commitSha: sha },
                });

                // Auto-merge for trusted contributors (non-fatal)
                if (!ghMeta.humanReviewRequired) {
                  try {
                    const merged = await mergePR(worktreePath, pr.number);
                    if (merged) {
                      bb.appendEvent({
                        actorId: sessionId,
                        targetId: item.item_id,
                        summary: `Auto-merged PR #${pr.number} (squash) for "${item.title}"`,
                        metadata: { prNumber: pr.number, autoMerge: true },
                      });

                      // Pull merged changes into main repo
                      try {
                        await pullMain(ghProjectPath, mainBranch!);
                        bb.appendEvent({
                          actorId: sessionId,
                          targetId: item.item_id,
                          summary: `Pulled merged changes into ${ghProjectPath}`,
                          metadata: { mainBranch, pullAfterMerge: true },
                        });
                      } catch (pullErr: unknown) {
                        const pullMsg = pullErr instanceof Error ? pullErr.message : String(pullErr);
                        bb.appendEvent({
                          actorId: sessionId,
                          targetId: item.item_id,
                          summary: `Pull after merge failed (non-fatal): ${pullMsg}`,
                          metadata: { error: pullMsg },
                        });
                      }
                    } else {
                      // Create recovery work item for merge failure
                      const mergeFixId = createMergeFixWorkItem(bb, {
                        originalItemId: item.item_id,
                        prNumber: pr.number,
                        prUrl: pr.url,
                        branch: branch!,
                        mainBranch: mainBranch!,
                        issueNumber: ghMeta.issueNumber,
                        projectId: item.project_id!,
                        originalTitle: item.title,
                        sessionId,
                      });
                      bb.appendEvent({
                        actorId: sessionId,
                        targetId: item.item_id,
                        summary: `Auto-merge failed for PR #${pr.number} — created recovery item ${mergeFixId}`,
                        metadata: { prNumber: pr.number, autoMerge: false, mergeFixItemId: mergeFixId },
                      });
                    }
                  } catch (mergeErr: unknown) {
                    const mergeMsg = mergeErr instanceof Error ? mergeErr.message : String(mergeErr);
                    // Create recovery work item for merge error
                    const mergeFixId = createMergeFixWorkItem(bb, {
                      originalItemId: item.item_id,
                      prNumber: pr.number,
                      prUrl: pr.url,
                      branch: branch!,
                      mainBranch: mainBranch!,
                      issueNumber: ghMeta.issueNumber,
                      projectId: item.project_id!,
                      originalTitle: item.title,
                      sessionId,
                    });
                    bb.appendEvent({
                      actorId: sessionId,
                      targetId: item.item_id,
                      summary: `Auto-merge error for PR #${pr.number}: ${mergeMsg} — created recovery item ${mergeFixId}`,
                      metadata: { prNumber: pr.number, error: mergeMsg, mergeFixItemId: mergeFixId },
                    });
                  }
                }

                // Launch commenter agent (non-fatal)
                try {
                  const diffSummary = await getDiffSummary(worktreePath, mainBranch);
                  const commentPrompt = buildCommentPrompt(
                    {
                      number: ghMeta.issueNumber!,
                      title: item.title,
                      body: item.description ?? undefined,
                      author: ghMeta.author ?? 'unknown',
                    },
                    pr.url,
                    diffSummary
                  );

                  await launcher({
                    workDir: worktreePath,
                    prompt: commentPrompt,
                    timeoutMs: 120_000,
                    sessionId: `${sessionId}-comment`,
                  });
                } catch {
                  // Commenter failure is non-fatal
                }
              }
            } catch (gitErr: unknown) {
              const msg = gitErr instanceof Error ? gitErr.message : String(gitErr);
              bb.releaseWorkItem(item.item_id, sessionId, { reason: "Post-agent git ops failed", noProgress: true, actorId: personaName ?? sessionId });
              bb.deregisterAgent(sessionId);
              result.errors.push({
                itemId: item.item_id,
                title: item.title,
                error: `Post-agent git ops failed: ${msg}`,
              });
              // Clean up worktree before continuing
              if (worktreePath) {
                try { await removeWorktree(ghProjectPath, worktreePath); } catch { /* best effort */ }
              }
              continue;
            }
          }

          // --- HANDOVER ON SUCCESS ---
          // Check if agent did meaningful work but wants to hand over to another persona
          let didHandover = false;
          try {
            const { readFileSync } = require('node:fs');
            const logContent = readFileSync(logPathForSession(sessionId), 'utf-8');
            const handoverMatch = logContent.match(/HANDOVER_CONTEXT:\s*\n([\s\S]*?)(?:```|$)/);
            if (handoverMatch) {
              const block = handoverMatch[1]!;
              let progress = block.match(/progress:\s*(.+)/)?.[1]?.trim() ?? '';
              let nextSteps = block.match(/next_steps:\s*(.+)/)?.[1]?.trim() ?? '';
              let blockers = block.match(/blockers:\s*(.+)/)?.[1]?.trim() ?? '';

              // Validate: if they just copied placeholders, try to fallback to PHASE_REPORT
              if (isMeaninglessHandover(progress) || isMeaninglessHandover(nextSteps)) {
                const phaseReport = parsePhaseReport(logPathForSession(sessionId));
                if (phaseReport.factsLearned.length > 0) {
                  progress = `Completed phase: ${phaseReport.lastPhase}. Facts: ${phaseReport.factsLearned.join(', ')}`;
                  nextSteps = 'Continue to next logical phase.';
                } else if (!isMeaninglessHandover(progress)) {
                  // Keep progress
                } else {
                  progress = 'Agent did not provide meaningful progress summary.';
                  nextSteps = 'Check logs for details.';
                }
              }

              // Update metadata with the block context and clear agent_persona override
              // so the next dispatch runs a fresh bidding cycle
              bb.updateWorkItemMetadata(item.item_id, {
                handover_context: JSON.stringify({
                  progress,
                  next_steps: nextSteps,
                  blockers,
                  previous_agent: sessionId,
                  handed_over_at: new Date().toISOString(),
                }),
                agent_persona: null,
              });

              bb.appendEvent({
                actorId: sessionId,
                targetId: item.item_id,
                summary: `Agent handed over task successfully (progress: ${progress.slice(0, 50)}${progress.length > 50 ? '...' : ''})`,
                metadata: { handover: true, exitCode: 0 },
              });

              bb.releaseWorkItem(item.item_id, sessionId, {
                reason: 'Agent requested handover to next persona on success',
                actorId: personaName ?? sessionId,
              });

              didHandover = true;
            }
          } catch { /* ignore parsing/fs errors */ }

          if (didHandover) {
            bb.deregisterAgent(sessionId);

            result.dispatched.push({
              itemId: item.item_id,
              title: item.title,
              projectId: item.project_id ?? '(none)',
              sessionId,
              exitCode: 0,
              completed: false, // Handed over, not truly completed
              durationMs,
            });
            continue;
          }

          // No-work safeguard: if the agent used zero tools AND produced no handover,
          // it likely did nothing meaningful (e.g. stalled or looped).
          const hasTools = hasToolUsage(sessionId);
          const hasActions = hasActionUsage(sessionId);
          const report = parsePhaseReport(logPathForSession(sessionId));

          // Physical change verification: did the agent actually change files on disk?
          // We check if the working tree is clean. If it's clean, no files were changed.
          const isWorkingTreeClean = await isCleanBranch(resolvedWorkDir).catch(() => true);
          const hasDiskChanges = !isWorkingTreeClean;

          // Strict check for build tasks: must have actions unless it's a handover or completed report.
          const isBuildTask = resolvedWorkDir.endsWith('cli-proj') ||
            /build|create|implement|add|fix|update|draft|spec/i.test(item.title);

          if (!hasTools && !didHandover && !report.completed && !hasDiskChanges) {
            bb.appendEvent({
              actorId: sessionId,
              targetId: item.item_id,
              summary: `Agent exited 0 but did no meaningful work for "${item.title}" — releasing as no-progress`,
              metadata: { itemId: item.item_id, exitCode: 0, durationMs, noWorkDetected: true, lastPhase: report.lastPhase, diskChanged: hasDiskChanges },
            });
            try {
              bb.releaseWorkItem(item.item_id, sessionId, {
                reason: 'Agent exited successfully but did no meaningful work (no tools, no disk changes, no handover)',
                noProgress: true,
                actorId: personaName ?? sessionId,
              });
            } catch { /* best effort */ }
            bb.deregisterAgent(sessionId);
            result.errors.push({
              itemId: item.item_id,
              title: item.title,
              error: 'Agent exited 0 but did no meaningful work (no tools, no disk changes)',
            });
            continue;
          }

          if (isBuildTask && !hasActions && !didHandover && !report.completed && !hasDiskChanges) {
            const reason = `Simulated work detected: build task reached phase "${report.lastPhase}" without using action tools (Write/Edit/Bash) or changing disk.`;
            bb.appendEvent({
              actorId: sessionId,
              targetId: item.item_id,
              summary: `Agent claimed completion for build task "${item.title}" but no disk changes were detected — releasing as no-progress`,
              metadata: { itemId: item.item_id, exitCode: 0, durationMs, simulatedWorkDetected: true, lastPhase: report.lastPhase, diskChanged: hasDiskChanges },
            });
            try {
              bb.releaseWorkItem(item.item_id, sessionId, {
                reason,
                noProgress: true,

                actorId: personaName ?? sessionId,
              });
            } catch { /* best effort */ }
            bb.deregisterAgent(sessionId);
            result.errors.push({
              itemId: item.item_id,
              title: item.title,
              error: reason,
            });
            continue;
          }

          bb.completeWorkItem(item.item_id, sessionId);

          bb.appendEvent({
            actorId: sessionId,
            targetId: item.item_id,
            summary: `Completed "${item.title}" (exit 0, ${Math.round(durationMs / 1000)}s)`,
            metadata: { itemId: item.item_id, exitCode: 0, durationMs },
          });

          result.dispatched.push({
            itemId: item.item_id,
            title: item.title,
            projectId: item.project_id ?? '(none)',
            sessionId,
            exitCode: 0,
            completed: true,
            durationMs,
          });
        } else {
          // Progress evaluation: if exit != 0, check if git tree changed as a rudimentary metric
          let noProgress = true;
          try {
            const diffSummary = await getDiffSummary(workDir, mainBranch ?? 'HEAD');
            // diffSummary is a string from git diff --stat. Check if it's non-empty.
            if (diffSummary && diffSummary.trim().length > 0) {
              noProgress = false; // Progress was made (files changed) despite the exit code
            }
          } catch {
            // Default to assuming no progress if we can't check
          }

          bb.releaseWorkItem(item.item_id, sessionId, {
            reason: `Claude exited with code ${launchResult.exitCode}`,
            noProgress,
            actorId: personaName ?? sessionId
          });

          bb.appendEvent({
            actorId: sessionId,
            targetId: item.item_id,
            summary: `Failed "${item.title}" (exit ${launchResult.exitCode}, ${Math.round(durationMs / 1000)}s)${noProgress ? ' — No progress detected' : ' — Partial progress detected'}`,
            metadata: {
              itemId: item.item_id,
              exitCode: launchResult.exitCode,
              durationMs,
              stderr: launchResult.stderr.slice(0, 500),
            },
          });

          result.errors.push({
            itemId: item.item_id,
            title: item.title,
            error: `Claude exited with code ${launchResult.exitCode}`,
          });
        }

        bb.deregisterAgent(sessionId);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        const durationMs = Date.now() - startTime;

        try { bb.releaseWorkItem(item.item_id, sessionId, { reason: `Dispatcher error: ${msg}`, noProgress: true, actorId: personaName ?? sessionId }); } catch { /* best effort */ }
        try { bb.deregisterAgent(sessionId); } catch { /* best effort */ }

        bb.appendEvent({
          actorId: sessionId,
          targetId: item.item_id,
          summary: `Error dispatching "${item.title}": ${msg}`,
          metadata: { itemId: item.item_id, error: msg, durationMs },
        });

        result.errors.push({
          itemId: item.item_id,
          title: item.title,
          error: msg,
        });
      } finally {
        // Always clean up worktree if created
        if (worktreePath) {
          try { await removeWorktree(ghProjectPath, worktreePath); } catch { /* best effort */ }
        }
        // Restore stashed changes
        if (didStash) {
          const restored = await popStash(ghProjectPath);
          bb.appendEvent({
            actorId: sessionId,
            targetId: item.item_id,
            summary: restored
              ? `Restored stashed changes in ${ghProjectPath}`
              : `Failed to restore stash in ${ghProjectPath} — run 'git stash pop' manually`,
          });
        }
      }
    }
  }

  return result;
}
