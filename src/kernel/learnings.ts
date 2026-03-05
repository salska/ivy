import type { Database } from "bun:sqlite";
import type { BlackboardEvent, SteeringRule } from "./types";

// ─── Learning event types we query for ───────────────────────────────
const LEARNING_EVENT_TYPES = [
    "fact_extracted",
    "pattern_detected",
    "session_learning",
] as const;

const DEFAULT_LIMIT = 20;

// ─── Interfaces ──────────────────────────────────────────────────────

export interface QueryLearningsOptions {
    limit?: number;
    since?: string; // ISO 8601 timestamp
}

export interface PromptContext {
    steeringRules: string;
    sessionHistory: string;
    ruleCount: number;
}

export interface SynthesisResult {
    rulesCreated: number;
    rulesUpdated: number;
    totalActive: number;
}

// ─── Query functions ─────────────────────────────────────────────────

/**
 * Pull learning events (fact_extracted, pattern_detected, session_learning)
 * scoped to a project. Returns up to `limit` items, most recent first.
 */
export function queryLearnings(
    db: Database,
    projectId: string,
    opts?: QueryLearningsOptions
): BlackboardEvent[] {
    const limit = opts?.limit ?? DEFAULT_LIMIT;
    const conditions = [
        `event_type IN (${LEARNING_EVENT_TYPES.map(() => "?").join(", ")})`,
        `target_id = ?`,
        `target_type = 'project'`,
    ];
    const params: any[] = [...LEARNING_EVENT_TYPES, projectId];

    if (opts?.since) {
        conditions.push("timestamp >= ?");
        params.push(opts.since);
    }

    params.push(limit);

    const sql = `SELECT * FROM events WHERE ${conditions.join(" AND ")} ORDER BY timestamp DESC LIMIT ?`;
    return db.query(sql).all(...params) as BlackboardEvent[];
}

/**
 * Fetch active steering rules for a project, sorted by confidence DESC.
 */
export function getSteeringRules(
    db: Database,
    projectId: string
): SteeringRule[] {
    return db
        .query(
            `SELECT * FROM steering_rules
       WHERE project_id = ? AND status = 'active'
       ORDER BY confidence DESC, hit_count DESC`
        )
        .all(projectId) as SteeringRule[];
}

/**
 * Analyze recent learnings and synthesize them into steering rules.
 *
 * Algorithm:
 * 1. Fetch recent learning events for the project (last 100)
 * 2. Extract keywords from event summaries (words 4+ chars)
 * 3. If a keyword cluster appears 3+ times, promote to a steering rule
 * 4. For existing rules whose source facts keep appearing, boost confidence
 * 5. Emit rule_synthesized events for new rules
 */
