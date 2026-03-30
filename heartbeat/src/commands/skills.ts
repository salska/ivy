import { Command } from "commander";
import type { CliContext } from "../cli.ts";
import { listSkills, buildSkillContext } from "../skills.ts";
import { formatJson } from "ivy-blackboard/src/kernel/output";

export function registerSkillsCommand(
    parent: Command,
    getContext: () => CliContext
): void {
    const skills = parent
        .command("skills")
        .description("Manage and discover agent skills");

    skills
        .command("list")
        .description("List available skills from ~/.claude/skills")
        .action(async () => {
            try {
                const ctx = getContext();
                const available = listSkills();

                if (ctx.json) {
                    console.log(formatJson({ count: available.length, items: available }));
                } else {
                    console.log(`\n🧠 Available Skills (${available.length}):`);
                    if (available.length === 0) {
                        console.log("  (none found in ~/.claude/skills)\n");
                    } else {
                        for (const s of available) {
                            console.log(`  • ${s.name.padEnd(15)} ${s.description}`);
                        }
                        console.log();
                    }
                }
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`Error: ${msg}`);
                process.exit(1);
            }
        });

    skills
        .command("context")
        .description("Get the raw prompt context block for a skill")
        .argument("<name>", "Name of the skill to fetch context for")
        .action(async (name) => {
            try {
                const ctx = getContext();
                const context = buildSkillContext([name]);

                if (ctx.json) {
                    console.log(formatJson({ name, context }));
                } else {
                    // Output raw prompt block suitable for piping
                    console.log(context);
                }
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`Error: ${msg}`);
                process.exit(1);
            }
        });
}
