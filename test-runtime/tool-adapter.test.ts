import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

import {
    resolveProvider,
    getAdapter,
    normalizeToolUse,
    formatToolLog,
    buildLaunchArgs,
    registeredProviders,
    translatePermissions,
    translateHookMatchers,
    translateSettings,
    normalizeSettings,
} from '../src/runtime/tool-adapter/index';

import { CLAUDE_TO_GEMINI, GEMINI_TO_CLAUDE } from '../src/runtime/tool-adapter/gemini-provider';
import { CLAUDE_TO_LMS, LMS_TO_CLAUDE } from '../src/runtime/tool-adapter/lmstudio-provider';

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let savedEnv: string | undefined;

beforeEach(() => {
    savedEnv = process.env.HEARTBEAT_AGENT_COMMAND;
});

afterEach(() => {
    if (savedEnv === undefined) {
        delete process.env.HEARTBEAT_AGENT_COMMAND;
    } else {
        process.env.HEARTBEAT_AGENT_COMMAND = savedEnv;
    }
});

// ===================================================================
// Provider Registration
// ===================================================================

describe('Provider registration', () => {
    test('all three built-in providers are registered', () => {
        const providers = registeredProviders();
        expect(providers).toContain('claude');
        expect(providers).toContain('gemini');
        expect(providers).toContain('lmstudio');
    });
});

// ===================================================================
// resolveProvider
// ===================================================================

describe('resolveProvider', () => {
    test('defaults to gemini when env is unset', () => {
        delete process.env.HEARTBEAT_AGENT_COMMAND;
        expect(resolveProvider()).toBe('gemini');
    });

    test('maps "claude" to claude', () => {
        process.env.HEARTBEAT_AGENT_COMMAND = 'claude';
        expect(resolveProvider()).toBe('claude');
    });

    test('maps "gemini" to gemini', () => {
        process.env.HEARTBEAT_AGENT_COMMAND = 'gemini';
        expect(resolveProvider()).toBe('gemini');
    });

    test('maps "antigravity" to gemini', () => {
        process.env.HEARTBEAT_AGENT_COMMAND = 'antigravity';
        expect(resolveProvider()).toBe('gemini');
    });

    test('maps "lmstudio" to lmstudio', () => {
        process.env.HEARTBEAT_AGENT_COMMAND = 'lmstudio';
        expect(resolveProvider()).toBe('lmstudio');
    });

    test('maps "lms" to lmstudio', () => {
        process.env.HEARTBEAT_AGENT_COMMAND = 'lms';
        expect(resolveProvider()).toBe('lmstudio');
    });

    test('maps "lm-studio" to lmstudio', () => {
        process.env.HEARTBEAT_AGENT_COMMAND = 'lm-studio';
        expect(resolveProvider()).toBe('lmstudio');
    });

    test('falls back to gemini for unknown command', () => {
        process.env.HEARTBEAT_AGENT_COMMAND = 'some-future-cli';
        expect(resolveProvider()).toBe('gemini');
    });
});

// ===================================================================
// Claude Provider (passthrough)
// ===================================================================

describe('Claude provider', () => {
    const adapter = getAdapter('claude');

    test('tool names are identity-mapped', () => {
        expect(adapter.translateToolName('Bash')).toBe('Bash');
        expect(adapter.translateToolName('Read')).toBe('Read');
        expect(adapter.translateToolName('Write')).toBe('Write');
        expect(adapter.normalizeToolName('Bash')).toBe('Bash');
    });

    test('buildCLIArgs includes --print and stream-json', () => {
        const args = adapter.buildCLIArgs('hello');
        expect(args).toContain('claude');
        expect(args).toContain('--print');
        expect(args).toContain('--output-format');
        expect(args).toContain('stream-json');
        expect(args).toContain('hello');
    });

    test('buildCLIArgs with disableMcp adds --strict-mcp-config', () => {
        const args = adapter.buildCLIArgs('hello', { disableMcp: true });
        expect(args).toContain('--strict-mcp-config');
    });

    test('parseToolUse handles Claude tool_use blocks', () => {
        const block = { type: 'tool_use', name: 'Bash', input: { command: 'ls' } };
        const call = adapter.parseToolUse(block);
        expect(call).not.toBeNull();
        expect(call!.name).toBe('Bash');
        expect(call!.input.command).toBe('ls');
    });

    test('parseToolUse returns null for non-tool blocks', () => {
        expect(adapter.parseToolUse({ type: 'text', text: 'hi' })).toBeNull();
        expect(adapter.parseToolUse(null)).toBeNull();
        expect(adapter.parseToolUse({})).toBeNull();
    });
});

// ===================================================================
// Gemini Provider
// ===================================================================

