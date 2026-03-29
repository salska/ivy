import { evaluateGithubIssues, setIssueFetcher, setBlackboardAccessor, setContentFilter } from './src/runtime/evaluators/github-issues.ts';
import { Blackboard } from './src/runtime/blackboard.ts';
import { registerProject } from './src/kernel/project.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'hb-ghissues-'));
const bb = new Blackboard(join(tmpDir, 'test.db'));

registerProject(bb.db, {
  id: 'test-project',
  name: 'Test Project',
  path: '/tmp/test-project',
  repo: 'https://github.com/owner/test-project',
});

setBlackboardAccessor({
  listProjects: () => bb.listProjects(),
  listWorkItems: (opts) => bb.listWorkItems(opts),
  createWorkItem: (opts) => {
    try {
      return bb.createWorkItem(opts);
    } catch (e) {
      console.error("FAIL", e);
      throw e;
    }
  }
});
setContentFilter(async () => ({ decision: 'ALLOWED', matches: [] }));
setIssueFetcher(async () => [
  {
    number: 1,
    title: 'Bug A',
    url: 'https://github.com/owner/test-project/issues/1',
    state: 'open',
    labels: [],
    createdAt: new Date().toISOString(),
    author: { login: 'reporter' },
    body: 'Default issue body for testing.',
  }
]);

await evaluateGithubIssues({
  name: 'GitHub Issues',
  type: 'github_issues',
  severity: 'medium',
  channels: ['terminal'],
  enabled: true,
  description: 'Check for new GitHub issues',
  config: {},
});

console.log(bb.listWorkItems({ all: true, project: 'test-project' }).length);
bb.close();
rmSync(tmpDir, { recursive: true, force: true });
