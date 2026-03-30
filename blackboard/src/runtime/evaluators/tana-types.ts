import type { ProjectWithCounts } from '../blackboard.ts';

// ─── Tana local API response types ───────────────────────────────────────

export interface TanaWorkspace {
  id: string;
  name?: string;
  homeNodeId?: string;
}

export interface TanaTag {
  id: string;
  name: string;
  color?: string;
}

export interface TanaNode {
  id: string;
  name: string;
  markdown?: string;
  tags?: Array<{ id: string; name: string }>;
  tagIds?: string[];
  workspaceId?: string;
  description?: string;
  created?: string;
  breadcrumb?: string[];
  docType?: string;
  inTrash?: boolean;
}

export interface TanaNodeContent {
  id: string;
  name: string;
  markdown: string;
  children?: string[];
}

export interface TanaChildNode {
  id: string;
  name: string;
  tags?: Array<{ id: string; name: string }>;
}

export interface TanaChildrenResult {
  children: TanaChildNode[];
  totalCount?: number;
}

// ─── Tana Search Query types ──────────────────────────────────────────────

/**
 * Typed representation of the Tana Search API query language.
 * Maps to the /nodes/search endpoint's `query` parameter.
 *
 * Filters compose via `and`/`or` arrays, or can be used standalone.
 */
export interface TanaSearchFilter {
  /** Match by node name (exact or contains) */
  name?: string | { contains: string };
  /** Filter by supertag ID */
  hasType?: string;
  /** Find children of specific nodes */
  childOf?: { nodeIds: string[]; recursive?: boolean; includeReferences?: boolean };
  /** Find nodes owned by a specific node */
  ownedBy?: { nodeId: string; recursive?: boolean; includeSelf?: boolean };
  /** Find nodes linking to these IDs */
  linksTo?: string[];
  /** Special node type filter */
  is?: 'done' | 'todo' | 'template' | 'field' | 'published' | 'entity' | 'calendarNode' | 'onDayNode' | 'chat' | 'search' | 'command' | 'inLibrary';
  /** Content type filter */
  has?: 'tag' | 'field' | 'media' | 'audio' | 'video' | 'image';
  /** Nodes created within N days */
  created?: { last: number };
  /** Nodes edited within time range */
  edited?: { by?: string; last?: number; since?: number };
  /** Nodes marked done within N days */
  done?: { last: number };
  /** Date matching */
  onDate?: string | { date: string; fieldId?: string; overlaps?: boolean };
  /** Limit to specific workspace */
  inWorkspace?: string;
  /** Overdue tasks */
  overdue?: true;
  /** Library/stash items */
  inLibrary?: true;
  /** Negation wrapper */
  not?: Partial<TanaSearchFilter>;
}

export interface TanaSearchQuery {
  and?: TanaSearchFilter[];
  or?: TanaSearchFilter[];
}

// ─── TanaAccessor interface (injectable for testing) ──────────────────────

/**
 * Injectable Tana accessor — mirrors the BlackboardAccessor pattern.
 * Each method maps to a Tana local API endpoint (localhost:8262).
 */
export interface TanaAccessor {
  /** GET /workspaces — list all available workspaces */
  listWorkspaces(): Promise<TanaWorkspace[]>;

  /** GET /workspaces/{id}/tags — list all tags in a workspace */
  listTags(workspaceId: string): Promise<TanaTag[]>;

  /** Resolve a tag name (e.g. "ivy-todo" or "#ivy-todo") to its internal ID */
  resolveTagId(tagName: string): Promise<string | null>;

  /** GET /nodes/search — flexible structured search */
  searchNodes(query: TanaSearchQuery, opts?: {
    workspaceIds?: string[];
    limit?: number;
  }): Promise<TanaNode[]>;

  /** search_nodes with hasType filter, unchecked only (convenience wrapper) */
  searchTodos(opts: {
    tagId: string;
    workspaceId?: string;
    limit?: number;
  }): Promise<TanaNode[]>;

  /** GET /nodes/{id} — read a node as markdown */
  readNode(nodeId: string, maxDepth?: number): Promise<TanaNodeContent>;

  /** GET /nodes/{id}/children — paginated children */
  getChildren(nodeId: string, opts?: { limit?: number; offset?: number }): Promise<TanaChildrenResult>;

  /** POST /nodes/{id}/import — add content under a node */
  addChildContent(parentNodeId: string, content: string): Promise<void>;

  /** POST /nodes/{id}/done — mark todo as done */
  checkNode(nodeId: string): Promise<void>;
}

// ─── Config types ─────────────────────────────────────────────────────────

export interface TanaTodosConfig {
  /** Tag name (e.g. "#ivy-todo") or resolved tag ID — auto-resolved via tags API */
  tagId?: string;
  /** Tana workspace ID (optional — auto-discovered if not set) */
  workspaceId?: string;
  /** Max todos to fetch per evaluation (default: 20) */
  limit: number;
  /** Tana field ID for "Project" field on ivy-todo nodes (optional) */
  projectFieldId?: string;
}

// ─── Work item metadata ───────────────────────────────────────────────────

export interface TanaWorkItemMetadata {
  tana_node_id: string;
  tana_workspace_id?: string;
  tana_tag_id: string;
  content_filtered: boolean;
  content_blocked: boolean;
  content_warning?: boolean;
  filter_matches: string[];
  minimal_context?: boolean;
  project_name?: string;
  human_review_required?: boolean;
}

// ─── Content filter types (shared with github-issues) ─────────────────────

export interface ContentFilterResult {
  decision: 'ALLOWED' | 'BLOCKED' | 'HUMAN_REVIEW';
  matches: Array<{ pattern_id: string; pattern_name: string; matched_text: string }>;
}

export type ContentFilterFn = (content: string, label: string) => Promise<ContentFilterResult>;

// ─── Blackboard accessor (minimal interface for the evaluator) ────────────

export type TanaBlackboardAccessor = {
  listProjects(): ProjectWithCounts[];
  listWorkItems(opts?: { all?: boolean; project?: string }): Array<{
    source_ref: string | null;
    metadata?: string | null;
    status?: string;
  }>;
  createWorkItem(opts: {
    id: string;
    title: string;
    description?: string;
    project?: string | null;
    source?: string;
    sourceRef?: string;
    priority?: string;
    metadata?: string;
  }): unknown;
};
