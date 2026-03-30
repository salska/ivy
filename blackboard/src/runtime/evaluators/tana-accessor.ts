import type {
  TanaAccessor,
  TanaNode,
  TanaNodeContent,
  TanaWorkspace,
  TanaTag,
  TanaChildrenResult,
  TanaSearchQuery,
  TanaSearchFilter,
} from './tana-types.ts';

// ─── Tana local API client (http://localhost:8262) ───────────────────────

/**
 * Default TanaAccessor that calls Tana Desktop's local REST API directly.
 *
 * Reads bearer token from ~/.config/supertag/config.json (same config
 * used by the supertag CLI). No subprocess spawning needed.
 *
 * Uses the proper Tana local API endpoints:
 *   GET  /workspaces                    — discover available workspaces
 *   GET  /workspaces/{id}/tags          — list tags by name+ID (reliable tag resolution)
 *   GET  /nodes/search                  — structured search with full query DSL
 *   GET  /nodes/{id}                    — read node content as markdown
 *   GET  /nodes/{id}/children           — paginated children
 *   POST /nodes/{id}/import             — import content under a node
 *   POST /nodes/{id}/done               — mark a todo as done
 *
 * In tests, this is entirely replaced by a mock via setTanaAccessor().
 */

const TANA_LOCAL_API = 'http://localhost:8262';
const CONFIG_PATH = `${process.env.HOME}/.config/supertag/config.json`;

let cachedBearerToken: string | null = null;

