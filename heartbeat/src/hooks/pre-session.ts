/**
 * Pre-session hook for the PAI Hybrid Algorithm.
 *
 * Queries the blackboard's events table for past learnings relevant to
 * a specific project. Returns formatted context blocks that get injected
 * into the Hybrid_Algorithm.md template before the agent starts.
 *
 * Usage (standalone):
 *   bun src/hooks/pre-session.ts --project <project-id> [--db <path>]
 *
 * Usage (programmatic):
 *   import { loadProjectContext } from './pre-session.ts';
 *   const context = loadProjectContext(bb, 'ivy-blackboard');
 */

import type { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ProjectContext {
    /** Formatted steering rules block (from past learnings) */
    steeringRules: string;
    /** Formatted project context block (recent session history) */
    projectContext: string;
    /** Number of facts/patterns loaded */
    factCount: number;
    /** Number of recent sessions referenced */
    sessionCount: number;
}

interface EventRow {
    summary: string;
    metadata: string | null;
    timestamp: string;
}

/**
 * Load the Hybrid Algorithm template and inject project-specific context.
 */
export function loadAlgorithmTemplate(
    db: Database,
    projectId?: string
): string {
    const templatePath = join(import.meta.dir, 'Hybrid_Algorithm.md');
    let template = readFileSync(templatePath, 'utf-8');

    const context = loadProjectContext(db, projectId);

    template = template.replace(
        '{{STEERING_RULES}}',
        context.steeringRules || '_No steering rules yet. This is the first session for this project._'
    );
    template = template.replace(
        '{{PROJECT_CONTEXT}}',
        context.projectContext || '_No prior sessions found for this project._'
    );

    return template;
}

/**
 * Query the blackboard for past learnings and session history
 * relevant to a specific project.
 */
export function loadProjectContext(
    db: Database,
    projectId?: string
): ProjectContext {
    const facts = loadFactsAndPatterns(db, projectId);
    const sessions = loadRecentSessions(db, projectId);

    return {
        steeringRules: formatSteeringRules(facts),
        projectContext: formatProjectContext(sessions),
        factCount: facts.length,
        sessionCount: sessions.length,
    };
}

/**
 * Query events table for extracted facts and detected patterns.
 * These become "steering rules" — behavioral guidance from past sessions.
 */
function loadFactsAndPatterns(
    db: Database,
    projectId?: string,
    limit = 20
): EventRow[] {
    // Facts and patterns are stored with hookEvent metadata
    // We search for them in the summary field since metadata is JSON
    const query = projectId
        ? `SELECT summary, metadata, timestamp FROM events
       WHERE (summary LIKE 'Fact extracted:%' OR summary LIKE 'Pattern detected:%')
       AND (
         metadata LIKE ? OR
         target_id IN (
           SELECT item_id FROM work_items WHERE project_id = ?
         )
       )
       ORDER BY timestamp DESC
       LIMIT ?`
        : `SELECT summary, metadata, timestamp FROM events
       WHERE (summary LIKE 'Fact extracted:%' OR summary LIKE 'Pattern detected:%')
       ORDER BY timestamp DESC
       LIMIT ?`;

    const params = projectId
        ? [`%${projectId}%`, projectId, limit]
        : [limit];

    return db.prepare(query).all(...params) as EventRow[];
}

/**
 * Query events table for recent session completion events.
 * Provides the agent with historical context about what's been done.
 */
function loadRecentSessions(
    db: Database,
    projectId?: string,
    limit = 5
): EventRow[] {
    const query = projectId
        ? `SELECT summary, metadata, timestamp FROM events
       WHERE summary LIKE 'Completed "%' 
       AND (
         metadata LIKE ? OR
         target_id IN (
           SELECT item_id FROM work_items WHERE project_id = ?
         )
       )
       ORDER BY timestamp DESC
       LIMIT ?`
        : `SELECT summary, metadata, timestamp FROM events
       WHERE summary LIKE 'Completed "%'
       ORDER BY timestamp DESC
       LIMIT ?`;

    const params = projectId
        ? [`%${projectId}%`, projectId, limit]
        : [limit];

    return db.prepare(query).all(...params) as EventRow[];
}

/**
 * Format extracted facts/patterns into a human-readable steering rules block.
 */
function formatSteeringRules(facts: EventRow[]): string {
    if (facts.length === 0) return '';

    const lines = facts.map((f) => {
        // Strip the "Fact extracted: " or "Pattern detected: " prefix
        const text = f.summary
            .replace(/^Fact extracted:\s*/i, '')
            .replace(/^Pattern detected:\s*/i, '');
        const isPattern = f.summary.startsWith('Pattern');
        const bullet = isPattern ? '🔄' : '📌';
        return `- ${bullet} ${text}`;
    });

    return [
        `_${facts.length} rule(s) loaded from past sessions:_`,
        '',
        ...lines,
    ].join('\n');
}

/**
 * Format recent session history into a project context block.
 */
function formatProjectContext(sessions: EventRow[]): string {
    if (sessions.length === 0) return '';

    const lines = sessions.map((s) => {
        const date = s.timestamp.split('T')[0];
        return `- [${date}] ${s.summary}`;
    });

    return [
        `_${sessions.length} recent session(s):_`,
        '',
        ...lines,
    ].join('\n');
}

// ─── Standalone CLI usage ──────────────────────────────────────────────

if (import.meta.main) {
    const { Blackboard } = await import('../blackboard.ts');

    const args = process.argv.slice(2);
    const projectIdx = args.indexOf('--project');
    const projectId = projectIdx >= 0 ? args[projectIdx + 1] : undefined;

    const dbIdx = args.indexOf('--db');
    const dbPath = dbIdx >= 0 ? args[dbIdx + 1] : undefined;

    if (!projectId) {
        console.error('Usage: pre-session.ts --project <project-id> [--db <path>]');
        process.exit(1);
    }

    const bb = new Blackboard(dbPath);

    try {
        const context = loadProjectContext(bb.db, projectId);

        console.log('=== Steering Rules ===');
        console.log(context.steeringRules || '(none)');
        console.log('');
        console.log('=== Project Context ===');
        console.log(context.projectContext || '(none)');
        console.log('');
        console.log(`Loaded: ${context.factCount} facts/patterns, ${context.sessionCount} recent sessions`);
    } finally {
        bb.close();
    }
}
