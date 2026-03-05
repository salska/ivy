/**
 * Claude Provider — Identity (passthrough) adapter.
 *
 * Claude Code is the canonical vocabulary, so all translations
 * are identity mappings.
 */

import type { ProviderAdapter, ToolCall, LaunchAdapterOptions } from './types';

export const claudeProvider: ProviderAdapter = {
    provider: 'claude',

    translateToolName(canonical: string): string {
        return canonical;
    },

    normalizeToolName(native: string): string {
        return native;
    },

    buildCLIArgs(prompt: string, options?: LaunchAdapterOptions): string[] {
        const args = ['claude', '--print', '--verbose', '--output-format', 'stream-json'];
        if (options?.disableMcp) {
            args.push('--strict-mcp-config');
        }
        args.push(prompt);
        return args;
    },

    parseToolUse(block: unknown): ToolCall | null {
        const b = block as Record<string, unknown>;
        if (b?.type !== 'tool_use' || typeof b.name !== 'string') return null;
        return {
            name: b.name,
            input: (b.input as Record<string, unknown>) ?? {},
        };
    },

    formatToolLog(call: ToolCall): string {
        return formatCanonicalLog(call);
    },
};

/**
 * Shared log formatter — works on canonical names.
 * Extracted so all providers can use it after normalization.
 */
export function formatCanonicalLog(call: ToolCall): string {
    const { name, input } = call;
    switch (name) {
        case 'Bash':
            return `[tool] Bash: ${((input.command as string) ?? '').slice(0, 200)}`;
        case 'Read':
            return `[tool] Read: ${input.file_path ?? ''}`;
        case 'Write':
            return `[tool] Write: ${input.file_path ?? ''}`;
        case 'Edit':
            return `[tool] Edit: ${input.file_path ?? ''}`;
        case 'MultiEdit':
            return `[tool] MultiEdit: ${input.file_path ?? ''}`;
        case 'Glob':
            return `[tool] Glob: ${input.pattern ?? ''}`;
        case 'Grep':
            return `[tool] Grep: ${input.pattern ?? ''}`;
        case 'LS':
            return `[tool] LS: ${input.path ?? ''}`;
        case 'Task':
            return `[tool] Task: ${input.description ?? ''}`;
        case 'TaskCreate':
            return `[tool] TaskCreate: ${input.subject ?? ''}`;
        case 'TaskUpdate': {
            const status = input.status ? ` → ${input.status}` : '';
            return `[tool] TaskUpdate: #${input.taskId ?? '?'}${status}`;
        }
        case 'TaskList':
            return '[tool] TaskList';
        case 'TaskOutput':
            return `[tool] TaskOutput: task=${input.task_id ?? '?'}`;
        case 'TodoWrite': {
            const todos = Array.isArray(input.todos) ? input.todos : [];
            const summary = todos
                .map((t: any) => `${t.status === 'completed' ? '✓' : '○'} ${((t.content as string) ?? '').slice(0, 60)}`)
                .join(', ');
            return `[tool] TodoWrite: ${summary || '(empty)'}`;
        }
        case 'WebFetch':
            return `[tool] WebFetch: ${input.url ?? ''}`;
        case 'WebSearch':
            return `[tool] WebSearch: ${input.query ?? ''}`;
        case 'Skill':
            return `[tool] Skill: ${input.skill ?? ''}`;
        case 'NotebookEdit':
            return `[tool] NotebookEdit: ${input.notebook_path ?? ''}`;
        case 'NotebookRead':
            return `[tool] NotebookRead: ${input.notebook_path ?? ''}`;
        default:
            return `[tool] ${name}`;
    }
}
