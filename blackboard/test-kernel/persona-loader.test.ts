import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
    loadPersona,
    loadAllDispatchable,
    scoreBid,
    selectPersona,
    resetPersonaCache,
} from '../src/runtime/scheduler/persona-loader.ts';

// ─── Fixtures ───────────────────────────────────────────────────────────────

const TEST_DIR = join(tmpdir(), `ivy-persona-test-${Date.now()}`);

const ENGINEER_MD = `---
name: Engineer
description: Elite principal engineer with Fortune 10 experience. Uses TDD, strategic planning, and constitutional principles for implementation work.
persona:
  name: "Marcus Webb"
  background: "15 years from junior engineer to technical leadership."
---

# Character: Marcus Webb

## Core Identity

You are an elite principal/staff engineer with deep expertise in distributed systems.

## Development Philosophy

- Test-First Imperative - NO CODE BEFORE TESTS
- Strategic Planning for non-trivial tasks

## 🚨 MANDATORY STARTUP SEQUENCE

**BEFORE ANY WORK:**
\`\`\`bash
curl -X POST http://localhost:8888/notify \\
  -H "Content-Type: application/json" \\
  -d '{"message":"Loading context"}'
\`\`\`

**This is NON-NEGOTIABLE. Load your context first.**

## Communication Style

Deliberate delivery, strategic questions, measured wisdom.
`;

const DESIGNER_MD = `---
name: Designer
description: Elite UX/UI design specialist with design school pedigree. Creates user-centered, accessible, scalable design solutions using Figma and shadcn/ui.
persona:
  name: "Sophia Chen"
  background: "Trained at Rhode Island School of Design."
---

# Character: Sophia Chen

## Core Identity

You are a UX/UI design specialist focused on accessibility and visual excellence.

## Communication Style

Warm, professional, direct feedback on visual hierarchy.
`;

const RESEARCHER_MD = `---
name: ClaudeResearcher
description: Academic researcher using Claude's WebSearch. Called BY Research skill workflows only. Excels at multi-query decomposition.
persona:
  name: "Dr. Wells"
  background: "Former academic researcher."
---

# Character: Dr. Wells

## Core Identity

You are an academic researcher supporting the Research skill.
`;

const ARCHITECT_MD = `---
name: Architect
description: Elite system design specialist with PhD-level distributed systems knowledge and Fortune 10 architecture experience. Creates constitutional principles, feature specs, and implementation plans using strategic analysis.
persona:
  name: "Elena Vasquez"
  background: "PhD in distributed systems."
---

# Character: Elena Vasquez

## Core Identity

You are an elite system design specialist with deep architecture knowledge.

## Communication Style

Precise, structured, strategic.
`;

const QA_MD = `---
name: QATester
description: Quality Assurance validation agent that verifies functionality is actually working before declaring work complete. Uses browser-automation for browser testing.
persona:
  name: "QA Bot"
  background: "Testing specialist."
---

# QATester

## Core Identity

You validate that features work correctly through comprehensive testing.
`;

// ─── Setup / Teardown ───────────────────────────────────────────────────────

beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    writeFileSync(join(TEST_DIR, 'Engineer.md'), ENGINEER_MD);
    writeFileSync(join(TEST_DIR, 'Designer.md'), DESIGNER_MD);
    writeFileSync(join(TEST_DIR, 'ClaudeResearcher.md'), RESEARCHER_MD);
    writeFileSync(join(TEST_DIR, 'Architect.md'), ARCHITECT_MD);
    writeFileSync(join(TEST_DIR, 'QATester.md'), QA_MD);
    process.env.IVY_PERSONA_DIR = TEST_DIR;
    resetPersonaCache();
});

