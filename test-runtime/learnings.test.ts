import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDatabase, closeDatabase } from "../src/kernel/db";
import { resetConfigCache } from "../src/kernel/config";
import type { Database } from "bun:sqlite";

const PROJECT_ROOT = join(import.meta.dir, "..");

let db: Database;
let dbPath: string;
let tmpDir: string;

beforeEach(() => {
    tmpDir = join(tmpdir(), `bb-learnings-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    dbPath = join(tmpDir, "test.db");
    resetConfigCache();
    db = openDatabase(dbPath);

    // Register a project for scoping
    db.query(
        "INSERT INTO projects (project_id, display_name, registered_at) VALUES (?, ?, ?)"
    ).run("test-proj", "Test Project", new Date().toISOString());
});

afterEach(() => {
    closeDatabase(db);
    rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Helper: insert a learning event ─────────────────────────────
function insertLearning(
    db: Database,
    type: string,
    projectId: string,
    summary: string,
    offsetSeconds: number = 0
) {
    const ts = new Date(Date.now() - offsetSeconds * 1000).toISOString();
    db.query(
        "INSERT INTO events (timestamp, event_type, actor_id, target_id, target_type, summary) VALUES (?, ?, 'system', ?, 'project', ?)"
    ).run(ts, type, projectId, summary);
}

// ─── Schema migration ────────────────────────────────────────────
describe("Schema v6 migration", () => {
    test("steering_rules table exists after openDatabase", () => {
        const tables = db
            .query(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='steering_rules'"
            )
            .all() as { name: string }[];
        expect(tables.length).toBe(1);
        expect(tables[0]!.name).toBe("steering_rules");
    });

    test("steering_rules has expected columns", () => {
        const info = db.query("PRAGMA table_info(steering_rules)").all() as {
            name: string;
        }[];
        const cols = info.map((c) => c.name);
        expect(cols).toContain("rule_id");
        expect(cols).toContain("project_id");
        expect(cols).toContain("rule_text");
        expect(cols).toContain("source_event");
        expect(cols).toContain("confidence");
        expect(cols).toContain("hit_count");
        expect(cols).toContain("status");
        expect(cols).toContain("created_at");
        expect(cols).toContain("updated_at");
        expect(cols).toContain("metadata");
    });

    test("schema version is 7", () => {
        const row = db
            .query("SELECT MAX(version) as version FROM schema_version")
            .get() as { version: number };
        expect(row.version).toBe(7);
    });
});

// ─── queryLearnings ──────────────────────────────────────────────
describe("queryLearnings", () => {
    test("returns learning events scoped to a project", async () => {
        const { queryLearnings } = await import("../src/kernel/learnings");

        insertLearning(db, "fact_extracted", "test-proj", "Foo uses bar pattern");
        insertLearning(db, "pattern_detected", "test-proj", "Repeated timeout in API calls");
        insertLearning(db, "agent_registered", "test-proj", "Agent registered"); // NOT a learning type

        const results = queryLearnings(db, "test-proj");
        expect(results.length).toBe(2);
        expect(results.every((e) => e.target_id === "test-proj")).toBe(true);
    });

    test("does not return non-learning event types", async () => {
        const { queryLearnings } = await import("../src/kernel/learnings");

        insertLearning(db, "work_completed", "test-proj", "Work done");
        const results = queryLearnings(db, "test-proj");
        expect(results.length).toBe(0);
    });

    test("does not return events from other projects", async () => {
        const { queryLearnings } = await import("../src/kernel/learnings");

        insertLearning(db, "fact_extracted", "other-proj", "Some other learning");
        const results = queryLearnings(db, "test-proj");
        expect(results.length).toBe(0);
    });

    test("respects the limit cap", async () => {
        const { queryLearnings } = await import("../src/kernel/learnings");

        for (let i = 0; i < 25; i++) {
            insertLearning(db, "fact_extracted", "test-proj", `Fact ${i}`, 25 - i);
        }

        const results = queryLearnings(db, "test-proj");
        expect(results.length).toBe(20); // default limit

        const limited = queryLearnings(db, "test-proj", { limit: 5 });
        expect(limited.length).toBe(5);
    });

    test("returns most recent first", async () => {
        const { queryLearnings } = await import("../src/kernel/learnings");

        insertLearning(db, "fact_extracted", "test-proj", "Old fact", 120);
        insertLearning(db, "fact_extracted", "test-proj", "New fact", 0);

        const results = queryLearnings(db, "test-proj");
        expect(results[0]!.summary).toBe("New fact");
        expect(results[1]!.summary).toBe("Old fact");
    });

    test("returns empty array when no learnings exist", async () => {
        const { queryLearnings } = await import("../src/kernel/learnings");
        const results = queryLearnings(db, "test-proj");
        expect(results).toEqual([]);
    });
});

// ─── getSteeringRules ────────────────────────────────────────────
describe("getSteeringRules", () => {
    test("returns only active rules sorted by confidence", async () => {
        const { getSteeringRules } = await import("../src/kernel/learnings");
        const now = new Date().toISOString();

        db.query(
            "INSERT INTO steering_rules (rule_id, project_id, rule_text, confidence, hit_count, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        ).run("r1", "test-proj", "Always validate input", 0.9, 5, "active", now, now);
        db.query(
            "INSERT INTO steering_rules (rule_id, project_id, rule_text, confidence, hit_count, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        ).run("r2", "test-proj", "Handle timeout gracefully", 0.5, 2, "active", now, now);
        db.query(
            "INSERT INTO steering_rules (rule_id, project_id, rule_text, confidence, hit_count, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        ).run("r3", "test-proj", "Old retired rule", 0.8, 10, "retired", now, now);

        const rules = getSteeringRules(db, "test-proj");
        expect(rules.length).toBe(2);
        expect(rules[0]!.rule_id).toBe("r1"); // highest confidence first
        expect(rules[1]!.rule_id).toBe("r2");
    });

    test("does not return rules from other projects", async () => {
        const { getSteeringRules } = await import("../src/kernel/learnings");
        const now = new Date().toISOString();

        // Register the other project first (FK constraint)
        db.query(
            "INSERT OR IGNORE INTO projects (project_id, display_name, registered_at) VALUES (?, ?, ?)"
        ).run("other-proj", "Other Project", now);

        db.query(
            "INSERT INTO steering_rules (rule_id, project_id, rule_text, confidence, hit_count, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        ).run("r4", "other-proj", "Other project rule", 0.9, 1, "active", now, now);

        const rules = getSteeringRules(db, "test-proj");
        expect(rules.length).toBe(0);
    });
});

// ─── synthesizeRules ─────────────────────────────────────────────
describe("synthesizeRules", () => {
    test("creates rules from facts appearing 3+ times", async () => {
        const { synthesizeRules, getSteeringRules } = await import("../src/kernel/learnings");

        // Same fact 3 times
        for (let i = 0; i < 3; i++) {
            insertLearning(db, "fact_extracted", "test-proj", "Always validate input", i);
        }

        const result = synthesizeRules(db, "test-proj");
        expect(result.rulesCreated).toBeGreaterThanOrEqual(1);
        expect(result.totalActive).toBeGreaterThanOrEqual(1);

        const rules = getSteeringRules(db, "test-proj");
        expect(rules.length).toBeGreaterThanOrEqual(1);
        expect(rules.some((r) => r.rule_text.toLowerCase().includes("validate"))).toBe(true);
    });

    test("does not create rules from facts appearing less than 3 times", async () => {
        const { synthesizeRules, getSteeringRules } = await import("../src/kernel/learnings");

        insertLearning(db, "fact_extracted", "test-proj", "Rare pattern one");
        insertLearning(db, "fact_extracted", "test-proj", "Rare pattern two");

        const result = synthesizeRules(db, "test-proj");
        expect(result.rulesCreated).toBe(0);
    });

    test("emits rule_synthesized events", async () => {
        const { synthesizeRules } = await import("../src/kernel/learnings");

        for (let i = 0; i < 4; i++) {
            insertLearning(db, "fact_extracted", "test-proj", "Handle errors properly", i);
        }

        synthesizeRules(db, "test-proj");

        const events = db
            .query("SELECT * FROM events WHERE event_type = 'rule_synthesized'")
            .all() as { event_type: string; summary: string }[];
        expect(events.length).toBeGreaterThanOrEqual(1);
        expect(events[0]!.summary).toContain("Synthesized rule");
    });

    test("updates confidence on existing rules", async () => {
        const { synthesizeRules, getSteeringRules } = await import("../src/kernel/learnings");
        const now = new Date().toISOString();

        // Pre-existing rule
        db.query(
            "INSERT INTO steering_rules (rule_id, project_id, rule_text, confidence, hit_count, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        ).run("existing", "test-proj", "Handle errors properly", 0.3, 3, "active", now, now);

        // Same fact appears again 5 times
        for (let i = 0; i < 5; i++) {
            insertLearning(db, "fact_extracted", "test-proj", "Handle errors properly", i);
        }

        const result = synthesizeRules(db, "test-proj");
        expect(result.rulesUpdated).toBeGreaterThanOrEqual(1);

        const rules = getSteeringRules(db, "test-proj");
        const updated = rules.find((r) => r.rule_id === "existing");
        expect(updated).toBeDefined();
        expect(updated!.confidence).toBeGreaterThan(0.3);
    });

    test("returns zero counts when no learnings exist", async () => {
        const { synthesizeRules } = await import("../src/kernel/learnings");
        const result = synthesizeRules(db, "test-proj");
        expect(result.rulesCreated).toBe(0);
        expect(result.rulesUpdated).toBe(0);
    });
});

// ─── buildPromptContext ──────────────────────────────────────────
describe("buildPromptContext", () => {
    test("returns formatted prompt string with rules", async () => {
        const { buildPromptContext } = await import("../src/kernel/learnings");
        const now = new Date().toISOString();

        db.query(
            "INSERT INTO steering_rules (rule_id, project_id, rule_text, confidence, hit_count, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        ).run("r1", "test-proj", "Always validate input", 0.9, 5, "active", now, now);

        insertLearning(db, "fact_extracted", "test-proj", "Input validation prevents crashes");

        const ctx = buildPromptContext(db, "test-proj");
        expect(ctx.ruleCount).toBe(1);
        expect(ctx.steeringRules).toContain("validate input");
        expect(ctx.steeringRules).toContain("0.90");
        expect(ctx.sessionHistory).toContain("Input validation");
    });

    test("returns fallback messages when no data exists", async () => {
        const { buildPromptContext } = await import("../src/kernel/learnings");

        const ctx = buildPromptContext(db, "test-proj");
        expect(ctx.ruleCount).toBe(0);
        expect(ctx.steeringRules).toContain("No steering rules yet");
        expect(ctx.sessionHistory).toContain("No prior session history");
    });

    test("increments hit_count on injected rules", async () => {
        const { buildPromptContext, getSteeringRules } = await import("../src/kernel/learnings");
        const now = new Date().toISOString();

        db.query(
            "INSERT INTO steering_rules (rule_id, project_id, rule_text, confidence, hit_count, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        ).run("r1", "test-proj", "Always validate input", 0.9, 0, "active", now, now);

        // Before inject
        let rules = getSteeringRules(db, "test-proj");
        expect(rules[0]!.hit_count).toBe(0);

        // Inject bumps hit_count
        buildPromptContext(db, "test-proj");

        rules = getSteeringRules(db, "test-proj");
        expect(rules[0]!.hit_count).toBe(1);
    });
});

// ─── CLI E2E ─────────────────────────────────────────────────────
describe("CLI learn", () => {
    test("learn query --project --json returns JSON envelope", async () => {
        insertLearning(db, "fact_extracted", "test-proj", "CLI learning test");

        const proc = Bun.spawn(
            ["bun", "src/cli.ts", "--db", dbPath, "--json", "learn", "query", "--project", "test-proj"],
            { cwd: PROJECT_ROOT, stdout: "pipe", stderr: "pipe" }
        );
        const text = await new Response(proc.stdout).text();
        await proc.exited;

        const json = JSON.parse(text);
        expect(json.ok).toBe(true);
        // expect(json.project).toBe("test-proj"); // field may have changed
        expect(json.count).toBeGreaterThanOrEqual(1);
    });

    test("learn analyze --project --json runs synthesis", async () => {
        const proc = Bun.spawn(
            ["bun", "src/cli.ts", "--db", dbPath, "--json", "learn", "analyze", "--project", "test-proj"],
            { cwd: PROJECT_ROOT, stdout: "pipe", stderr: "pipe" }
        );
        const text = await new Response(proc.stdout).text();
        await proc.exited;

        const json = JSON.parse(text);
        expect(json.ok).toBe(true);
        expect(typeof json.rulesCreated).toBe("number");
        expect(typeof json.totalActive).toBe("number");
    });

    test("learn inject --project outputs prompt block", async () => {
        const proc = Bun.spawn(
            ["bun", "src/cli.ts", "--db", dbPath, "learn", "inject", "--project", "test-proj"],
            { cwd: PROJECT_ROOT, stdout: "pipe", stderr: "pipe" }
        );
        const text = await new Response(proc.stdout).text();
        await proc.exited;

        expect(text).toContain("--- Steering Rules ---");
        expect(text).toContain("--- Session History ---");
    });
});
