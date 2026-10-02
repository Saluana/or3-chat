/**
 * @module app/db/projects
 *
 * Purpose:
 * Project persistence helpers for the local database.
 *
 * Responsibilities:
 * - Validate and store project rows
 * - Emit hook events for project lifecycle operations
 *
 * Non-responsibilities:
 * - Workspace management or authorization
 */
import { getDb, type Or3DB } from './client';
import { dbTry } from './dbTry';
import { useHooks } from '../core/hooks/useHooks';
import { parseOrThrow, nowSec, nextClock, getWriteTxTableNames } from './util';
import { ProjectSchema, type Project } from './schema';

/**
 * Purpose:
 * Create a project row in the local database.
 *
 * Behavior:
 * Filters input, validates the schema, and writes to Dexie with hooks.
 *
 * Constraints:
 * - Throws on validation errors.
 *
 * Non-Goals:
 * - Does not create associated threads.
 */
export async function createProject(input: Project): Promise<Project> {
    const db = getDb();
    const prepared = await prepareProjectWrite(input, 'create');
    const next = prepared.row;
    await db.transaction('rw', getWriteTxTableNames(db, 'projects'), async () => {
        await dbTry(() => db.projects.put(next), { op: 'write', entity: 'projects', action: 'create' }, { rethrow: true });
    });
    await prepared.afterCommit(next);
    return next;
}

/**
 * Purpose:
 * Upsert a project row with updated clocks.
 *
 * Behavior:
 * Validates the project, updates clock values, and writes to Dexie.
 *
 * Constraints:
 * - Requires a fully shaped `Project` value.
 *
 * Non-Goals:
 * - Does not merge partial updates.
 */
/** Run project hooks before entering a caller's atomic workspace transaction. */
export async function prepareProjectWrite(value: Project, operation: 'create' | 'upsert') {
    const hooks = useHooks();
    const filtered = operation === 'create'
        ? await hooks.applyFilters('db.projects.create:filter:input', value)
        : await hooks.applyFilters('db.projects.upsert:filter:input', value);
    const validated = parseOrThrow(ProjectSchema, filtered);
    const row = operation === 'create' ? { ...validated, clock: nextClock(validated.clock) } : validated;
    if (operation === 'create') await hooks.doAction('db.projects.create:action:before', { entity: row, tableName: 'projects' });
    else await hooks.doAction('db.projects.upsert:action:before', { entity: row, tableName: 'projects' });
    return { row: parseOrThrow(ProjectSchema, row), afterCommit: async (saved: Project) => {
        if (operation === 'create') await hooks.doAction('db.projects.create:action:after', { entity: saved, tableName: 'projects' });
        else await hooks.doAction('db.projects.upsert:action:after', { entity: saved, tableName: 'projects' });
    } };
}

export async function upsertProject(value: Project): Promise<void> {
    return upsertProjectInDb(getDb(), value);
}

export async function upsertProjectInDb(db: Or3DB, value: Project): Promise<void> {
    const prepared = await prepareProjectWrite(value, 'upsert');
    let saved = prepared.row;
    await db.transaction('rw', getWriteTxTableNames(db, 'projects'), async () => {
        const existing = await db.projects.get(prepared.row.id);
        saved = { ...prepared.row, clock: nextClock(existing?.clock ?? prepared.row.clock) };
        await dbTry(() => db.projects.put(saved), { op: 'write', entity: 'projects', action: 'upsert' }, { rethrow: true });
    });
    await prepared.afterCommit(saved);
}

/**
 * Purpose:
 * Soft delete a project by marking it deleted.
 *
 * Behavior:
 * Updates deletion flags and timestamps with hooks.
 *
 * Constraints:
 * - No-op if the project does not exist.
 *
 * Non-Goals:
 * - Does not delete related threads.
 */
export async function softDeleteProject(id: string): Promise<void> {
    const hooks = useHooks();
    const db = getDb();
    await db.transaction(
        'rw',
        getWriteTxTableNames(db, 'projects', { includeTombstones: true }),
        async () => {
        const p = await dbTry(() => db.projects.get(id), {
            op: 'read',
            entity: 'projects',
            action: 'get',
        });
        if (!p) return;
        if (p.deleted) return;
        await hooks.doAction('db.projects.delete:action:soft:before', {
            entity: p,
            id: p.id,
            tableName: 'projects',
        });
        await db.projects.put({
            ...p,
            deleted: true,
            updated_at: nowSec(),
            clock: nextClock(p.clock),
        });
        await hooks.doAction('db.projects.delete:action:soft:after', {
            entity: p,
            id: p.id,
            tableName: 'projects',
        });
        }
    );
}

/**
 * Purpose:
 * Hard delete a project row by id.
 *
 * Behavior:
 * Deletes the row and emits delete hooks.
 *
 * Constraints:
 * - No-op if the project does not exist.
 *
 * Non-Goals:
 * - Does not cascade deletion to threads or messages.
 */
export async function hardDeleteProject(id: string): Promise<void> {
    const hooks = useHooks();
    const db = getDb();
    await db.transaction(
        'rw',
        getWriteTxTableNames(db, 'projects', { includeTombstones: true }),
        async () => {
        const existing = await dbTry(() => db.projects.get(id), {
            op: 'read',
            entity: 'projects',
            action: 'get',
        });
        if (!existing) return;

        await hooks.doAction('db.projects.delete:action:hard:before', {
            entity: existing,
            id,
            tableName: 'projects',
        });
        await db.projects.delete(id);
        await hooks.doAction('db.projects.delete:action:hard:after', {
            entity: existing,
            id,
            tableName: 'projects',
        });
        }
    );
}

/**
 * Purpose:
 * Fetch a project by id with hook filtering.
 *
 * Behavior:
 * Reads the row and applies output filters.
 *
 * Constraints:
 * - Returns undefined when missing or filtered out.
 *
 * Non-Goals:
 * - Does not include related threads.
 */
export async function getProject(id: string) {
    const hooks = useHooks();
    const res = await dbTry(() => getDb().projects.get(id), {
        op: 'read',
        entity: 'projects',
        action: 'get',
    });
    if (!res) return undefined;
    return hooks.applyFilters('db.projects.get:filter:output', res);
}
