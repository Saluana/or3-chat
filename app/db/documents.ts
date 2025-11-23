import { db } from './client';
import { dbTry } from './dbTry';
import { newId, nowSec } from './util';
import { useHooks } from '../core/hooks/useHooks';
import type {
    DbCreatePayload,
    DbDeletePayload,
    DbUpdatePayload,
    DocumentEntity,
} from '../core/hooks/hook-types';
import type { TypedHookEngine } from '~/core/hooks/typed-hooks';

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

const DOCUMENT_TABLE = 'documents';

function toDocumentEntity(row: DocumentRow): DocumentEntity {
    return {
        id: row.id,
        title: row.title,
        content: row.content,
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
}

function documentEntityToRow(
    entity: DocumentEntity,
    base?: DocumentRow
): DocumentRow {
    const fallback: DocumentRow =
        base ??
        ({
            id: entity.id,
            title: normalizeTitle(entity.title ?? null),
            content: entity.content ?? JSON.stringify(emptyDocJSON()),
            postType: 'doc',
            created_at: entity.created_at ?? nowSec(),
            updated_at: entity.updated_at ?? nowSec(),
            deleted: false,
        } as DocumentRow);

    return {
        ...fallback,
        id: entity.id ?? fallback.id,
        title: entity.title ?? fallback.title,
        content: entity.content ?? fallback.content,
        created_at: entity.created_at ?? fallback.created_at,
        updated_at: entity.updated_at ?? fallback.updated_at,
        postType: 'doc',
        deleted: fallback.deleted ?? false,
    };
}

function mergeDocumentEntities(
    entities: DocumentEntity[],
    baseRows: Map<string, DocumentRow>
): DocumentRow[] {
    return entities.map((entity) =>
        documentEntityToRow(entity, baseRows.get(entity.id))
    );
}

function buildDocumentUpdatePayload(
    existingRow: DocumentRow,
    updatedRow: DocumentRow,
    patch: UpdateDocumentPatch
): DbUpdatePayload<DocumentEntity> {
    const patchEntity: Partial<DocumentEntity> = {
        id: existingRow.id,
        updated_at: updatedRow.updated_at,
    };
    if (patch.title !== undefined) patchEntity.title = updatedRow.title;
    if (patch.content !== undefined) patchEntity.content = updatedRow.content;

    return {
        existing: toDocumentEntity(existingRow),
        updated: toDocumentEntity(updatedRow),
        patch: patchEntity,
        tableName: DOCUMENT_TABLE,
    };
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
    existing?: DocumentEntity;
}

/**
 * Hook: `db.documents.title:filter`
 *  - Runs after trimming/normalizing the raw title and before persistence.
 *  - Receives the sanitized title as the value and additional context `{ phase, id, rawTitle, existing }`.
 */
async function resolveTitle(
    hooks: TypedHookEngine,
    rawTitle: string | null | undefined,
    context: TitleFilterContext
): Promise<string> {
    const base = normalizeTitle(rawTitle);
    return (hooks.applyFilters as any)(
        'db.documents.title:filter',
        base,
        context
    ) as Promise<string>;
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
    const baseRow: DocumentRow = {
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
    const filteredEntity = await hooks.applyFilters(
        'db.documents.create:filter:input',
        toDocumentEntity(baseRow)
    );
    const filteredRow = documentEntityToRow(filteredEntity, baseRow);
    let actionPayload: DbCreatePayload<DocumentEntity> = {
        entity: toDocumentEntity(filteredRow),
        tableName: DOCUMENT_TABLE,
    };
    await hooks.doAction('db.documents.create:action:before', actionPayload);
    const persistedRow = documentEntityToRow(actionPayload.entity, filteredRow);
    await dbTry(
        () => db.posts.put(persistedRow as any),
        { op: 'write', entity: 'posts', action: 'createDocument' },
        { rethrow: true }
    );
    actionPayload = {
        ...actionPayload,
        entity: toDocumentEntity(persistedRow),
    };
    await hooks.doAction('db.documents.create:action:after', actionPayload);
    return rowToRecord(persistedRow);
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
    const baseRow = row as DocumentRow;
    const filteredEntity = await hooks.applyFilters(
        'db.documents.get:filter:output',
        toDocumentEntity(baseRow)
    );
    if (!filteredEntity) return undefined;
    const mergedRow = documentEntityToRow(filteredEntity, baseRow);
    return rowToRecord(mergedRow);
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
    const baseMap = new Map(sliced.map((row) => [row.id, row]));
    const filteredEntities = await hooks.applyFilters(
        'db.documents.list:filter:output',
        sliced.map(toDocumentEntity)
    );
    return mergeDocumentEntities(filteredEntities, baseMap).map(rowToRecord);
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
    const existingRow = existing as DocumentRow;
    const updatedRow: DocumentRow = {
        id: existingRow.id,
        title: patch.title
            ? await resolveTitle(hooks, patch.title, {
                  phase: 'update',
                  id: existingRow.id,
                  rawTitle: patch.title,
                  existing: toDocumentEntity(existingRow),
              })
            : existingRow.title,
        content: patch.content
            ? JSON.stringify(patch.content)
            : existingRow.content,
        postType: 'doc',
        created_at: existingRow.created_at,
        updated_at: nowSec(),
        deleted: existingRow.deleted ?? false,
    };

    const basePayload = buildDocumentUpdatePayload(
        existingRow,
        updatedRow,
        patch
    );
    const filteredPayload = await hooks.applyFilters(
        'db.documents.update:filter:input',
        basePayload
    );
    const mergedRow = documentEntityToRow(filteredPayload.updated, updatedRow);

    let actionPayload: DbUpdatePayload<DocumentEntity> = {
        ...filteredPayload,
        updated: toDocumentEntity(mergedRow),
    };

    await hooks.doAction('db.documents.update:action:before', actionPayload);

    const persistedRow = documentEntityToRow(actionPayload.updated, mergedRow);
    await dbTry(
        () => db.posts.put(persistedRow as any),
        { op: 'write', entity: 'posts', action: 'updateDocument' },
        { rethrow: true }
    );

    actionPayload = {
        ...actionPayload,
        updated: toDocumentEntity(persistedRow),
    };
    await hooks.doAction('db.documents.update:action:after', actionPayload);
    return rowToRecord(persistedRow);
}

export async function softDeleteDocument(id: string): Promise<void> {
    const hooks = useHooks();
    const existing = await dbTry(() => db.posts.get(id), {
        op: 'read',
        entity: 'posts',
        action: 'getDocument',
    });
    if (!existing || (existing as any).postType !== 'doc') return;
    const existingRow = existing as DocumentRow;
    const payload: DbDeletePayload<DocumentEntity> = {
        entity: toDocumentEntity(existingRow),
        id: existingRow.id,
        tableName: DOCUMENT_TABLE,
    };
    await hooks.doAction('db.documents.delete:action:soft:before', payload);
    const row = {
        ...existingRow,
        deleted: true,
        updated_at: nowSec(),
    };
    await dbTry(
        () => db.posts.put(row),
        { op: 'write', entity: 'posts', action: 'softDeleteDocument' },
        { rethrow: true }
    );
    await hooks.doAction('db.documents.delete:action:soft:after', payload);
}

export async function hardDeleteDocument(id: string): Promise<void> {
    const hooks = useHooks();
    const existing = await dbTry(() => db.posts.get(id), {
        op: 'read',
        entity: 'posts',
        action: 'getDocument',
    });
    if (!existing || (existing as any).postType !== 'doc') return;
    const existingRow = existing as DocumentRow;
    const payload: DbDeletePayload<DocumentEntity> = {
        entity: toDocumentEntity(existingRow),
        id: existingRow.id,
        tableName: DOCUMENT_TABLE,
    };
    await hooks.doAction('db.documents.delete:action:hard:before', payload);
    await dbTry(
        () => db.posts.delete(id),
        { op: 'write', entity: 'posts', action: 'hardDeleteDocument' },
        { rethrow: true }
    );
    await hooks.doAction('db.documents.delete:action:hard:after', payload);
}

// Convenience for ensuring DB open (mirrors pattern in other modules)
export async function ensureDbOpen() {
    if (!db.isOpen()) await db.open();
}

export type { DocumentRecord as Document };
