import type { Blackboard } from '../blackboard.ts';
import { generateDashboardHTML as generateHeartbeatHTML } from './dashboard.ts';
import { generateSummary } from '../observe/summary.ts';
import { getSpecFlowPipelines } from './api/specflow-pipeline.ts';
import { renderSpecFlowPanel } from './views/specflow-panel.ts';
import { renderMonitoringPanel } from './views/monitoring-panel.ts';
import { listSkills, buildSkillContext } from '../skills.ts';
import { loadPersona } from '../scheduler/persona-loader.ts';

// Kernel imports for blackboard API routes
import { getOverallStatus } from '../../kernel/status';
import { getHealthStatus } from '../../kernel/health';
import { listAgents } from '../../kernel/agent';
import {
    listWorkItems, getWorkItemStatus, deleteWorkItem,
    updateWorkItemMetadata, appendWorkItemEvent, flushActiveWorkItems,
    flushAllDatabase
} from '../../kernel/work';
import { listProjects, getProjectDetail } from '../../kernel/project';
import { observeEvents } from '../../kernel/events';
import { queryLearnings, getSteeringRules } from '../../kernel/learnings';
import type { BlackboardAgent } from '../../kernel/types';
import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

// ─── Types ───────────────────────────────────────────────────────────

export interface UnifiedServerOptions {
    port: number;
    hostname: string;
    dbPath: string;
    allowedLogDirs?: string[];
}

const DEFAULTS: UnifiedServerOptions = {
    port: 7878,
    hostname: '127.0.0.1',
    dbPath: '',
};

// ─── Helpers ─────────────────────────────────────────────────────────

