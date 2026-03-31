# Plan: F-2 — CLI Framework and Command Routing

## Architecture

Use Commander.js to define a root `program` with global options, then attach each subcommand as a `.command()` registration that delegates to the existing handler functions.

## Database Resolution

```
resolveDb(opts): string
  1. if opts.db          → return opts.db
  2. if BLACKBOARD_DB    → return process.env.BLACKBOARD_DB
  3. walk CWD upward     → return first .blackboard/local.db found
  4. fallback            → return ~/.pai/blackboard/local.db
```

## Entry Point (`blackboard/src/index.ts`)

```
program
  .option('--json',      'emit JSON output')
  .option('--db <path>', 'database path')

program.command('status')   → registerStatusCommand(program)
program.command('agent')    → registerAgentCommand(program)
program.command('project')  → registerProjectCommand(program)
program.command('work')     → registerWorkCommand(program)
program.command('observe')  → registerObserveCommand(program)
program.command('serve')    → registerServeCommand(program)
program.command('sweep')    → registerSweepCommand(program)
program.command('specflow-queue') → registerSpecFlowQueueCommand(program)

program.parseAsync(process.argv)
```

## Error Handling

- Unknown command → `console.error` + `process.exit(1)`
- Missing required arg → Commander auto-exits with usage message

[PHASE COMPLETE: PLAN]
Feature: F-2
Plan: .claude-local/skills/SpecFlow/.specify/specs/f-2-cli-framework-and-command-routing/plan.md
