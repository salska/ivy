import type { Database } from "bun:sqlite";
import { BlackboardError } from "./errors";
import { sanitizeText } from "./sanitize";
import { ingestExternalContent, mergeFilterMetadata, requiresFiltering } from "./ingestion";
import { WORK_ITEM_PRIORITIES, WORK_ITEM_STATUSES, KNOWN_EVENT_TYPES } from "./types";
import type { BlackboardWorkItem, BlackboardEvent, KnownEventType } from "./types";

export interface CreateWorkItemOptions {
  id: string;
  title: string;
  description?: string;
  project?: string | null;
  source?: string;
  sourceRef?: string;
  priority?: string;
  metadata?: string;
  skills?: string[];
}

export interface CreateWorkItemResult {
  item_id: string;
  title: string;
  status: string;
  claimed_by: string | null;
  claimed_at: string | null;
  created_at: string;
}

export interface ClaimWorkItemResult {
  item_id: string;
  claimed: boolean;
  claimed_by: string | null;
  claimed_at: string | null;
}

/**
 * Create a new work item.
 * Validates source/priority, inserts row, emits work_created event.
 */
export function createWorkItem(
  db: Database,
  opts: CreateWorkItemOptions
): CreateWorkItemResult {
  const now = new Date().toISOString();
  const title = sanitizeText(opts.title);
  const source = opts.source ?? "local";
  const priority = opts.priority ?? "P2";
  const description = opts.description ? sanitizeText(opts.description) : null;
  const project = opts.project ?? null;
  const sourceRef = opts.sourceRef ?? null;
  let metadata: string | null = null;

  if (!source || typeof source !== "string") {
    throw new BlackboardError(
      "Source must be a non-empty string",
      "INVALID_SOURCE"
    );
  }

  if (!WORK_ITEM_PRIORITIES.includes(priority as any)) {
    throw new BlackboardError(
      `Invalid priority "${priority}". Valid values: ${WORK_ITEM_PRIORITIES.join(", ")}`,
      "INVALID_PRIORITY"
    );
  }

  if (opts.metadata) {
    try {
      const parsed = JSON.parse(opts.metadata);
      if (opts.skills && opts.skills.length > 0) {
        metadata = JSON.stringify({ ...parsed, skills: opts.skills });
      } else {
        metadata = JSON.stringify(parsed);
      }
    } catch {
      throw new BlackboardError(
        `Invalid JSON in metadata: ${opts.metadata}`,
        "INVALID_METADATA"
      );
    }
  } else if (opts.skills && opts.skills.length > 0) {
    metadata = JSON.stringify({ skills: opts.skills });
  }

  // Content filter: scan external-origin content at the ingestion boundary
  if (requiresFiltering(source)) {
    const contentToScan = [title, description].filter(Boolean).join("\n");
    const ingestResult = ingestExternalContent(contentToScan, source, "mixed");
    metadata = mergeFilterMetadata(metadata, ingestResult);
  }

  try {
    db.transaction(() => {
      db.query(`
        INSERT INTO work_items (item_id, project_id, title, description, source, source_ref, status, priority, created_at, metadata)
        VALUES (?, ?, ?, ?, ?, ?, 'available', ?, ?, ?)
      `).run(opts.id, project, title, description, source, sourceRef, priority, now, metadata);

      const summary = `Work item "${title}" created as ${opts.id}`;
      db.query(`
        INSERT INTO events (timestamp, event_type, actor_id, target_id, target_type, summary)
        VALUES (?, 'work_created', NULL, ?, 'work_item', ?)
      `).run(now, opts.id, summary);
    })();
  } catch (err: any) {
    if (err.code === "CONTENT_BLOCKED" || err.code === "CONTENT_FILTER_ERROR") throw err;
    if (err.code === "INVALID_SOURCE" || err.code === "INVALID_PRIORITY" || err.code === "INVALID_METADATA") throw err;
    if (err.message?.includes("UNIQUE constraint")) {
      throw new BlackboardError(
        `Work item already exists: ${opts.id}`,
        "WORK_ITEM_EXISTS"
      );
    }
    throw err;
  }

  return {
    item_id: opts.id,
    title,
    status: "available",
    claimed_by: null,
    claimed_at: null,
    created_at: now,
  };
}

/**
 * Claim an existing available work item.
 * Atomic: UPDATE WHERE status='available' ensures no double-claim.
 */
export function claimWorkItem(
  db: Database,
  itemId: string,
  sessionId: string
): ClaimWorkItemResult {
  // Validate session exists
  const agent = db
    .query("SELECT session_id FROM agents WHERE session_id = ?")
    .get(sessionId) as { session_id: string } | null;

  if (!agent) {
    throw new BlackboardError(
      `Agent session not found: ${sessionId}`,
      "AGENT_NOT_FOUND"
    );
  }

  // Validate item exists
  const item = db
    .query("SELECT item_id, title FROM work_items WHERE item_id = ?")
    .get(itemId) as { item_id: string; title: string } | null;

  if (!item) {
    throw new BlackboardError(
      `Work item not found: ${itemId}`,
      "WORK_ITEM_NOT_FOUND"
    );
  }

  const now = new Date().toISOString();

  const result = db.query(`
    UPDATE work_items SET status = 'claimed', claimed_by = ?, claimed_at = ?
    WHERE item_id = ? AND status = 'available'
  `).run(sessionId, now, itemId);

  if (result.changes === 0) {
    return {
      item_id: itemId,
      claimed: false,
      claimed_by: null,
      claimed_at: null,
    };
  }

  // Emit event
  const agentRow = db.query("SELECT agent_name FROM agents WHERE session_id = ?").get(sessionId) as { agent_name: string } | null;
  const agentName = agentRow?.agent_name ?? sessionId.slice(0, 12);
  const summary = `Work item "${item.title}" claimed by agent ${agentName}`;
  db.query(`
    INSERT INTO events (timestamp, event_type, actor_id, target_id, target_type, summary)
    VALUES (?, 'work_claimed', ?, ?, 'work_item', ?)
  `).run(now, sessionId, itemId, summary);

  return {
    item_id: itemId,
    claimed: true,
    claimed_by: sessionId,
    claimed_at: now,
  };
}

