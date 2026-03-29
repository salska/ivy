import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PersonaBlock {
    /** Persona file name without extension, e.g. "Engineer" */
    name: string;
    /** Raw description from YAML frontmatter */
    description: string;
    /** Persona background from frontmatter */
    background: string;
    /** Extracted capability keywords for scoring */
    keywords: string[];
    /** Cleaned markdown body (boilerplate stripped) */
    identityBlock: string;
    /** Whether this persona can be auto-selected via bidding */
    dispatchable: boolean;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_PERSONA_DIR = `${process.env.HOME ?? '/tmp'}/.claude/agents`;
const DEFAULT_PERSONA = 'Architect';

/** Phrases that mark a persona as a sub-agent (not dispatchable) */
const SUB_AGENT_MARKERS = [
    'called by',
    'called by research',
    'called by media',
    'called by webassessment',
];

/** Stop words to exclude from keyword extraction */
const STOP_WORDS = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be',
    'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'could', 'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before',
    'after', 'above', 'below', 'between', 'this', 'that', 'these', 'those', 'it',
    'its', 'not', 'no', 'nor', 'only', 'very', 'use', 'using', 'uses', 'any',
    'all', 'both', 'each', 'every', 'who', 'whom', 'which', 'what', 'when',
    'where', 'how', 'than', 'then', 'also', 'just', 'more', 'most', 'other',
    'some', 'such', 'own', 'same', 'so', 'too', 'about', 'up', 'out', 'if',
    'elite', 'agent', 'work', 'skill',
]);

/** Markers in section headers that indicate PAI-specific boilerplate */
const BOILERPLATE_SECTION_MARKERS = [
    '\u{1F6A8}',       // 🚨
    '\u{1F3AF} MANDATORY', // 🎯 MANDATORY
    'MANDATORY STARTUP',
    'MANDATORY OUTPUT',
    'MANDATORY VOICE',
    'MANDATORY: Voice',
    'MANDATORY FIRST',
    'SESSION STARTUP',
    'MANDATORY:',
    'Strategic Planning with /plan Mode',
    'Micro-Cycle Development',
    'Final Output Format',
    'Project State and Session Recovery',
    'Step-by-Step Instructions',
    'Planning and Coordination',
];

// ─── Cache ──────────────────────────────────────────────────────────────────

let cachedPersonas: Map<string, PersonaBlock> | null = null;

// ─── Core Functions ─────────────────────────────────────────────────────────

/**
 * Resolve the persona directory path.
 * Respects IVY_PERSONA_DIR env var for testing.
 */
export function getPersonaDir(): string {
    return process.env.IVY_PERSONA_DIR ?? DEFAULT_PERSONA_DIR;
}

/**
 * Parse YAML frontmatter from a markdown string.
 * Returns the frontmatter fields and the remaining body.
 */