describe('Gemini provider', () => {
    const adapter = getAdapter('gemini');

    test('translates all canonical tools to Gemini names', () => {
        expect(adapter.translateToolName('Bash')).toBe('run_shell_command');
        expect(adapter.translateToolName('Read')).toBe('read_file');
        expect(adapter.translateToolName('Write')).toBe('write_file');
        expect(adapter.translateToolName('Edit')).toBe('replace');
        expect(adapter.translateToolName('MultiEdit')).toBe('replace');
        expect(adapter.translateToolName('Glob')).toBe('glob');
        expect(adapter.translateToolName('Grep')).toBe('grep_search');
        expect(adapter.translateToolName('LS')).toBe('list_directory');
        expect(adapter.translateToolName('WebFetch')).toBe('web_fetch');
        expect(adapter.translateToolName('WebSearch')).toBe('google_web_search');
    });

    test('normalizes Gemini names back to canonical', () => {
        expect(adapter.normalizeToolName('run_shell_command')).toBe('Bash');
        expect(adapter.normalizeToolName('read_file')).toBe('Read');
        expect(adapter.normalizeToolName('write_file')).toBe('Write');
        expect(adapter.normalizeToolName('replace')).toBe('Edit');
        expect(adapter.normalizeToolName('grep_search')).toBe('Grep');
    });

    test('unknown tool names pass through', () => {
        expect(adapter.translateToolName('SomeFutureTool')).toBe('SomeFutureTool');
        expect(adapter.normalizeToolName('some_unknown_tool')).toBe('some_unknown_tool');
    });

    test('parseToolUse normalizes Gemini tool names', () => {
        const block = {
            type: 'tool_use',
            name: 'run_shell_command',
            input: { CommandLine: 'ls -la', Cwd: '/home' },
        };
        const call = adapter.parseToolUse(block);
        expect(call).not.toBeNull();
        expect(call!.name).toBe('Bash');
        // Input normalization: CommandLine → command
        expect(call!.input.command).toBe('ls -la');
    });

    test('parseToolUse normalizes Gemini Read input', () => {
        const block = {
            type: 'tool_use',
            name: 'read_file',
            input: { AbsolutePath: '/etc/hosts' },
        };
        const call = adapter.parseToolUse(block);
        expect(call!.name).toBe('Read');
        expect(call!.input.file_path).toBe('/etc/hosts');
    });

    test('buildCLIArgs starts with gemini', () => {
        const args = adapter.buildCLIArgs('do something');
        expect(args[0]).toBe('gemini');
        expect(args).toContain('--output-format');
        expect(args).toContain('stream-json');
    });
});

// ===================================================================
// LM Studio Provider
// ===================================================================

describe('LM Studio provider', () => {
    const adapter = getAdapter('lmstudio');

    test('translates canonical tools to LMS function names', () => {
        expect(adapter.translateToolName('Bash')).toBe('run_bash_command');
        expect(adapter.translateToolName('Read')).toBe('read_file');
        expect(adapter.translateToolName('Write')).toBe('write_file');
        expect(adapter.translateToolName('Edit')).toBe('edit_file');
        expect(adapter.translateToolName('Grep')).toBe('grep_search');
    });

    test('normalizes LMS function names back to canonical', () => {
        expect(adapter.normalizeToolName('run_bash_command')).toBe('Bash');
        expect(adapter.normalizeToolName('read_file')).toBe('Read');
        expect(adapter.normalizeToolName('write_file')).toBe('Write');
    });

    test('parseToolUse handles OpenAI function format', () => {
        const block = {
            type: 'function',
            function: { name: 'run_bash_command', arguments: '{"command":"ls"}' },
        };
        const call = adapter.parseToolUse(block);
        expect(call).not.toBeNull();
        expect(call!.name).toBe('Bash');
        expect(call!.input.command).toBe('ls');
    });

    test('parseToolUse handles malformed JSON arguments gracefully', () => {
        const block = {
            type: 'function',
            function: { name: 'read_file', arguments: '{invalid json' },
        };
        const call = adapter.parseToolUse(block);
        expect(call).not.toBeNull();
        expect(call!.name).toBe('Read');
        expect(call!.input.raw).toBe('{invalid json');
    });

    test('buildCLIArgs generates curl command', () => {
        const args = adapter.buildCLIArgs('test prompt');
        expect(args[0]).toBe('curl');
        expect(args).toContain('-X');
        expect(args).toContain('POST');
        // Should contain the default URL
        const url = args.find((a) => a.includes('/chat/completions'));
        expect(url).toBeTruthy();
    });
});

// ===================================================================
// formatToolLog (canonical)
// ===================================================================

describe('formatToolLog', () => {
    test('formats Bash commands', () => {
        const log = formatToolLog({ name: 'Bash', input: { command: 'npm test' } });
        expect(log).toBe('[tool] Bash: npm test');
    });

    test('formats Read with file path', () => {
        const log = formatToolLog({ name: 'Read', input: { file_path: '/app/src/index.ts' } });
        expect(log).toBe('[tool] Read: /app/src/index.ts');
    });

    test('formats TaskUpdate with status', () => {
        const log = formatToolLog({ name: 'TaskUpdate', input: { taskId: '42', status: 'done' } });
        expect(log).toBe('[tool] TaskUpdate: #42 → done');
    });

    test('formats unknown tools gracefully', () => {
        const log = formatToolLog({ name: 'SomeFutureTool', input: {} });
        expect(log).toBe('[tool] SomeFutureTool');
    });
});

