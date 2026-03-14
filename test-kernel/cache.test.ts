import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { SemanticCache } from "../src/kernel/cache";
import { CREATE_TABLES_SQL, CREATE_INDEXES_SQL, SEED_VERSION_SQL } from "../src/kernel/schema";

describe("SemanticCache", () => {
    let db: Database;
    let cache: SemanticCache;

    beforeEach(() => {
        db = new Database(":memory:");
        db.exec(CREATE_TABLES_SQL);
        db.exec(CREATE_INDEXES_SQL);
        db.exec(SEED_VERSION_SQL);
        cache = new SemanticCache(db);
    });

    afterEach(() => {
        db.close();
    });

    it("should store and retrieve an exact match", () => {
        const query = "SELECT * FROM work_items WHERE project_id = 'p1'";
        const params = [{ status: "available" }];
        const response = [{ id: "task-1", title: "Task 1" }];

        cache.set(query, params, response);
        const cached = cache.get(query, params);

        expect(cached).toEqual(response);
        
        const stats = cache.stats();
        expect(stats.totalHits).toBe(1);
    });

    it("should retrieve a semantically similar match", () => {
        const query1 = "get me all work items for project-a";
        const query2 = "give me the work items for project-a";
        const params: any[] = [];
        const response = [{ id: "task-1", title: "Semantic Task" }];

        cache.set(query1, params, response);
        
        // Use query2 which is slightly different but semantically similar
        const cached = cache.get(query2, params, 0.4); // lowering threshold for the test

        expect(cached).toEqual(response);
        
        const stats = cache.stats();
        expect(stats.totalHits).toBe(1);
    });

    it("should not retrieve if similarity is below threshold", () => {
        const query1 = "get me all work items for project-a";
        const query2 = "show me current agents for project-b";
        const params: any[] = [];
        const response = [{ id: "task-1", title: "Project A Task" }];

        cache.set(query1, params, response);
        const cached = cache.get(query2, params, 0.9);

        expect(cached).toBeNull();
    });

    it("should respect TTL", async () => {
        const query = "SELECT 1";
        const response = { val: 1 };
        
        // Store with 0 second TTL (immediate expire)
        cache.set(query, [], response, 0);
        
        // Wait a tiny bit for the timestamp to definitely pass if needed (though 0 should be past now + 0)
        const cached = cache.get(query, []);
        expect(cached).toBeNull();
    });

    it("should clear cache", () => {
        cache.set("q1", [], "r1");
        cache.set("q2", [], "r2");
        
        cache.clear(true);
        
        const stats = cache.stats();
        expect(stats.totalEntries).toBe(0);
    });
});
