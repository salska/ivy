import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";

export interface CacheOptions {
    ttlSeconds?: number;
    similarityThreshold?: number;
}

const DEFAULT_TTL = 3600; // 1 hour
const DEFAULT_THRESHOLD = 0.85;

/**
 * SemanticCache provides a way to cache database query results
 * based on both exact SQL match and semantic similarity of the query text.
 */
export class SemanticCache {
    private db: Database;

    constructor(db: Database) {
        this.db = db;
    }

    /**
     * Compute a SHA-256 hash for a query and its parameters for exact matching.
     */
    private hashQuery(query: string, params: any[]): string {
        const data = JSON.stringify({ query, params });
        return createHash("sha256").update(data).digest("hex");
    }

    /**
     * Simple Jaccard similarity between two strings based on word sets.
     * This is a placeholder for a true embedding-based semantic similarity.
     */
    private calculateSimilarity(a: string, b: string): number {
        // Tokenize and normalize
        const tokenize = (s: string) => new Set(
            s.toLowerCase()
             .replace(/[^a-z0-9\s]/g, ' ')
             .split(/\s+/)
             .filter(w => w.length > 2)
        );

        const setA = tokenize(a);
        const setB = tokenize(b);
        
        if (setA.size === 0 || setB.size === 0) return 0;

        const intersection = new Set([...setA].filter(x => setB.has(x)));
        const union = new Set([...setA, ...setB]);
        
        return intersection.size / union.size;
    }

    /**
     * Get a cached result for a query.
     * 1. Exact match via hash.
     * 2. Semantic match via similarity of query text (if params match).
     */
    get<T>(query: string, params: any[] = [], threshold = DEFAULT_THRESHOLD): T | null {
        const hash = this.hashQuery(query, params);
        const now = new Date().toISOString();

        // 1. Try exact match first (O(1) with index)
        const exact = this.db.query(
            "SELECT * FROM semantic_cache WHERE query_hash = ? AND expires_at > ?"
        ).get(hash, now) as any;

        if (exact) {
            this.db.query("UPDATE semantic_cache SET hits = hits + 1 WHERE cache_id = ?").run(exact.cache_id);
            return JSON.parse(exact.response_json) as T;
        }

        // 2. Try semantic match (linear scan of recent cache entries)
        // We limit the scan to the last 100 entries for performance
        const candidates = this.db.query(
            "SELECT * FROM semantic_cache WHERE expires_at > ? ORDER BY created_at DESC LIMIT 100"
        ).all(now) as any[];

        for (const candidate of candidates) {
            const similarity = this.calculateSimilarity(query, candidate.query_text);
            if (similarity >= threshold) {
                // To be safe, we only return semantically similar results if the params match exactly
                const cParams = candidate.query_params ? JSON.parse(candidate.query_params) : [];
                if (JSON.stringify(params) === JSON.stringify(cParams)) {
                    this.db.query("UPDATE semantic_cache SET hits = hits + 1 WHERE cache_id = ?").run(candidate.cache_id);
                    return JSON.parse(candidate.response_json) as T;
                }
            }
        }

        return null;
    }

    /**
     * Store a result in the cache.
     */
    set(query: string, params: any[] = [], response: any, ttl = DEFAULT_TTL): void {
        const hash = this.hashQuery(query, params);
        const now = new Date().toISOString();
        const expires = new Date(Date.now() + ttl * 1000).toISOString();
        const responseJson = JSON.stringify(response);
        const paramsJson = JSON.stringify(params);

        this.db.query(`
            INSERT INTO semantic_cache (query_text, query_params, query_hash, response_json, expires_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(query_hash) DO UPDATE SET
                response_json = excluded.response_json,
                expires_at = excluded.expires_at,
                created_at = excluded.created_at
        `).run(query, paramsJson, hash, responseJson, expires, now);
    }

    /**
     * Clear expired entries or all entries.
     */
    clear(all = false): void {
        if (all) {
            this.db.query("DELETE FROM semantic_cache").run();
        } else {
            const now = new Date().toISOString();
            this.db.query("DELETE FROM semantic_cache WHERE expires_at <= ?").run(now);
        }
    }

    /**
     * Clear only cache entries whose query_text starts with the given prefix.
     * Use this for entity-scoped invalidation (e.g. 'work:' for work item mutations)
     * to avoid nuking unrelated cache entries on every write.
     */
    clearByPrefix(prefix: string): void {
        this.db.query("DELETE FROM semantic_cache WHERE query_text LIKE ?")
            .run(prefix + "%");
    }

    /**
     * Get cache statistics.
     */
    stats(): { totalEntries: number; totalHits: number; expiredEntries: number } {
        const now = new Date().toISOString();
        const total = this.db.query("SELECT COUNT(*) as count FROM semantic_cache").get() as any;
        const hits = this.db.query("SELECT SUM(hits) as sum FROM semantic_cache").get() as any;
        const expired = this.db.query("SELECT COUNT(*) as count FROM semantic_cache WHERE expires_at <= ?").get(now) as any;

        return {
            totalEntries: total.count || 0,
            totalHits: hits.sum || 0,
            expiredEntries: expired.count || 0
        };
    }
}
