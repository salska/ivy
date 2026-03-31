#!/usr/bin/env bun

/**
 * ivy — Unified Personal AI Infrastructure CLI
 *
 * Merges ivy-blackboard (kernel/SDK) and ivy-heartbeat (runtime/daemon)
 * into a single CLI binary. Supports:
 *
 *   - All blackboard commands: work, project, agent, learn, status, sweep
 *   - All heartbeat commands: observe, check, schedule, search, export,
 *     serve, dispatch, dispatch-worker, specflow-queue, kai-manual, skills
 *   - Multi-database "Second Brain" via --attach
 *   - Plugin system via ~/.ivy/plugins/ or --plugin-dir
 */

import { Command } from 'commander';
import { Blackboard } from './blackboard.ts';
import { SecondBrainManager, parseAttachFlags } from './second-brain.ts';
import { loadPlugins, startScheduledJobs, teardownPlugins } from './plugins.ts';
import { resolveDbPath } from '../kernel/db.ts';
import { join } from 'node:path';
import { homedir } from 'node:os';

// ─── Heartbeat-native commands ───────────────────────────────────────
import { registerAgentCommands } from './commands/agent.ts';
import { registerObserveCommand } from './commands/observe.ts';
import { registerCheckCommand } from './commands/check.ts';
import { registerScheduleCommand } from './commands/schedule.ts';
import { registerSearchCommand } from './commands/search.ts';
import { registerExportCommand } from './commands/export.ts';
import { registerServeCommand } from './commands/serve.ts';
import { registerDispatchCommand } from './commands/dispatch.ts';
import { registerDispatchWorkerCommand } from './commands/dispatch-worker.ts';
import { registerSpecFlowQueueCommand } from './commands/specflow-queue.ts';
import { registerKaiManualCommand } from './commands/kai-manual.ts';
import { registerSkillsCommand } from './commands/skills.ts';
import { registerCacheCommands } from './commands/cache.ts';

// ─── Migrated blackboard commands ────────────────────────────────────
import { registerWorkCommands } from './commands/work.ts';
import { registerProjectCommands } from './commands/project.ts';
import { registerLearnCommand } from './commands/learn.ts';
import { registerStatusCommand, registerSweepCommand } from './commands/status-sweep.ts';
import { registerExportCommand as registerSnapshotCommand } from '../kernel/commands/export.ts';

// ─── CLI Context ─────────────────────────────────────────────────────

export interface CliContext {
  bb: Blackboard;
  json: boolean;
  secondBrain?: SecondBrainManager;
}

// ─── Program Definition ──────────────────────────────────────────────

const program = new Command()
  .name('ivy')
  .version('0.2.0')
  .description(
    'ivy — Unified Personal AI Infrastructure\n\n' +
    '  Kernel:  ivy-blackboard (SQLite SDK for agents, work items, projects)\n' +
    '  Runtime: ivy-heartbeat  (scheduling, dispatch, evaluators, plugins)\n\n' +
    '  Use --attach to mount additional "second brain" databases.\n' +
    '  Use --plugin-dir to load custom plugins.'
  )
  .option('-j, --json', 'Output as JSON', false)
  .option('--db <path>', 'Database path (overrides all resolution)')
  .option('--attach <alias=path...>', 'Attach secondary brain databases (repeatable)')
  .option('--plugin-dir <path>', 'Plugin directory (default: ~/.ivy/plugins)');

let cached: CliContext | null = null;

/**
 * Standardized Context Factory:
 * 1. Resolves DB path using the Level 1-4 chain (including upward walk).
 * 2. Initializes the Blackboard kernel.
 * 3. Mounts secondary brains if --attach is provided.
 */
function getContext(): CliContext {
  if (cached) return cached;

  const opts = program.opts();
  const dbPath = resolveDbPath({ dbPath: opts.db });
  const bb = new Blackboard(dbPath);

  // ─── Attach secondary brains ───────────────────────────────────────
  let secondBrain: SecondBrainManager | undefined;
  if (opts.attach && opts.attach.length > 0) {
    secondBrain = new SecondBrainManager(bb.db);
    const attachArgs = Array.isArray(opts.attach) ? opts.attach : [opts.attach];
    const brains = parseAttachFlags(attachArgs);
    for (const { alias, path } of brains) {
      secondBrain.attach(alias, path);
      console.error(`[ivy] Attached brain "${alias}" from ${path}`);
    }
  }

  cached = { bb, json: opts.json, secondBrain };

  process.on('exit', () => {
    if (cached) {
      if (cached.secondBrain) cached.secondBrain.detachAll();
      cached.bb.close();
      cached = null;
    }
  });

  return cached;
}

// ─── Register all commands ───────────────────────────────────────────

// Blackboard kernel commands (migrated)
registerWorkCommands(program, getContext);
registerProjectCommands(program, getContext);
registerLearnCommand(program, getContext);
registerStatusCommand(program, getContext);
registerSweepCommand(program, getContext);
registerSnapshotCommand(program, () => {
  const ctx = getContext();
  return {
    db: ctx.bb.db,
    dbPath: resolveDbPath({ dbPath: program.opts().db }),
    options: {
      json: ctx.json,
      db: program.opts().db,
    },
  };
});

// Heartbeat runtime commands
registerAgentCommands(program, getContext);
registerObserveCommand(program, getContext);
registerCheckCommand(program, getContext);
registerScheduleCommand(program, getContext);
registerSearchCommand(program, getContext);
registerExportCommand(program, getContext);
registerServeCommand(program, getContext);
registerDispatchCommand(program, getContext);
registerDispatchWorkerCommand(program, getContext);
registerSpecFlowQueueCommand(program, getContext);
registerKaiManualCommand(program, getContext);
registerSkillsCommand(program, getContext);
registerCacheCommands(program, getContext);

// ─── Plugin loading (async, then parse) ──────────────────────────────

async function main() {
  program.parseOptions(process.argv);
  const opts = program.opts();
  const pluginDir = opts.pluginDir ?? join(homedir(), '.ivy', 'plugins');

  // Load plugins before parsing commands (they may register custom commands)
  const ctx = getContext();
  const plugins = await loadPlugins(
    pluginDir,
    ctx.bb,
    ctx.secondBrain?.getAttachedMap()
  );

  if (plugins.length > 0) {
    const stopJobs = startScheduledJobs();
    process.on('exit', () => {
      stopJobs();
      teardownPlugins();
    });
  }

  program.parse();
}

main().catch((err) => {
  const opts = program.opts();
  if (opts.json) {
    console.log(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  } else {
    console.error(`[ivy] Fatal: ${err instanceof Error ? err.message : String(err)}`);
  }
  process.exit(1);
});