afterEach(() => {
    delete process.env.IVY_PERSONA_DIR;
    resetPersonaCache();
    rmSync(TEST_DIR, { recursive: true, force: true });
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('loadPersona', () => {
    test('loads a valid persona file and parses frontmatter', () => {
        const p = loadPersona('Engineer');
        expect(p).not.toBeNull();
        expect(p!.name).toBe('Engineer');
        expect(p!.description).toContain('principal engineer');
        expect(p!.background).toContain('15 years');
        expect(p!.dispatchable).toBe(true);
    });

    test('returns null for missing file', () => {
        expect(loadPersona('NonExistent')).toBeNull();
    });

    test('strips PAI boilerplate from identity block', () => {
        const p = loadPersona('Engineer')!;
        expect(p.identityBlock).not.toContain('curl');
        expect(p.identityBlock).not.toContain('🚨');
        expect(p.identityBlock).not.toContain('NON-NEGOTIABLE');
        // Keeps useful content
        expect(p.identityBlock).toContain('Core Identity');
        expect(p.identityBlock).toContain('Development Philosophy');
    });

    test('marks sub-agents as non-dispatchable', () => {
        const p = loadPersona('ClaudeResearcher');
        expect(p).not.toBeNull();
        expect(p!.dispatchable).toBe(false);
    });

    test('extracts capability keywords from description', () => {
        const p = loadPersona('Engineer')!;
        expect(p.keywords).toContain('engineer');
        expect(p.keywords).toContain('tdd');
        expect(p.keywords).toContain('implementation');
    });
});

describe('loadAllDispatchable', () => {
    test('returns only dispatchable personas', () => {
        const all = loadAllDispatchable();
        const names = all.map(p => p.name);
        expect(names).toContain('Engineer');
        expect(names).toContain('Designer');
        expect(names).toContain('Architect');
        expect(names).not.toContain('ClaudeResearcher');
    });
});

describe('scoreBid', () => {
    test('scores Engineer highest for code/implementation tasks', () => {
        const eng = loadPersona('Engineer')!;
        const des = loadPersona('Designer')!;

        const engScore = scoreBid(eng, 'Fix auth bug', 'Implement retry logic with TDD');
        const desScore = scoreBid(des, 'Fix auth bug', 'Implement retry logic with TDD');

        expect(engScore).toBeGreaterThan(desScore);
    });

    test('scores Designer highest for design/UX tasks', () => {
        const eng = loadPersona('Engineer')!;
        const des = loadPersona('Designer')!;

        const engScore = scoreBid(eng, 'Design new dashboard', 'UX wireframes for accessible UI');
        const desScore = scoreBid(des, 'Design new dashboard', 'UX wireframes for accessible UI');

        expect(desScore).toBeGreaterThan(engScore);
    });

    test('scores QATester highest for testing tasks', () => {
        const qa = loadPersona('QATester')!;
        const eng = loadPersona('Engineer')!;

        const qaScore = scoreBid(qa, 'Write E2E tests', 'Browser testing validation');
        const engScore = scoreBid(eng, 'Write E2E tests', 'Browser testing validation');

        expect(qaScore).toBeGreaterThan(engScore);
    });
});

describe('selectPersona', () => {
    test('explicit metadata override bypasses bidding', () => {
        const p = selectPersona('{"agent_persona":"ClaudeResearcher"}', 'Fix bug', 'code fix');
        expect(p).not.toBeNull();
        expect(p!.name).toBe('ClaudeResearcher');
    });

    test('returns null for override with missing persona file', () => {
        const p = selectPersona('{"agent_persona":"DoesNotExist"}', 'Fix bug', 'code fix');
        expect(p).toBeNull();
    });

    test('selects best-fit persona via bidding when no override', () => {
        const p = selectPersona(null, 'Design new dashboard layout', 'UX wireframes for accessible design');
        expect(p).not.toBeNull();
        expect(p!.name).toBe('Designer');
    });

    test('falls back to Architect when no match', () => {
        const p = selectPersona(null, 'Send birthday card', 'something unrelated');
        expect(p).not.toBeNull();
        expect(p!.name).toBe('Architect');
    });

    test('handles invalid JSON metadata gracefully', () => {
        const p = selectPersona('not valid json', 'Fix auth bug', 'implementation');
        // Should not throw, falls through to bidding
        expect(p).not.toBeNull();
    });

    test('handles metadata without agent_persona field', () => {
        const p = selectPersona('{"github_issue_number": 42}', 'Fix auth bug', 'implementation');
        // Should fall through to bidding
        expect(p).not.toBeNull();
    });
});
