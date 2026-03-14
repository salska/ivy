import type { Database } from 'bun:sqlite';
import {
  openDatabase,
  closeDatabase,
  resolveDbPath,
} from '../kernel/db';
import {
  registerAgent,
  sendHeartbeat,
  deregisterAgent,
  type RegisterAgentOptions,
  type RegisterAgentResult,
  type HeartbeatOptions,
  type HeartbeatResult,
  type DeregisterAgentResult,
} from '../kernel/agent';
import {
  createWorkItem,
  listWorkItems,
  claimWorkItem,
  completeWorkItem,
  releaseWorkItem,
  failWorkItem,
  blockWorkItem,
  unblockWorkItem,
  setWaitingForResponse,
  updateWorkItemMetadata,
  requestApproval,
  approveWorkItem,
  rejectWorkItem,
  handoverWorkItem,
  type CreateWorkItemOptions,
  type CreateWorkItemResult,
  type ListWorkItemsOptions,
  type ClaimWorkItemResult,
  type CompleteWorkItemResult,
  type ReleaseWorkItemResult,
  type FailWorkItemResult,
  type WorkItemReleaseResult,
  type BlockWorkItemResult,
  type UnblockWorkItemResult,
  type SetWaitingResult,
  type UpdateWorkItemMetadataResult,
  type RequestApprovalResult,
  type ApproveWorkItemResult,
  type RejectWorkItemResult,
  type HandoverWorkItemResult,
} from '../kernel/work';
import {
  createSnapshot,
  listSnapshots,
  restoreSnapshot,
  type CreateSnapshotResult,
  type RestoreSnapshotResult,
} from '../kernel/snapshot';
import { listProjects, type ProjectWithCounts } from '../kernel/project';
import type { BlackboardProject, BlackboardWorkItem } from '../kernel/types';
import { HeartbeatQueryRepository } from './repositories/heartbeats.ts';
import { EventQueryRepository } from './repositories/events.ts';
import { setupFTS5 } from './fts.ts';
import { SemanticCache } from '../kernel/cache';

/**
 * Ivy Heartbeat's interface to the blackboard.
 *
 * Delegates DB lifecycle and agent operations to ivy-blackboard.
 * Adds ivy-heartbeat-specific query repositories for heartbeats and events.
 */
export class Blackboard {
  readonly db: Database;
  readonly heartbeatQueries: HeartbeatQueryRepository;
  readonly eventQueries: EventQueryRepository;
  readonly semanticCache: SemanticCache;

  constructor(dbPath?: string) {
    const resolved = dbPath ?? resolveDbPath();
    this.db = openDatabase(resolved);
    setupFTS5(this.db);
    this.semanticCache = new SemanticCache(this.db);
    this.heartbeatQueries = new HeartbeatQueryRepository(this.db);
    this.eventQueries = new EventQueryRepository(this.db, this.semanticCache);
  }

  // ─── Agent lifecycle (delegated to ivy-blackboard) ─────────────────────

  registerAgent(opts: RegisterAgentOptions): RegisterAgentResult {
    return registerAgent(this.db, opts);
  }

  sendHeartbeat(opts: HeartbeatOptions): HeartbeatResult {
    return sendHeartbeat(this.db, opts);
  }

  deregisterAgent(sessionId: string): DeregisterAgentResult {
    return deregisterAgent(this.db, sessionId);
  }

  // ─── Work items (delegated to ivy-blackboard) ───────────────────────────

  createWorkItem(opts: CreateWorkItemOptions): CreateWorkItemResult {
    this.semanticCache.clearByPrefix('work:');
    return createWorkItem(this.db, opts);
  }

  listWorkItems(opts?: ListWorkItemsOptions): BlackboardWorkItem[] {
    const cacheKey = 'work:list:' + JSON.stringify(opts ?? {});
    const cached = this.semanticCache.get<BlackboardWorkItem[]>(cacheKey);
    if (cached) return cached;

    const results = listWorkItems(this.db, opts);
    this.semanticCache.set(cacheKey, [], results, 30); // 30s TTL for work items
    return results;
  }

  claimWorkItem(itemId: string, sessionId: string): ClaimWorkItemResult {
    this.semanticCache.clearByPrefix('work:');
    return claimWorkItem(this.db, itemId, sessionId);
  }

  completeWorkItem(itemId: string, sessionId: string): CompleteWorkItemResult {
    this.semanticCache.clearByPrefix('work:');
    return completeWorkItem(this.db, itemId, sessionId);
  }

  releaseWorkItem(itemId: string, sessionId: string, opts?: { reason?: string; noProgress?: boolean; actorId?: string }): WorkItemReleaseResult {
    this.semanticCache.clearByPrefix('work:');
    return releaseWorkItem(this.db, itemId, sessionId, opts);
  }

  failWorkItem(itemId: string, sessionId: string, opts?: { reason?: string }): FailWorkItemResult {
    this.semanticCache.clearByPrefix('work:');
    return failWorkItem(this.db, itemId, sessionId, opts);
  }

  blockWorkItem(itemId: string, opts?: { blockedBy?: string }): BlockWorkItemResult {
    this.semanticCache.clearByPrefix('work:');
    return blockWorkItem(this.db, itemId, opts);
  }

  unblockWorkItem(itemId: string): UnblockWorkItemResult {
    this.semanticCache.clearByPrefix('work:');
    return unblockWorkItem(this.db, itemId);
  }

  setWaitingForResponse(itemId: string, opts?: { blockedBy?: string }): SetWaitingResult {
    this.semanticCache.clearByPrefix('work:');
    return setWaitingForResponse(this.db, itemId, opts);
  }