/**
 * Create a work item and claim it in one transaction.
 */
export function createAndClaimWorkItem(
  db: Database,
  opts: CreateWorkItemOptions,
  sessionId: string
): CreateWorkItemResult {
  const now = new Date().toISOString();
  const title = sanitizeText(opts.title);
  const source = opts.source ?? "local";
  const priority = opts.priority ?? "P2";
  const description = opts.description ? sanitizeText(opts.description) : null;
  const project = opts.project ?? null;
  const sourceRef = opts.sourceRef ?? null;
  let metadata: string | null = null;

  if (!source || typeof source !== "string") {
    throw new BlackboardError(
      "Source must be a non-empty string",
      "INVALID_SOURCE"
    );
  }

  if (!WORK_ITEM_PRIORITIES.includes(priority as any)) {
    throw new BlackboardError(
      `Invalid priority "${priority}". Valid values: ${WORK_ITEM_PRIORITIES.join(", ")}`,
      "INVALID_PRIORITY"
    );
  }

  if (opts.metadata) {
    try {
      const parsed = JSON.parse(opts.metadata);
      metadata = JSON.stringify({ ...parsed, skills: opts.skills ?? [] });
    } catch {
      throw new BlackboardError(
        `Invalid JSON in metadata: ${opts.metadata}`,
        "INVALID_METADATA"
      );
    }
  } else if (opts.skills && opts.skills.length > 0) {
    metadata = JSON.stringify({ skills: opts.skills });
  }

  // Content filter: scan external-origin content at the ingestion boundary
  if (requiresFiltering(source)) {
    const contentToScan = [title, description].filter(Boolean).join("\n");
    const ingestResult = ingestExternalContent(contentToScan, source, "mixed");
    metadata = mergeFilterMetadata(metadata, ingestResult);
  }

  // Validate session exists
  const agent = db
    .query("SELECT session_id FROM agents WHERE session_id = ?")
    .get(sessionId) as { session_id: string } | null;

  if (!agent) {
    throw new BlackboardError(
      `Agent session not found: ${sessionId}`,
      "AGENT_NOT_FOUND"
    );
  }

  db.transaction(() => {
    db.query(`
      INSERT INTO work_items (item_id, project_id, title, description, source, source_ref, status, priority, claimed_by, claimed_at, created_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, 'claimed', ?, ?, ?, ?, ?)
    `).run(opts.id, project, title, description, source, sourceRef, priority, sessionId, now, now, metadata);

    const createSummary = `Work item "${title}" created as ${opts.id}`;
    db.query(`
      INSERT INTO events (timestamp, event_type, actor_id, target_id, target_type, summary)
      VALUES (?, 'work_created', ?, ?, 'work_item', ?)
    `).run(now, sessionId, opts.id, createSummary);

    const agentRow = db.query("SELECT agent_name FROM agents WHERE session_id = ?").get(sessionId) as { agent_name: string } | null;
    const agentName = agentRow?.agent_name ?? sessionId.slice(0, 12);
    const claimSummary = `Work item "${title}" claimed by agent ${agentName}`;
    db.query(`
      INSERT INTO events (timestamp, event_type, actor_id, target_id, target_type, summary)
      VALUES (?, 'work_claimed', ?, ?, 'work_item', ?)
    `).run(now, sessionId, opts.id, claimSummary);
  })();

  return {
    item_id: opts.id,
    title,
    status: "claimed",
    claimed_by: sessionId,
    claimed_at: now,
    created_at: now,
  };
}

export interface ReleaseWorkItemResult {
  outcome: 'released';
  item_id: string;
  released: boolean;
  previous_status: string;
}

export interface FailWorkItemResult {
  outcome: 'failed';
  item_id: string;
  failed: boolean;
  previous_status: string;
}

/** Discriminated union for releaseWorkItem — check `outcome` to distinguish release vs stagnation-fail. */
export type WorkItemReleaseResult = ReleaseWorkItemResult | FailWorkItemResult;

export interface CompleteWorkItemResult {
  item_id: string;
  completed: boolean;
  completed_at: string;
  claimed_by: string;
}

export interface BlockWorkItemResult {
  item_id: string;
  blocked: boolean;
  blocked_by: string | null;
  previous_status: string;
}

export interface UnblockWorkItemResult {
  item_id: string;
  unblocked: boolean;
  restored_status: string;
}

/**
 * Release a claimed work item back to available.
 * 
 * If noProgress is true:
 * - Increments stagnation_count
 * - Appends the actorId (usually sessionId, or persona name) to failed_by array.
 * - If stagnation reaches MAX_STAGNATION, transitions to failed instead.
 */
