import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

export interface SkillMetadata {
    name: string;
    description: string;
}

/**
 * Parses a SKILL.md file for its YAML frontmatter.
 */
function parseSkillFile(filePath: string): Omit<SkillMetadata, "name"> | null {
    try {
        const raw = readFileSync(filePath, "utf-8");
        const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
        if (!fmMatch) return null;

        const yaml = fmMatch[1]!;
        const getDesc = yaml.match(/^description:\s*(.+)$/m);

        return {
            description: getDesc?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "",
        };
    } catch (err) {
        return null;
    }
}

/**
 * Returns a list of all available skills by scanning ~/.claude/skills/
 */
export function listSkills(): SkillMetadata[] {
    const skillsDir = resolve(homedir(), ".claude", "skills");
    if (!existsSync(skillsDir)) {
        return [];
    }

    const skills: SkillMetadata[] = [];
    try {
        const directories = readdirSync(skillsDir, { withFileTypes: true })
            .filter((dirent) => dirent.isDirectory())
            .map((dirent) => dirent.name);

        for (const dirName of directories) {
            const skillFile = resolve(skillsDir, dirName, "SKILL.md");
            if (existsSync(skillFile)) {
                const metadata = parseSkillFile(skillFile);
                if (metadata) {
                    skills.push({ name: dirName, description: metadata.description });
                }
            }
        }
    } catch (err) {
        console.error(`Error reading skills directory:`, err);
    }

    return skills.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Concatenates the contents of the given skill names into a prompt block.
 * Uses the exact file contents of `~/.claude/skills/<name>/SKILL.md`.
 * Throws an error if any of the requested skills do not exist.
 */
export function buildSkillContext(skillNames: string[]): string {
    if (!skillNames || skillNames.length === 0) {
        return "";
    }

    const skillsDir = resolve(homedir(), ".claude", "skills");
    let combinedContext = "";

    for (const name of skillNames) {
        const skillFile = resolve(skillsDir, name, "SKILL.md");
        if (!existsSync(skillFile)) {
            throw new Error(`Skill not found: ${name}`);
        }

        try {
            const contents = readFileSync(skillFile, "utf-8");
            combinedContext += `\n=== SKILL: ${name} ===\n${contents}\n`;
        } catch (err) {
            throw new Error(`Error reading skill source for ${name}: ${err}`);
        }
    }

    return combinedContext.trim();
}
