import { Command } from 'commander';
import type { CliContext } from '../cli.ts';
import { formatJson, formatTable } from '../../kernel/output.ts';

export function registerCacheCommands(
  parent: Command,
  getContext: () => CliContext
): void {
  const cache = parent.command('cache').description('Manage semantic query cache');

  cache
    .command('status')
    .description('Show cache statistics')
    .action(() => {
      try {
        const ctx = getContext();
        const stats = ctx.bb.semanticCache.stats();

        if (ctx.json) {
          console.log(formatJson(stats));
          return;
        }

        const headers = ['METRIC', 'VALUE'];
        const rows = [
          ['Total Entries', stats.totalEntries.toString()],
          ['Total Hits', stats.totalHits.toString()],
          ['Expired Entries', stats.expiredEntries.toString()],
        ];

        console.log('Semantic Cache Status:\n');
        console.log(formatTable(headers, rows));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${msg}`);
        process.exit(1);
      }
    });

  cache
    .command('clear')
    .description('Clear query cache')
    .option('--all', 'Clear all entries (default: only expired)', false)
    .action((opts) => {
      try {
        const ctx = getContext();
        ctx.bb.semanticCache.clear(opts.all);
        console.log(opts.all ? 'All cache entries cleared.' : 'Expired cache entries cleared.');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${msg}`);
        process.exit(1);
      }
    });
}
