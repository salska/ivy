
import { loadPersona, resetPersonaCache } from './src/runtime/scheduler/persona-loader.ts';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const TMP_PERSONA_DIR = join(process.cwd(), 'tmp-personas');

function setup() {
    if (!existsSync(TMP_PERSONA_DIR)) {
        mkdirSync(TMP_PERSONA_DIR);
    }
    process.env.IVY_PERSONA_DIR = TMP_PERSONA_DIR;
    resetPersonaCache();
}

function teardown() {
    rmSync(TMP_PERSONA_DIR, { recursive: true, force: true });
}

function testStripping() {
    console.log('Testing Persona Stripping...');
    const personaContent = `---
name: TestAgent
description: A test agent.
---
# Identity
I am a test agent.

# 🚨 MANDATORY STARTUP SEQUENCE
Do this first.

## Strategic Planning with /plan Mode
Plan first.

# Voice Check
This section is just a curl call.
\`\`\`bash
curl -X POST http://localhost:8888/notify -d '{"msg":"talk"}'
\`\`\`

# Valid Work
I do real work here.
This section should be kept.
`;

    writeFileSync(join(TMP_PERSONA_DIR, 'TestAgent.md'), personaContent);

    const persona = loadPersona('TestAgent');
    if (!persona) throw new Error('Failed to load persona');

    console.log('--- Identity Block ---');
    console.log(persona.identityBlock);
    console.log('----------------------');

    if (persona.identityBlock.includes('MANDATORY STARTUP SEQUENCE')) {
        throw new Error('Failed to strip MANDATORY STARTUP SEQUENCE');
    }
    if (persona.identityBlock.includes('/plan Mode')) {
        throw new Error('Failed to strip /plan Mode');
    }
    if (persona.identityBlock.includes('Voice Check')) {
        throw new Error('Failed to strip Voice Check section');
    }
    if (!persona.identityBlock.includes('Valid Work')) {
        throw new Error('Incorrectly stripped Valid Work');
    }
    console.log('✅ Persona stripping works correctly.');
}

try {
    setup();
    testStripping();
} catch (err) {
    console.error('❌ Verification failed:', err);
    process.exit(1);
} finally {
    teardown();
}