const ALLOWED_ORIGIN_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function corsHeaders(req: Request): Record<string, string> {
    const origin = req.headers.get('Origin') ?? '';
    const h: Record<string, string> = {
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (ALLOWED_ORIGIN_RE.test(origin)) h['Access-Control-Allow-Origin'] = origin;
    return h;
}

function jsonOk(data: unknown, status = 200, cors: Record<string, string> = {}): Response {
    return new Response(
        JSON.stringify({ ok: status < 400, ...data as Record<string, unknown>, timestamp: new Date().toISOString() }, null, 2),
        { status, headers: { 'Content-Type': 'application/json', ...cors } },
    );
}

function isPathSafe(requestedPath: string, allowedBase: string): boolean {
    const resolved = resolve(requestedPath);
    const base = resolve(allowedBase);
    return resolved.startsWith(base + '/') || resolved === base;
}

// ─── Tabbed Dashboard Shell ──────────────────────────────────────────

function generateTabbedShell(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ivy Dashboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #0a0a0a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace; }

  /* Tab bar */
  .tab-bar {
    display: flex;
    gap: 0;
    background: #0d1117;
    border-bottom: 2px solid #1a1a2e;
    padding: 0 16px;
    position: sticky;
    top: 0;
    z-index: 100;
    align-items: flex-end;
  }
  .tab-bar .logo {
    color: #4fc3f7;
    font-weight: 700;
    font-size: 15px;
    padding: 12px 20px 10px 4px;
    letter-spacing: 1px;
  }
  .tab-btn {
    background: none;
    border: none;
    color: #6e7681;
    font-family: inherit;
    font-size: 13px;
    font-weight: 600;
    padding: 10px 20px 8px;
    cursor: pointer;
    border-bottom: 2px solid transparent;
    margin-bottom: -2px;
    transition: color 0.15s, border-color 0.15s;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .tab-btn:hover { color: #c9d1d9; }
  .tab-btn.active {
    color: #58a6ff;
    border-bottom-color: #58a6ff;
  }

  /* Content frames */
  .tab-content { display: none; width: 100%; height: calc(100vh - 42px); border: none; }
  .tab-content.active { display: block; }
</style>
</head>
<body>
  <div class="tab-bar">
    <span class="logo">🌿 ivy</span>
    <button class="tab-btn active" onclick="switchTab('blackboard')" id="tab-blackboard">Blackboard</button>
    <button class="tab-btn" onclick="switchTab('heartbeat')" id="tab-heartbeat">Heartbeat</button>
    <button class="tab-btn" onclick="switchTab('specflow')" id="tab-specflow">SpecFlow</button>
    <button class="tab-btn" onclick="switchTab('monitoring')" id="tab-monitoring">Monitoring</button>
    <div style="flex-grow: 1;"></div>
    <button onclick="flushAllDatabase()" style="background-color: transparent; color: #ff7b72; border: 1px solid #da3633; padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: bold; cursor: pointer; text-transform: uppercase; margin-bottom: 6px; box-shadow: 0 0 4px rgba(218, 54, 51, 0.4); align-self: center;">☢️ Nuclear Flush</button>
  </div>
  <iframe id="frame-blackboard" class="tab-content active" src="/dashboard/blackboard"></iframe>
  <iframe id="frame-heartbeat" class="tab-content" src="/dashboard/heartbeat"></iframe>
  <iframe id="frame-specflow" class="tab-content" src="/dashboard/specflow"></iframe>
  <iframe id="frame-monitoring" class="tab-content" src="/dashboard/monitoring"></iframe>
<script>
function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(f => f.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  document.getElementById('frame-' + name).classList.add('active');
}

async function flushAllDatabase() {
  if (!confirm('☢️ NUCLEAR FLUSH ☢️\\n\\nAre you absolutely sure you want to completely flush the database?\\n\\nThis will permanently delete all running/completed agents, all active/historical work items, and all heartbeats and events.')) {
    return;
  }
  try {
    const res = await fetch('/api/db/flush-all', { method: 'POST' });
    const data = await res.json();
    if (res.ok && (data.ok || data.flushed)) {
      alert('Nuclear flush complete.');
      // Reload the iframes by recreating their src/reloading the whole page.
      location.reload();
    } else {
      alert('Error flushing database: ' + (data.error || 'Unknown error'));
    }
  } catch (e) {
    alert('Network error flushing database: ' + e);
  }
}
</script>
</body>
</html>`;
}

// ─── Unified Server ──────────────────────────────────────────────────

export function startUnifiedServer(
    bb: Blackboard,
    opts: Partial<UnifiedServerOptions> = {},
) {
    const { port, hostname, dbPath, allowedLogDirs } = { ...DEFAULTS, ...opts };
    const logDirs = allowedLogDirs ?? [homedir()];
    const db = bb.db;

    // Pre-generate heartbeat HTML
    const heartbeatHTML = generateHeartbeatHTML();

    // Read blackboard dashboard HTML
    let blackboardHTML: string;
    try {
        blackboardHTML = readFileSync(
            resolve(__dirname, '../../kernel/web/dashboard.html'), 'utf-8'
        );
    } catch {
        blackboardHTML = '<html><body style="background:#0d1117;color:#c9d1d9;padding:40px;font-family:monospace"><h1>Blackboard Dashboard</h1><p>dashboard.html not found.</p></body></html>';
    }

    // Tabbed shell
    const shellHTML = generateTabbedShell();

    const server = Bun.serve({
        port,
        hostname,
        idleTimeout: 255, // Prevent premature timeouts on slow/long-lived connections (like SSE)
        async fetch(req) {
            const url = new URL(req.url);
            const path = url.pathname;
            const cors = corsHeaders(req);

            // CORS preflight
            if (req.method === 'OPTIONS') {
                return new Response(null, { status: 204, headers: cors });
            }

            try {
                // ═══ Dashboard routes ═══════════════════════════════════════

                if (path === '/' || path === '/index.html') {
                    return new Response(shellHTML, { headers: { 'Content-Type': 'text/html', ...cors } });
                }

                if (path === '/dashboard/blackboard') {
                    return new Response(blackboardHTML, { headers: { 'Content-Type': 'text/html', ...cors } });
                }

                if (path === '/dashboard/heartbeat') {
                    return new Response(heartbeatHTML, { headers: { 'Content-Type': 'text/html', ...cors } });
                }

                if (path === '/dashboard/specflow') {
                    const pipelines = getSpecFlowPipelines(bb);
                    const html = renderSpecFlowPanel(pipelines);
                    return new Response(
                        `<!DOCTYPE html><html><head><meta charset="utf-8"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:monospace;background:#0d1117;color:#c9d1d9;padding:20px;font-size:13px}</style></head><body>${html}</body></html>`,
                        { headers: { 'Content-Type': 'text/html', ...cors } },
                    );
                }

                if (path === '/dashboard/monitoring') {
                    const html = renderMonitoringPanel();
                    return new Response(
                        `<!DOCTYPE html><html><head><meta charset="utf-8"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:monospace;background:#0d1117;color:#c9d1d9;padding:0;font-size:13px}</style></head><body>${html}</body></html>`,
                        { headers: { 'Content-Type': 'text/html', ...cors } },
                    );
                }

                // ═══ Heartbeat API routes ════════════════════════════════════

                if (path === '/api/events' && !url.searchParams.has('filter')) {
                    // Heartbeat-style events (simple list)
                    const limit = parseInt(url.searchParams.get('limit') ?? '30', 10);
                    const since = url.searchParams.get('since');
                    const events = since
                        ? bb.eventQueries.getSince(since).slice(0, limit)
                        : bb.eventQueries.getRecent(limit);
                    return Response.json(events, { headers: { ...cors, 'Content-Type': 'application/json' } });
                }

                if (path === '/api/events' && url.searchParams.has('filter')) {
                    // Blackboard-style events (with filter, limit)
                    const since = url.searchParams.get('since') ?? undefined;
                    const type = url.searchParams.get('filter') ?? undefined;
                    const limitStr = url.searchParams.get('limit');
                    const limit = limitStr ? parseInt(limitStr, 10) : undefined;
                    const events = observeEvents(db, { since, type, limit });
                    return jsonOk({ count: events.length, items: events }, 200, cors);
                }

                if (path === '/api/heartbeats') {
                    const limit = parseInt(url.searchParams.get('limit') ?? '20', 10);
                    const heartbeats = bb.heartbeatQueries.getRecent(limit);
                    return Response.json(heartbeats, { headers: { ...cors, 'Content-Type': 'application/json' } });
                }

                if (path === '/api/summary') {
                    const summary = generateSummary(bb);
                    return Response.json(summary, { headers: { ...cors, 'Content-Type': 'application/json' } });
                }

                if (path === '/api/search') {
                    const query = url.searchParams.get('q') ?? '';
                    if (!query) return Response.json([], { headers: { ...cors, 'Content-Type': 'application/json' } });
                    const limit = parseInt(url.searchParams.get('limit') ?? '20', 10);
                    const results = bb.eventQueries.search(query, { limit });
                    return Response.json(results, { headers: { ...cors, 'Content-Type': 'application/json' } });
                }

                if (path === '/api/skills') {
                    const skills = listSkills();
                    return Response.json(skills, { headers: { ...cors, 'Content-Type': 'application/json' } });
                }

                if (path.startsWith('/api/skills/')) {
                    const name = path.replace('/api/skills/', '');
                    if (name) {
                        const context = buildSkillContext([decodeURIComponent(name)]);
                        return Response.json(
                            { name: decodeURIComponent(name), context },
                            { headers: { ...cors, 'Content-Type': 'application/json' } },
                        );
                    }
                }

                if (path === '/api/specflow/pipelines') {
                    const pipelines = getSpecFlowPipelines(bb);
                    return Response.json(pipelines, { headers: { ...cors, 'Content-Type': 'application/json' } });
                }

                if (path === '/api/specflow/panel') {
                    const pipelines = getSpecFlowPipelines(bb);
                    const html = renderSpecFlowPanel(pipelines);
                    return new Response(html, { headers: { ...cors, 'Content-Type': 'text/html' } });
                }

                if (path === '/api/metrics/monitoring') {
                    // Aggregate stats from semantic_cache table
                    const cacheStats = db.query('SELECT SUM(hits) as total_hits, COUNT(*) as entry_count FROM semantic_cache').get() as { total_hits: number | null, entry_count: number };
                    
                    // Mock additional monitoring data for visualization
                    // In a production system, these would come from Prometheus or an OTel aggregator
                    const hits = cacheStats.total_hits ?? 0;
                    const misses = Math.floor(hits * 0.15) + 5; // Simulating some misses
                    
                    const similarityBuckets = [
                        Math.floor(Math.random() * 5),
                        Math.floor(Math.random() * 8),
                        Math.floor(Math.random() * 12),
                        Math.floor(Math.random() * 20),
                        Math.floor(Math.random() * 15),
                        Math.floor(Math.random() * 10),
                        Math.floor(Math.random() * 5)
                    ];

                    const data = {
                        hits,
                        misses,
                        entryCount: cacheStats.entry_count,
                        currentLatency: 45 + Math.floor(Math.random() * 20),
                        similarityBuckets,
                        throughput: (hits + misses) / 60 // Simple avg
                    };
                    
                    return jsonOk(data, 200, cors);
                }

                // ═══ Blackboard API routes ═══════════════════════════════════

                if (path === '/api/status') {
                    return jsonOk(getOverallStatus(db, dbPath), 200, cors);
                }

                if (path === '/api/health') {
                    return jsonOk(getHealthStatus(db), 200, cors);
                }

                if (path === '/api/agents') {
                    const all = url.searchParams.get('all') === 'true';
                    const status = url.searchParams.get('status') ?? undefined;
                    const agents = listAgents(db, { all, status });
                    return jsonOk({ count: agents.length, items: agents }, 200, cors);
                }

                if (path === '/api/work') {
                    const all = url.searchParams.get('all') === 'true';
                    const status = url.searchParams.get('status') ?? undefined;
                    const project = url.searchParams.get('project') ?? undefined;
                    const items = listWorkItems(db, { all, status, project });
                    return jsonOk({ count: items.length, items }, 200, cors);
                }

                if (path === '/api/work/flush' && req.method === 'POST') {
                    return jsonOk(flushActiveWorkItems(db), 200, cors);
                }

                if (path === '/api/db/flush-all' && req.method === 'POST') {
                    return jsonOk(flushAllDatabase(db), 200, cors);
                }

                // Work item detail / delete
                const workMatch = path.match(/^\/api\/work\/([^/]+)$/);
                if (workMatch) {
                    const itemId = decodeURIComponent(workMatch[1]!);
                    if (req.method === 'DELETE') {
                        const force = url.searchParams.get('force') === 'true';
                        return jsonOk(deleteWorkItem(db, itemId, force), 200, cors);
                    }
                    const detail = getWorkItemStatus(db, itemId);
                    let agent_name: string | null = null;
                    if (detail.item.claimed_by) {
                        const agent = db.query('SELECT agent_name FROM agents WHERE session_id = ?')
                            .get(detail.item.claimed_by) as { agent_name: string } | null;
                        agent_name = agent?.agent_name ?? null;
                    }

                    // Enrich with persona and skills details
                    let persona_detail: any = null;
                    let skills_detail: any[] = [];
                    if (detail.item.metadata) {
                        try {
                            const meta = JSON.parse(detail.item.metadata);
                            if (meta.agent_persona) {
                                persona_detail = loadPersona(meta.agent_persona);
                            }
                            if (meta.skills && Array.isArray(meta.skills)) {
                                const allSkills = listSkills();
                                skills_detail = meta.skills.map((sName: string) =>
                                    allSkills.find(s => s.name === sName) || { name: sName, description: 'Unknown skill' }
                                );
                            }
                        } catch { }
                    }

                    return jsonOk({
                        ...detail,
                        agent_name,
                        persona_detail,
                        skills_detail
                    }, 200, cors);
                }

                // Work item metadata update
                const metaMatch = path.match(/^\/api\/work\/([^/]+)\/metadata$/);
                if (metaMatch && req.method === 'PATCH') {
                    const itemId = decodeURIComponent(metaMatch[1]!);
                    const body = await req.json() as Record<string, unknown>;
                    return jsonOk(updateWorkItemMetadata(db, itemId, body), 200, cors);
                }

                // Work item event append
                const evtMatch = path.match(/^\/api\/work\/([^/]+)\/events$/);
                if (evtMatch && req.method === 'POST') {
                    const itemId = decodeURIComponent(evtMatch[1]!);
                    const body = await req.json() as { event_type: string; summary: string; actor_id?: string; metadata?: Record<string, unknown>; source?: string };
                    return jsonOk(appendWorkItemEvent(db, itemId, body), 200, cors);
                }

                if (path === '/api/projects') {
                    const projects = listProjects(db);
                    return jsonOk({ count: projects.length, items: projects }, 200, cors);
                }

                // Project detail
                const projMatch = path.match(/^\/api\/projects\/([^/]+)$/);
                if (projMatch) {
                    return jsonOk(getProjectDetail(db, decodeURIComponent(projMatch[1]!)), 200, cors);
                }

                if (path === '/api/learnings') {
                    const project = url.searchParams.get('project');
                    if (!project) return jsonOk({ error: 'project query parameter is required' }, 400, cors);
                    const limitStr = url.searchParams.get('limit');
                    const limit = limitStr ? parseInt(limitStr, 10) : undefined;
                    const learnings = queryLearnings(db, project, { limit });
                    return jsonOk({ count: learnings.length, items: learnings }, 200, cors);
                }

                if (path === '/api/steering-rules') {
                    const project = url.searchParams.get('project');
                    if (!project) return jsonOk({ error: 'project query parameter is required' }, 400, cors);
                    const rules = getSteeringRules(db, project);
                    return jsonOk({ count: rules.length, items: rules }, 200, cors);
                }

                // Personas
                if (path === '/api/personas') {
                    const agentsDir = resolve(homedir(), '.claude', 'agents');
                    const personas: Array<Record<string, unknown>> = [];
                    if (existsSync(agentsDir)) {
                        const files = (readdirSync(agentsDir) as string[]).filter((f: string) => f.endsWith('.md'));
                        const SUB_AGENT_MARKERS = ['called by'];
                        for (const file of files) {
                            const filePath = resolve(agentsDir, file);
                            const raw = readFileSync(filePath, 'utf-8');
                            const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
                            if (!fmMatch) continue;
                            const yaml = fmMatch[1]!;
                            const getName = yaml.match(/^name:\s*(.+)$/m);
                            const getDesc = yaml.match(/^description:\s*(.+)$/m);
                            const getModel = yaml.match(/^model:\s*(.+)$/m);
                            const name = getName?.[1]?.trim().replace(/^["']|["']$/g, '') ?? file.replace('.md', '');
                            const description = getDesc?.[1]?.trim().replace(/^["']|["']$/g, '') ?? '';
                            const dispatchable = !SUB_AGENT_MARKERS.some(m => description.toLowerCase().includes(m));
                            personas.push({ name, description, model: getModel?.[1]?.trim() ?? 'default', dispatchable });
                        }
                        personas.sort((a, b) => {
                            if (a.dispatchable !== b.dispatchable) return a.dispatchable ? -1 : 1;
                            return (a.name as string).localeCompare(b.name as string);
                        });
                    }
                    return jsonOk({ count: personas.length, items: personas }, 200, cors);
                }

                // Agent log
                const logMatch = path.match(/^\/api\/agents\/([^/]+)\/log$/);
                if (logMatch) {
                    const sessionId = decodeURIComponent(logMatch[1]!);
                    const agent = db.query('SELECT * FROM agents WHERE session_id = ?')
                        .get(sessionId) as BlackboardAgent | null;
                    if (!agent) return jsonOk({ error: 'Agent not found' }, 404, cors);
                    let logPath: string | null = null;
                    if (agent.metadata) { try { logPath = JSON.parse(agent.metadata).logPath ?? null; } catch { } }
                    if (!logPath) return jsonOk({ error: 'No log file available' }, 404, cors);
                    if (!logDirs.some(base => isPathSafe(logPath!, base)))
                        return jsonOk({ error: 'Access denied' }, 403, cors);
                    if (!existsSync(logPath)) return jsonOk({ error: 'Log file not found' }, 404, cors);

                    const size = statSync(logPath).size;
                    const tailParam = url.searchParams.get('tail');
                    if (tailParam) {
                        const n = parseInt(tailParam, 10);
                        const chunkSize = Math.min(size, 256 * 1024);
                        const fd = require('fs').openSync(logPath, 'r');
                        const buf = Buffer.alloc(chunkSize);
                        const startPos = Math.max(0, size - chunkSize);
                        require('fs').readSync(fd, buf, 0, chunkSize, startPos);
                        require('fs').closeSync(fd);
                        let lines = buf.toString('utf-8').split('\n');
                        if (startPos > 0) lines = lines.slice(1);
                        if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
                        return new Response(lines.slice(-n).join('\n'), {
                            headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Log-Size': String(size), 'X-Agent-Status': agent.status, ...cors },
                        });
                    }
                    const content = size > 1024 * 1024
                        ? '[... truncated ...]\n' + readFileSync(logPath, 'utf-8').slice(-1024 * 1024)
                        : readFileSync(logPath, 'utf-8');
                    return new Response(content, {
                        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Log-Size': String(size), ...cors },
                    });
                }

                // SSE live event stream
                if (path === '/api/events/stream') {
                    const lastEventId = req.headers.get('Last-Event-ID');
                    let lastId = lastEventId ? parseInt(lastEventId, 10) : 0;
                    if (!lastId) {
                        const row = db.query('SELECT MAX(id) as max_id FROM events').get() as { max_id: number | null } | null;
                        lastId = row?.max_id ?? 0;
                    }
                    const stream = new ReadableStream({
                        start(controller) {
                            const enc = new TextEncoder();
                            const send = (data: string, id?: number) => {
                                try {
                                    if (id) controller.enqueue(enc.encode(`id: ${id}\n`));
                                    controller.enqueue(enc.encode(`data: ${data}\n\n`));
                                } catch { clearInterval(interval); }
                            };
                            send(JSON.stringify({ type: 'connected', last_id: lastId }));
                            const interval = setInterval(() => {
                                try {
                                    const newEvents = db.query('SELECT * FROM events WHERE id > ? ORDER BY id ASC LIMIT 50')
                                        .all(lastId) as Array<{ id: number;[key: string]: any }>;
                                    for (const event of newEvents) { send(JSON.stringify(event), event.id); lastId = event.id; }
                                } catch { clearInterval(interval); controller.close(); }
                            }, 500);
                            req.signal.addEventListener('abort', () => clearInterval(interval));
                        },
                    });
                    return new Response(stream, {
                        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', ...cors },
                    });
                }

                return jsonOk({ error: 'Not found' }, 404, cors);
            } catch (err: any) {
                return jsonOk({ error: err.message ?? 'Internal server error' }, err.code ? 400 : 500, cors);
            }
        },
    });

    return server;
}
