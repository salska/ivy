/**
 * Tool Adapter — Provider registry + factory.
 *
 * Manages registered providers and resolves the active one
 * from the HEARTBEAT_AGENT_COMMAND environment variable.
 */

import type { ProviderAdapter, ToolProvider, ToolCall } from './types';
import { TOOL_PROVIDERS } from './types';

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const registry = new Map<string, ProviderAdapter>();

/**
 * Register a provider adapter.
 * Overwrites any existing registration for the same name.
 */
export function registerProvider(adapter: ProviderAdapter): void {
    registry.set(adapter.provider, adapter);
}

/**
 * Get all registered provider names.
 */
export function registeredProviders(): string[] {
    return [...registry.keys()];
}

// ---------------------------------------------------------------------------
// Provider resolution
// ---------------------------------------------------------------------------

/** Map of HEARTBEAT_AGENT_COMMAND values → ToolProvider */
const COMMAND_TO_PROVIDER: Record<string, ToolProvider> = {
    claude: 'claude',
    gemini: 'gemini',
    antigravity: 'gemini',    // Antigravity uses Gemini CLI under the hood
    lmstudio: 'lmstudio',
    lms: 'lmstudio',
    'lm-studio': 'lmstudio',
};

/**
 * Resolve the active provider from the HEARTBEAT_AGENT_COMMAND env var.
 * Falls back to 'gemini' if unset or unrecognized.
 */
export function resolveProvider(): ToolProvider {
    const cmd = process.env.HEARTBEAT_AGENT_COMMAND ?? 'gemini';
    return COMMAND_TO_PROVIDER[cmd.toLowerCase()] ?? 'gemini';
}

/**
 * Get the adapter for a specific provider, or the active one.
 * Throws if the provider has no registered adapter.
 */
export function getAdapter(provider?: ToolProvider): ProviderAdapter {
    const target = provider ?? resolveProvider();
    const adapter = registry.get(target);
    if (!adapter) {
        throw new Error(
            `No adapter registered for provider "${target}". ` +
            `Registered: ${registeredProviders().join(', ') || '(none)'}`
        );
    }
    return adapter;
}

// ---------------------------------------------------------------------------
// Convenience helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a provider-native tool_use block into a canonical ToolCall.
 * Uses the active provider's adapter by default.
 */
export function normalizeToolUse(
    block: unknown,
    provider?: ToolProvider
): ToolCall | null {
    return getAdapter(provider).parseToolUse(block);
}

/**
 * Format a canonical ToolCall into a human-readable log line.
 */
export function formatToolLog(
    call: ToolCall,
    provider?: ToolProvider
): string {
    return getAdapter(provider).formatToolLog(call);
}

/**
 * Build CLI launch arguments for the active provider.
 */
export function buildLaunchArgs(
    prompt: string,
    options?: { disableMcp?: boolean; model?: string; baseUrl?: string },
    provider?: ToolProvider
): string[] {
    return getAdapter(provider).buildCLIArgs(prompt, options);
}

/**
 * Build a prompt preamble that maps Claude Code tool names to the
 * active provider's native tool names.
 *
 * For Claude: returns empty string (no mapping needed).
 * For Gemini/LMS: returns a block instructing the LLM which native
 * tool to call when the persona prompt references a Claude tool name.
 */
export function buildPromptPreamble(provider?: ToolProvider): string {
    const adapter = getAdapter(provider);

    // Claude is the canonical vocabulary — no preamble needed
    if (adapter.provider === 'claude') return '';

    const CORE_TOOLS: Array<[string, string]> = [
        ['Bash', 'Run shell commands'],
        ['Read', 'Read/view a file'],
        ['Write', 'Create or overwrite a file'],
        ['Edit', 'Edit part of a file (single block)'],
        ['MultiEdit', 'Edit multiple non-contiguous blocks'],
        ['Glob', 'Find files by name pattern'],
        ['Grep', 'Search file contents'],
        ['LS', 'List directory'],
        ['WebFetch', 'Fetch a URL'],
        ['WebSearch', 'Web search'],
    ];

    const mappingLines = CORE_TOOLS
        .map(([claude, desc]) => {
            const native = adapter.translateToolName(claude);
            if (native === claude) return null;  // no mapping exists
            return `- "${claude}" → use \`${native}\` (${desc})`;
        })
        .filter(Boolean);

    if (mappingLines.length === 0) return '';

    return [
        '## Tool Name Mapping',
        '',
        'The instructions below may reference tool names from Claude Code.',
        `You are running on **${adapter.provider}** which has different tool names.`,
        'When the prompt says to use a Claude tool, use the equivalent below:',
        '',
        ...mappingLines,
        '',
        'Use the **right-hand side** tool names in all your tool calls.',
        'Do not invent tool names. Only call tools that are available to you.',
        '',
    ].join('\n');
}
