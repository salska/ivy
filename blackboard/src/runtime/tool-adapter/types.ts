/**
 * Tool Adapter — Canonical Types
 *
 * Claude Code tool names are the canonical representation.
 * Provider adapters translate to/from their native vocabulary.
 */

// ---------------------------------------------------------------------------
// Canonical tool names (Claude Code vocabulary)
// ---------------------------------------------------------------------------

export const CANONICAL_TOOLS = [
    'Bash',
    'Read',
    'Write',
    'Edit',
    'MultiEdit',
    'Glob',
    'Grep',
    'LS',
    'WebFetch',
    'WebSearch',
    'Task',
    'TaskCreate',
    'TaskUpdate',
    'TaskList',
    'TaskOutput',
    'TodoWrite',
    'Skill',
    'NotebookRead',
    'NotebookEdit',
    'ExitPlanMode',
    'AskUserQuestion',
] as const;

export type CanonicalTool = (typeof CANONICAL_TOOLS)[number];

// ---------------------------------------------------------------------------
// Supported providers
// ---------------------------------------------------------------------------

export const TOOL_PROVIDERS = ['claude', 'gemini', 'lmstudio'] as const;
export type ToolProvider = (typeof TOOL_PROVIDERS)[number];

// ---------------------------------------------------------------------------
// Canonical tool call (provider-agnostic)
// ---------------------------------------------------------------------------

export interface ToolCall {
    /** Canonical Claude Code tool name */
    name: CanonicalTool | string;
    /** Tool input parameters */
    input: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Provider adapter interface
// ---------------------------------------------------------------------------

export interface ProviderAdapter {
    /** Provider identifier */
    readonly provider: ToolProvider;

    /**
     * Translate a canonical tool name to the provider's native name.
     * Returns the input unchanged if no mapping exists.
     */
    translateToolName(canonical: string): string;

    /**
     * Reverse-translate a provider-native tool name to canonical.
     * Returns the input unchanged if no mapping exists.
     */
    normalizeToolName(native: string): string;

    /**
     * Build CLI arguments for launching an agent session.
     * @param prompt - The prompt to send
     * @param options - Provider-specific options (e.g. disableMcp)
     */
    buildCLIArgs(prompt: string, options?: LaunchAdapterOptions): string[];

    /**
     * Parse a stream-json message into a canonical ToolCall.
     * Returns null if the message doesn't represent a tool use.
     */
    parseToolUse(block: unknown): ToolCall | null;

    /**
     * Format a canonical ToolCall into a human-readable log line.
     */
    formatToolLog(call: ToolCall): string;
}

// ---------------------------------------------------------------------------
// Launch options passed to adapter
// ---------------------------------------------------------------------------

export interface LaunchAdapterOptions {
    disableMcp?: boolean;
    /** LM Studio: model name override */
    model?: string;
    /** LM Studio: base URL override */
    baseUrl?: string;
}
