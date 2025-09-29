import { db } from './client';
import { dbTry } from './dbTry';
import { newId, nowSec } from './util';
import { useHooks } from '../composables/useHooks';
import type { HookEngine } from '../utils/hooks';

/**
 * Internal stored row shape (reuses posts table with postType = 'doc').
 * We intentionally DO NOT add a new Dexie version / table to keep scope minimal.
 * Content is persisted as a JSON string (TipTap JSON) for flexibility.
 */
export interface DocumentRow {
    id: string;
    title: string; // non-empty trimmed
    content: string; // JSON string
    postType: string; // always 'doc'
    created_at: number; // seconds
    updated_at: number; // seconds
    deleted: boolean;
}

/** Public facing record with content already parsed. */
export interface DocumentRecord {
    id: string;
    title: string;
    content: any; // TipTap JSON object
    created_at: number;
    updated_at: number;
    deleted: boolean;
}

function emptyDocJSON() {
    return { type: 'doc', content: [] };
}

function normalizeTitle(title?: string | null): string {
    const t = (title ?? '').trim();
    return t.length ? t : 'Untitled';
}

interface TitleFilterContext {
    phase: 'create' | 'update';
    id: string;
    rawTitle?: string | null;
    existing?: DocumentRow;
}

/**
 * Hook: `db.documents.title:filter`
 *  - Runs after trimming/normalizing the raw title and before persistence.
 *  - Receives the sanitized title as the value and additional context `{ phase, id, rawTitle, existing }`.
 */
async function resolveTitle(
    hooks: HookEngine,
    rawTitle: string | null | undefined,
    context: TitleFilterContext
): Promise<string> {
    const base = normalizeTitle(rawTitle);
    return hooks.applyFilters('db.documents.title:filter', base, context);
}

function parseContent(raw: string | null | undefined): any {
    if (!raw) return emptyDocJSON();
    try {
        const parsed = JSON.parse(raw);
        // Basic structural guard
        if (parsed && typeof parsed === 'object' && parsed.type) return parsed;
        return emptyDocJSON();
    } catch {
        return emptyDocJSON();
    }
}

function rowToRecord(row: DocumentRow): DocumentRecord {
    return {
        id: row.id,
        title: row.title,
        content: parseContent(row.content),
        created_at: row.created_at,
        updated_at: row.updated_at,
        deleted: row.deleted,
    };
}

export interface CreateDocumentInput {
    title?: string | null;
    content?: any; // TipTap JSON object
}

export async function createDocument(
    input: CreateDocumentInput = {}
): Promise<DocumentRecord> {
    const hooks = useHooks();
    const id = newId();
    const prepared: DocumentRow = {
        id,
        title: await resolveTitle(hooks, input.title ?? null, {
            phase: 'create',
            id,
            rawTitle: input.title ?? null,
        }),
        content: JSON.stringify(input.content ?? emptyDocJSON()),
        postType: 'doc',
        created_at: nowSec(),
        updated_at: nowSec(),
        deleted: false,
    };
    /**
     * Hook: `db.documents.create:filter:input`
     *  - Filter phase allowing plugins to transform or veto the pending row before persistence.
     */
    const filtered = (await hooks.applyFilters(
        'db.documents.create:filter:input',
        prepared
    )) as DocumentRow;
    /**
     * Hook: `db.documents.create:action:before`
     *  - Action fired prior to writing the new document row. Can throw to veto.
     */
    await hooks.doAction('db.documents.create:action:before', filtered);
    await dbTry(
        () => db.posts.put(filtered as any),
        { op: 'write', entity: 'posts', action: 'createDocument' },
        { rethrow: true }
    ); // reuse posts table
    /**
     * Hook: `db.documents.create:action:after`
     *  - Action fired after the row has been persisted.
     */
    await hooks.doAction('db.documents.create:action:after', filtered);
    return rowToRecord(filtered);
}

export async function getDocument(
    id: string
): Promise<DocumentRecord | undefined> {
    const hooks = useHooks();
    const row = await dbTry(() => db.posts.get(id), {
        op: 'read',
        entity: 'posts',
        action: 'getDocument',
    });
    if (!row || (row as any).postType !== 'doc') return undefined;
    const filtered = (await hooks.applyFilters(
        'db.documents.get:filter:output',
        row
    )) as DocumentRow | undefined;
    return filtered ? rowToRecord(filtered) : undefined;
}

