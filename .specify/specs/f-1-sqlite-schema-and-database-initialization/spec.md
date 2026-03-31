# Specification: F-1 — SQLite schema and database initialization

## Problem

The `blackboard` system requires a persistent, reliable data store to track agents, projects, work items, and events. Without a structured database, the system cannot manage task lifecycles or provide observability. The database must support both per-project and global storage to allow for distributed yet coordinated execution.

## Users

- **Agents** (Heartbeat, SpecFlow) that need to claim and update work items.
- **Operator** (User) who needs to query the system state and observe events.
- **Blackboard Server** which serves the dashboard and coordinates services.

## Success Criteria

1.  **SQLite Database** initialized with **WAL (Write-Ahead Logging) mode** for concurrent access.
2.  **Schema Definition** including 6 core tables:
    - `agents`: Metadata and status of registered agents.
    - `projects`: Configuration and status for project workspaces.
    - `work_items`: Tasks with state (available, claimed, completed, etc.), priority, and project association.
    - `heartbeats`: Periodic check-in records from active agents.
    - `events`: Structured timeline of system activities (audit log).
    - `schema_version`: Tracking for automated migrations.
3.  **Indexes** on foreign keys (`project_id`, `work_item_id`) and status fields to ensure high-performance queries.
4.  **Dual-Location Resolution**:
    - Primary: `.blackboard/local.db` (within the project root).
    - Fallback: `~/.pai/blackboard/local.db` (operator-wide configuration).
5.  **Migration Support**: A robust mechanism to apply schema updates without data loss.
6.  **Connection Pooling**: Managed connections to prevent "database is locked" errors during heavy agent activity.

## Out of Scope

- External database support (PostgreSQL, MySQL).
- Real-time websocket notifications (deferred to dashboard features).

## Constraints

- Must use `sqlite3` driver compatible with Node.js/Bun.
- Database file must be protected with appropriate filesystem permissions.

[PHASE COMPLETE: SPECIFY]
Feature: F-1
Spec: /Users/sal/Downloads/ivy-blackboard/.specify/specs/f-1-sqlite-schema-and-database-initialization/spec.md
Mode: manual