  updateWorkItemMetadata(itemId: string, updates: Record<string, unknown>): UpdateWorkItemMetadataResult {
    this.semanticCache.clear(true);
    return updateWorkItemMetadata(this.db, itemId, updates);
  }

  // ─── Phase 1: Approval workflow ─────────────────────────────────────────────

  requestApproval(itemId: string, request: Record<string, unknown>): RequestApprovalResult {
    this.semanticCache.clearByPrefix('work:');
    return requestApproval(this.db, itemId, request);
  }

  approveWorkItem(itemId: string): ApproveWorkItemResult {
    this.semanticCache.clearByPrefix('work:');
    return approveWorkItem(this.db, itemId);
  }

  rejectWorkItem(itemId: string): RejectWorkItemResult {
    this.semanticCache.clearByPrefix('work:');
    return rejectWorkItem(this.db, itemId);
  }

  // ─── Phase 1: Agent handover ───────────────────────────────────────────────

  handoverWorkItem(itemId: string, sessionId: string, context: Record<string, unknown>): HandoverWorkItemResult {
    this.semanticCache.clearByPrefix('work:');
    return handoverWorkItem(this.db, itemId, sessionId, context);
  }

  // ─── Phase 1: Snapshots ────────────────────────────────────────────────────

  createSnapshot(trigger: string): CreateSnapshotResult {
    return createSnapshot(this.db, trigger);
  }

  listSnapshots(limit?: number): any[] {
    return listSnapshots(this.db, limit);
  }

  restoreSnapshot(snapshotId: string): RestoreSnapshotResult {
    return restoreSnapshot(this.db, snapshotId);
  }

  /**
   * Complete a waiting_for_response item directly (no session required).
   * Used by the issue watcher evaluator when a watched dependency resolves.
   */
  completeWaitingItem(itemId: string): void {
    const now = new Date().toISOString();
    this.semanticCache.clearByPrefix('work:');
    const result = this.db.query(
      "UPDATE work_items SET status = 'completed', completed_at = ? WHERE item_id = ? AND status = 'waiting_for_response'"
    ).run(now, itemId);
    if (result.changes > 0) {
      this.db.query(
        "INSERT INTO events (timestamp, event_type, actor_id, target_id, target_type, summary) VALUES (?, 'work_completed', 'issue-watcher', ?, 'work_item', ?)"
      ).run(now, itemId, `Waiting item "${itemId}" completed by issue watcher (dependency resolved)`);
    }
  }

  // ─── Projects (delegated to ivy-blackboard) ──────────────────────────

  getProject(projectId: string): BlackboardProject | null {
    return this.db
      .query('SELECT * FROM projects WHERE project_id = ?')
      .get(projectId) as BlackboardProject | null;
  }

  listProjects(): ProjectWithCounts[] {
    return listProjects(this.db);
  }

  // ─── Event appending ────────────────────────────────────────────────

  /**
   * Append an event to the blackboard event log.
   * Accepts an optional eventType (defaults to 'heartbeat_received' for
   * backward compatibility). Now that migration V2 dropped the event_type
   * CHECK constraint, any string is valid — callers should pass a
   * meaningful type from KNOWN_EVENT_TYPES where possible.
   */
  appendEvent(opts: {
    actorId?: string;
    targetId?: string;
    summary: string;
    metadata?: Record<string, unknown>;
    eventType?: string;
  }): void {
    const now = new Date().toISOString();
    const eventType = opts.eventType ?? 'heartbeat_received';
    this.db
      .prepare(
        `INSERT INTO events (timestamp, event_type, actor_id, target_id, target_type, summary, metadata)
         VALUES (?, ?, ?, ?, 'agent', ?, ?)`
      )
      .run(
        now,
        eventType,
        opts.actorId ?? null,
        opts.targetId ?? null,
        opts.summary,
        opts.metadata ? JSON.stringify(opts.metadata) : null
      );
  }

  close(): void {
    closeDatabase(this.db);
  }
}

// Re-export types consumers need
export type {
  RegisterAgentOptions,
  RegisterAgentResult,
  HeartbeatOptions,
  HeartbeatResult,
  DeregisterAgentResult,
} from '../kernel/agent';

export type {
  BlackboardAgent,
  BlackboardEvent,
  BlackboardHeartbeat,
  BlackboardProject,
  BlackboardWorkItem,
} from '../kernel/types';

export type {
  CreateWorkItemOptions,
  CreateWorkItemResult,
  ListWorkItemsOptions,
  ClaimWorkItemResult,
  CompleteWorkItemResult,
  ReleaseWorkItemResult,
  FailWorkItemResult,
  WorkItemReleaseResult,
  BlockWorkItemResult,
  UnblockWorkItemResult,
  SetWaitingResult,
  UpdateWorkItemMetadataResult,
  RequestApprovalResult,
  ApproveWorkItemResult,
  RejectWorkItemResult,
  HandoverWorkItemResult,
} from '../kernel/work';

export type {
  CreateSnapshotResult,
  RestoreSnapshotResult,
} from '../kernel/snapshot';

export type { ProjectWithCounts } from '../kernel/project';

export * from './parser/types.ts';
export { HeartbeatQueryRepository } from './repositories/heartbeats.ts';
export { EventQueryRepository, type ListOptions, type SearchResult } from './repositories/events.ts';
export { setupFTS5, rebuildFTSIndex } from './fts.ts';
export { logCredentialAccess, logCredentialDenied } from './credential/audit.ts';
export { loadScopeConfig, isCredentialAllowed } from './credential/scope.ts';
export type { CredentialAccessEvent, CredentialScopeConfig } from './credential/types.ts';