function getBearerToken(): string {
  if (cachedBearerToken) return cachedBearerToken;
  try {
    const fs = require('node:fs');
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const config = JSON.parse(raw);
    const token = config.localApi?.bearerToken ?? config.bearerToken ?? '';
    if (!token) throw new Error('No bearer token found in supertag config');
    cachedBearerToken = token;
    return token;
  } catch (err) {
    throw new Error(`Failed to read Tana bearer token from ${CONFIG_PATH}: ${(err as Error).message}`);
  }
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────

async function tanaGet(path: string, query?: Record<string, string>): Promise<unknown> {
  const url = new URL(path, TANA_LOCAL_API);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, v);
    }
  }
  const resp = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${getBearerToken()}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Tana local API ${path} failed (${resp.status}): ${body.slice(0, 200)}`);
  }
  return resp.json();
}

/**
 * GET with raw URL string — needed for the search endpoint where
 * bracket notation query params must not be percent-encoded.
 */
async function tanaGetRaw(rawUrl: string): Promise<unknown> {
  const resp = await fetch(rawUrl, {
    headers: { Authorization: `Bearer ${getBearerToken()}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Tana local API GET failed (${resp.status}): ${body.slice(0, 200)}`);
  }
  return resp.json();
}

async function tanaPost(path: string, body: unknown): Promise<unknown> {
  const resp = await fetch(`${TANA_LOCAL_API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getBearerToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Tana local API POST ${path} failed (${resp.status}): ${text.slice(0, 200)}`);
  }
  return resp.json();
}

// ─── Search query serialization ───────────────────────────────────────────

/**
 * Serialize a TanaSearchQuery into bracket-notation URL query params.
 *
 * The Tana local API requires literal brackets in the URL, e.g.:
 *   query[and][0][hasType]=XYZ&query[and][1][not][is]=done
 *
 * We build the raw URL string rather than using URLSearchParams
 * (which would percent-encode the brackets and cause 400 errors).
 */
function serializeSearchQuery(query: TanaSearchQuery): string {
  const parts: string[] = [];

  function serializeFilter(prefix: string, filter: TanaSearchFilter): void {
    if (filter.name !== undefined) {
      if (typeof filter.name === 'string') {
        parts.push(`${prefix}[name]=${encodeURIComponent(filter.name)}`);
      } else {
        parts.push(`${prefix}[name][contains]=${encodeURIComponent(filter.name.contains)}`);
      }
    }
    if (filter.hasType !== undefined) {
      parts.push(`${prefix}[hasType]=${encodeURIComponent(filter.hasType)}`);
    }
    if (filter.childOf !== undefined) {
      for (let i = 0; i < filter.childOf.nodeIds.length; i++) {
        parts.push(`${prefix}[childOf][nodeIds][${i}]=${encodeURIComponent(filter.childOf.nodeIds[i]!)}`);
      }
      if (filter.childOf.recursive !== undefined) {
        parts.push(`${prefix}[childOf][recursive]=${filter.childOf.recursive}`);
      }
      if (filter.childOf.includeReferences !== undefined) {
        parts.push(`${prefix}[childOf][includeReferences]=${filter.childOf.includeReferences}`);
      }
    }
    if (filter.ownedBy !== undefined) {
      parts.push(`${prefix}[ownedBy][nodeId]=${encodeURIComponent(filter.ownedBy.nodeId)}`);
      if (filter.ownedBy.recursive !== undefined) {
        parts.push(`${prefix}[ownedBy][recursive]=${filter.ownedBy.recursive}`);
      }
      if (filter.ownedBy.includeSelf !== undefined) {
        parts.push(`${prefix}[ownedBy][includeSelf]=${filter.ownedBy.includeSelf}`);
      }
    }
    if (filter.linksTo !== undefined) {
      for (let i = 0; i < filter.linksTo.length; i++) {
        parts.push(`${prefix}[linksTo][${i}]=${encodeURIComponent(filter.linksTo[i]!)}`);
      }
    }
    if (filter.is !== undefined) {
      parts.push(`${prefix}[is]=${encodeURIComponent(filter.is)}`);
    }
    if (filter.has !== undefined) {
      parts.push(`${prefix}[has]=${encodeURIComponent(filter.has)}`);
    }
    if (filter.created !== undefined) {
      parts.push(`${prefix}[created][last]=${filter.created.last}`);
    }
    if (filter.edited !== undefined) {
      if (filter.edited.by) parts.push(`${prefix}[edited][by]=${encodeURIComponent(filter.edited.by)}`);
      if (filter.edited.last !== undefined) parts.push(`${prefix}[edited][last]=${filter.edited.last}`);
      if (filter.edited.since !== undefined) parts.push(`${prefix}[edited][since]=${filter.edited.since}`);
    }
    if (filter.done !== undefined) {
      parts.push(`${prefix}[done][last]=${filter.done.last}`);
    }
    if (filter.onDate !== undefined) {
      if (typeof filter.onDate === 'string') {
        parts.push(`${prefix}[onDate]=${encodeURIComponent(filter.onDate)}`);
      } else {
        parts.push(`${prefix}[onDate][date]=${encodeURIComponent(filter.onDate.date)}`);
        if (filter.onDate.fieldId) parts.push(`${prefix}[onDate][fieldId]=${encodeURIComponent(filter.onDate.fieldId)}`);
        if (filter.onDate.overlaps !== undefined) parts.push(`${prefix}[onDate][overlaps]=${filter.onDate.overlaps}`);
      }
    }
    if (filter.inWorkspace !== undefined) {
      parts.push(`${prefix}[inWorkspace]=${encodeURIComponent(filter.inWorkspace)}`);
    }
    if (filter.overdue === true) {
      parts.push(`${prefix}[overdue]=true`);
    }
    if (filter.inLibrary === true) {
      parts.push(`${prefix}[inLibrary]=true`);
    }
    if (filter.not !== undefined) {
      serializeFilter(`${prefix}[not]`, filter.not as TanaSearchFilter);
    }
  }

  if (query.and) {
    for (let i = 0; i < query.and.length; i++) {
      serializeFilter(`query[and][${i}]`, query.and[i]!);
    }
  }
  if (query.or) {
    for (let i = 0; i < query.or.length; i++) {
      serializeFilter(`query[or][${i}]`, query.or[i]!);
    }
  }

  return parts.join('&');
}

// ─── Workspace/tag caching ────────────────────────────────────────────────

/** Cache resolved tag IDs so we don't hit the API repeatedly */
const tagIdCache = new Map<string, string>();

// ─── Default accessor implementation ──────────────────────────────────────

const defaultTanaAccessor: TanaAccessor = {
  async listWorkspaces(): Promise<TanaWorkspace[]> {
    const result = await tanaGet('/workspaces');
    if (!Array.isArray(result)) return [];
    return result as TanaWorkspace[];
  },

  async listTags(workspaceId: string): Promise<TanaTag[]> {
    const result = await tanaGet(`/workspaces/${encodeURIComponent(workspaceId)}/tags`);
    if (!Array.isArray(result)) return [];
    return result as TanaTag[];
  },

  async resolveTagId(tagName: string): Promise<string | null> {
    const cleanName = tagName.startsWith('#') ? tagName.slice(1) : tagName;

    // Check cache first
    const cached = tagIdCache.get(cleanName);
    if (cached) return cached;

    // Use the proper tags list API: discover workspaces, then search tags by name
    try {
      const workspaces = await defaultTanaAccessor.listWorkspaces();
      if (workspaces.length === 0) {
        throw new Error('No Tana workspaces found. Ensure Tana Desktop is running.');
      }

      for (const ws of workspaces) {
        const tags = await defaultTanaAccessor.listTags(ws.id);
        const match = tags.find(
          (t) => t.name.toLowerCase() === cleanName.toLowerCase()
        );
        if (match) {
          tagIdCache.set(cleanName, match.id);
          return match.id;
        }
      }

      return null;
    } catch (err) {
      throw new Error(`Failed to resolve tag "${tagName}": ${(err as Error).message}`);
    }
  },

  async searchNodes(query, opts) {
    const queryString = serializeSearchQuery(query);
    let url = `${TANA_LOCAL_API}/nodes/search?${queryString}`;

    if (opts?.workspaceIds) {
      for (let i = 0; i < opts.workspaceIds.length; i++) {
        url += `&workspaceIds[${i}]=${encodeURIComponent(opts.workspaceIds[i]!)}`;
      }
    }
    if (opts?.limit) {
      url += `&limit=${opts.limit}`;
    }

    const result = await tanaGetRaw(url);
    if (!Array.isArray(result)) return [];
    return result as TanaNode[];
  },

  async searchTodos(opts) {
    // Build a proper search query: hasType + not done
    const query: TanaSearchQuery = {
      and: [
        { hasType: opts.tagId },
        { not: { is: 'done' } },
      ],
    };

    return defaultTanaAccessor.searchNodes(query, {
      workspaceIds: opts.workspaceId ? [opts.workspaceId] : undefined,
      limit: opts.limit,
    });
  },

  async readNode(nodeId, maxDepth = 2) {
    const query: Record<string, string> = {};
    if (maxDepth !== undefined) query.maxDepth = String(maxDepth);

    const result = await tanaGet(`/nodes/${encodeURIComponent(nodeId)}`, query);
    if (!result || typeof result !== 'object') {
      return { id: nodeId, name: '', markdown: '', children: [] };
    }

    const r = result as Record<string, unknown>;
    return {
      id: nodeId,
      name: (r.name as string) ?? '',
      markdown: (r.markdown as string) ?? '',
      children: Array.isArray(r.children) ? r.children as string[] : [],
    };
  },

  async getChildren(nodeId, opts) {
    const query: Record<string, string> = {};
    if (opts?.limit) query.limit = String(opts.limit);
    if (opts?.offset) query.offset = String(opts.offset);

    const result = await tanaGet(`/nodes/${encodeURIComponent(nodeId)}/children`, query);
    if (!result || typeof result !== 'object') {
      return { children: [] };
    }

    const r = result as Record<string, unknown>;
    return {
      children: Array.isArray(r.children) ? r.children as any[] : [],
      totalCount: typeof r.totalCount === 'number' ? r.totalCount : undefined,
    };
  },

  async addChildContent(parentNodeId, content) {
    await tanaPost(`/nodes/${encodeURIComponent(parentNodeId)}/import`, { content });
  },

  async checkNode(nodeId) {
    await tanaPost(`/nodes/${encodeURIComponent(nodeId)}/done`, { done: true });
  },
};

// ─── Injectable accessor (for testing) ────────────────────────────────────

let tanaAccessor: TanaAccessor = defaultTanaAccessor;

export function getTanaAccessor(): TanaAccessor {
  return tanaAccessor;
}

export function setTanaAccessor(accessor: TanaAccessor): void {
  tanaAccessor = accessor;
}

export function resetTanaAccessor(): void {
  tanaAccessor = defaultTanaAccessor;
  tagIdCache.clear();
}
