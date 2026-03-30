import { test, expect } from "bun:test";
import { Blackboard } from "./src/blackboard.ts";
import { evaluateGithubIssues, setIssueFetcher, setBlackboardAccessor, setContentFilter } from "./src/evaluators/github-issues.ts";
import { registerProject } from "ivy-blackboard/src/project";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { mock } from "bun:test";
mock.module('ivy-blackboard/src/ingestion', () => ({
  ingestExternalContent: () => ({ allowed: true }),
  requiresFiltering: () => false,
  mergeFilterMetadata: (existing: any, result: any) => existing
}));

test("debug", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'hb-ghissues-'));
    const bb = new Blackboard(join(tmpDir, 'test.db'));
    registerProject(bb.db, {
      id: 'test-project',
      name: 'Test Project',
      path: '/tmp/test-project',
      repo: 'https://github.com/owner/test-project',
    });
    setBlackboardAccessor(bb);
    setContentFilter(async () => ({ decision: 'ALLOWED', matches: [] }));
    
    setIssueFetcher(async () => [{
        number: 7,
        title: 'Add feature X',
        url: 'https://github.com/owner/test-project/issues/7',
        state: 'open',
        labels: [],
        createdAt: new Date().toISOString(),
        author: { login: 'jcfischer' },
        body: 'Default issue body for testing.'
    } as any]);

    const overrides = { config: { owner_logins: ['jcfischer'] } };
    const item = {
      name: 'GitHub Issues',
      type: 'github_issues',
      severity: 'medium',
      channels: ['terminal'],
      enabled: true,
      description: 'Check for new GitHub issues',
      config: {},
      ...overrides,
    };

    await evaluateGithubIssues(item as any);

    const workItems = bb.listWorkItems({ all: true, project: 'test-project' });
    console.log("PRIORITY:", workItems[0].priority);
    console.log("METADATA:", workItems[0].metadata);
    bb.close();
});
