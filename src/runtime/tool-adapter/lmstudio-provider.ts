/**
 * LM Studio Provider — OpenAI-compatible HTTP adapter.
 *
 * LM Studio exposes an OpenAI-compatible /v1/chat/completions endpoint.
 * This provider translates canonical tools into OpenAI function-calling
 * format and handles HTTP dispatch instead of CLI subprocess spawning.
 */

import type { ProviderAdapter, ToolCall, LaunchAdapterOptions } from './types';
import { formatCanonicalLog } from './claude-provider';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = 'http://localhost:1234/v1';
const DEFAULT_MODEL = 'default';

// ---------------------------------------------------------------------------
// Tool name mapping — LM Studio uses snake_case function names
// ---------------------------------------------------------------------------

const CLAUDE_TO_LMS: Record<string, string> = {
    Bash: 'run_bash_command',
    Read: 'read_file',
    Write: 'write_file',
    Edit: 'edit_file',
    MultiEdit: 'multi_edit_file',
    Glob: 'glob_files',
    Grep: 'grep_search',
    LS: 'list_directory',
    WebFetch: 'fetch_url',
    WebSearch: 'web_search',
    Task: 'create_task',
    TaskCreate: 'create_task',
    TaskUpdate: 'update_task',
    TaskList: 'list_tasks',
    TodoWrite: 'write_todos',
    Skill: 'use_skill',
    NotebookRead: 'read_notebook',
    NotebookEdit: 'edit_notebook',
};

const LMS_TO_CLAUDE: Record<string, string> = {};
for (const [claude, lms] of Object.entries(CLAUDE_TO_LMS)) {
    if (!LMS_TO_CLAUDE[lms]) {
        LMS_TO_CLAUDE[lms] = claude;
    }
}

// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------

export const lmstudioProvider: ProviderAdapter = {
    provider: 'lmstudio',

    translateToolName(canonical: string): string {
        return CLAUDE_TO_LMS[canonical] ?? canonical;
    },

    normalizeToolName(native: string): string {
        return LMS_TO_CLAUDE[native] ?? native;
    },

    buildCLIArgs(prompt: string, options?: LaunchAdapterOptions): string[] {
        // LM Studio does not have a CLI agent runner like Claude/Gemini.
        // We shell out to curl for HTTP dispatch via the OpenAI-compatible API.
        const baseUrl = options?.baseUrl ?? process.env.LM_STUDIO_URL ?? DEFAULT_BASE_URL;
        const model = options?.model ?? process.env.LM_STUDIO_MODEL ?? DEFAULT_MODEL;

        const payload = JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            stream: true,
        });

        return [
            'curl', '-sN',
            '--no-buffer',
            '-X', 'POST',
            `${baseUrl}/chat/completions`,
            '-H', 'Content-Type: application/json',
            '-d', payload,
        ];
    },

    parseToolUse(block: unknown): ToolCall | null {
        const b = block as Record<string, unknown>;

        // OpenAI function-calling format in stream chunks:
        // { type: "function", function: { name: "...", arguments: "..." } }
        if (b?.type === 'function' && typeof (b as any).function === 'object') {
            const fn = (b as any).function as { name?: string; arguments?: string };
            if (!fn.name) return null;

            const canonicalName = LMS_TO_CLAUDE[fn.name] ?? fn.name;
            let input: Record<string, unknown> = {};
            try {
                input = fn.arguments ? JSON.parse(fn.arguments) : {};
            } catch {
                input = { raw: fn.arguments };
            }
            return { name: canonicalName, input };
        }

        // Also handle Claude-style tool_use blocks (if model was fine-tuned to emit those)
        if (b?.type === 'tool_use' && typeof b.name === 'string') {
            const canonicalName = LMS_TO_CLAUDE[b.name] ?? b.name;
            return {
                name: canonicalName,
                input: (b.input as Record<string, unknown>) ?? {},
            };
        }

        return null;
    },

    formatToolLog(call: ToolCall): string {
        return formatCanonicalLog(call);
    },
};

// ---------------------------------------------------------------------------
// Exports for testing
// ---------------------------------------------------------------------------

export { CLAUDE_TO_LMS, LMS_TO_CLAUDE, DEFAULT_BASE_URL, DEFAULT_MODEL };
