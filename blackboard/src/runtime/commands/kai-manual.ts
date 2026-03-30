import { Command } from 'commander';
import type { CliContext } from '../cli.ts';
import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadAlgorithmTemplate } from '../hooks/pre-session.ts';
import { parseTranscript, extractSessionSummary } from '../hooks/transcript.ts';
import { extractFacts } from '../hooks/extractor.ts';

const DEFAULT_LOG_DIR = '/tmp/kai-sessions';
const DEFAULT_TIMEOUT_MS = 3_600_000; // 1 hour

/**
 * Generate a timestamped session ID for transcript naming.
 */
function generateSessionId(): string {
    const now = new Date();
    const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const rand = Math.random().toString(36).slice(2, 8);
    return `kai-${ts}-${rand}`;
}

/**
 * Build CLI args for the chosen agent command.
 */
function buildAgentArgs(agentCmd: string, prompt: string): string[] {
    const args = [agentCmd];

    if (agentCmd === 'antigravity') {
        args.push('chat', '--mode', 'agent', '--reuse-window');
    } else if (agentCmd === 'claude') {
        args.push('--print', '--verbose', '--output-format', 'stream-json');
    } else if (agentCmd === 'gemini') {
        args.push('--output-format', 'stream-json');
    }

    args.push(prompt);
    return args;
}

/**
 * Run the post-session extraction pipeline on a transcript file.
 * Extracts facts/patterns and writes them to the Blackboard DB.
 * Returns the number of facts extracted.
 */
export function runPostSession(
    bb: CliContext['bb'],
    transcriptPath: string,
    sessionId: string,
): number {
    if (!existsSync(transcriptPath)) {
        console.error(`[kai-manual] Transcript not found: ${transcriptPath}`);
        return 0;
    }

    const content = readFileSync(transcriptPath, 'utf-8').trim();
    if (!content) {
        console.log('[kai-manual] Empty transcript, skipping post-session extraction.');
        return 0;
    }

    const messages = parseTranscript(transcriptPath);
    if (messages.length === 0) {
        console.log('[kai-manual] No parseable messages in transcript, skipping.');
        return 0;
    }

    const summary = extractSessionSummary(messages, transcriptPath);
    const facts = extractFacts(summary.assistantMessages);

    // Record session_started event
    bb.appendEvent({
        summary: `Session started: kai-manual (${sessionId})`,
        metadata: {
            hookEvent: 'session_started',
            sessionId,
            source: 'kai-manual',
            startTime: summary.startTime,
        },
    });

    // Record session_activity event
    bb.appendEvent({
        summary: `Session activity: ${summary.messageCount} messages, ${summary.toolsUsed.length} tools, ${summary.filesModified.length} files`,
        metadata: {
            hookEvent: 'session_activity',
            sessionId,
            source: 'kai-manual',
            messageCount: summary.messageCount,
            toolsUsed: summary.toolsUsed,
            filesModified: summary.filesModified.slice(0, 50),
            durationMinutes: summary.durationMinutes,
        },
    });

    // Extract and record facts
    for (const fact of facts.slice(0, 20)) {
        bb.appendEvent({
            summary: `${fact.type === 'fact' ? 'Fact extracted' : 'Pattern detected'}: ${fact.text}`,
            metadata: {
                hookEvent: fact.type === 'fact' ? 'fact_extracted' : 'pattern_detected',
                sessionId,
                source: 'kai-manual',
                text: fact.text,
            },
        });
    }

    // Record session_ended event
    bb.appendEvent({
        summary: `Session ended: kai-manual (${sessionId}, ${summary.durationMinutes}m)`,
        metadata: {
            hookEvent: 'session_ended',
            sessionId,
            source: 'kai-manual',
            endTime: summary.endTime,
            durationMinutes: summary.durationMinutes,
            factsExtracted: facts.length,
        },
    });

    return facts.length;
}

/**
 * Stream the agent's stdout to both the terminal and a log file.
 * Returns the full raw output.
 */
async function streamToFileAndTerminal(
    stream: ReadableStream<Uint8Array>,
    logPath: string
): Promise<string> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        chunks.push(text);

        // Write to log file
        appendFileSync(logPath, text);

        // Also write to terminal so user sees live output
        process.stdout.write(text);
    }

    return chunks.join('');
}

/**
 * Register the kai-manual command on the CLI program.
 */
