import { Command } from 'commander';
import type { CliContext } from '../cli.ts';
import { startUnifiedServer } from '../serve/unified-server.ts';
import { resolveDbPath } from '../../kernel/db';
import { sweepStaleAgents } from '../../kernel/sweep.ts';
import { dispatch } from '../scheduler/scheduler.ts';

export function registerServeCommand(
  parent: Command,
  getContext: () => CliContext
): void {
  parent
    .command('serve')
    .description('Start unified ivy web dashboard')
    .option('--port <n>', 'Port to listen on', '7878')
    .option('--dispatch', 'Run agent dispatcher in the background', false)
    .option('--dispatch-interval <minutes>', 'Interval for background dispatch in minutes', '1')
    .action(async (opts) => {
      try {
        const ctx = getContext();
        const port = parseInt(opts.port, 10);
        const dbPath = resolveDbPath({ dbPath: (parent.opts() as any).db });

        const server = startUnifiedServer(ctx.bb, { port, dbPath });

        console.log(`\n  🌿 ivy dashboard running at http://localhost:${server.port}\n`);
        console.log(`     Tabs: Blackboard · Heartbeat · SpecFlow`);
        console.log(`     API:  http://localhost:${server.port}/api/*`);

        let dispatchTimer: Timer | null = null;
        if (opts.dispatch) {
          const intervalMin = parseInt(opts.dispatchInterval, 10);
          const intervalMs = intervalMin * 60 * 1000;
          console.log(`     Dispatch: enabled (every ${intervalMin}m)`);

          const runDispatch = async () => {
            try {
              sweepStaleAgents(ctx.bb.db);
              await dispatch(ctx.bb, {
                maxConcurrent: 1,
                maxItems: 5,
                timeout: 60,
                dryRun: false,
                fireAndForget: true,
              });
            } catch (err) {
              console.error(`[dispatch] Background error: ${err instanceof Error ? err.message : String(err)}`);
            }
          };

          // Initial run and then interval
          runDispatch();
          dispatchTimer = setInterval(runDispatch, intervalMs);
        }

        console.log(`\n  Press Ctrl+C to stop.\n`);

        // Keep process alive
        process.on('SIGINT', () => {
          if (dispatchTimer) clearInterval(dispatchTimer);
          server.stop();
          ctx.bb.close();
          process.exit(0);
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${msg}`);
        process.exit(1);
      }
    });
}
