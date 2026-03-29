import type { Database } from 'bun:sqlite';

// ─── Second Brain Manager ────────────────────────────────────────────

/**
 * Manages SQLite ATTACH DATABASE connections for the "Second Brain" feature.
 *
 * Uses SQLite's ATTACH DATABASE to mount additional database files as
 * named schemas on the primary connection. This allows cross-brain
 * queries like:
 *
 *   SELECT w.title FROM main.work_items w
 *   JOIN brain_research.topics t ON w.title LIKE '%' || t.keyword || '%'
 *
 * The primary database is always available as `main`.
 * Each attached brain gets an alias (e.g., `brain_research`).
 */
export class SecondBrainManager {
    private readonly attached: Map<string, string> = new Map(); // alias → path
    private readonly db: Database;

    constructor(db: Database) {
        this.db = db;
    }

    /**
     * Attach a secondary database file under the given alias.
     *
     * @param alias - Schema namespace (e.g., "brain_research")
     * @param dbPath - Absolute path to the SQLite file
     * @throws If alias is already in use or the file is invalid
     *
     * @example
     *   manager.attach("research", "/home/user/.ivy/research.db");
     *   // Now you can query: SELECT * FROM research.work_items
     */
    attach(alias: string, dbPath: string): void {
        if (this.attached.has(alias)) {
            throw new Error(
                `Brain alias "${alias}" is already attached (path: ${this.attached.get(alias)}). ` +
                `Detach it first with detach("${alias}").`
            );
        }

        // Validate alias: must be a safe SQL identifier
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(alias)) {
            throw new Error(
                `Invalid brain alias "${alias}". Use only letters, digits, and underscores (start with letter/underscore).`
            );
        }

        // Reserved names
        const reserved = new Set(['main', 'temp', 'sqlite_master']);
        if (reserved.has(alias.toLowerCase())) {
            throw new Error(`"${alias}" is a reserved SQLite schema name.`);
        }

        try {
            this.db.exec(`ATTACH DATABASE '${dbPath}' AS "${alias}"`);
            this.attached.set(alias, dbPath);
        } catch (err) {
            throw new Error(
                `Failed to attach brain "${alias}" from ${dbPath}: ${err instanceof Error ? err.message : String(err)}`
            );
        }
    }

    /**
     * Detach a previously attached brain.
     */
    detach(alias: string): void {
        if (!this.attached.has(alias)) {
            throw new Error(`Brain alias "${alias}" is not attached.`);
        }

        this.db.exec(`DETACH DATABASE "${alias}"`);
        this.attached.delete(alias);
    }

    /**
     * List all currently attached brains.
     */
    list(): Array<{ alias: string; path: string }> {
        return Array.from(this.attached.entries()).map(([alias, path]) => ({
            alias,
            path,
        }));
    }

    /**
     * Check if a brain alias is attached.
     */
    isAttached(alias: string): boolean {
        return this.attached.has(alias);
    }

    /**
     * Get a Map of alias → Database for plugin context.
     * NOTE: All attached brains share the same Database handle (via ATTACH),
     * so the Database reference is the same. Plugins query via schema-qualified SQL.
     */
    getAttachedMap(): Map<string, Database> {
        const map = new Map<string, Database>();
        for (const [alias] of this.attached) {
            map.set(alias, this.db);
        }
        return map;
    }

    /**
     * Detach all attached brains (cleanup on shutdown).
     */
    detachAll(): void {
        for (const alias of Array.from(this.attached.keys())) {
            try {
                this.detach(alias);
            } catch {
                // Best-effort cleanup
            }
        }
    }

    /**
     * Get the number of attached brains.
     */
    get count(): number {
        return this.attached.size;
    }
}

// ─── CLI Helper ──────────────────────────────────────────────────────

/**
 * Parse `--attach` flag values from CLI.
 *
 * Format: `alias=path` (e.g., `brain_research=./research.db`)
 *
 * @returns Array of { alias, path } tuples
 */
export function parseAttachFlags(attachArgs: string[]): Array<{ alias: string; path: string }> {
    return attachArgs.map((arg) => {
        const eqIdx = arg.indexOf('=');
        if (eqIdx === -1) {
            throw new Error(
                `Invalid --attach format: "${arg}". Expected alias=path (e.g., research=./research.db)`
            );
        }
        return {
            alias: arg.slice(0, eqIdx),
            path: arg.slice(eqIdx + 1),
        };
    });
}
