import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Blackboard } from './src/runtime/blackboard.ts';
import { registerProject } from './src/kernel/project.ts';

const tmpDir = mkdtempSync(join(tmpdir(), 'hb-ghissues-'));
const bb = new Blackboard(join(tmpDir, 'test.db'));

registerProject(bb.db, {
  id: 'test-project',
  name: 'Test Project',
  path: '/tmp/test-project',
  repo: 'https://github.com/owner/test-project',
});

bb.createWorkItem({
  id: 'gh-test-project-1',
  title: 'Test',
  project: 'test-project',
  source: 'github',
  sourceRef: 'https://github.com/owner/test-project/issues/1'
});

console.log(bb.listWorkItems({ all: true, project: 'test-project' }).length);
bb.close();
rmSync(tmpDir, { recursive: true, force: true });
