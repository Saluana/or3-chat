/**
 * @module app/db/attachments
 *
 * Purpose:
 * Local attachment persistence APIs with hook integration for creation,
 * updates, and deletion lifecycles.
 *
 * Responsibilities:
 * - Validate attachment inputs with Zod schemas
 * - Persist attachment rows to IndexedDB via Dexie
 * - Emit hook actions and filters for extension points
 *
 * Non-responsibilities:
 * - Uploading or downloading attachment binaries
 * - Server-side storage lifecycle management
 */
import { getDb, getWorkspaceGeneration } from './client';
import { dbTry, dbRequired } from './dbTry';
import { useHooks } from '../core/hooks/useHooks';
import { parseOrThrow, nowSec, getWriteTxTableNames } from './util';
import {
    AttachmentCreateSchema,
    AttachmentSchema,
    type Attachment,
    type AttachmentCreate,
} from './schema';

/**
 * Purpose:
 * Create a new attachment record in the local database.
 *
 * Behavior:
 * Filters input, validates it, writes to Dexie, and emits before and after hooks.
 *
 * Constraints:
 * - Validation errors throw.
 * - Uses the active workspace DB from `getDb()`.
 *
 * Non-Goals:
 * - Does not handle file storage or upload.
 */
export async function createAttachment(
    input: AttachmentCreate
): Promise<Attachment> {
    const db = getDb();
    const hooks = useHooks();
    const filtered = await hooks.applyFilters(
        'db.attachments.create:filter:input',
        input
    );
    await hooks.doAction('db.attachments.create:action:before', {
        entity: filtered,
        tableName: 'attachments',
    });
    const value = parseOrThrow(AttachmentCreateSchema, filtered);
    await dbRequired(
        () => db.attachments.put(value),
        { op: 'write', entity: 'attachments', action: 'create' }
    );
    await hooks.doAction('db.attachments.create:action:after', {
        entity: value,
        tableName: 'attachments',
    });
    return value;
}

/**
 * Purpose:
 * Upsert an attachment record with hook integration.
 *
 * Behavior:
 * Filters input, validates the full schema, and writes to Dexie.
 *
 * Constraints:
 * - Requires a fully shaped `Attachment` value.
 *
 * Non-Goals:
 * - Does not merge partial updates.
 */
export async function upsertAttachment(value: Attachment): Promise<void> {
    const db = getDb();
    const hooks = useHooks();
    const filtered = await hooks.applyFilters(
        'db.attachments.upsert:filter:input',
        value
    );
    await hooks.doAction('db.attachments.upsert:action:before', {
        entity: filtered,
        tableName: 'attachments',
    });
    const validated = parseOrThrow(AttachmentSchema, filtered);
    await dbRequired(
        () => db.attachments.put(validated),
        { op: 'write', entity: 'attachments', action: 'upsert' }
    );
    await hooks.doAction('db.attachments.upsert:action:after', {
        entity: validated,
        tableName: 'attachments',
    });
}

/**
 * Purpose:
 * Soft delete an attachment by setting the deleted flag.
 *
 * Behavior:
 * Loads the row, toggles the deleted flag, updates timestamps, and emits hooks.
 *
 * Constraints:
 * - No-op if the attachment does not exist.
 *
 * Non-Goals:
 * - Does not remove the row permanently.
 */
export async function softDeleteAttachment(id: string): Promise<void> {
    await deleteAttachment(id, 'soft');
}

/**
 * Purpose:
 * Hard delete an attachment row from IndexedDB.
 *
 * Behavior:
 * Emits before and after hooks around the Dexie delete.
 *
 * Constraints:
 * - Caller is responsible for any external cleanup.
 *
 * Non-Goals:
 * - Does not cascade deletes to related tables.
 */
export async function hardDeleteAttachment(id: string): Promise<void> {
    await deleteAttachment(id, 'hard');
}

async function deleteAttachment(id: string, kind: 'soft' | 'hard'): Promise<void> {
    const db = getDb();
    const generation = getWorkspaceGeneration();
    const hooks = useHooks();
    const assertCurrent = () => {
        if (db !== getDb() || generation !== getWorkspaceGeneration()) {
            throw new Error('The workspace changed while deleting the attachment.');
        }
    };
    const existing = await dbRequired(() => db.attachments.get(id), {
        op: 'read', entity: 'attachments', action: 'get',
    });
    if (!existing) return;
    assertCurrent();
    const payload = { entity: existing, id, tableName: 'attachments' as const };
    await hooks.doAction(`db.attachments.delete:action:${kind}:before`, payload);
    assertCurrent();
    await db.transaction(
        'rw',
        getWriteTxTableNames(db, 'attachments', { includePendingOps: false }),
        async () => {
            const current = await db.attachments.get(id);
            assertCurrent();
            if (JSON.stringify(current) !== JSON.stringify(existing)) {
                throw new Error('This attachment changed while deleting it. Try again.');
            }
            if (kind === 'hard') await db.attachments.delete(id);
            else await db.attachments.put({ ...existing, deleted: true, updated_at: nowSec() });
            assertCurrent();
        }
    );
    try { await hooks.doAction(`db.attachments.delete:action:${kind}:after`, payload); }
    catch (error) { console.warn('[attachments] Deletion committed; notification failed', error); }
}

/**
 * Purpose:
 * Retrieve a single attachment by id with hook filtering.
 *
 * Behavior:
 * Reads the row and runs it through output filters.
 *
 * Constraints:
 * - Returns undefined when not found or filtered out.
 *
 * Non-Goals:
 * - Does not return related entity data.
 */
export async function getAttachment(id: string) {
    const db = getDb();
    const hooks = useHooks();
    const res = await dbTry(() => db.attachments.get(id), {
        op: 'read',
        entity: 'attachments',
        action: 'get',
    });
    if (!res) return undefined;
    return hooks.applyFilters('db.attachments.get:filter:output', res);
}
