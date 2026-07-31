/**
 * @module app/utils/projects/normalizeProjectData
 *
 * Purpose:
 * Normalizes project entry lists from user or plugin inputs into a
 * predictable array shape.
 */

export type ProjectEntryKind = 'chat' | 'doc';

/**
 * `ProjectEntry`
 *
 * Purpose:
 * Canonical project entry shape used in UI lists and menus.
 */
export interface ProjectEntry {
    id: string;
    name?: string;
    kind: ProjectEntryKind;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseEntriesArray(raw: unknown): unknown[] | null {
    if (Array.isArray(raw)) return raw.map((item) => item as unknown);
    if (typeof raw === 'string') {
        try {
            const parsed: unknown = JSON.parse(raw);
            return Array.isArray(parsed)
                ? parsed.map((item) => item as unknown)
                : null;
        } catch {
            return null;
        }
    }
    return null;
}

function coerceKind(value: unknown): ProjectEntryKind {
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'doc' || normalized === 'document') return 'doc';
        if (normalized === 'chat') return 'chat';
    }
    return 'chat';
}

function coerceName(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

function normalizeEntry(value: unknown): ProjectEntry | null {
    if (typeof value === 'string') {
        const id = value.trim();
        return id ? { id, kind: 'chat' } : null;
    }
    if (!isPlainObject(value)) return null;
    const idRaw = value.id;
    if (typeof idRaw !== 'string') return null;
    const id = idRaw.trim();
    if (!id) return null;
    const name = coerceName(value.name);
    const kind = coerceKind(value.kind);
    return { id, name, kind };
}

/**
 * `normalizeProjectData`
 *
 * Purpose:
 * Converts an unknown input into a normalized list of project entries.
 *
 * Behavior:
 * - Accepts arrays, JSON array strings, or single entry objects
 * - Skips invalid entries
 */
export function normalizeProjectData(raw: unknown): ProjectEntry[] {
    const arr = parseEntriesArray(raw);
    if (!arr || !arr.length) return [];
    const result: ProjectEntry[] = [];
    for (const entry of arr) {
        const normalized = normalizeEntry(entry);
        if (normalized) result.push(normalized);
    }
    return result;
}