function parseFrontmatter(content: string): { meta: Record<string, any>; body: string } {
    const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
    if (!match) return { meta: {}, body: content };

    const rawYaml = match[1]!;
    const body = match[2]!;

    // Simple YAML parser for the flat/nested fields we care about
    const meta: Record<string, any> = {};
    const lines = rawYaml.split('\n');
    let currentKey = '';

    for (const line of lines) {
        const topLevel = line.match(/^(\w[\w-]*):\s*(.*)$/);
        if (topLevel) {
            currentKey = topLevel[1]!;
            const value = topLevel[2]!.trim();
            if (value) {
                meta[currentKey] = value.replace(/^["']|["']$/g, '');
            } else {
                meta[currentKey] = {};
            }
            continue;
        }

        const nested = line.match(/^\s{2,}(\w[\w-]*):\s*(.+)$/);
        if (nested && currentKey && typeof meta[currentKey] === 'object') {
            const val = nested[2]!.trim().replace(/^["']|["']$/g, '');
            meta[currentKey][nested[1]!] = val;
        }
    }

    return { meta, body };
}

/**
 * Extract capability keywords from a description string.
 */
function extractKeywords(description: string): string[] {
    const tokens = description
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2 && !STOP_WORDS.has(w));

    // Deduplicate
    return [...new Set(tokens)];
}

/**
 * Detect whether a persona is a sub-agent (not eligible for bidding).
 * Personas containing "Researcher" are allowed even if they have sub-agent markers.
 */
function isSubAgent(description: string, name: string): boolean {
    const lower = description.toLowerCase();

    // Explicit sub-agent markers always take precedence — even for researcher personas.
    // e.g. "Called BY Research skill workflows only" marks ClaudeResearcher as non-dispatchable.
    if (SUB_AGENT_MARKERS.some(marker => lower.includes(marker))) return true;

    // Researcher personas without sub-agent markers are dispatchable (e.g. a first-class research agent).
    const isResearcher = name.toLowerCase().includes('researcher') || lower.includes('research');
    if (isResearcher) return false;

    return false;
}

/**
 * Strip PAI-specific boilerplate from agent markdown body.
 * Uses a section-level approach: splits on markdown headers, drops any section
 * whose header matches a boilerplate marker, then reassembles.
 */
export function stripBoilerplate(body: string): string {
    // Split into sections by markdown headers (# ## ### etc.)
    const sections = body.split(/(?=^#{1,4}\s)/m);

    const kept = sections.filter(section => {
        const firstLine = section.split('\n')[0]?.trim() ?? '';
        const upperHeader = firstLine.toUpperCase();
        // Drop sections whose header contains any boilerplate marker (case-insensitive)
        const isBoilerplate = BOILERPLATE_SECTION_MARKERS.some(marker =>
            upperHeader.includes(marker.toUpperCase())
        );
        if (isBoilerplate) return false;

        // Also drop sections that are mostly curl notification blocks or voice boilerplate
        if (section.includes('curl -X POST http://localhost:8888')) return false;
        if (section.toLowerCase().includes('voice notification')) return false;
        if (section.toLowerCase().includes('startup sound')) return false;

        return true;
    });

    let cleaned = kept.join('').trim();

    // Remove any remaining inline curl blocks
    cleaned = cleaned.replace(/```bash\s*\ncurl[\s\S]*?```/g, '');
    // Remove standalone NON-NEGOTIABLE / not optional lines
    cleaned = cleaned.replace(/^\*\*This is NON-NEGOTIABLE.*$/gm, '');
    cleaned = cleaned.replace(/^\*\*This is not optional.*$/gm, '');
    cleaned = cleaned.replace(/^\*\*DO NOT LIE.*$/gm, '');

    // Collapse multiple blank lines
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    return cleaned.trim();
}

/**
 * Load a single persona from disk by name.
 * Returns null if file does not exist.
 */
export function loadPersona(name: string): PersonaBlock | null {
    const dir = getPersonaDir();
    const filePath = join(dir, `${name}.md`);

    if (!existsSync(filePath)) return null;

    const raw = readFileSync(filePath, 'utf-8');
    const { meta, body } = parseFrontmatter(raw);

    const description = (meta.description as string) ?? '';
    const persona = meta.persona as Record<string, string> | undefined;
    const background = persona?.background ?? '';

    return {
        name: (meta.name as string) ?? name,
        description,
        background,
        keywords: extractKeywords(description),
        identityBlock: stripBoilerplate(body),
        dispatchable: !isSubAgent(description, name),
    };
}

/**
 * Load all dispatchable personas from the persona directory.
 * Results are cached after first call.
 */
export function loadAllDispatchable(): PersonaBlock[] {
    if (cachedPersonas) {
        return [...cachedPersonas.values()].filter(p => p.dispatchable);
    }

    const dir = getPersonaDir();
    if (!existsSync(dir)) return [];

    cachedPersonas = new Map();

    const files = readdirSync(dir).filter(f => f.endsWith('.md'));
    for (const file of files) {
        const name = basename(file, '.md');
        const persona = loadPersona(name);
        if (persona) {
            cachedPersonas.set(name, persona);
        }
    }

    return [...cachedPersonas.values()].filter(p => p.dispatchable);
}

/**
 * Score how well a persona matches a work item.
 * Returns a number >= 0. Higher = better match.
 *
 * Scoring:
 * - Exact word match: +2 points
 * - Substring overlap (min 4 chars): +0.5 points
 */
export function scoreBid(
    persona: PersonaBlock,
    title: string,
    description: string
): number {
    const text = `${title} ${description}`.toLowerCase();
    const tokens = text
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length > 2);

    let score = 0;
    for (const keyword of persona.keywords) {
        for (const token of tokens) {
            if (token === keyword) {
                // Exact match: high confidence
                score += 2;
            } else if (keyword.length >= 4 && token.includes(keyword)) {
                // Token contains keyword (e.g. "designing" contains "design")
                score += 0.5;
            } else if (token.length >= 4 && keyword.includes(token)) {
                // Keyword contains token
                score += 0.5;
            }
        }
    }

    return score;
}

/**
 * Select the best persona for a work item.
 *
 * 1. If metadata contains `agent_persona`, load that persona directly (override).
 * 2. Otherwise, run bidding across all dispatchable personas.
 * 3. If no persona scores above threshold, fall back to Architect.
 *
 * Returns null only if the override persona file doesn't exist.
 */
export function selectPersona(
    metadata: string | null,
    title: string,
    description: string,
    excludeNames: string[] = []
): PersonaBlock | null {
    const excluded = new Set(excludeNames.map(n => n.toLowerCase()));

    // 1. Explicit override from metadata (skip if that persona already failed)
    if (metadata) {
        try {
            const parsed = JSON.parse(metadata);
            if (parsed.agent_persona && typeof parsed.agent_persona === 'string') {
                if (!excluded.has(parsed.agent_persona.toLowerCase())) {
                    return loadPersona(parsed.agent_persona);
                }
                // Persona is excluded — fall through to bidding with rotation
            }
        } catch {
            // Not valid JSON — proceed to bidding
        }
    }

    // 2. Run bidding (exclude failed personas)
    const allCandidates = loadAllDispatchable();
    const candidates = excluded.size > 0
        ? allCandidates.filter(p => !excluded.has(p.name.toLowerCase()))
        : allCandidates;

    if (candidates.length === 0) {
        // All personas excluded — last resort: use best scorer from full pool
        if (allCandidates.length > 0) {
            const scored = allCandidates.map(p => ({
                persona: p,
                score: scoreBid(p, title, description),
            }));
            scored.sort((a, b) => b.score - a.score);
            return scored[0]!.persona;
        }
        return loadPersona(DEFAULT_PERSONA);
    }

    const scored = candidates.map(p => ({
        persona: p,
        score: scoreBid(p, title, description),
    }));

    scored.sort((a, b) => b.score - a.score);

    const THRESHOLD = 0.1;
    const best = scored[0]!;

    if (best.score >= THRESHOLD) {
        return best.persona;
    }

    // 3. Fallback to default (if not excluded), otherwise first candidate
    if (!excluded.has(DEFAULT_PERSONA.toLowerCase())) {
        return loadPersona(DEFAULT_PERSONA) ?? candidates[0] ?? null;
    }
    return candidates[0] ?? null;
}

/**
 * Reset the persona cache. Used for test isolation.
 */
export function resetPersonaCache(): void {
    cachedPersonas = null;
}
