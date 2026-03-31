# Specification: F-2 — CLI Framework and Command Routing

## Problem

The `blackboard` CLI entry point lacks a coherent framework. Commands are registered inconsistently, global flags (--json, --db) are not uniformly available, and the database resolution chain is fragile — resulting in hard-to-debug failures when users run commands outside the project root.

## Users

- **Developers** using `blackboard` as a daily task management and observability tool.
- **CI/automation scripts** that call `blackboard status --json` or `blackboard work list --json` to feed dashboards.

## Success Criteria

1. A single `blackboard` binary entry point powered by **Commander.js**.
2. Global flags available on every subcommand:
   - `--json` — emit machine-readable JSON output
   - `--db <path>` — explicit database path override
3. Database resolution chain (in priority order):
   - `--db` CLI flag
   - `BLACKBOARD_DB` environment variable
   - `.blackboard/local.db` (project-relative, walking up to workspace root)
   - `~/.pai/blackboard/local.db` (global fallback)
4. Subcommand routing for: `agent`, `project`, `work`, `observe`, `serve`, `sweep`, `status`, `specflow-queue`.
5. Helpful `--help` output at every level (root and per-subcommand).
6. Exit code `1` on any unrecognized subcommand or missing required argument.

## Out of Scope

- Plugin/extension loading system (deferred to a later feature).
- Shell completion scripts.

## Constraints

- Must use **Commander.js** (already in `blackboard` package dependencies).
- Must be fully compatible with the existing command implementations in `blackboard/src/runtime/commands/`.
- No breaking changes to existing flag names or output formats.

[PHASE COMPLETE: SPECIFY]
Feature: F-2
Spec: .claude-local/skills/SpecFlow/.specify/specs/f-2-cli-framework-and-command-routing/spec.md
Mode: batch
