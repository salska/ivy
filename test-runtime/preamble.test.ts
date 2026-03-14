import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { buildPromptPreamble } from '../src/runtime/tool-adapter/index';

describe('buildPromptPreamble', () => {
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

    test('Gemini preamble includes explicit instruction for Bash', () => {
        process.env.HEARTBEAT_AGENT_COMMAND = 'gemini';
        const preamble = buildPromptPreamble();
        expect(preamble).toContain('- "Bash" → use `run_shell_command` (Run shell commands. For modifying commands, you MUST provide an explicit instruction/explanation of your intent before calling the tool.)');
    });

    test('Claude preamble is empty', () => {
        process.env.HEARTBEAT_AGENT_COMMAND = 'claude';
        const preamble = buildPromptPreamble();
        expect(preamble).toBe('');
    });

    test('LM Studio preamble includes explicit instruction for Bash', () => {
        process.env.HEARTBEAT_AGENT_COMMAND = 'lmstudio';
        const preamble = buildPromptPreamble();
        expect(preamble).toContain('- "Bash" → use `run_bash_command` (Run shell commands. For modifying commands, you MUST provide an explicit instruction/explanation of your intent before calling the tool.)');
    });
});
