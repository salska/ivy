import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

mock.module('../src/kernel/ingestion', () => ({
    ingestExternalContent: () => ({ allowed: true }),
    requiresFiltering: () => false,
    mergeFilterMetadata: (existing: any, result: any) => existing
}));

import { Blackboard } from '../src/runtime/blackboard.ts';
import { loadAlgorithmTemplate } from '../src/runtime/hooks/pre-session.ts';
import { runPostSession } from '../src/runtime/commands/kai-manual.ts';

// ── Pre-session prompt generation ───────────────────────────────────────

describe('kai-manual pre-session', () => {
    let bb: Blackboard;
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'kai-manual-'));
        bb = new Blackboard(join(tmpDir, 'test.db'));
    });

    afterEach(() => {
        bb.close();
        rmSync(tmpDir, { recursive: true, force: true });
    });

    test('loadAlgorithmTemplate returns valid markdown with placeholders replaced', () => {
        const template = loadAlgorithmTemplate(bb.db);

        // Should contain the algorithm phases
        expect(template).toContain('Phase 1: OBSERVE');
        expect(template).toContain('Phase 7: LEARN');
        expect(template).toContain('PHASE_REPORT');

        // Placeholders should be replaced (not present as raw {{...}})
        expect(template).not.toContain('{{STEERING_RULES}}');
        expect(template).not.toContain('{{PROJECT_CONTEXT}}');

        // Default text when no prior sessions exist
        expect(template).toContain('No steering rules yet');
        expect(template).toContain('No prior sessions found');
    });

    test('loadAlgorithmTemplate injects steering rules from past facts', () => {
        // Seed the DB with a fact
        bb.appendEvent({
            summary: 'Fact extracted: This project uses Bun instead of Node',
            metadata: {
                hookEvent: 'fact_extracted',
                text: 'This project uses Bun instead of Node',
                source: 'test',
            },
        });

        const template = loadAlgorithmTemplate(bb.db);

        // Should contain the injected fact
        expect(template).toContain('This project uses Bun instead of Node');
        // Default placeholder text should be gone
        expect(template).not.toContain('No steering rules yet');
    });

    test('loadAlgorithmTemplate injects project context from past sessions', () => {
        // Seed the DB with a session completion event
        bb.appendEvent({
            summary: 'Completed "Refactor auth module"',
            metadata: {
                hookEvent: 'session_ended',
                sessionId: 'test-session-1',
            },
        });

        const template = loadAlgorithmTemplate(bb.db);

        // Should contain the session reference
        expect(template).toContain('Refactor auth module');
        expect(template).not.toContain('No prior sessions found');
    });
});

// ── Post-session fact extraction ────────────────────────────────────────

describe('kai-manual post-session (runPostSession)', () => {
    let bb: Blackboard;
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'kai-post-'));
        bb = new Blackboard(join(tmpDir, 'test.db'));
    });

    afterEach(() => {
        bb.close();
        rmSync(tmpDir, { recursive: true, force: true });
    });

    test('extracts facts from a valid transcript and writes events to DB', () => {
        const transcriptPath = join(tmpDir, 'session.jsonl');
        writeFileSync(transcriptPath, [
            JSON.stringify({
                type: 'message',
                role: 'user',
                content: 'Fix the authentication bug',
                timestamp: '2026-02-23T10:00:00Z',
            }),
            JSON.stringify({
                type: 'message',
                role: 'assistant',
                content: 'The root cause was a missing null check in the JWT parser. We decided to add validation at the middleware layer.',
                timestamp: '2026-02-23T10:05:00Z',
            }),
            JSON.stringify({
                type: 'message',
                role: 'assistant',
                content: 'This project uses Express.js for all API routes.',
                timestamp: '2026-02-23T10:10:00Z',
            }),
        ].join('\n'));

        const factCount = runPostSession(bb, transcriptPath, 'test-session-123');

        // Should have extracted at least 1 fact
        expect(factCount).toBeGreaterThanOrEqual(1);

        // Verify events were written to the DB
        const events = bb.eventQueries.getRecent(20);
        const hookEvents = events.filter((e) => e.metadata?.includes('"kai-manual"'));

        // Should have session_started, session_activity, session_ended, plus facts
        expect(hookEvents.length).toBeGreaterThanOrEqual(3);
        expect(hookEvents.some((e) => e.metadata?.includes('"session_started"'))).toBe(true);
        expect(hookEvents.some((e) => e.metadata?.includes('"session_ended"'))).toBe(true);
        expect(hookEvents.some((e) => e.metadata?.includes('"session_activity"'))).toBe(true);
    });

    test('returns 0 for missing transcript file', () => {
        const factCount = runPostSession(bb, '/nonexistent/path.jsonl', 'missing-session');
        expect(factCount).toBe(0);
    });

    test('returns 0 for empty transcript', () => {
        const transcriptPath = join(tmpDir, 'empty.jsonl');
        writeFileSync(transcriptPath, '');

        const factCount = runPostSession(bb, transcriptPath, 'empty-session');
        expect(factCount).toBe(0);
    });

    test('returns 0 for transcript with no parseable messages', () => {
        const transcriptPath = join(tmpDir, 'garbage.jsonl');
        writeFileSync(transcriptPath, 'not json\nalso not json\n');

        const factCount = runPostSession(bb, transcriptPath, 'garbage-session');
        expect(factCount).toBe(0);
    });

    test('facts from post-session are available in next pre-session', () => {
        // Simulate a session that produces learnable facts
        const transcriptPath = join(tmpDir, 'learn-session.jsonl');
        writeFileSync(transcriptPath, [
            JSON.stringify({
                type: 'message',
                role: 'assistant',
                content: 'Key insight: The database migrations must run before seeding test data.',
                timestamp: '2026-02-23T10:00:00Z',
            }),
        ].join('\n'));

        // Run post-session to extract the fact
        runPostSession(bb, transcriptPath, 'learn-session-1');

        // Now run pre-session — the extracted fact should appear as a steering rule
        const template = loadAlgorithmTemplate(bb.db);
        expect(template).toContain('database migrations must run before seeding test data');
    });
});
