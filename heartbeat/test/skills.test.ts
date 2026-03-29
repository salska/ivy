import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { listSkills, buildSkillContext } from "../src/skills";

const MOCK_SKILLS_DIR = resolve(homedir(), ".claude", "skills");

describe("Skills Module", () => {
    let originalExists: boolean;

    beforeAll(() => {
        originalExists = existsSync(MOCK_SKILLS_DIR);
        if (!originalExists) {
            mkdirSync(MOCK_SKILLS_DIR, { recursive: true });
        }

        // Create dummy skills
        const skillA = resolve(MOCK_SKILLS_DIR, "TestSkillA");
        mkdirSync(skillA, { recursive: true });
        writeFileSync(resolve(skillA, "SKILL.md"), "---\ndescription: First test skill\n---\nHere is pattern A.");

        const skillB = resolve(MOCK_SKILLS_DIR, "TestSkillB");
        mkdirSync(skillB, { recursive: true });
        writeFileSync(resolve(skillB, "SKILL.md"), "---\ndescription: Second test skill\n---\nHere is pattern B.");
    });

    afterAll(() => {
        // Cleanup dummy skills
        rmSync(resolve(MOCK_SKILLS_DIR, "TestSkillA"), { recursive: true, force: true });
        rmSync(resolve(MOCK_SKILLS_DIR, "TestSkillB"), { recursive: true, force: true });

        // Only remove the root skills dir if we created it for tests
        if (!originalExists) {
            rmSync(MOCK_SKILLS_DIR, { recursive: true, force: true });
        }
    });

    it("listSkills > discovers skills and parses yaml frontmatter", () => {
        const skills = listSkills();
        expect(skills.length).toBeGreaterThanOrEqual(2);

        const skillA = skills.find(s => s.name === "TestSkillA");
        expect(skillA).toBeDefined();
        expect(skillA?.description).toBe("First test skill");

        const skillB = skills.find(s => s.name === "TestSkillB");
        expect(skillB).toBeDefined();
        expect(skillB?.description).toBe("Second test skill");
    });

    it("buildSkillContext > combines contents correctly", () => {
        const context = buildSkillContext(["TestSkillA", "TestSkillB"]);
        expect(context).toContain("=== SKILL: TestSkillA ===");
        expect(context).toContain("Here is pattern A.");
        expect(context).toContain("=== SKILL: TestSkillB ===");
        expect(context).toContain("Here is pattern B.");
    });

    it("buildSkillContext > throws error for missing skill", () => {
        expect(() => buildSkillContext(["NonExistentSkillXYZ123"])).toThrow("Skill not found");
    });

    it("buildSkillContext > handles empty array", () => {
        const context = buildSkillContext([]);
        expect(context).toBe("");
    });
});
