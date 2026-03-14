# Gemini Instructions for ivy-blackboard

## Project Overview
**ivy-blackboard** is a local agent coordination system utilizing the blackboard pattern. It acts as a shared surface (a single SQLite database) where multiple CLI agents can coordinate work without direct communication. The system comprises two main dimensions:
- **State (ivy-blackboard):** A database with a CLI that tracks available work, agent assignments, and events.
- **Time (ivy-heartbeat):** A scheduled runner that evaluates conditions, dispatches agents to tasks, and writes results back.

The technology stack heavily relies on:
- **Runtime:** Bun
- **Language:** TypeScript (ESM)
- **Database:** SQLite (`bun:sqlite`)
- **CLI Framework:** Commander.js
- **Validation:** Zod
- **Telemetry:** OpenTelemetry

## Building and Running

Key commands defined in `package.json` and `README.md` for interacting with the project:

- **Install Dependencies:** `bun install`
- **Build the Project:** `bun run build` (compiles, signs, and installs)
- **Run Tests:** `bun test`
- **Continuous Integration:** `bun run ci` (runs tests and typecheck)
- **Typecheck:** `bun run typecheck`
- **Run CLI (Dev):** `bun run dev` (runs `src/cli.ts`)
- **Serve Web Dashboard:** `bun run serve` (starts a local HTTP server with REST API, SSE, and HTML dashboard)

## Development Conventions
- **Architecture:** The CLI routes commands via Commander.js to core modules which interact transactionally with the SQLite database.
- **Data Integrity:** All user-supplied text fields are filtered/sanitized (using `pai-content-filter`) and strictly typed/validated using Zod.
- **State Management:** All state is local within a single SQLite file (`db.sqlite`). Network dependencies are avoided in the core blackboard tier.
- **Agent Lifecycle:** Agents register a session, send heartbeats to indicate progress, and deregister. The system automatically detects stale agents via PID liveness checking.
- **Testing:** Tests are located in `test-kernel/` and `test-runtime/`. Always run `bun test` and ensure changes maintain existing test coverage.
