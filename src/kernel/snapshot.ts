import type { Database } from "bun:sqlite";
import type { BlackboardSnapshot } from "./types";
import { listAgents } from "./agent";
import { listWorkItems } from "./work";

// ─── Types ──────────────────────────────────────────────────────────────

export interface CreateSnapshotResult {
    snapshot_id: string;
    item_count: number;
    agent_count: number;
}

export interface RestoreSnapshotResult {
    restored: boolean;
    items_restored: number;
}

// ─── Core Functions ─────────────────────────────────────────────────────

/**
 * Create a snapshot of current blackboard state (work items + agents).
 * Serializes all non-completed work items and active agents into a JSON blob.
 *
 * @param db - Database handle
 * @param trigger - What caused the snapshot (e.g. 'pre-dispatch', 'manual')
 */
export function createSnapshot(
    db: Database,
    trigger: string
): CreateSnapshotResult {
    const snapshotId = `snap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    // Capture current state
    const workItems = listWorkItems(db, { all: true });
    const agents = listAgents(db, { all: true });
    const activeItems = workItems.filter(
        (w) => w.status !== "completed"
    );

    const data = JSON.stringify({
        work_items: activeItems,
        agents,
    });

    db.query(
        `INSERT INTO snapshots (snapshot_id, created_at, trigger, item_count, agent_count, data)
     VALUES (?, ?, ?, ?, ?, ?)`
    ).run(snapshotId, now, trigger, activeItems.length, agents.length, data);

    // Emit event
    db.query(
        `INSERT INTO events (timestamp, event_type, actor_id, target_id, target_type, summary, metadata)
     VALUES (?, 'snapshot_created', 'system', ?, NULL, ?, ?)`
    ).run(
        now,
        snapshotId,
        `Snapshot created (${trigger}): ${activeItems.length} items, ${agents.length} agents`,
        JSON.stringify({ trigger, item_count: activeItems.length, agent_count: agents.length })
    );

    return {
        snapshot_id: snapshotId,
        item_count: activeItems.length,
        agent_count: agents.length,
    };
}

/**
 * List available snapshots, most recent first.
 *
 * @param db - Database handle
 * @param limit - Max snapshots to return (default 20)
 */
export function listSnapshots(
    db: Database,
    limit: number = 20
): Omit<BlackboardSnapshot, "data">[] {
    return db
        .query(
            `SELECT snapshot_id, created_at, trigger, item_count, agent_count
       FROM snapshots ORDER BY created_at DESC LIMIT ?`
        )
        .all(limit) as Omit<BlackboardSnapshot, "data">[];
}

/**
 * Restore work items from a snapshot.
 * Resets all non-completed work items to their snapshotted state.
 *
 * @param db - Database handle
 * @param snapshotId - The snapshot to restore from
 */
export function restoreSnapshot(
    db: Database,
    snapshotId: string
): RestoreSnapshotResult {
    const snap = db
        .query("SELECT * FROM snapshots WHERE snapshot_id = ?")
        .get(snapshotId) as BlackboardSnapshot | null;

    if (!snap || !snap.data) {
        return { restored: false, items_restored: 0 };
    }

    const parsed = JSON.parse(snap.data) as {
        work_items: Array<{
            item_id: string;
            status: string;
            claimed_by: string | null;
            claimed_at: string | null;
            metadata: string | null;
            handover_context: string | null;
            approval_request: string | null;
        }>;
    };

    const now = new Date().toISOString();
    let restored = 0;

    db.transaction(() => {
        for (const item of parsed.work_items) {
            const result = db
                .query(
                    `UPDATE work_items
           SET status = ?, claimed_by = ?, claimed_at = ?,
               metadata = ?, handover_context = ?, approval_request = ?
           WHERE item_id = ? AND status != 'completed'`
                )
                .run(
                    item.status,
                    item.claimed_by,
                    item.claimed_at,
                    item.metadata,
                    item.handover_context ?? null,
                    item.approval_request ?? null,
                    item.item_id
                );
            if (result.changes > 0) restored++;
        }

        // Emit event
        db.query(
            `INSERT INTO events (timestamp, event_type, actor_id, target_id, target_type, summary, metadata)
       VALUES (?, 'snapshot_restored', 'system', ?, NULL, ?, ?)`
        ).run(
            now,
            snapshotId,
            `Restored ${restored} work items from snapshot ${snapshotId}`,
            JSON.stringify({ snapshot_id: snapshotId, items_restored: restored })
        );
    })();

    return { restored: true, items_restored: restored };
}