// ===================================================================
// Settings Translator
// ===================================================================

describe('Settings translator', () => {
    describe('translatePermissions', () => {
        test('translates simple tool names for Gemini', () => {
            const adapter = getAdapter('gemini');
            const perms = { allow: ['Bash', 'Read', 'Write'], deny: [], ask: [] };
            const result = translatePermissions(perms, adapter);
            expect(result.allow).toEqual(['run_shell_command', 'read_file', 'write_file']);
        });

        test('handles parameterized permissions', () => {
            const adapter = getAdapter('gemini');
            const perms = { allow: [], deny: [], ask: ['Bash(rm -rf /)'] };
            const result = translatePermissions(perms, adapter);
            expect(result.ask).toEqual(['run_shell_command(rm -rf /)']);
        });

        test('passes through MCP patterns unchanged', () => {
            const adapter = getAdapter('gemini');
            const perms = { allow: ['mcp__*', 'Bash'], deny: [] };
            const result = translatePermissions(perms, adapter);
            expect(result.allow).toEqual(['mcp__*', 'run_shell_command']);
        });

        test('Claude provider leaves permissions unchanged', () => {
            const adapter = getAdapter('claude');
            const perms = { allow: ['Bash', 'Read'], deny: ['Write'], ask: ['Bash(rm -rf /)'] };
            const result = translatePermissions(perms, adapter);
            expect(result).toEqual(perms);
        });
    });

    describe('translateHookMatchers', () => {
        test('translates hook matchers for Gemini', () => {
            const adapter = getAdapter('gemini');
            const hooks = {
                PreToolUse: [
                    { matcher: 'Bash', hooks: [{ type: 'command', command: '/some/hook.ts' }] },
                    { matcher: 'Edit', hooks: [{ type: 'command', command: '/other/hook.ts' }] },
                ],
            };
            const result = translateHookMatchers(hooks, adapter);
            expect(result.PreToolUse![0]!.matcher).toBe('run_shell_command');
            expect(result.PreToolUse![1]!.matcher).toBe('replace');
        });

        test('preserves hooks without matchers', () => {
            const adapter = getAdapter('gemini');
            const hooks = {
                SessionEnd: [
                    { hooks: [{ type: 'command', command: '/end.ts' }] },
                ] as any[],
            };
            const result = translateHookMatchers(hooks, adapter);
            expect(result.SessionEnd![0]!.matcher).toBeUndefined();
        });
    });

    describe('translateSettings', () => {
        test('translates full settings object', () => {
            const adapter = getAdapter('gemini');
            const settings = {
                permissions: { allow: ['Bash', 'Read'] },
                hooks: {
                    PreToolUse: [
                        { matcher: 'Bash', hooks: [{ type: 'command', command: '/hook.ts' }] },
                    ],
                },
                unrelated: { foo: 'bar' },
            };
            const result = translateSettings(settings, adapter);
            expect(result.permissions!.allow).toEqual(['run_shell_command', 'read_file']);
            expect(result.hooks!.PreToolUse![0]!.matcher).toBe('run_shell_command');
            expect(result.unrelated).toEqual({ foo: 'bar' });
        });
    });

    describe('normalizeSettings', () => {
        test('reverse-translates Gemini names to canonical', () => {
            const adapter = getAdapter('gemini');
            const nativeSettings = {
                permissions: { allow: ['run_shell_command', 'read_file'] },
                hooks: {
                    PreToolUse: [
                        { matcher: 'run_shell_command', hooks: [{ type: 'command', command: '/hook.ts' }] },
                    ],
                },
            };
            const result = normalizeSettings(nativeSettings, adapter);
            expect(result.permissions!.allow).toEqual(['Bash', 'Read']);
            expect(result.hooks!.PreToolUse![0]!.matcher).toBe('Bash');
        });
    });
});

// ===================================================================
// Mapping completeness
// ===================================================================

describe('Mapping completeness', () => {
    test('every Claude→Gemini mapping has a reverse entry', () => {
        for (const [claude, gemini] of Object.entries(CLAUDE_TO_GEMINI)) {
            const reverse = GEMINI_TO_CLAUDE[gemini];
            // At minimum, the first-registered canonical name should exist
            expect(reverse).toBeTruthy();
        }
    });

    test('every Claude→LMS mapping has a reverse entry', () => {
        for (const [claude, lms] of Object.entries(CLAUDE_TO_LMS)) {
            const reverse = LMS_TO_CLAUDE[lms];
            expect(reverse).toBeTruthy();
        }
    });
});
