import { Command } from 'commander';
import type { CliContext } from '../cli.ts';
import { getOverallStatus } from 'ivy-blackboard/src/status';
import { sweepStaleAgents } from 'ivy-blackboard/src/sweep';
import { formatJson } from 'ivy-blackboard/src/output';
import { resolveDbPath } from 'ivy-blackboard/src/db';

/**
 * Register status & sweep commands on the unified ivy CLI.
 * Migrated from ivy-blackboard.
 */
export function registerStatusCommand(
    parent: Command,
    getContext: () => CliContext
): void {
    parent
        .command('status')
        .description('Show overall blackboard status')
        .action(() => {
            try {
                const ctx = getContext();
                const dbPath = resolveDbPath({ dbPath: (parent.opts() as any).db });
                const status = getOverallStatus(ctx.bb.db, dbPath);

                if (ctx.json) {
                    console.log(formatJson(status));
                } else {
                    console.log(`Database:     ${status.database}`);
                    console.log(`Size:         ${status.database_size}`);
                    console.log(`Projects:     ${status.projects}`);
                    console.log(`Events (24h): ${status.events_24h}`);

                    console.log(`\nAgents:`);
                    for (const [s, c] of Object.entries(status.agents)) {
                        console.log(`  ${s}: ${c}`);
                    }

                    console.log(`\nWork Items:`);
                    for (const [s, c] of Object.entries(status.work_items)) {
                        console.log(`  ${s}: ${c}`);
                    }

                    if (status.active_agents.length > 0) {
                        console.log(`\nActive Agents:`);
                        for (const a of status.active_agents) {
                            console.log(`  ${a.agent_name} (${a.session_id.slice(0, 12)}) — ${a.current_work ?? 'idle'}`);
                        }
                    }
                }
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`Error: ${msg}`);
                process.exitCode = 1;
            }
        });
}

export function registerSweepCommand(
    parent: Command,
    getContext: () => CliContext
): void {
    parent
        .command('sweep')
        .description('Sweep stale agents and clean up')
        .option('--threshold <seconds>', 'Stale threshold in seconds', '300')
        .action((opts) => {
            try {
                const ctx = getContext();
                const result = sweepStaleAgents(ctx.bb.db, {
                    staleThresholdSeconds: parseInt(opts.threshold, 10),
                });

                if (ctx.json) {
                    console.log(formatJson(result));
                } else {
                    const releasedCount = result.staleAgents.reduce(
                        (sum, a) => sum + a.releasedItems.length, 0
                    );
                    console.log(`Swept ${result.staleAgents.length} stale agent(s)`);
                    console.log(`Released ${releasedCount} work item(s)`);
                    console.log(`Pruned ${result.heartbeatsPruned} old heartbeat(s)`);
                }
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`Error: ${msg}`);
                process.exitCode = 1;
            }
        });
}
