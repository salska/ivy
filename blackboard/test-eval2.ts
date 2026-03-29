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
try {
  bb.createWorkItem({
    id: "gh-test-project-1",
    title: "Issue #1: Bug A",
    description: "desc",
    project: "test-project",
    source: 'github',
    sourceRef: "href",
    priority: "P2",
    metadata: JSON.stringify({
      github_issue_number: 1,
      github_repo: "ownerRepo",
      author: "issue.author.login",
      labels: [],
      workflow: "acknowledge-investigate-branch-implement-test-commit-push-comment",
      human_review_required: true,
      content_filtered: true,
      content_blocked: false,
      content_warning: false,
      filter_matches: [],
    }),
  });
} catch (e) {
  console.error(e);
}
console.log(bb.listWorkItems({ all: true, project: 'test-project' }).length);
bb.close();
rmSync(tmpDir, { recursive: true, force: true });
