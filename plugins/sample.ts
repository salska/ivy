/**
 * Sample Plugin — Demonstrates the ivy plugin API.
 *
 * This plugin:
 * 1. Logs a startup message.
 * 2. Registers a scheduled job that checks for stale work items every 60s.
 * 3. Demonstrates access to the Blackboard and attached brains.
 *
 * To use: Copy this file to ~/.ivy/plugins/ or pass --plugin-dir ./plugins
 */

interface PluginContext {
    blackboard: any;
    db: any;
    log: { info: (...args: any[]) => void };
    addScheduledJob: (name: string, intervalMs: number, fn: () => Promise<void>) => void;
    attachedBrains: Map<string, any>;
}

interface IvyPlugin {
    name: string;
    version?: string;
    register: (ctx: PluginContext) => void | Promise<void>;
    teardown?: () => void | Promise<void>;
}

const samplePlugin: IvyPlugin = {
    name: 'sample-plugin',
    version: '0.1.0',

    register(ctx: PluginContext) {
        ctx.log.info('Sample plugin loaded!');

        // Log attached brains
        if (ctx.attachedBrains.size > 0) {
            ctx.log.info(`Attached brains: ${Array.from(ctx.attachedBrains.keys()).join(', ')}`);
        }

        // Register a periodic job
        ctx.addScheduledJob('stale-work-check', 60_000, async () => {
            const staleItems = ctx.blackboard.listWorkItems({ status: 'claimed' });
            if (staleItems.length > 0) {
                ctx.log.info(`${staleItems.length} claimed work item(s) — consider checking for stale claims.`);
            }
        });

        ctx.log.info('Registered stale-work-check job (every 60s)');
    },

    teardown() {
        console.log('[plugin:sample-plugin] Goodbye!');
    },
};

export default samplePlugin;
