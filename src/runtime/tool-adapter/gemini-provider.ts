/**
 * Gemini CLI Provider — Maps Claude Code canonical tools to Gemini CLI equivalents.
 */

import type { ProviderAdapter, ToolCall, LaunchAdapterOptions } from './types';
import { formatCanonicalLog } from './claude-provider';

// ---------------------------------------------------------------------------
// Claude → Gemini mappings
// ---------------------------------------------------------------------------

const CLAUDE_TO_GEMINI: Record<string, string> = {
    // Verified via: gemini -p "List all available tools" (2026-03-05)
    // Gemini CLI actual tools: run_shell_command, read_file, write_file,
    // replace, glob, grep_search, list_directory, web_fetch,
    // google_web_search, save_memory, codebase_investigator,
    // cli_help, generalist, activate_skill, ask_user
    Bash: 'run_shell_command',
    Read: 'read_file',
    Write: 'write_file',
    Edit: 'replace',
    MultiEdit: 'replace',
    Glob: 'glob',
    Grep: 'grep_search',
    LS: 'list_directory',
    WebFetch: 'web_fetch',
    WebSearch: 'google_web_search',
    Task: 'generalist',
    Skill: 'activate_skill',
    AskUserQuestion: 'ask_user',
    TodoWrite: 'write_file',
    NotebookRead: 'read_file',
    NotebookEdit: 'write_file',
};

// Build reverse map
const GEMINI_TO_CLAUDE: Record<string, string> = {};
for (const [claude, gemini] of Object.entries(CLAUDE_TO_GEMINI)) {
    // First mapping wins for reverse (some many-to-one)
    if (!GEMINI_TO_CLAUDE[gemini]) {
        GEMINI_TO_CLAUDE[gemini] = claude;
    }
}

// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------

export const geminiProvider: ProviderAdapter = {
    provider: 'gemini',

    translateToolName(canonical: string): string {
        return CLAUDE_TO_GEMINI[canonical] ?? canonical;
    },

    normalizeToolName(native: string): string {
        return GEMINI_TO_CLAUDE[native] ?? native;
    },

    buildCLIArgs(prompt: string, _options?: LaunchAdapterOptions): string[] {
        // -p forces non-interactive (headless) mode
        // --yolo auto-approves all tools (without this, Gemini CLI excludes
        //   run_shell_command, replace, write_file, web_fetch in non-interactive mode)
        // --output-format stream-json for structured streaming output
        return ['gemini', '-p', prompt, '--yolo', '--output-format', 'stream-json'];
    },

    parseToolUse(block: unknown): ToolCall | null {
        const b = block as Record<string, unknown>;
        const name = (b.tool_name ?? b.name) as string | undefined;
        if ((b.type !== 'tool_use' && !b.tool_name) || !name) return null;

        // Normalize native Gemini tool name → canonical Claude name
        const canonicalName = GEMINI_TO_CLAUDE[name] ?? name;

        // Map Gemini input field names → Claude input field names
        const rawInput = (b.parameters ?? b.input ?? {}) as Record<string, unknown>;
        const input = normalizeInput(canonicalName, rawInput);

        return { name: canonicalName, input };
    },

    formatToolLog(call: ToolCall): string {
        return formatCanonicalLog(call);
    },
};

// ---------------------------------------------------------------------------
// Input field normalization: Gemini → Claude conventions
// ---------------------------------------------------------------------------

function normalizeInput(
    canonicalName: string,
    raw: Record<string, unknown>
): Record<string, unknown> {
    switch (canonicalName) {
        case 'Bash':
            // Gemini uses CommandLine; Claude uses command
            if (raw.CommandLine && !raw.command) {
                return { ...raw, command: raw.CommandLine };
            }
            return raw;

        case 'Read':
        case 'Write':
        case 'Edit':
        case 'MultiEdit':
            // Gemini uses AbsolutePath / TargetFile; Claude uses file_path
            if (raw.AbsolutePath && !raw.file_path) {
                return { ...raw, file_path: raw.AbsolutePath };
            }
            if (raw.TargetFile && !raw.file_path) {
                return { ...raw, file_path: raw.TargetFile };
            }
            return raw;

        case 'Glob':
            // Gemini uses Pattern; Claude uses pattern
            if (raw.Pattern && !raw.pattern) {
                return { ...raw, pattern: raw.Pattern };
            }
            return raw;

        case 'Grep':
            // Gemini uses Query; Claude uses pattern
            if (raw.Query && !raw.pattern) {
                return { ...raw, pattern: raw.Query };
            }
            return raw;

        case 'LS':
            // Gemini uses DirectoryPath; Claude uses path
            if (raw.DirectoryPath && !raw.path) {
                return { ...raw, path: raw.DirectoryPath };
            }
            return raw;

        case 'WebFetch':
            // Gemini uses Url; Claude uses url
            if (raw.Url && !raw.url) {
                return { ...raw, url: raw.Url };
            }
            return raw;

        case 'WebSearch':
            // Gemini uses query (lowercase already)
            return raw;

        default:
            return raw;
    }
}

// ---------------------------------------------------------------------------
// Exports for testing
// ---------------------------------------------------------------------------

export { CLAUDE_TO_GEMINI, GEMINI_TO_CLAUDE };