export function releaseWorkItem(
  db: Database,
  itemId: string,
  sessionId: string,
  opts?: { reason?: string; noProgress?: boolean; actorId?: string }
): WorkItemReleaseResult {
  const item = db
    .query("SELECT * FROM work_items WHERE item_id = ?")
    .get(itemId) as BlackboardWorkItem | null;

  if (!item) {
    throw new BlackboardError(`Work item not found: ${itemId}`, "WORK_ITEM_NOT_FOUND");
  }

  const agent = db
    .query("SELECT session_id FROM agents WHERE session_id = ?")
    .get(sessionId) as { session_id: string } | null;

  if (!agent) {
    throw new BlackboardError(`Agent session not found: ${sessionId}`, "AGENT_NOT_FOUND");
  }

  if (item.status === "completed") {
    throw new BlackboardError(`Work item already completed: ${itemId}`, "ALREADY_COMPLETED");
  }

  if (item.status !== "claimed") {
    throw new BlackboardError(`Work item is not claimed: ${itemId}`, "NOT_CLAIMED");
  }

  if (item.claimed_by !== sessionId) {
    throw new BlackboardError(`Work item not claimed by session: ${sessionId}`, "NOT_CLAIMED_BY_SESSION");
  }

  const now = new Date().toISOString();
  const previousStatus = item.status;

  // Stagnation checking
  if (opts?.noProgress) {
    let metadataObj: any = {};
    if (item.metadata) {
      try { metadataObj = JSON.parse(item.metadata); } catch { /* ignore */ }
    }

    const maxStagnation = 3;
    const currentStagnation = (metadataObj.stagnation_count ?? 0) + 1;

    // Always log the failure to the actor blacklist
    const failedBy = metadataObj.failed_by ?? [];
    const actorId = opts.actorId ?? sessionId;
    if (!failedBy.includes(actorId)) {
      failedBy.push(actorId);
    }

    metadataObj.stagnation_count = currentStagnation;
    metadataObj.failed_by = failedBy;
    const newMetadata = JSON.stringify(metadataObj);

    if (currentStagnation > maxStagnation) {
      // Automatically fail the item instead of releasing
      return db.transaction(() => {
        db.query(
          "UPDATE work_items SET status = 'failed', claimed_by = NULL, claimed_at = NULL, metadata = ? WHERE item_id = ?"
        ).run(newMetadata, itemId);

        const agentRow = db.query("SELECT agent_name FROM agents WHERE session_id = ?").get(sessionId) as { agent_name: string } | null;
        const agentName = agentRow?.agent_name ?? sessionId.slice(0, 12);
        const reasonFragment = opts.reason ? ` (${opts.reason})` : "";
        const summary = `Work item "${item.title}" failed due to stagnation (max failures reached) from agent ${agentName}${reasonFragment}`;

        db.query(
          "INSERT INTO events (timestamp, event_type, actor_id, target_id, target_type, summary) VALUES (?, 'work_failed', ?, ?, 'work_item', ?)"
        ).run(now, sessionId, itemId, summary);

        return { outcome: 'failed' as const, item_id: itemId, failed: true, previous_status: previousStatus };
      })();
    } else {
      // Update metadata and continue to release
      db.query("UPDATE work_items SET metadata = ? WHERE item_id = ?").run(newMetadata, itemId);
    }
  }

  db.transaction(() => {
    db.query(
      "UPDATE work_items SET status = 'available', claimed_by = NULL, claimed_at = NULL WHERE item_id = ?"
    ).run(itemId);

    const agentRow = db.query("SELECT agent_name FROM agents WHERE session_id = ?").get(sessionId) as { agent_name: string } | null;
    const agentName = agentRow?.agent_name ?? sessionId.slice(0, 12);
    const reasonFragment = opts?.reason ? ` (Reason: ${opts.reason}${opts.noProgress ? ", No Progress" : ""})` : "";
    const summary = `Work item "${item.title}" released by agent ${agentName}${reasonFragment}`;

    db.query(
      "INSERT INTO events (timestamp, event_type, actor_id, target_id, target_type, summary) VALUES (?, 'work_released', ?, ?, 'work_item', ?)"
    ).run(now, sessionId, itemId, summary);
  })();

  return { outcome: 'released', item_id: itemId, released: true, previous_status: previousStatus };
}

/**
 * Mark a work item as terminally failed.
 */
