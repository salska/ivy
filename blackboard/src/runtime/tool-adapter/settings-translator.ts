/**
 * Settings Translator
 *
 * Translates settings.json permissions and hook matchers
 * from canonical (Claude Code) tool names to the active
 * provider's native names — and back.
 *
 * This makes the settings layer seamless regardless of backend.
 */

import type { ProviderAdapter } from './types';

// ---------------------------------------------------------------------------
// Types for settings sections we translate
// ---------------------------------------------------------------------------

export interface PermissionsBlock {
    allow?: string[];
    deny?: string[];
    ask?: string[];
    defaultMode?: string;
}

export interface HookEntry {
    matcher?: string;
    hooks?: Array<{ type: string; command: string }>;
}

export interface HooksBlock {
    PreToolUse?: HookEntry[];
    PostToolUse?: HookEntry[];
    [key: string]: HookEntry[] | undefined;
}

export interface TranslatableSettings {
    permissions?: PermissionsBlock;
    hooks?: HooksBlock;
    [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Permission translation helpers
// ---------------------------------------------------------------------------

/**
 * Translate a single permission entry.
 * Handles entries like "Bash", "Bash(rm -rf /)", "Bash(rm -rf /:*)", "mcp__*"
 */
function translatePermissionEntry(
    entry: string,
    adapter: ProviderAdapter
): string {
    // Skip wildcards and MCP patterns
    if (entry.startsWith('mcp__') || entry === '*') {
        return entry;
    }

    // Handle parameterized permissions: "Bash(rm -rf /)" or "Read(~/.ssh/*)"
    const paramMatch = entry.match(/^(\w+)\((.+)\)$/);
    if (paramMatch) {
        const [, toolName, params] = paramMatch;
        const translated = adapter.translateToolName(toolName!);
        return `${translated}(${params!})`;
    }

    // Simple tool name
    return adapter.translateToolName(entry);
}

/**
 * Translate a permissions array (allow, deny, or ask).
 */
function translatePermissionList(
    entries: string[],
    adapter: ProviderAdapter
): string[] {
    return entries.map((e) => translatePermissionEntry(e, adapter));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Translate settings.json permissions block to the provider's native tool names.
 */
export function translatePermissions(
    permissions: PermissionsBlock,
    adapter: ProviderAdapter
): PermissionsBlock {
    const result: PermissionsBlock = { ...permissions };

    if (permissions.allow) {
        result.allow = translatePermissionList(permissions.allow, adapter);
    }
    if (permissions.deny) {
        result.deny = translatePermissionList(permissions.deny, adapter);
    }
    if (permissions.ask) {
        result.ask = translatePermissionList(permissions.ask, adapter);
    }

    return result;
}

/**
 * Translate hook matchers in a hooks block to the provider's native tool names.
 */
export function translateHookMatchers(
    hooks: HooksBlock,
    adapter: ProviderAdapter
): HooksBlock {
    const result: HooksBlock = {};

    for (const [event, entries] of Object.entries(hooks)) {
        if (!Array.isArray(entries)) {
            result[event] = entries;
            continue;
        }

        result[event] = entries.map((entry) => {
            if (!entry.matcher) return entry;

            return {
                ...entry,
                matcher: adapter.translateToolName(entry.matcher),
            };
        });
    }

    return result;
}

/**
 * Translate an entire settings object — permissions + hooks.
 * Non-translatable sections are passed through unchanged.
 */
export function translateSettings(
    settings: TranslatableSettings,
    adapter: ProviderAdapter
): TranslatableSettings {
    const result = { ...settings };

    if (settings.permissions) {
        result.permissions = translatePermissions(settings.permissions, adapter);
    }

    if (settings.hooks) {
        result.hooks = translateHookMatchers(settings.hooks, adapter);
    }

    return result;
}

/**
 * Reverse-translate settings from a provider's native tool names
 * back to canonical (Claude Code) tool names.
 */
export function normalizeSettings(
    settings: TranslatableSettings,
    adapter: ProviderAdapter
): TranslatableSettings {
    // Build a reverse adapter that uses normalizeToolName as translateToolName
    const reverseAdapter: ProviderAdapter = {
        ...adapter,
        translateToolName: (name: string) => adapter.normalizeToolName(name),
    };

    return translateSettings(settings, reverseAdapter);
}