export async function listDocuments(limit = 100): Promise<DocumentRecord[]> {
    const hooks = useHooks();
    // Filter by postType (indexed) and non-deleted
    const rows = await dbTry(
        () =>
            db.posts
                .where('postType')
                .equals('doc')
                .and((r) => !(r as any).deleted)
                .reverse()
                .toArray(),
        { op: 'read', entity: 'posts', action: 'listDocuments' }
    );
    if (!rows) return [];
    // Sort by updated_at desc (Dexie compound index not defined for this pair; manual sort ok for small N)
    rows.sort((a, b) => b.updated_at - a.updated_at);
    const sliced = rows.slice(0, limit) as unknown as DocumentRow[];
    const filtered = (await hooks.applyFilters(
        'db.documents.list:filter:output',
        sliced
    )) as DocumentRow[];
    return filtered.map(rowToRecord);
}

export interface UpdateDocumentPatch {
    title?: string;
    content?: any; // TipTap JSON object
}

export async function updateDocument(
    id: string,
    patch: UpdateDocumentPatch
): Promise<DocumentRecord | undefined> {
    const hooks = useHooks();
    const existing = await dbTry(() => db.posts.get(id), {
        op: 'read',
        entity: 'posts',
        action: 'getDocument',
    });
    if (!existing || (existing as any).postType !== 'doc') return undefined;
    const updated: DocumentRow = {
        id: existing.id,
        title: patch.title
            ? await resolveTitle(hooks, patch.title, {
                  phase: 'update',
                  id: existing.id,
                  rawTitle: patch.title,
                  existing: existing as DocumentRow,
              })
            : existing.title,
        content: patch.content
            ? JSON.stringify(patch.content)
            : (existing as any).content,
        postType: 'doc',
        created_at: existing.created_at,
        updated_at: nowSec(),
        deleted: (existing as any).deleted ?? false,
    };
    /**
     * Hook: `db.documents.update:filter:input`
     *  - Filter phase receives `{ existing, updated, patch }` allowing transforms or veto.
     */
    const filtered = (await hooks.applyFilters(
        'db.documents.update:filter:input',
        { existing, updated, patch }
    )) as { updated: DocumentRow } | DocumentRow;
    const row = (filtered as any).updated
        ? (filtered as any).updated
        : (filtered as any as DocumentRow);
    /**
     * Hook: `db.documents.update:action:before`
     *  - Action fired prior to writing the updated row. Throwing will abort the write.
     */
    await hooks.doAction('db.documents.update:action:before', row);
    await dbTry(
        () => db.posts.put(row as any),
        { op: 'write', entity: 'posts', action: 'updateDocument' },
        { rethrow: true }
    );
    /**
     * Hook: `db.documents.update:action:after`
     *  - Action fired after a successful write.
     */
    await hooks.doAction('db.documents.update:action:after', row);
    return rowToRecord(row);
}

export async function softDeleteDocument(id: string): Promise<void> {
    const hooks = useHooks();
    const existing = await dbTry(() => db.posts.get(id), {
        op: 'read',
        entity: 'posts',
        action: 'getDocument',
    });
    if (!existing || (existing as any).postType !== 'doc') return;
    const row = {
        ...(existing as any),
        deleted: true,
        updated_at: nowSec(),
    };
    await hooks.doAction('db.documents.delete:action:soft:before', row);
    await dbTry(
        () => db.posts.put(row),
        { op: 'write', entity: 'posts', action: 'softDeleteDocument' },
        { rethrow: true }
    );
    await hooks.doAction('db.documents.delete:action:soft:after', row);
}

export async function hardDeleteDocument(id: string): Promise<void> {
    const hooks = useHooks();
    const existing = await dbTry(() => db.posts.get(id), {
        op: 'read',
        entity: 'posts',
        action: 'getDocument',
    });
    if (!existing || (existing as any).postType !== 'doc') return;
    await hooks.doAction('db.documents.delete:action:hard:before', existing);
    await dbTry(
        () => db.posts.delete(id),
        { op: 'write', entity: 'posts', action: 'hardDeleteDocument' },
        { rethrow: true }
    );
    await hooks.doAction('db.documents.delete:action:hard:after', id);
}

// Convenience for ensuring DB open (mirrors pattern in other modules)
export async function ensureDbOpen() {
    if (!db.isOpen()) await db.open();
}

export type { DocumentRecord as Document };
