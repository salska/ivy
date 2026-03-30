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

export interface TanaSearchFilter {
  name?: string | { contains: string };
  hasType?: string;
  childOf?: { nodeIds: string[]; recursive?: boolean; includeReferences?: boolean };
  ownedBy?: { nodeId: string; recursive?: boolean; includeSelf?: boolean };
  linksTo?: string[];
  is?: 'done' | 'todo' | 'template' | 'field' | 'published' | 'entity' | 'calendarNode' | 'onDayNode' | 'chat' | 'search' | 'command' | 'inLibrary';
  has?: 'tag' | 'field' | 'media' | 'audio' | 'video' | 'image';
  created?: { last: number };
  edited?: { by?: string; last?: number; since?: number };
  done?: { last: number };
  onDate?: string | { date: string; fieldId?: string; overlaps?: boolean };
  inWorkspace?: string;
  overdue?: true;
  inLibrary?: true;
  not?: Partial<TanaSearchFilter>;
}

export interface TanaSearchQuery {
  and?: TanaSearchFilter[];
  or?: TanaSearchFilter[];
}

// ─── TanaAccessor interface (injectable for testing) ──────────────────────

export interface TanaAccessor {
  listWorkspaces(): Promise<TanaWorkspace[]>;
  listTags(workspaceId: string): Promise<TanaTag[]>;
  resolveTagId(tagName: string): Promise<string | null>;
  searchNodes(query: TanaSearchQuery, opts?: {
    workspaceIds?: string[];
    limit?: number;
  }): Promise<TanaNode[]>;
  searchTodos(opts: {
    tagId: string;
    workspaceId?: string;
    limit?: number;
  }): Promise<TanaNode[]>;
  readNode(nodeId: string, maxDepth?: number): Promise<TanaNodeContent>;
  getChildren(nodeId: string, opts?: { limit?: number; offset?: number }): Promise<TanaChildrenResult>;
  addChildContent(parentNodeId: string, content: string): Promise<void>;
  checkNode(nodeId: string): Promise<void>;
}

// ─── Config types ─────────────────────────────────────────────────────────

export interface TanaTodosConfig {
  tagId?: string;
  workspaceId?: string;
  limit: number;
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
