import { Command } from 'commander';
import type { CliContext } from '../cli.ts';
import {
    registerProject,
    listProjects,
    getProjectStatus,
} from '../../kernel/project';
import {
    formatJson,
    formatTable,
    formatRelativeTime,
} from '../../kernel/output';

/**
 * Register project commands on the unified ivy CLI.
 * Migrated from ivy-blackboard/src/commands/project.ts.
 */
export function registerProjectCommands(
    parent: Command,
    getContext: () => CliContext
): void {
    const project = parent
        .command('project')
        .description('Manage projects');

    project
        .command('register')
        .description('Register or update a project')
        .requiredOption('--id <id>', 'Project slug')
        .requiredOption('--name <name>', 'Display name')
        .option('--path <path>', 'Local path')
        .option('--repo <repo>', 'Remote repository URL')
        .option('--metadata <json>', 'Metadata as JSON')
        .action((opts) => {
            try {
                const ctx = getContext();
                const result = registerProject(ctx.bb.db, {
                    id: opts.id,
                    name: opts.name,
                    path: opts.path,
                    repo: opts.repo,
                    metadata: opts.metadata,
                });

                if (ctx.json) {
                    console.log(formatJson(result));
                } else {
                    console.log(`${result.updated ? 'Updated' : 'Registered'} project: ${result.project_id}`);
                    console.log(`Name: ${result.display_name}`);
                    if (result.local_path) console.log(`Path: ${result.local_path}`);
                    if (result.remote_repo) console.log(`Repo: ${result.remote_repo}`);
                }
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`Error: ${msg}`);
                process.exitCode = 1;
            }
        });

    project
        .command('list')
        .description('List registered projects')
        .action(() => {
            try {
                const ctx = getContext();
                const projects = listProjects(ctx.bb.db);

                if (ctx.json) {
                    console.log(formatJson(projects));
                } else if (projects.length === 0) {
                    console.log('No projects registered.');
                } else {
                    const headers = ['ID', 'NAME', 'AGENTS', 'AVAILABLE', 'CLAIMED', 'COMPLETED', 'REGISTERED'];
                    const rows = projects.map((p) => [
                        p.project_id,
                        p.display_name,
                        String(p.active_agents),
                        String(p.work_available),
                        String(p.work_claimed),
                        String(p.work_completed),
                        formatRelativeTime(p.registered_at),
                    ]);
                    console.log(formatTable(headers, rows));
                }
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`Error: ${msg}`);
                process.exitCode = 1;
            }
        });

    project
        .command('status')
        .description('Show detailed project status')
        .argument('<id>', 'Project ID')
        .action((id) => {
            try {
                const ctx = getContext();
                const detail = getProjectStatus(ctx.bb.db, id);

                if (ctx.json) {
                    console.log(formatJson(detail));
                } else {
                    const p = detail.project;
                    console.log(`Project:  ${p.project_id}`);
                    console.log(`Name:     ${p.display_name}`);
                    if (p.local_path) console.log(`Path:     ${p.local_path}`);
                    if (p.remote_repo) console.log(`Repo:     ${p.remote_repo}`);
                    console.log(`\nActive agents: ${detail.agents.length}`);
                    for (const a of detail.agents) {
                        console.log(`  ${a.agent_name} (${a.session_id.slice(0, 12)}) — ${a.current_work ?? 'idle'}`);
                    }
                    console.log(`\nWork items: ${detail.work_items.length}`);
                    for (const w of detail.work_items) {
                        console.log(`  [${w.priority}] ${w.title} — ${w.status}`);
                    }
                }
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`Error: ${msg}`);
                process.exitCode = 1;
            }
        });
}
