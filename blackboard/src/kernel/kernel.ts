/**
 * ivy-blackboard Kernel — Pure SDK Exports
 *
 * This module exports all stateless database operations, types,
 * and schema utilities. It has NO opinion on scheduling, CLI,
 * or background tasks. Import this from your runtime (ivy-heartbeat)
 * or any other consumer that needs direct blackboard access.
 */

// ─── Database lifecycle ──────────────────────────────────────────────
export {
    openDatabase,
    closeDatabase,
    resolveDbPath,
    getSchemaVersion,
    migrate,
} from "./db";

// ─── Schema constants ────────────────────────────────────────────────
export {
    CURRENT_SCHEMA_VERSION,
    PRAGMA_SQL,
    CREATE_TABLES_SQL,
    CREATE_INDEXES_SQL,
    SEED_VERSION_SQL,
    MIGRATE_V2_SQL,
    MIGRATE_V3_SQL,
    MIGRATE_V4_SQL,
    MIGRATE_V5_SQL,
    MIGRATE_V6_SQL,
    MIGRATE_V7_SQL,
} from "./schema";

// ─── Agent lifecycle ─────────────────────────────────────────────────
export {
    registerAgent,
    sendHeartbeat,
    deregisterAgent,
    listAgents,
    type RegisterAgentOptions,
    type RegisterAgentResult,
    type HeartbeatOptions,
    type HeartbeatResult,
    type DeregisterAgentResult,
    type ListAgentsOptions,
} from "./agent";

// ─── Work items ──────────────────────────────────────────────────────
export {
    createWorkItem,
    listWorkItems,
    claimWorkItem,
    createAndClaimWorkItem,
    completeWorkItem,
    releaseWorkItem,
    blockWorkItem,
    unblockWorkItem,
    setWaitingForResponse,
    deleteWorkItem,
    getWorkItemStatus,
    updateWorkItemMetadata,
    appendWorkItemEvent,
    requestApproval,
    approveWorkItem,
    rejectWorkItem,
    handoverWorkItem,
    type CreateWorkItemOptions,
    type CreateWorkItemResult,
    type ClaimWorkItemResult,
    type CompleteWorkItemResult,
    type ReleaseWorkItemResult,
    type BlockWorkItemResult,
    type UnblockWorkItemResult,
    type SetWaitingResult,
    type UpdateWorkItemMetadataResult,
    type ListWorkItemsOptions,
    type DeleteWorkItemResult,
    type RequestApprovalResult,
    type ApproveWorkItemResult,
    type RejectWorkItemResult,
    type HandoverWorkItemResult,
} from "./work";

// ─── Projects ────────────────────────────────────────────────────────
export {
    registerProject,
    listProjects,
    getProjectStatus,
    getProjectDetail,
    type RegisterProjectOptions,
    type RegisterProjectResult,
    type ProjectWithCounts,
    type ProjectStatus,
    type ProjectDetail,
} from "./project";

// ─── Events ──────────────────────────────────────────────────────────
export {
    observeEvents,
    parseDuration,
    type ObserveEventsOptions,
} from "./events";

// ─── Learnings / Steering Rules ──────────────────────────────────────
export {
    queryLearnings,
    synthesizeRules,
    buildPromptContext,
    type QueryLearningsOptions,
    type PromptContext,
    type SynthesisResult,
} from "./learnings";

// ─── Sweep (stale agent cleanup) ─────────────────────────────────────
export { sweepStaleAgents } from "./sweep";

// ─── Sanitization ────────────────────────────────────────────────────
export { sanitizeText } from "./sanitize";

// ─── Content filtering (ingestion boundary) ──────────────────────────
export {
    ingestExternalContent,
    mergeFilterMetadata,
    requiresFiltering,
    type IngestResult,
} from "./ingestion";

// ─── Configuration ───────────────────────────────────────────────────
export { loadConfig } from "./config";

// ─── Output formatting utilities ─────────────────────────────────────
export { formatJson, formatTable, formatRelativeTime } from "./output";

// ─── Context (for consumers that need lazy DB + sweeping) ────────────
export {
    createContext,
    resetContextState,
    disableAutoSweep,
    type GlobalOptions,
    type CommandContext,
} from "./context";

// ─── Error handling ──────────────────────────────────────────────────
export { BlackboardError, withErrorHandling } from "./errors";

// ─── Status ──────────────────────────────────────────────────────────
export {
    getOverallStatus,
    formatSize,
    type OverallStatus,
} from "./status";

// ─── Export utilities ────────────────────────────────────────────────
export {
    exportSnapshot,
    serializeSnapshot,
    type ExportSnapshot,
    type ExportOptions,
} from "./export";

// ─── Snapshots (Phase 1) ─────────────────────────────────────────────────
export {
    createSnapshot,
    listSnapshots,
    restoreSnapshot,
    type CreateSnapshotResult,
    type RestoreSnapshotResult,
} from "./snapshot";

// ─── All types ───────────────────────────────────────────────────────
export type {
    AgentStatus,
    WorkItemStatus,
    WorkItemPriority,
    WorkItemSource,
    KnownEventType,
    EventType,
    TargetType,
    BlackboardAgent,
    BlackboardProject,
    BlackboardWorkItem,
    BlackboardHeartbeat,
    BlackboardEvent,
    BlackboardSnapshot,
    MigrationEntry,
    DbOptions,
    SteeringRuleStatus,
    SteeringRule,
} from "./types";

export {
    AGENT_STATUSES,
    WORK_ITEM_STATUSES,
    WORK_ITEM_PRIORITIES,
    WELL_KNOWN_SOURCES,
    KNOWN_EVENT_TYPES,
    TARGET_TYPES,
    STEERING_RULE_STATUSES,
} from "./types";

// ─── Permissions ─────────────────────────────────────────────────────
export { setSecurePermissions, validatePermissions } from "./permissions";
