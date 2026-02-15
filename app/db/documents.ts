/**
 * @module app/db/documents
 *
 * Purpose:
 * Document CRUD utilities built on top of the posts table with hook support.
 *
 * Responsibilities:
 * - Manage document-specific metadata and content parsing
 * - Emit hook actions and filters for document lifecycle events
 * - Provide stable typed APIs for document records
 *
 * Non-responsibilities:
 * - Rich-text editor state management
 * - Server-side document synchronization
 */
import { getDb } from './client';
import { dbTry } from './dbTry';
import { newId, nowSec, nextClock, getWriteTxTableNames } from './util';
import { useHooks } from '../core/hooks/useHooks';
import type {
    DbCreatePayload,
    DbDeletePayload,
    DbUpdatePayload,
    DocumentEntity,
} from '../core/hooks/hook-types';
import type { TypedHookEngine } from '~/core/hooks/typed-hooks';
import type { TipTapDocument } from '~/types/database';
import type { Post } from './schema';

/**
 * Type guard to check if a post is a document
 */
function isDocumentPost(
    post: Post | undefined | null
): post is Post & { postType: 'doc' } {
    return post !== undefined && post !== null && post.postType === 'doc';
}

/**
 * Internal stored row shape (reuses posts table with postType = 'doc').
 * We intentionally DO NOT add a new Dexie version / table to keep scope minimal.
 * Content is persisted as a JSON string (TipTap JSON) for flexibility.
 */
/**
 * Purpose:
 * Internal storage shape for document rows in the posts table.
 *
 * Behavior:
 * Persists TipTap JSON as a string to keep Dexie rows compact.
 *
 * Constraints:
 * - `postType` must be `doc`.
 *
 * Non-Goals:
 * - Not intended for direct consumption by UI.
 */
export interface DocumentRow {
    id: string;
    title: string; // non-empty trimmed
    content: string; // JSON string
    postType: string; // always 'doc'
    created_at: number; // seconds
    updated_at: number; // seconds
    deleted: boolean;
    clock?: number;
}

/** Public facing record with content already parsed. */
/**
 * Purpose:
 * Public document record shape returned to callers.
 *
 * Behavior:
 * Parses the stored JSON content into a TipTap document.
 *
 * Constraints:
 * - Content is normalized to a valid TipTap JSON structure.
 *
 * Non-Goals:
 * - Does not retain raw JSON strings.
 */
export interface DocumentRecord {
    id: string;
    title: string;
    content: TipTapDocument | null; // TipTap JSON object
    created_at: number;
    updated_at: number;
    deleted: boolean;
}

const DOCUMENT_TABLE = 'documents';

async function putDocumentPostRow(row: Post): Promise<void> {
    const db = getDb();
    if (typeof (db as { transaction?: unknown }).transaction !== 'function') {
        await db.posts.put(row);
        return;
    }
    await db.transaction(
        'rw',
        getWriteTxTableNames(db, 'posts'),
        async () => {
            await db.posts.put(row);
        }
    );
}