export function failWorkItem(
  db: Database,
  itemId: string,
  sessionId: string,
  opts?: { reason?: string }
): FailWorkItemResult {
  const item = db
    .query("SELECT * FROM work_items WHERE item_id = ?")
    .get(itemId) as BlackboardWorkItem | null;

  if (!item) {
    throw new BlackboardError(`Work item not found: ${itemId}`, "WORK_ITEM_NOT_FOUND");
  }

  const agent = db
    .query("SELECT session_id FROM agents WHERE session_id = ?")
    .get(sessionId) as { session_id: string } | null;

  if (!agent) {
    throw new BlackboardError(`Agent session not found: ${sessionId}`, "AGENT_NOT_FOUND");
  }

  if (item.status === "completed") {
    throw new BlackboardError(`Work item already completed: ${itemId}`, "ALREADY_COMPLETED");
  }

  if (item.status !== "claimed") {
    throw new BlackboardError(`Work item is not claimed: ${itemId}`, "NOT_CLAIMED");
  }

  if (item.claimed_by !== sessionId) {
    throw new BlackboardError(`Work item not claimed by session: ${sessionId}`, "NOT_CLAIMED_BY_SESSION");
  }

  const now = new Date().toISOString();
  const previousStatus = item.status;

  db.transaction(() => {
    db.query(
      "UPDATE work_items SET status = 'failed', claimed_by = NULL, claimed_at = NULL WHERE item_id = ?"
    ).run(itemId);

    const agentRow = (db.query("SELECT agent_name FROM agents WHERE session_id = ?").get(sessionId) as { agent_name: string } | null);
    const agentName = agentRow?.agent_name ?? sessionId.slice(0, 12);
    const reasonFragment = opts?.reason ? ` (${opts.reason})` : "";
    const summary = `Work item "${item.title}" failed by agent ${agentName}${reasonFragment}`;

    db.query(
      "INSERT INTO events (timestamp, event_type, actor_id, target_id, target_type, summary) VALUES (?, 'work_failed', ?, ?, 'work_item', ?)"
    ).run(now, sessionId, itemId, summary);
  })();

  return { outcome: 'failed', item_id: itemId, failed: true, previous_status: previousStatus };
}

/**
 * Mark a claimed work item as completed.
 */
export function completeWorkItem(
  db: Database,
  itemId: string,
  sessionId: string
): CompleteWorkItemResult {
  const item = db
    .query("SELECT * FROM work_items WHERE item_id = ?")
    .get(itemId) as BlackboardWorkItem | null;

  if (!item) {
    throw new BlackboardError(`Work item not found: ${itemId}`, "WORK_ITEM_NOT_FOUND");
  }

  const agent = db
    .query("SELECT session_id FROM agents WHERE session_id = ?")
    .get(sessionId) as { session_id: string } | null;

  if (!agent) {
    throw new BlackboardError(`Agent session not found: ${sessionId}`, "AGENT_NOT_FOUND");
  }

  if (item.status === "completed") {
    throw new BlackboardError(`Work item already completed: ${itemId}`, "ALREADY_COMPLETED");
  }

  if (item.status !== "claimed") {
    throw new BlackboardError(`Work item is not claimed: ${itemId}`, "NOT_CLAIMED");
  }

  if (item.claimed_by !== sessionId) {
    throw new BlackboardError(`Work item not claimed by session: ${sessionId}`, "NOT_CLAIMED_BY_SESSION");
  }

  const now = new Date().toISOString();

  db.transaction(() => {
    db.query(
      "UPDATE work_items SET status = 'completed', completed_at = ? WHERE item_id = ?"
    ).run(now, itemId);

    const agentRow = (db.query("SELECT agent_name FROM agents WHERE session_id = ?").get(sessionId) as { agent_name: string } | null);
    const agentName = agentRow?.agent_name ?? sessionId.slice(0, 12);
    const summary = `Work item "${item.title}" completed by agent ${agentName}`;
    db.query(
      "INSERT INTO events (timestamp, event_type, actor_id, target_id, target_type, summary) VALUES (?, 'work_completed', ?, ?, 'work_item', ?)"
    ).run(now, sessionId, itemId, summary);
  })();

  return { item_id: itemId, completed: true, completed_at: now, claimed_by: sessionId };
}

/**
 * Block a work item. Retains claimed_by if was claimed.
 */
export function blockWorkItem(
  db: Database,
  itemId: string,
  opts?: { blockedBy?: string }
): BlockWorkItemResult {
  const item = db
    .query("SELECT * FROM work_items WHERE item_id = ?")
    .get(itemId) as BlackboardWorkItem | null;

  if (!item) {
    throw new BlackboardError(`Work item not found: ${itemId}`, "WORK_ITEM_NOT_FOUND");
  }

  if (item.status === "completed") {
    throw new BlackboardError(`Work item already completed: ${itemId}`, "ALREADY_COMPLETED");
  }

  const now = new Date().toISOString();
  const previousStatus = item.status;
  const blockedBy = opts?.blockedBy ?? null;

  db.transaction(() => {
    db.query(
      "UPDATE work_items SET status = 'blocked', blocked_by = ? WHERE item_id = ?"
    ).run(blockedBy, itemId);

    const summary = `Work item "${item.title}" blocked${blockedBy ? ` by ${blockedBy}` : ""}`;
    db.query(
      "INSERT INTO events (timestamp, event_type, actor_id, target_id, target_type, summary) VALUES (?, 'work_blocked', NULL, ?, 'work_item', ?)"
    ).run(now, itemId, summary);
  })();

  return { item_id: itemId, blocked: true, blocked_by: blockedBy, previous_status: previousStatus };
}

/**
 * Unblock a blocked work item. Restores to claimed or available based on claimed_by.
 */
