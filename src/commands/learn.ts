import { Command } from "commander";
import type { CommandContext } from "../context";
import { formatJson } from "../output";
import { withErrorHandling } from "../errors";
import {
    queryLearnings,
    synthesizeRules,
    getSteeringRules,
    buildPromptContext,
} from "../learnings";

export function registerLearnCommand(
    parent: Command,
    getContext: () => CommandContext
): void {
    const learn = parent
        .command("learn")
        .description("Query, analyze, and inject learnings from the blackboard");

    // ─── blackboard learn query ──────────────────────────────────────
    learn
        .command("query")
        .description("Show current steering rules and recent learnings for a project")
        .requiredOption("--project <id>", "Project ID to query learnings for")
        .option("--limit <n>", "Max learning events to return", "20")
        .action(
            withErrorHandling(async (opts) => {
                const ctx = getContext();
                const rules = getSteeringRules(ctx.db, opts.project);
                const learnings = queryLearnings(ctx.db, opts.project, {
                    limit: parseInt(opts.limit, 10),
                });

                if (ctx.options.json) {
                    console.log(
                        formatJson({
                            project: opts.project,
                            rules: { count: rules.length, items: rules },
                            learnings: { count: learnings.length, items: learnings },
                        })
                    );
                } else {
                    // Human-readable output
                    console.log(`\n📚 Steering Rules for "${opts.project}":`);
                    if (rules.length === 0) {
                        console.log("  (none yet)\n");
                    } else {
                        for (const r of rules) {
                            console.log(
                                `  • [${r.confidence.toFixed(2)}] ${r.rule_text} (used ${r.hit_count}x)`
                            );
                        }
                        console.log();
                    }

                    console.log(`📝 Recent Learnings (${learnings.length}):`);
                    if (learnings.length === 0) {
                        console.log("  (none yet)\n");
                    } else {
                        for (const e of learnings) {
                            const ago = timeSince(e.timestamp);
                            console.log(`  [${ago}] ${e.event_type}: ${e.summary}`);
                        }
                        console.log();
                    }
                }
            }, () => getContext().options.json)
        );

    // ─── blackboard learn analyze ────────────────────────────────────
    learn
        .command("analyze")
        .description("Synthesize steering rules from accumulated learnings")
        .requiredOption("--project <id>", "Project ID to analyze")
        .action(
            withErrorHandling(async (opts) => {
                const ctx = getContext();
                const result = synthesizeRules(ctx.db, opts.project);

                if (ctx.options.json) {
                    console.log(formatJson({ project: opts.project, ...result }));
                } else {
                    console.log(`\n🔬 Analysis complete for "${opts.project}":`);
                    console.log(`  Rules created:  ${result.rulesCreated}`);
                    console.log(`  Rules updated:  ${result.rulesUpdated}`);
                    console.log(`  Total active:   ${result.totalActive}\n`);
                }
            }, () => getContext().options.json)
        );

    // ─── blackboard learn inject ─────────────────────────────────────
    learn
        .command("inject")
        .description("Output the prompt context block for agent injection")
        .requiredOption("--project <id>", "Project ID to build context for")
        .action(
            withErrorHandling(async (opts) => {
                const ctx = getContext();
                const context = buildPromptContext(ctx.db, opts.project);

                if (ctx.options.json) {
                    console.log(formatJson({ project: opts.project, ...context }));
                } else {
                    // Output raw prompt block suitable for piping
                    console.log("=== STEERING RULES ===");
                    console.log(context.steeringRules);
                    console.log("\n=== SESSION HISTORY ===");
                    console.log(context.sessionHistory);
                    console.log(`\n[${context.ruleCount} active rules injected]`);
                }
            }, () => getContext().options.json)
        );
}

/**
 * Simple relative time formatter for CLI display.
 */
function timeSince(isoString: string): string {
    const diffMs = Date.now() - new Date(isoString).getTime();
    const diffSeconds = Math.floor(diffMs / 1000);

    if (diffSeconds < 60) return "just now";
    const diffMinutes = Math.floor(diffSeconds / 60);
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
}
