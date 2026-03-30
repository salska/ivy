import { Command } from 'commander';
import type { CliContext } from '../cli.ts';
import {
    queryLearnings,
    synthesizeRules,
    buildPromptContext,
} from 'ivy-blackboard/src/kernel/learnings';
import { formatJson } from 'ivy-blackboard/src/kernel/output';

/**
 * Register learn commands on the unified ivy CLI.
 * Migrated from ivy-blackboard/src/commands/learn.ts.
 */
export function registerLearnCommand(
    parent: Command,
    getContext: () => CliContext
): void {
    const learn = parent
        .command('learn')
        .description('Query and manage learnings / steering rules');

    learn
        .command('query')
        .description('Query learning events for a project')
        .requiredOption('--project <id>', 'Project ID')
        .option('--limit <n>', 'Max results', '20')
        .option('--since <duration>', 'Duration filter (e.g., 24h, 7d)')
        .action((opts) => {
            try {
                const ctx = getContext();
                const events = queryLearnings(ctx.bb.db, opts.project, {
                    limit: parseInt(opts.limit, 10),
                    since: opts.since,
                });

                if (ctx.json) {
                    console.log(formatJson(events));
                } else if (events.length === 0) {
                    console.log('No learning events found.');
                } else {
                    for (const e of events) {
                        console.log(`[${e.timestamp}] ${e.event_type}: ${e.summary}`);
                    }
                }
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`Error: ${msg}`);
                process.exitCode = 1;
            }
        });

    learn
        .command('analyze')
        .description('Synthesize steering rules from recent learnings')
        .requiredOption('--project <id>', 'Project ID')
        .action((opts) => {
            try {
                const ctx = getContext();
                const result = synthesizeRules(ctx.bb.db, opts.project);

                if (ctx.json) {
                    console.log(formatJson(result));
                } else {
                    console.log(`Rules created:  ${result.rulesCreated}`);
                    console.log(`Rules updated:  ${result.rulesUpdated}`);
                    console.log(`Total active:   ${result.totalActive}`);
                }
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`Error: ${msg}`);
                process.exitCode = 1;
            }
        });

    learn
        .command('inject')
        .description('Build prompt context for agent injection')
        .requiredOption('--project <id>', 'Project ID')
        .action((opts) => {
            try {
                const ctx = getContext();
                const promptCtx = buildPromptContext(ctx.bb.db, opts.project);

                if (ctx.json) {
                    console.log(formatJson(promptCtx));
                } else {
                    console.log(`Active steering rules: ${promptCtx.ruleCount}\n`);
                    if (promptCtx.steeringRules) {
                        console.log('--- Steering Rules ---');
                        console.log(promptCtx.steeringRules);
                    }
                    if (promptCtx.sessionHistory) {
                        console.log('\n--- Session History ---');
                        console.log(promptCtx.sessionHistory);
                    }
                }
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`Error: ${msg}`);
                process.exitCode = 1;
            }
        });
}
