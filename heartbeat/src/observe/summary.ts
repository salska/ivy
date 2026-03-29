import type { Blackboard, BlackboardEvent } from '../blackboard.ts';
import { parseHeartbeatChecklist } from '../parser/heartbeat-parser.ts';

export interface ChecklistItemStatus {
  name: string;
  status: string;
  time: string | null;
  interval_minutes: number;
  enabled: boolean;
  severity: string;
}

export interface ObserveSummary {
  totalEvents: number;
  eventsByType: Record<string, number>;
  lastHeartbeat: string | null;
  activeAgents: number;
  recentChecks: Array<{
    name: string;
    status: string;
    time: string;
  }>;
  allChecks: ChecklistItemStatus[];
  healthScore: number; // 0-100
  overallStatus: 'ok' | 'alert' | 'error';
}

/**
 * Generate an aggregate summary of blackboard state.
 */
export function generateSummary(bb: Blackboard): ObserveSummary {
  const events = bb.eventQueries.getRecent(200);

  // Count by type
  const eventsByType: Record<string, number> = {};
  for (const e of events) {
    eventsByType[e.event_type] = (eventsByType[e.event_type] ?? 0) + 1;
  }

  // Last heartbeat
  const lastHb = bb.heartbeatQueries.getLatest();
  const lastHeartbeat = lastHb?.timestamp ?? null;

  // Active agents
  const agentIds = new Set<string>();
  for (const e of events) {
    if (e.actor_id) agentIds.add(e.actor_id);
  }

  // Load all checks from checklist
  const checklist = parseHeartbeatChecklist();
  const allChecks: ChecklistItemStatus[] = [];

  // Recent checks (from events with checkName metadata)
  const recentChecks: ObserveSummary['recentChecks'] = [];
  const statusMap = new Map<string, { status: string; time: string }>();

  for (const e of events) {
    if (!e.metadata) continue;
    try {
      const meta = JSON.parse(e.metadata);
      if (meta.checkName) {
        if (!statusMap.has(meta.checkName)) {
          statusMap.set(meta.checkName, {
            status: meta.status ?? 'unknown',
            time: e.timestamp,
          });
          recentChecks.push({
            name: meta.checkName,
            status: meta.status ?? 'unknown',
            time: e.timestamp,
          });
        }
      }
    } catch {
      // Skip unparseable metadata
    }
  }

  // Map checklist to status
  for (const item of checklist) {
    const current = statusMap.get(item.name);
    allChecks.push({
      name: item.name,
      status: current?.status ?? (item.enabled ? 'pending' : 'disabled'),
      time: current?.time ?? null,
      interval_minutes: item.interval_minutes,
      enabled: item.enabled,
      severity: item.severity,
    });
  }

  // Calculate health
  let errors = 0;
  let alerts = 0;
  let enabledCount = 0;

  for (const c of allChecks) {
    if (!c.enabled) continue;
    enabledCount++;
    if (c.status === 'error') errors++;
    if (c.status === 'alert') alerts++;
  }

  let healthScore = 100;
  if (enabledCount > 0) {
    const errorWeight = 40;
    const alertWeight = 15;
    const penalty = (errors * errorWeight) + (alerts * alertWeight);
    healthScore = Math.max(0, 100 - (penalty / enabledCount) * 10);
    // Rough heuristic: cap at 100, divide by count and scale
    healthScore = Math.max(0, 100 - (errors * 30) - (alerts * 10));
  }

  const overallStatus = errors > 0 ? 'error' : alerts > 0 ? 'alert' : 'ok';

  return {
    totalEvents: events.length,
    eventsByType,
    lastHeartbeat,
    activeAgents: agentIds.size,
    recentChecks: recentChecks.slice(0, 10),
    allChecks,
    healthScore,
    overallStatus,
  };
}

/**
 * Format summary as text for CLI output.
 */
export function formatSummaryText(summary: ObserveSummary): string {
  const lines: string[] = [];

  lines.push('ivy-heartbeat dashboard');
  lines.push('═══════════════════════');
  lines.push('');
  lines.push(`  Events (recent):    ${summary.totalEvents}`);
  lines.push(`  Active agents:      ${summary.activeAgents}`);
  lines.push(`  Last heartbeat:     ${summary.lastHeartbeat ?? 'never'}`);
  lines.push('');

  if (Object.keys(summary.eventsByType).length > 0) {
    lines.push('  Events by type:');
    for (const [type, count] of Object.entries(summary.eventsByType)) {
      lines.push(`    ${type}: ${count}`);
    }
    lines.push('');
  }

  if (summary.recentChecks.length > 0) {
    lines.push('  Recent checks:');
    for (const check of summary.recentChecks) {
      const icon = check.status === 'ok' ? '✓' : check.status === 'alert' ? '!' : '✗';
      const time = check.time.split('T')[1]?.slice(0, 5) ?? '';
      lines.push(`    ${icon} ${check.name} (${check.status}) at ${time}`);
    }
  }

  return lines.join('\n');
}