export function unblockWorkItem(
  db: Database,
  itemId: string
): UnblockWorkItemResult {
  const item = db
    .query("SELECT * FROM work_items WHERE item_id = ?")
    .get(itemId) as BlackboardWorkItem | null;

  if (!item) {
    throw new BlackboardError(`Work item not found: ${itemId}`, "WORK_ITEM_NOT_FOUND");
  }

  if (item.status !== "blocked" && item.status !== "waiting_for_response") {
    throw new BlackboardError(`Work item is not blocked: ${itemId}`, "NOT_BLOCKED");
  }

  const now = new Date().toISOString();
  const restoredStatus = item.claimed_by ? "claimed" : "available";

  db.transaction(() => {
    db.query(
      "UPDATE work_items SET status = ?, blocked_by = NULL WHERE item_id = ?"
    ).run(restoredStatus, itemId);

    const summary = `Work item "${item.title}" unblocked, restored to ${restoredStatus}`;
    db.query(
      "INSERT INTO events (timestamp, event_type, actor_id, target_id, target_type, summary) VALUES (?, 'work_released', NULL, ?, 'work_item', ?)"
    ).run(now, itemId, summary);
  })();

  return { item_id: itemId, unblocked: true, restored_status: restoredStatus };
}

export interface SetWaitingResult {
  item_id: string;
  waiting: boolean;
  previous_status: string;
}

/**
 * Set a work item to waiting_for_response status.
 * Used when a work item is blocked on an external dependency (e.g., cross-project issue).
 * Preserves claimed_by if was claimed.
 */
export function setWaitingForResponse(
  db: Database,
  itemId: string,
  opts?: { blockedBy?: string }
): SetWaitingResult {
  const item = db
    .query("SELECT * FROM work_items WHERE item_id = ?")
    .get(itemId) as BlackboardWorkItem | null;

  if (!item) {
    throw new BlackboardError(`Work item not found: ${itemId}`, "WORK_ITEM_NOT_FOUND");
  }

  if (item.status === "completed") {
    throw new BlackboardError(`Work item already completed: ${itemId}`, "ALREADY_COMPLETED");
  }

  const now = new Date().toISOString();
  const previousStatus = item.status;
  const blockedBy = opts?.blockedBy ?? null;

  db.transaction(() => {
    db.query(
      "UPDATE work_items SET status = 'waiting_for_response', blocked_by = ? WHERE item_id = ?"
    ).run(blockedBy, itemId);

    const summary = `Work item "${item.title}" set to waiting_for_response${blockedBy ? ` (blocked by ${blockedBy})` : ""}`;
    db.query(
      "INSERT INTO events (timestamp, event_type, actor_id, target_id, target_type, summary) VALUES (?, 'work_blocked', NULL, ?, 'work_item', ?)"
    ).run(now, itemId, summary);
  })();

  return { item_id: itemId, waiting: true, previous_status: previousStatus };
}

export interface DeleteWorkItemResult {
  item_id: string;
  deleted: boolean;
  title: string;
  previous_status: string;
  was_claimed_by: string | null;
}

/**
 * Delete a work item from the blackboard.
 * - Claimed items require force=true (agent is actively working)
 * - Completed items can be deleted without force (history cleanup)
 * - Cleans up heartbeat references before deletion
 * - Emits work_deleted event with item details
 */
export function deleteWorkItem(
  db: Database,
  itemId: string,
  force: boolean = false
): DeleteWorkItemResult {
  const item = db
    .query("SELECT * FROM work_items WHERE item_id = ?")
    .get(itemId) as BlackboardWorkItem | null;

  if (!item) {
    throw new BlackboardError(`Work item not found: ${itemId}`, "WORK_ITEM_NOT_FOUND");
  }

  if (item.status === "claimed" && !force) {
    throw new BlackboardError(
      `Work item is currently claimed by ${item.claimed_by}. Use --force to delete.`,
      "ITEM_CLAIMED"
    );
  }

  const now = new Date().toISOString();
  const previousStatus = item.status;
  const wasClaimed = item.claimed_by;

  db.transaction(() => {
    // Clean up heartbeat references
    db.query("UPDATE heartbeats SET work_item_id = NULL WHERE work_item_id = ?").run(itemId);

    // Delete the work item
    db.query("DELETE FROM work_items WHERE item_id = ?").run(itemId);

    // Emit work_deleted event
    const summary = `Work item "${item.title}" deleted (was ${previousStatus}${wasClaimed ? `, claimed by ${wasClaimed.slice(0, 12)}` : ""})`;
    db.query(
      "INSERT INTO events (timestamp, event_type, actor_id, target_id, target_type, summary) VALUES (?, 'work_deleted', NULL, ?, 'work_item', ?)"
    ).run(now, itemId, summary);
  })();

  return {
    item_id: itemId,
    deleted: true,
    title: item.title,
    previous_status: previousStatus,
    was_claimed_by: wasClaimed,
  };
}

export interface FlushWorkItemsResult {
  deleted_count: number;
}

/**
 * Flush (delete) all active work items from the blackboard.
 * Active statuses: available, claimed, blocked, waiting_for_response.
 * - Cleans up heartbeat references for the deleted items
 * - Emits work_deleted events
 */
