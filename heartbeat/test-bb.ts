import { test, expect } from "bun:test";
import { parseGithubIssuesConfig } from "./src/evaluators/github-issues.ts";

test("config test", () => {
    const item = { config: { owner_logins: ['jcfischer'] } };
    const conf = parseGithubIssuesConfig(item as any);
    console.log(conf);
});