export function registerKaiManualCommand(
    parent: Command,
    getContext: () => CliContext
): void {
    parent
        .command('kai-manual')
        .description('Run a manual Kai session with full memory lifecycle (pre-session → execute → post-session)')
        .argument('<task>', 'Task description for the AI agent')
        .option('--project <id>', 'Project ID for context lookup')
        .option('--agent <cmd>', 'AI agent command: gemini, claude, antigravity', process.env.HEARTBEAT_AGENT_COMMAND ?? 'gemini')
        .option('--timeout <ms>', 'Session timeout in milliseconds', String(DEFAULT_TIMEOUT_MS))
        .option('--log-dir <dir>', 'Transcript output directory', DEFAULT_LOG_DIR)
        .option('--dry-run', 'Print the generated prompt without launching the agent', false)
        .action(async (task: string, opts) => {
            const ctx = getContext();
            const bb = ctx.bb;

            const agentCmd: string = opts.agent;
            const timeoutMs = parseInt(opts.timeout, 10);
            const logDir: string = opts.logDir;
            const projectId: string | undefined = opts.project;
            const dryRun: boolean = opts.dryRun;
            const sessionId = generateSessionId();

            // ── 1. Pre-session: Build prompt with steering rules ──────────────
            console.log('[kai-manual] 🧠 Pre-session: Loading steering rules and project context...');

            let algorithmBlock: string;
            try {
                algorithmBlock = loadAlgorithmTemplate(bb.db, projectId);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`[kai-manual] Failed to load algorithm template: ${msg}`);
                console.log('[kai-manual] Proceeding with raw task prompt (no steering rules).');
                algorithmBlock = '';
            }

            const promptParts = [
                `You are an autonomous agent working on: ${task}`,
                '',
            ];
            if (algorithmBlock) {
                promptParts.push('## PAI Hybrid Algorithm', '', algorithmBlock, '');
            }
            promptParts.push('When you are done, summarize what you accomplished.');

            const fullPrompt = promptParts.join('\n');

            // ── Dry-run: just print and exit ──────────────────────────────────
            if (dryRun) {
                console.log('\n═══ Generated Prompt ═══\n');
                console.log(fullPrompt);
                console.log('\n═══ End Prompt ═══');
                return;
            }

            // ── 2. Setup transcript logging ───────────────────────────────────
            mkdirSync(logDir, { recursive: true });
            const transcriptPath = join(logDir, `${sessionId}.jsonl`);

            console.log(`[kai-manual] 📝 Transcript: ${transcriptPath}`);
            console.log(`[kai-manual] 🤖 Agent: ${agentCmd}`);
            console.log(`[kai-manual] ⏱  Timeout: ${timeoutMs / 1000}s`);
            if (projectId) {
                console.log(`[kai-manual] 📂 Project: ${projectId}`);
            }
            console.log(`[kai-manual] 🚀 Launching session ${sessionId}...\n`);

            // Write prompt header to transcript
            appendFileSync(transcriptPath, JSON.stringify({
                type: 'system',
                subtype: 'init',
                timestamp: new Date().toISOString(),
                metadata: { sessionId, agentCmd, projectId, source: 'kai-manual' },
            }) + '\n');

            // ── 3. Execute: Spawn the agent ───────────────────────────────────
            const args = buildAgentArgs(agentCmd, fullPrompt);
            const startTime = Date.now();

            let exitCode = 1;
            try {
                const proc = Bun.spawn(args, {
                    cwd: process.cwd(),
                    stdout: 'pipe',
                    stderr: 'pipe',
                    env: { ...process.env },
                });

                // Timeout handler
                const timeoutId = setTimeout(() => {
                    console.error(`\n[kai-manual] ⏱ Timeout reached (${timeoutMs / 1000}s) — killing agent`);
                    proc.kill('SIGTERM');
                }, timeoutMs);

                // Handle SIGINT/SIGTERM gracefully — kill child but still run post-session
                const signalHandler = () => {
                    console.error('\n[kai-manual] 🛑 Interrupted — killing agent and running post-session...');
                    proc.kill('SIGTERM');
                };
                process.on('SIGINT', signalHandler);
                process.on('SIGTERM', signalHandler);

                // Stream stdout and stderr
                const [stdout, stderr] = await Promise.all([
                    proc.stdout ? streamToFileAndTerminal(proc.stdout as any, transcriptPath) : Promise.resolve(""),
                    (async () => {
                        const reader = (proc.stderr as any)?.getReader();
                        if (!reader) return "";
                        const decoder = new TextDecoder();
                        const chunks: string[] = [];
                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;
                            const text = decoder.decode(value, { stream: true });
                            chunks.push(text);
                            process.stderr.write(text);
                        }
                        return chunks.join('');
                    })(),
                ]);

                exitCode = await proc.exited;
                clearTimeout(timeoutId);
                process.removeListener('SIGINT', signalHandler);
                process.removeListener('SIGTERM', signalHandler);

            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`\n[kai-manual] ❌ Agent error: ${msg}`);
            }

            const durationSec = Math.round((Date.now() - startTime) / 1000);
            console.log(`\n[kai-manual] Agent exited with code ${exitCode} after ${durationSec}s`);

            // ── 4. Post-session: Extract facts and write to DB ────────────────
            console.log('[kai-manual] 📚 Post-session: Extracting facts and patterns...');

            try {
                const factCount = runPostSession(bb, transcriptPath, sessionId);
                console.log(`[kai-manual] ✅ Extracted ${factCount} fact(s)/pattern(s) and saved to blackboard.`);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`[kai-manual] ⚠️  Post-session extraction failed: ${msg}`);

                // Still record the session failure
                bb.appendEvent({
                    summary: `kai-manual session failed: ${sessionId} (post-session error: ${msg})`,
                    metadata: {
                        hookEvent: 'session_error',
                        sessionId,
                        source: 'kai-manual',
                        error: msg,
                        exitCode,
                        durationSeconds: durationSec,
                    },
                });
            }

            console.log(`[kai-manual] 🏁 Session ${sessionId} complete.`);
        });
}