async function deleteDocumentPostRow(id: string): Promise<void> {
    const db = getDb();
    if (typeof (db as { transaction?: unknown }).transaction !== 'function') {
        await db.posts.delete(id);
        return;
    }
    await db.transaction(
        'rw',
        getWriteTxTableNames(db, 'posts', { includeTombstones: true }),
        async () => {
            await db.posts.delete(id);
        }
    );
}

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
            clock: 0,
        } as DocumentRow);

    return {
        ...fallback,
        id: entity.id,
        title: entity.title ?? fallback.title,
        content: entity.content ?? fallback.content,
        created_at: entity.created_at ?? fallback.created_at,
        updated_at: entity.updated_at ?? fallback.updated_at,
        postType: 'doc',
        deleted: fallback.deleted,
        clock: fallback.clock,
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

function emptyDocJSON(): TipTapDocument {
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
    return await hooks.applyFilters('db.documents.title:filter', base, context);
}

function parseContent(raw: string | null | undefined): TipTapDocument {
    if (!raw) return emptyDocJSON();
    try {
        const parsed: unknown = JSON.parse(raw);
        // Basic structural guard - ensure it's a valid TipTap document
        if (
            parsed &&
            typeof parsed === 'object' &&
            'type' in parsed &&
            (parsed as { type: unknown }).type === 'doc'
        ) {
            return parsed as TipTapDocument;
        }
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

/**
 * Purpose:
 * Input payload for creating new documents.
 *
 * Behavior:
 * Allows optional title and TipTap JSON content.
 *
 * Constraints:
 * - Title is normalized and defaults to a non-empty value.
 *
 * Non-Goals:
 * - Does not accept markdown or other formats.
 */
export interface CreateDocumentInput {
    title?: string | null;
    content?: TipTapDocument | null; // TipTap JSON object
}

/**
 * Purpose:
 * Create and persist a document record.
 *
 * Behavior:
 * Normalizes title, validates content, writes to the posts table, and emits
 * lifecycle hooks.
 *
 * Constraints:
 * - Stored content is JSON-stringified TipTap documents.
 *
 * Non-Goals:
 * - Does not perform collaborative merge logic.
 */
export async function createDocument(
    input: CreateDocumentInput = {}
): Promise<DocumentRecord> {
    const hooks = useHooks();
    const id = newId();
    const baseRow: DocumentRow = {
        id,
        title: await resolveTitle(hooks, input.title, {
            phase: 'create',
            id,
            rawTitle: input.title,
        }),
        content: JSON.stringify(input.content ?? emptyDocJSON()),
        postType: 'doc',
        created_at: nowSec(),
        updated_at: nowSec(),
        deleted: false,
        clock: nextClock(),
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
    // Convert DocumentRow to Post type for getDb().posts.put
    const postRow: Post = {
        id: persistedRow.id,
        title: persistedRow.title,
        content: persistedRow.content,
        postType: persistedRow.postType,
        created_at: persistedRow.created_at,
        updated_at: persistedRow.updated_at,
        deleted: persistedRow.deleted,
        meta: '',
        clock: persistedRow.clock ?? 0,
    };
    await dbTry(
        () => putDocumentPostRow(postRow),
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

/**
 * Purpose:
 * Fetch a single document by id.
 *
 * Behavior:
 * Reads the post row, filters through hooks, and returns a parsed record.
 *
 * Constraints:
 * - Returns undefined when the record is missing or filtered out.
 *
 * Non-Goals:
 * - Does not resolve linked entities or attachments.
 */
export async function getDocument(
    id: string
): Promise<DocumentRecord | undefined> {
    const hooks = useHooks();
    const row = await dbTry(() => getDb().posts.get(id), {
        op: 'read',
        entity: 'posts',
        action: 'getDocument',
    });
    if (!isDocumentPost(row)) return undefined;
    const baseRow: DocumentRow = {
        id: row.id,
        title: row.title,
        content: row.content,
        postType: row.postType,
        created_at: row.created_at,
        updated_at: row.updated_at,
        deleted: row.deleted,
        clock: row.clock,
    };
    const filteredEntity = await hooks.applyFilters(
        'db.documents.get:filter:output',
        toDocumentEntity(baseRow)
    );
    if (!filteredEntity) return undefined;
    const mergedRow = documentEntityToRow(filteredEntity, baseRow);
    return rowToRecord(mergedRow);
}

/**
 * Purpose:
 * List recent documents with optional limiting.
 *
 * Behavior:
 * Filters by `postType = doc`, excludes deleted rows, and sorts by `updated_at`.
 *
 * Constraints:
 * - Sorting is done in-memory for small result sets.
 *
 * Non-Goals:
 * - Does not paginate via cursor semantics.
 */
export async function listDocuments(limit = 100): Promise<DocumentRecord[]> {
    const hooks = useHooks();
    // Filter by postType (indexed) and non-deleted
    const rows = await dbTry(
        () =>
            getDb().posts
                .where('postType')
                .equals('doc')
                .and((r) => !r.deleted)
                .reverse()
                .toArray(),
        { op: 'read', entity: 'posts', action: 'listDocuments' }
    );
    if (!rows) return [];
    // Sort by updated_at desc (Dexie compound index not defined for this pair; manual sort ok for small N)
    rows.sort((a, b) => b.updated_at - a.updated_at);
    const sliced = rows.slice(0, limit) as DocumentRow[];
    const baseMap = new Map(sliced.map((row) => [row.id, row]));
    const filteredEntities = await hooks.applyFilters(
        'db.documents.list:filter:output',
        sliced.map(toDocumentEntity)
    );
    return mergeDocumentEntities(filteredEntities, baseMap).map(rowToRecord);
}

/**
 * Purpose:
 * Patch payload for document updates.
 *
 * Behavior:
 * Accepts optional title and content updates.
 *
 * Constraints:
 * - Undefined values are ignored.
 *
 * Non-Goals:
 * - Does not allow partial TipTap patch application.
 */
export interface UpdateDocumentPatch {
    title?: string;
    content?: TipTapDocument | null; // TipTap JSON object
}

/**
 * Purpose:
 * Update an existing document record.
 *
 * Behavior:
 * Loads the row, applies the patch, persists changes, and emits hooks.
 *
 * Constraints:
 * - Returns undefined if the document does not exist.
 *
 * Non-Goals:
 * - Does not merge concurrent edits.
 */
export async function updateDocument(
    id: string,
    patch: UpdateDocumentPatch
): Promise<DocumentRecord | undefined> {
    const hooks = useHooks();
    const existing = await dbTry(() => getDb().posts.get(id), {
        op: 'read',
        entity: 'posts',
        action: 'getDocument',
    });
    if (!isDocumentPost(existing)) return undefined;
    const existingRow: DocumentRow = {
        id: existing.id,
        title: existing.title,
        content: existing.content,
        postType: existing.postType,
        created_at: existing.created_at,
        updated_at: existing.updated_at,
        deleted: existing.deleted,
        clock: existing.clock,
    };
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
        deleted: existingRow.deleted,
        clock: nextClock(existingRow.clock),
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
    // Convert DocumentRow to Post type for getDb().posts.put
    const postRow: Post = {
        id: persistedRow.id,
        title: persistedRow.title,
        content: persistedRow.content,
        postType: persistedRow.postType,
        created_at: persistedRow.created_at,
        updated_at: persistedRow.updated_at,
        deleted: persistedRow.deleted,
        meta: '',
        clock: persistedRow.clock ?? 0,
    };
    await dbTry(
        () => putDocumentPostRow(postRow),
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

/**
 * Purpose:
 * Soft delete a document by marking the row as deleted.
 *
 * Behavior:
 * Updates deletion metadata and emits delete hooks.
 *
 * Constraints:
 * - No-op when the document does not exist.
 *
 * Non-Goals:
 * - Does not permanently remove the row.
 */
export async function softDeleteDocument(id: string): Promise<void> {
    const hooks = useHooks();
    const existing = await dbTry(() => getDb().posts.get(id), {
        op: 'read',
        entity: 'posts',
        action: 'getDocument',
    });
    if (!isDocumentPost(existing)) return;
    const existingRow: DocumentRow = {
        id: existing.id,
        title: existing.title,
        content: existing.content,
        postType: existing.postType,
        created_at: existing.created_at,
        updated_at: existing.updated_at,
        deleted: existing.deleted,
        clock: existing.clock,
    };
    const payload: DbDeletePayload<DocumentEntity> = {
        entity: toDocumentEntity(existingRow),
        id: existingRow.id,
        tableName: DOCUMENT_TABLE,
    };
    await hooks.doAction('db.documents.delete:action:soft:before', payload);
    const updatedRow = {
        ...existingRow,
        deleted: true,
        updated_at: nowSec(),
        clock: nextClock(existingRow.clock),
    };
    // Convert to Post type for getDb().posts.put
    const postRow: Post = {
        id: updatedRow.id,
        title: updatedRow.title,
        content: updatedRow.content,
        postType: updatedRow.postType,
        created_at: updatedRow.created_at,
        updated_at: updatedRow.updated_at,
        deleted: updatedRow.deleted,
        meta: '',
        clock: updatedRow.clock,
    };
    await dbTry(
        () => putDocumentPostRow(postRow),
        { op: 'write', entity: 'posts', action: 'softDeleteDocument' },
        { rethrow: true }
    );
    await hooks.doAction('db.documents.delete:action:soft:after', payload);
}

/**
 * Purpose:
 * Hard delete a document row from the posts table.
 *
 * Behavior:
 * Removes the row and emits delete hooks.
 *
 * Constraints:
 * - No-op when the document does not exist.
 *
 * Non-Goals:
 * - Does not clean up external resources.
 */
export async function hardDeleteDocument(id: string): Promise<void> {
    const hooks = useHooks();
    const existing = await dbTry(() => getDb().posts.get(id), {
        op: 'read',
        entity: 'posts',
        action: 'getDocument',
    });
    if (!isDocumentPost(existing)) return;
    const existingRow: DocumentRow = {
        id: existing.id,
        title: existing.title,
        content: existing.content,
        postType: existing.postType,
        created_at: existing.created_at,
        updated_at: existing.updated_at,
        deleted: existing.deleted,
        clock: existing.clock,
    };
    const payload: DbDeletePayload<DocumentEntity> = {
        entity: toDocumentEntity(existingRow),
        id: existingRow.id,
        tableName: DOCUMENT_TABLE,
    };
    await hooks.doAction('db.documents.delete:action:hard:before', payload);
    await dbTry(
        () => deleteDocumentPostRow(id),
        { op: 'write', entity: 'posts', action: 'hardDeleteDocument' },
        { rethrow: true }
    );
    await hooks.doAction('db.documents.delete:action:hard:after', payload);
}

/**
 * Purpose:
 * Public type alias for document records.
 *
 * Behavior:
 * Mirrors `DocumentRecord`.
 *
 * Constraints:
 * - Provided for backward compatibility.
 *
 * Non-Goals:
 * - Does not represent the internal storage row shape.
 */
export type { DocumentRecord as Document };
