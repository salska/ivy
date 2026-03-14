import type { Database } from "bun:sqlite";

export interface HealthMetric {
  label: string;
  value: string | number;
  status: "healthy" | "warning" | "critical" | "info";
  trend?: "up" | "down" | "stable";
  description?: string;
}

export interface HealthStatus {
  overall_score: number; // 0-100
  metrics: HealthMetric[];
  recent_failures: Array<{
    timestamp: string;
    summary: string;
    actor_id: string | null;
  }>;
  hourly_activity: Array<{
    hour: string;
    count: number;
  }>;
}

/**
 * Calculate system health metrics from the blackboard database.
 */
export function getHealthStatus(db: Database): HealthStatus {
  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // 1. Success Rate (Completed vs Stale/Failed)
  const completionStats = db.query(`
    SELECT 
      SUM(CASE WHEN event_type = 'work_completed' THEN 1 ELSE 0 END) as completions,
      SUM(CASE WHEN event_type = 'agent_stale' THEN 1 ELSE 0 END) as stales
    FROM events 
    WHERE timestamp >= ?
  `).get(sevenDaysAgo) as { completions: number | null; stales: number | null };

  const completions = completionStats.completions ?? 0;
  const stales = completionStats.stales ?? 0;
  const totalOutcomes = completions + stales;
  const successRate = totalOutcomes > 0 ? (completions / totalOutcomes) * 100 : 100;

  // 2. Average Task Completion Time (last 7 days)
  const latencyStats = db.query(`
    SELECT AVG(julianday(completed_at) - julianday(created_at)) * 1440 as avg_mins
    FROM work_items 
    WHERE status = 'completed' AND completed_at >= ?
  `).get(sevenDaysAgo) as { avg_mins: number | null };

  const avgLatency = latencyStats.avg_mins ?? 0;

  // 3. Stale Agent Count (Currently active)
  const staleCount = (db.query("SELECT COUNT(*) as count FROM agents WHERE status = 'stale'").get() as { count: number }).count;

  // 4. Recent Failures/Warnings (last 24h)
  const recentFailures = db.query(`
    SELECT timestamp, summary, actor_id 
    FROM events 
    WHERE (event_type = 'agent_stale' OR event_type = 'error' OR summary LIKE '%fail%')
    AND timestamp >= ?
    ORDER BY timestamp DESC
    LIMIT 10
  `).all(twentyFourHoursAgo) as HealthStatus["recent_failures"];

  // 5. Hourly Activity (last 24h)
  const hourlyActivity = db.query(`
    SELECT 
      strftime('%H', timestamp) as hour,
      COUNT(*) as count
    FROM events 
    WHERE timestamp >= ?
    GROUP BY hour
    ORDER BY hour ASC
  `).all(twentyFourHoursAgo) as HealthStatus["hourly_activity"];

  // Calculate Overall Score
  let score = 100;
  if (successRate < 95) score -= (95 - successRate) * 2;
  if (staleCount > 0) score -= Math.min(20, staleCount * 5);
  if (avgLatency > 120) score -= 10; // Penalty if tasks take > 2 hours on avg
  score = Math.max(0, Math.min(100, score));

  const metrics: HealthMetric[] = [
    {
      label: "Success Rate",
      value: `${successRate.toFixed(1)}%`,
      status: successRate > 90 ? "healthy" : successRate > 75 ? "warning" : "critical",
      description: "Ratio of completed tasks to stale agents (last 7d)"
    },
    {
      label: "Avg Task Duration",
      value: avgLatency > 60 ? `${(avgLatency / 60).toFixed(1)}h` : `${avgLatency.toFixed(0)}m`,
      status: avgLatency < 60 ? "healthy" : avgLatency < 240 ? "warning" : "critical",
      description: "Average time from creation to completion (last 7d)"
    },
    {
      label: "Stale Agents",
      value: staleCount,
      status: staleCount === 0 ? "healthy" : staleCount < 3 ? "warning" : "critical",
      description: "Agents that missed heartbeats and were swept"
    }
  ];

  return {
    overall_score: Math.round(score),
    metrics,
    recent_failures: recentFailures,
    hourly_activity: hourlyActivity
  };
}
