/**
 * @module app/utils/projects/normalizeProjectData
 *
 * Purpose:
 * Normalizes project entry lists from user or plugin inputs into a
 * predictable array shape.
 */

export type ProjectEntryKind = 'chat' | 'doc' | 'file';

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

function coerceKind(value: unknown): ProjectEntryKind | null {
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'doc' || normalized === 'document') return 'doc';
        if (normalized === 'chat') return 'chat';
        if (normalized === 'file') return 'file';
    }
    return value === undefined ? 'chat' : null;
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
    if (!kind) return null;
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

/** Preserve extension entries and extra fields when an existing UI edits core entries. */
export function mergeProjectEntries(raw: unknown, entries: ProjectEntry[]): unknown[] {
    const original = parseEntriesArray(raw);
    if (raw != null && !original) throw new Error('Unsupported project membership format.');
    const remaining = new Map(entries.map(entry => [`${entry.kind}:${entry.id}`, entry]));
    const merged: unknown[] = [];
    for (const value of original ?? []) {
        const known = normalizeEntry(value);
        if (!known) { merged.push(value); continue; }
        const key = `${known.kind}:${known.id}`;
        const replacement = remaining.get(key);
        if (!replacement) continue;
        merged.push({ ...(isPlainObject(value) ? value : {}), ...replacement });
        remaining.delete(key);
    }
    return [...merged, ...remaining.values()];
}
