// Agent status values (matches CHECK constraint)
export const AGENT_STATUSES = [
  "active",
  "idle",
  "completed",
  "stale",
] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

// Work item status values
export const WORK_ITEM_STATUSES = [
  "available",
  "claimed",
  "completed",
  "blocked",
  "waiting_for_response",
  "pending_approval",
] as const;
export type WorkItemStatus = (typeof WORK_ITEM_STATUSES)[number];

// Work item priority values
export const WORK_ITEM_PRIORITIES = ["P1", "P2", "P3"] as const;
export type WorkItemPriority = (typeof WORK_ITEM_PRIORITIES)[number];

// Well-known work item source values (conventions, not exhaustive — any non-empty string is valid)
export const WELL_KNOWN_SOURCES = ["github", "local", "operator"] as const;
export type WorkItemSource = string;

// Known blackboard event types (not exhaustive — downstream consumers may define their own)
export const KNOWN_EVENT_TYPES = [
  "agent_registered",
  "agent_deregistered",
  "agent_stale",
  "agent_recovered",
  "work_claimed",
  "work_released",
  "work_completed",
  "work_blocked",
  "work_created",
  "work_deleted",
  "metadata_updated",
  "comment_received",
  "work_approved",
  "work_rejected",
  "project_registered",
  "project_updated",
  "heartbeat_received",
  "stale_locks_released",
  "content_blocked",
  "content_reviewed",
  // Learning loop event types
  "fact_extracted",
  "pattern_detected",
  "rule_synthesized",
  "rule_retired",
  "session_learning",
  // Phase 1: Approval, handover, and snapshot event types
  "approval_requested",
  "approval_granted",
  "approval_rejected",
  "work_handover",
  "snapshot_created",
  "snapshot_restored",
] as const;
export type KnownEventType = (typeof KNOWN_EVENT_TYPES)[number];

// Event type is free-form text — no CHECK constraint in the database
export type EventType = string;

// Target type for events
export const TARGET_TYPES = ["agent", "work_item", "project"] as const;
export type TargetType = (typeof TARGET_TYPES)[number];

// Entity interfaces matching SQL schema

export interface BlackboardAgent {
  session_id: string;
  agent_name: string;
  pid: number | null;
  parent_id: string | null;
  project: string | null;
  current_work: string | null;
  status: AgentStatus;
  started_at: string; // ISO 8601
  last_seen_at: string; // ISO 8601
  metadata: string | null; // JSON blob
}

export interface BlackboardProject {
  project_id: string;
  display_name: string;
  local_path: string | null;
  remote_repo: string | null;
  registered_at: string; // ISO 8601
  metadata: string | null; // JSON blob
}

export interface BlackboardWorkItem {
  item_id: string;
  project_id: string | null;
  title: string;
  description: string | null;
  source: WorkItemSource;
  source_ref: string | null;
  status: WorkItemStatus;
  priority: WorkItemPriority;
  claimed_by: string | null;
  claimed_at: string | null;
  completed_at: string | null;
  blocked_by: string | null;
  created_at: string; // ISO 8601
  metadata: string | null; // JSON blob
  handover_context: string | null; // Context from previous agent handover
  approval_request: string | null; // JSON: what the agent wants to do
}

export interface BlackboardHeartbeat {
  id: number;
  session_id: string;
  timestamp: string; // ISO 8601
  progress: string | null;
  work_item_id: string | null;
  metadata: string | null; // JSON blob
}

export interface BlackboardEvent {
  id: number;
  timestamp: string; // ISO 8601
  event_type: EventType;
  actor_id: string | null;
  target_id: string | null;
  target_type: TargetType | null;
  summary: string;
  metadata: string | null; // JSON blob
}

export interface MigrationEntry {
  version: number;
  applied_at: string; // ISO 8601
  description: string | null;
}

export interface DbOptions {
  dbPath?: string;
  envPath?: string;
}

// Steering rule status values
export const STEERING_RULE_STATUSES = ["active", "retired", "candidate"] as const;
export type SteeringRuleStatus = (typeof STEERING_RULE_STATUSES)[number];

// Steering rule entity matching the steering_rules table
export interface SteeringRule {
  rule_id: string;
  project_id: string | null;
  rule_text: string;
  source_event: number | null;
  confidence: number;
  hit_count: number;
  status: SteeringRuleStatus;
  created_at: string;
  updated_at: string;
  metadata: string | null;
}

// Snapshot entity for pre-dispatch state capture
export interface BlackboardSnapshot {
  snapshot_id: string;
  created_at: string; // ISO 8601
  trigger: string; // e.g. 'pre-dispatch', 'manual'
  item_count: number;
  agent_count: number;
  data: string | null; // JSON blob of serialized state
}