export function synthesizeRules(
    db: Database,
    projectId: string
): SynthesisResult {
    // 1. Fetch recent learning events (wider window for synthesis)
    const events = queryLearnings(db, projectId, { limit: 100 });

    if (events.length === 0) {
        const active = getSteeringRules(db, projectId);
        return { rulesCreated: 0, rulesUpdated: 0, totalActive: active.length };
    }

    // 2. Extract fact sentences from summaries — group by frequency
    const factCounts = new Map<string, { count: number; eventIds: number[]; summaries: string[] }>();
    for (const event of events) {
        // Normalize: lowercase, trim, collapse whitespace
        const normalized = event.summary.toLowerCase().trim().replace(/\s+/g, " ");
        if (!normalized) continue;

        // Extract meaningful phrases (sentences or the whole summary if short)
        const phrases = normalized.length < 80
            ? [normalized]
            : normalized.split(/[.;!?]/).map((s) => s.trim()).filter((s) => s.length > 10);

        for (const phrase of phrases) {
            const existing = factCounts.get(phrase);
            if (existing) {
                existing.count++;
                existing.eventIds.push(event.id);
                existing.summaries.push(event.summary);
            } else {
                factCounts.set(phrase, {
                    count: 1,
                    eventIds: [event.id],
                    summaries: [event.summary],
                });
            }
        }
    }

    // 3. Get existing rules to avoid duplicates
    const existingRules = db
        .query(
            `SELECT * FROM steering_rules WHERE project_id = ? AND status IN ('active', 'candidate')`
        )
        .all(projectId) as SteeringRule[];

    const existingTexts = new Set(
        existingRules.map((r) => r.rule_text.toLowerCase().trim())
    );

    const now = new Date().toISOString();
    let rulesCreated = 0;
    let rulesUpdated = 0;

    // 4. Promote frequent patterns to rules
    for (const [phrase, data] of factCounts) {
        if (data.count < 3) continue; // Must appear 3+ times

        const ruleText = data.summaries[0]!; // Use original casing from first occurrence

        // Check if already exists
        if (existingTexts.has(phrase)) {
            // Boost confidence of existing rule
            const confidence = Math.min(1, data.count / 10);
            db.query(
                `UPDATE steering_rules
         SET confidence = MAX(confidence, ?), hit_count = hit_count + ?, updated_at = ?
         WHERE project_id = ? AND LOWER(TRIM(rule_text)) = ?`
            ).run(confidence, data.count, now, projectId, phrase);
            rulesUpdated++;
        } else {
            // Create new rule
            const ruleId = `rule-${crypto.randomUUID().slice(0, 8)}`;
            const confidence = Math.min(1, data.count / 10);
            const sourceEvent = data.eventIds[0]!;

            db.query(
                `INSERT INTO steering_rules (rule_id, project_id, rule_text, source_event, confidence, hit_count, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`
            ).run(ruleId, projectId, ruleText, sourceEvent, confidence, data.count, now, now) as any;

            // Emit rule_synthesized event
            db.query(
                `INSERT INTO events (timestamp, event_type, actor_id, target_id, target_type, summary, metadata)
         VALUES (?, 'rule_synthesized', 'system', ?, 'project', ?, ?)`
            ).run(
                now,
                projectId,
                `Synthesized rule: ${ruleText.slice(0, 100)}`,
                JSON.stringify({ rule_id: ruleId, source_count: data.count })
            );

            rulesCreated++;
            existingTexts.add(phrase);
        }
    }

    const totalActive = getSteeringRules(db, projectId).length;
    return { rulesCreated, rulesUpdated, totalActive };
}

/**
 * Build a formatted prompt context block for agent injection.
 *
 * Returns an object with:
 * - steeringRules: formatted list of active rules
 * - sessionHistory: formatted list of recent session events
 * - ruleCount: number of active rules
 */
export function buildPromptContext(
    db: Database,
    projectId: string
): PromptContext {
    // 1. Get active steering rules
    const rules = getSteeringRules(db, projectId);

    let steeringRules: string;
    if (rules.length === 0) {
        steeringRules = "No steering rules yet. Learn from this session.";
    } else {
        steeringRules = rules
            .map((r, i) => `${i + 1}. [confidence: ${r.confidence.toFixed(2)}] ${r.rule_text}`)
            .join("\n");
    }

    // 2. Get recent session/learning history
    const recentEvents = queryLearnings(db, projectId, { limit: 10 });

    let sessionHistory: string;
    if (recentEvents.length === 0) {
        sessionHistory = "No prior session history for this project.";
    } else {
        sessionHistory = recentEvents
            .map((e) => `- [${e.event_type}] ${e.summary}`)
            .join("\n");
    }

    // 3. Increment hit_count for the rules being injected
    if (rules.length > 0) {
        const ruleIds = rules.map((r) => r.rule_id);
        const placeholders = ruleIds.map(() => "?").join(", ");
        db.query(
            `UPDATE steering_rules SET hit_count = hit_count + 1, updated_at = ? WHERE rule_id IN (${placeholders})`
        ).run(new Date().toISOString(), ...ruleIds);
    }

    return {
        steeringRules,
        sessionHistory,
        ruleCount: rules.length,
    };
}
