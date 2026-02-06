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
import { getDb } from './client';
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
    const hooks = useHooks();
    const filtered = await hooks.applyFilters(
        'db.projects.create:filter:input',
        input
    );
    const value = parseOrThrow(ProjectSchema, filtered);
    const next = { ...value, clock: nextClock(value.clock) };
    await hooks.doAction('db.projects.create:action:before', {
        entity: next,
        tableName: 'projects',
    });
    const db = getDb();
    await db.transaction('rw', getWriteTxTableNames(db, 'projects'), async () => {
        await dbTry(
            () => db.projects.put(next),
            { op: 'write', entity: 'projects', action: 'create' },
            { rethrow: true }
        );
    });
    await hooks.doAction('db.projects.create:action:after', {
        entity: next,
        tableName: 'projects',
    });
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
export async function upsertProject(value: Project): Promise<void> {
    const hooks = useHooks();
    const filtered = await hooks.applyFilters(
        'db.projects.upsert:filter:input',
        value
    );
    await hooks.doAction('db.projects.upsert:action:before', {
        entity: filtered,
        tableName: 'projects',
    });
    const db = getDb();
    await db.transaction('rw', getWriteTxTableNames(db, 'projects'), async () => {
        const validated = parseOrThrow(ProjectSchema, filtered);
        const existing = await dbTry(() => db.projects.get(validated.id), {
            op: 'read',
            entity: 'projects',
            action: 'get',
        });
        const next = {
            ...validated,
            clock: nextClock(existing?.clock ?? validated.clock),
        };
        await dbTry(
            () => db.projects.put(next),
            { op: 'write', entity: 'projects', action: 'upsert' },
            { rethrow: true }
        );
        await hooks.doAction('db.projects.upsert:action:after', {
            entity: next,
            tableName: 'projects',
        });
    });
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
    await db.transaction('rw', getWriteTxTableNames(db, 'projects'), async () => {
        const p = await dbTry(() => db.projects.get(id), {
            op: 'read',
            entity: 'projects',
            action: 'get',
        });
        if (!p) return;
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
    });
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
