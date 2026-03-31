# Tasks: F-2 — CLI Framework and Command Routing

## Phase 1: Core Framework

- [ ] **T-2.1: Initialize Commander.js and global flags**
  - Implement `program` with `--json` and `--db <path>`.
  - Create `resolveDb(opts)` utility for the resolution chain.
- [ ] **T-2.2: Implement subcommand delegation**
  - Map `status`, `agent`, `project`, `work`, `observe`, `serve`, `sweep`, `specflow-queue` to their existing handlers.
  - Ensure global options are passed down correctly to each handler.

## Phase 2: Refinements

- [ ] **T-2.3: Uniform JSON output support**
  - Update any handlers that don't yet respect the `--json` flag to provide structured output.
- [ ] **T-2.4: Help and error parity**
  - Verify `--help` displays clearly for all subcommands.
  - Add "unknown command" handler for non-zero exit codes.

[PHASE COMPLETE: TASKS]
Feature: F-2
Tasks: .claude-local/skills/SpecFlow/.specify/specs/f-2-cli-framework-and-command-routing/tasks.md
Total tasks: 4
Parallelizable: 0