export function flushActiveWorkItems(db: Database): FlushWorkItemsResult {
  const now = new Date().toISOString();

  // Get all active items first so we can fire events for them
  const itemsToDelete = db
    .query("SELECT item_id, title, status, claimed_by FROM work_items WHERE status IN ('available', 'claimed', 'blocked', 'waiting_for_response')")
    .all() as { item_id: string; title: string; status: string; claimed_by: string | null }[];

  if (itemsToDelete.length === 0) {
    return { deleted_count: 0 };
  }

  const itemIds = itemsToDelete.map(i => i.item_id);

  db.transaction(() => {
    // Generate the IN clause for multiple IDs
    const placeholders = itemIds.map(() => '?').join(',');

    // Clean up heartbeat references
    db.query(`UPDATE heartbeats SET work_item_id = NULL WHERE work_item_id IN (${placeholders})`).run(...itemIds);

    // Delete the work items
    db.query(`DELETE FROM work_items WHERE item_id IN (${placeholders})`).run(...itemIds);

    // Emit event for each deleted item
    for (const item of itemsToDelete) {
      const summary = `Work item "${item.title}" flushed (was ${item.status}${item.claimed_by ? `, claimed by ${item.claimed_by.slice(0, 12)}` : ""})`;
      db.query(
        "INSERT INTO events (timestamp, event_type, actor_id, target_id, target_type, summary) VALUES (?, 'work_deleted', NULL, ?, 'work_item', ?)"
      ).run(now, item.item_id, summary);
    }
  })();

  return { deleted_count: itemsToDelete.length };
}

export interface FlushAllDatabaseResult {
  flushed: boolean;
  timestamp: string;
}

/**
 * Perform a "nuclear flush" by deleting all runtime state:
 * - heartbeats
 * - events (and implicitly events_fts via triggers)
 * - work_items
 * - agents
 * 
 * Does not flush projects or steering_rules.
 */
export function flushAllDatabase(db: Database): FlushAllDatabaseResult {
  const now = new Date().toISOString();

  db.transaction(() => {
    // Unlink steering rules from events to prevent foreign key constraint failures
    // since we want to keep the rules but delete their source events.
    db.query("UPDATE steering_rules SET source_event = NULL").run();

    db.query("DELETE FROM heartbeats").run();
    db.query("DELETE FROM events").run();
    db.query("DELETE FROM work_items").run();
    db.query("DELETE FROM agents").run();
    db.query("DELETE FROM snapshots").run();

    // Log the flush itself so the dashboard isn't completely empty and shows an audit trail
    db.query(
      "INSERT INTO events (timestamp, event_type, actor_id, target_id, target_type, summary) VALUES (?, 'system_flush', NULL, NULL, NULL, 'System performed a full database flush')"
    ).run(now);
  })();

  return { flushed: true, timestamp: now };
}

export interface ListWorkItemsOptions {
  all?: boolean;
  status?: string;
  priority?: string;
  project?: string;
}

export interface WorkItemDetail {
  item: BlackboardWorkItem;
  history: BlackboardEvent[];
}

/**
 * List work items with optional filters.
 * Default: status='available'. Order: priority ASC (P1 first), created_at DESC.
 */
