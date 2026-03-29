import type { Database } from 'bun:sqlite';
import type { Blackboard } from './blackboard.ts';

// ─── Plugin Interface ────────────────────────────────────────────────

/**
 * Context provided to plugins at registration time.
 * Gives plugins safe access to the runtime's core services.
 */
export interface PluginContext {
    /** The primary Blackboard instance (DB + all SDK methods) */
    blackboard: Blackboard;

    /** Raw SQLite database handle for advanced queries */
    db: Database;

    /** Logger scoped to the plugin name */
    log: PluginLogger;

    /** Register a periodic job with the runtime scheduler */
    addScheduledJob: (name: string, intervalMs: number, fn: () => Promise<void>) => void;

    /** Register a custom CLI subcommand */
    addCommand?: (name: string, description: string, handler: (...args: any[]) => void) => void;

    /** Map of attached brain aliases → Database handles */
    attachedBrains: Map<string, Database>;
}

export interface PluginLogger {
    info: (message: string, ...args: any[]) => void;
    warn: (message: string, ...args: any[]) => void;
    error: (message: string, ...args: any[]) => void;
    debug: (message: string, ...args: any[]) => void;
}

/**
 * A plugin module must export a `register` function (default or named).
 */
export interface IvyPlugin {
    /** Human-readable name for logging */
    name: string;
    /** Semver version string */
    version?: string;
    /** Called once at startup with the runtime context */
    register: (ctx: PluginContext) => void | Promise<void>;
    /** Called on graceful shutdown */
    teardown?: () => void | Promise<void>;
}

// ─── Scheduled Job Registry ──────────────────────────────────────────

interface ScheduledJob {
    name: string;
    intervalMs: number;
    fn: () => Promise<void>;
    timer?: ReturnType<typeof setInterval>;
}

// ─── Plugin Loader ───────────────────────────────────────────────────

const loadedPlugins: IvyPlugin[] = [];
const scheduledJobs: ScheduledJob[] = [];

/**
 * Create a scoped logger for a plugin.
 */
function createPluginLogger(pluginName: string): PluginLogger {
    const prefix = `[plugin:${pluginName}]`;
    return {
        info: (msg, ...args) => console.log(`${prefix} ${msg}`, ...args),
        warn: (msg, ...args) => console.warn(`${prefix} ${msg}`, ...args),
        error: (msg, ...args) => console.error(`${prefix} ${msg}`, ...args),
        debug: (msg, ...args) => {
            if (process.env.IVY_DEBUG) console.debug(`${prefix} ${msg}`, ...args);
        },
    };
}

/**
 * Discover and load all plugins from a directory.
 *
 * Convention:
 * - Each `.ts` or `.js` file in the directory is treated as a plugin.
 * - The file must export a default `IvyPlugin` object OR a named `register` function.
 *
 * Uses Bun's native dynamic `import()` — no separate bundler needed.
 */
export async function loadPlugins(
    pluginDir: string,
    blackboard: Blackboard,
    attachedBrains: Map<string, Database> = new Map()
): Promise<IvyPlugin[]> {
    const { readdirSync, existsSync } = await import('node:fs');
    const { join, extname, basename } = await import('node:path');

    if (!existsSync(pluginDir)) {
        return [];
    }

    const entries = readdirSync(pluginDir).filter(
        (f) => ['.ts', '.js'].includes(extname(f)) && !f.startsWith('_')
    );

    for (const entry of entries) {
        const fullPath = join(pluginDir, entry);
        const pluginName = basename(entry, extname(entry));

        try {
            const mod = await import(fullPath);

            // Support both `export default { name, register }` and `export function register(ctx)`
            const plugin: IvyPlugin =
                mod.default && typeof mod.default === 'object'
                    ? mod.default
                    : {
                        name: pluginName,
                        register: mod.register ?? mod.default,
                    };

            if (typeof plugin.register !== 'function') {
                console.warn(`[plugins] Skipping ${entry}: no register() export found`);
                continue;
            }

            const log = createPluginLogger(plugin.name ?? pluginName);

            const ctx: PluginContext = {
                blackboard,
                db: blackboard.db,
                log,
                addScheduledJob: (name, intervalMs, fn) => {
                    scheduledJobs.push({ name: `${pluginName}:${name}`, intervalMs, fn });
                },
                attachedBrains,
            };

            await plugin.register(ctx);
            loadedPlugins.push(plugin);

            log.info(`Loaded successfully${plugin.version ? ` (v${plugin.version})` : ''}`);
        } catch (err) {
            console.error(
                `[plugins] Failed to load ${entry}: ${err instanceof Error ? err.message : String(err)}`
            );
        }
    }

    return loadedPlugins;
}

/**
 * Start all registered scheduled jobs.
 * Returns a teardown function that clears all intervals.
 */
export function startScheduledJobs(): () => void {
    for (const job of scheduledJobs) {
        job.timer = setInterval(async () => {
            try {
                await job.fn();
            } catch (err) {
                console.error(
                    `[scheduler:${job.name}] Error: ${err instanceof Error ? err.message : String(err)}`
                );
            }
        }, job.intervalMs);
    }

    return () => {
        for (const job of scheduledJobs) {
            if (job.timer) clearInterval(job.timer);
        }
    };
}

/**
 * Gracefully tear down all loaded plugins.
 */
export async function teardownPlugins(): Promise<void> {
    for (const plugin of loadedPlugins) {
        if (plugin.teardown) {
            try {
                await plugin.teardown();
            } catch (err) {
                console.error(
                    `[plugins] Teardown error for ${plugin.name}: ${err instanceof Error ? err.message : String(err)}`
                );
            }
        }
    }
}

/**
 * Get the list of loaded plugin names (for status/debug).
 */
export function getLoadedPlugins(): string[] {
    return loadedPlugins.map((p) => p.name);
}