export function listWorkItems(
  db: Database,
  opts?: ListWorkItemsOptions
): BlackboardWorkItem[] {
  const conditions: string[] = [];
  const params: any[] = [];

  if (!opts?.all) {
    if (opts?.status) {
      const statuses = opts.status.split(",").map(s => s.trim());
      for (const s of statuses) {
        if (!WORK_ITEM_STATUSES.includes(s as any)) {
          throw new BlackboardError(
            `Invalid status "${s}". Valid values: ${WORK_ITEM_STATUSES.join(", ")}`,
            "INVALID_STATUS"
          );
        }
      }
      conditions.push(`status IN (${statuses.map(() => "?").join(", ")})`);
      params.push(...statuses);
    } else {
      conditions.push("status = ?");
      params.push("available");
    }
  } else if (opts?.status) {
    // --all with --status: status filter takes precedence
    const statuses = opts.status.split(",").map(s => s.trim());
    for (const s of statuses) {
      if (!WORK_ITEM_STATUSES.includes(s as any)) {
        throw new BlackboardError(
          `Invalid status "${s}". Valid values: ${WORK_ITEM_STATUSES.join(", ")}`,
          "INVALID_STATUS"
        );
      }
    }
    conditions.push(`status IN (${statuses.map(() => "?").join(", ")})`);
    params.push(...statuses);
  }

  if (opts?.priority) {
    const priorities = opts.priority.split(",").map(p => p.trim());
    for (const p of priorities) {
      if (!WORK_ITEM_PRIORITIES.includes(p as any)) {
        throw new BlackboardError(
          `Invalid priority "${p}". Valid values: ${WORK_ITEM_PRIORITIES.join(", ")}`,
          "INVALID_PRIORITY"
        );
      }
    }
    conditions.push(`priority IN (${priorities.map(() => "?").join(", ")})`);
    params.push(...priorities);
  }

  if (opts?.project) {
    conditions.push("project_id = ?");
    params.push(opts.project);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const sql = `SELECT * FROM work_items ${where} ORDER BY priority ASC, created_at ASC`;

  return db.query(sql).all(...params) as BlackboardWorkItem[];
}

/**
 * Get detailed status for a single work item, including event history.
 */
export function getWorkItemStatus(
  db: Database,
  itemId: string
): WorkItemDetail {
  const item = db
    .query("SELECT * FROM work_items WHERE item_id = ?")
    .get(itemId) as BlackboardWorkItem | null;

  if (!item) {
    throw new BlackboardError(
      `Work item not found: ${itemId}`,
      "WORK_ITEM_NOT_FOUND"
    );
  }

  const history = db
    .query(
      "SELECT * FROM events WHERE target_id = ? AND target_type = 'work_item' ORDER BY timestamp ASC"
    )
    .all(itemId) as BlackboardEvent[];

  return { item, history };
}

export interface UpdateWorkItemMetadataResult {
  item_id: string;
  updated: boolean;
  metadata: Record<string, unknown>;
}

/**
 * Merge new keys into a work item's existing metadata JSON.
 * Does not replace the whole object — only updates provided keys.
 * Emits a metadata_updated event.
 */
export function updateWorkItemMetadata(
  db: Database,
  itemId: string,
  metadataUpdates: Record<string, unknown>
): UpdateWorkItemMetadataResult {
  const item = db
    .query("SELECT * FROM work_items WHERE item_id = ?")
    .get(itemId) as BlackboardWorkItem | null;

  if (!item) {
    throw new BlackboardError(`Work item not found: ${itemId}`, "WORK_ITEM_NOT_FOUND");
  }

  // Parse existing metadata or start with empty object
  let existing: Record<string, unknown> = {};
  if (item.metadata) {
    try {
      existing = JSON.parse(item.metadata);
    } catch {
      // If existing metadata is somehow corrupt, start fresh
      existing = {};
    }
  }

  // Merge: new keys override existing
  const merged = { ...existing, ...metadataUpdates };
  const mergedJson = JSON.stringify(merged);

  const now = new Date().toISOString();
  const changedKeys = Object.keys(metadataUpdates);

  db.transaction(() => {
    db.query("UPDATE work_items SET metadata = ? WHERE item_id = ?").run(mergedJson, itemId);

    const summary = `Metadata updated on "${item.title}": ${changedKeys.join(", ")}`;
    db.query(
      "INSERT INTO events (timestamp, event_type, actor_id, target_id, target_type, summary, metadata) VALUES (?, 'metadata_updated', NULL, ?, 'work_item', ?, ?)"
    ).run(now, itemId, summary, JSON.stringify({ keys_updated: changedKeys }));
  })();

  return { item_id: itemId, updated: true, metadata: merged };
}

export interface AppendWorkItemEventOptions {
  event_type: string;
  summary: string;
  actor_id?: string;
  metadata?: Record<string, unknown>;
  source?: string;
}

export interface AppendWorkItemEventResult {
  item_id: string;
  event_id: number;
  event_type: string;
  timestamp: string;
}

/**
 * Record a structured event against a work item.
 * Allows any valid event type to be appended with custom summary and metadata.
 */
export function appendWorkItemEvent(
  db: Database,
  itemId: string,
  opts: AppendWorkItemEventOptions
): AppendWorkItemEventResult {
  const item = db
    .query("SELECT item_id, title FROM work_items WHERE item_id = ?")
    .get(itemId) as { item_id: string; title: string } | null;

  if (!item) {
    throw new BlackboardError(`Work item not found: ${itemId}`, "WORK_ITEM_NOT_FOUND");
  }

  if (!KNOWN_EVENT_TYPES.includes(opts.event_type as KnownEventType)) {
    throw new BlackboardError(
      `Unknown event_type "${opts.event_type}". Known values: ${KNOWN_EVENT_TYPES.join(", ")}`,
      "INVALID_EVENT_TYPE"
    );
  }

  const summary = sanitizeText(opts.summary);
  if (!summary) {
    throw new BlackboardError("Event summary is required", "MISSING_SUMMARY");
  }

  // Content filter: scan event summary if source is external
  if (opts.source && requiresFiltering(opts.source)) {
    ingestExternalContent(summary, opts.source, "mixed");
  }

  let metadataJson: string | null = null;
  if (opts.metadata) {
    metadataJson = JSON.stringify(opts.metadata);
  }

  const now = new Date().toISOString();
  const actorId = opts.actor_id ?? null;

  const result = db.query(
    "INSERT INTO events (timestamp, event_type, actor_id, target_id, target_type, summary, metadata) VALUES (?, ?, ?, ?, 'work_item', ?, ?)"
  ).run(now, opts.event_type, actorId, itemId, summary, metadataJson);

  return {
    item_id: itemId,
    event_id: Number(result.lastInsertRowid),
    event_type: opts.event_type,
    timestamp: now,
  };
}

// ─── Phase 1: Approval workflow ──────────────────────────────────────────

export interface RequestApprovalResult {
  item_id: string;
  requested: boolean;
  previous_status: string;
}

export interface ApproveWorkItemResult {
  item_id: string;
  approved: boolean;
  restored_status: string;
}

export interface RejectWorkItemResult {
  item_id: string;
  rejected: boolean;
}

/**
 * Request human approval for a claimed work item.
 * Transitions claimed → pending_approval and stores the approval request details.
 *
 * @param db - Database handle
 * @param itemId - Work item to request approval for
 * @param request - JSON-serializable description of what the agent wants to do
 */
export function requestApproval(
  db: Database,
  itemId: string,
  request: Record<string, unknown>
): RequestApprovalResult {
  const item = db
    .query("SELECT * FROM work_items WHERE item_id = ?")
    .get(itemId) as BlackboardWorkItem | null;

  if (!item) {
    throw new BlackboardError(`Work item not found: ${itemId}`, "WORK_ITEM_NOT_FOUND");
  }

  if (item.status !== "claimed") {
    throw new BlackboardError(
      `Work item must be claimed to request approval (current: ${item.status})`,
      "INVALID_STATUS_TRANSITION"
    );
  }

  const now = new Date().toISOString();
  const previousStatus = item.status;

  db.transaction(() => {
    db.query(
      "UPDATE work_items SET status = 'pending_approval', approval_request = ? WHERE item_id = ?"
    ).run(JSON.stringify(request), itemId);

    const summary = `Approval requested for "${item.title}": ${request.action ?? 'unspecified action'}`;
    db.query(
      "INSERT INTO events (timestamp, event_type, actor_id, target_id, target_type, summary, metadata) VALUES (?, 'approval_requested', ?, ?, 'work_item', ?, ?)"
    ).run(now, item.claimed_by, itemId, summary, JSON.stringify(request));
  })();

  return { item_id: itemId, requested: true, previous_status: previousStatus };
}

/**
 * Approve a pending_approval work item.
 * Transitions pending_approval → claimed so the agent can resume.
 */
export function approveWorkItem(
  db: Database,
  itemId: string
): ApproveWorkItemResult {
  const item = db
    .query("SELECT * FROM work_items WHERE item_id = ?")
    .get(itemId) as BlackboardWorkItem | null;

  if (!item) {
    throw new BlackboardError(`Work item not found: ${itemId}`, "WORK_ITEM_NOT_FOUND");
  }

  if (item.status !== "pending_approval") {
    throw new BlackboardError(
      `Work item must be pending_approval to approve (current: ${item.status})`,
      "INVALID_STATUS_TRANSITION"
    );
  }

  const now = new Date().toISOString();

  db.transaction(() => {
    db.query(
      "UPDATE work_items SET status = 'claimed', approval_request = NULL WHERE item_id = ?"
    ).run(itemId);

    const summary = `Approval granted for "${item.title}"`;
    db.query(
      "INSERT INTO events (timestamp, event_type, actor_id, target_id, target_type, summary) VALUES (?, 'approval_granted', 'operator', ?, 'work_item', ?)"
    ).run(now, itemId, summary);
  })();

  return { item_id: itemId, approved: true, restored_status: "claimed" };
}

/**
 * Reject a pending_approval work item.
 * Transitions pending_approval → available, clears claim and approval request.
 */
export function rejectWorkItem(
  db: Database,
  itemId: string
): RejectWorkItemResult {
  const item = db
    .query("SELECT * FROM work_items WHERE item_id = ?")
    .get(itemId) as BlackboardWorkItem | null;

  if (!item) {
    throw new BlackboardError(`Work item not found: ${itemId}`, "WORK_ITEM_NOT_FOUND");
  }

  if (item.status !== "pending_approval") {
    throw new BlackboardError(
      `Work item must be pending_approval to reject (current: ${item.status})`,
      "INVALID_STATUS_TRANSITION"
    );
  }

  const now = new Date().toISOString();

  db.transaction(() => {
    db.query(
      "UPDATE work_items SET status = 'available', claimed_by = NULL, claimed_at = NULL, approval_request = NULL WHERE item_id = ?"
    ).run(itemId);

    const summary = `Approval rejected for "${item.title}" — released back to available`;
    db.query(
      "INSERT INTO events (timestamp, event_type, actor_id, target_id, target_type, summary) VALUES (?, 'approval_rejected', 'operator', ?, 'work_item', ?)"
    ).run(now, itemId, summary);
  })();

  return { item_id: itemId, rejected: true };
}

// ─── Phase 1: Agent handover ─────────────────────────────────────────────

export interface HandoverWorkItemResult {
  item_id: string;
  handed_over: boolean;
  previous_claimed_by: string | null;
}

/**
 * Hand over a work item from one agent to the next with context.
 * Like releaseWorkItem, but stores structured handover context that the
 * next agent to claim the item will receive in their prompt.
 *
 * @param db - Database handle
 * @param itemId - Work item to hand over
 * @param sessionId - Current agent releasing the item
 * @param context - Structured handover context (progress, next steps, etc.)
 */
export function handoverWorkItem(
  db: Database,
  itemId: string,
  sessionId: string,
  context: Record<string, unknown>
): HandoverWorkItemResult {
  const item = db
    .query("SELECT * FROM work_items WHERE item_id = ?")
    .get(itemId) as BlackboardWorkItem | null;

  if (!item) {
    throw new BlackboardError(`Work item not found: ${itemId}`, "WORK_ITEM_NOT_FOUND");
  }

  if (item.status !== "claimed") {
    throw new BlackboardError(`Work item is not claimed: ${itemId}`, "NOT_CLAIMED");
  }

  if (item.claimed_by !== sessionId) {
    throw new BlackboardError(`Work item not claimed by session: ${sessionId}`, "NOT_CLAIMED_BY_SESSION");
  }

  const now = new Date().toISOString();
  const previousClaimedBy = item.claimed_by;

  db.transaction(() => {
    db.query(
      "UPDATE work_items SET status = 'available', claimed_by = NULL, claimed_at = NULL, handover_context = ? WHERE item_id = ?"
    ).run(JSON.stringify(context), itemId);

    const agentRow = db.query("SELECT agent_name FROM agents WHERE session_id = ?").get(sessionId) as { agent_name: string } | null;
    const agentName = agentRow?.agent_name ?? sessionId.slice(0, 12);
    const summary = `Work item "${item.title}" handed over by agent ${agentName} with context`;
    db.query(
      "INSERT INTO events (timestamp, event_type, actor_id, target_id, target_type, summary, metadata) VALUES (?, 'work_handover', ?, ?, 'work_item', ?, ?)"
    ).run(now, sessionId, itemId, summary, JSON.stringify(context));
  })();

  return { item_id: itemId, handed_over: true, previous_claimed_by: previousClaimedBy };
}
