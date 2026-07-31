/**
 * @module app/db/kv
 *
 * Purpose:
 * Key value storage helpers with hook integration.
 *
 * Responsibilities:
 * - Provide CRUD helpers for the KV table
 * - Ensure the active DB is open before operations
 *
 * Non-responsibilities:
 * - Storing secrets outside the KV table
 * - Schema migrations or indexing
 */
import { getDb, type Or3DB } from './client';
import { dbTry } from './dbTry';
import { useHooks } from '../core/hooks/useHooks';
import { parseOrThrow, nowSec, nextClock, getWriteTxTableNames } from './util';
import { KvCreateSchema, KvSchema, type Kv, type KvCreate } from './schema';

async function ensureDbOpen(targetDb: Or3DB): Promise<void> {
    if (!targetDb.isOpen()) {
        await targetDb.open();
    }
}

/**
 * Purpose:
 * Create a KV record in the local database.
 *
 * Behavior:
 * Applies filters, validates the input, and writes to Dexie.
 *
 * Constraints:
 * - Throws on validation errors.
 *
 * Non-Goals:
 * - Does not perform deduplication by name.
 */
export async function createKv(input: KvCreate): Promise<Kv> {
    const db = getDb();
    await ensureDbOpen(db);
    const hooks = useHooks();
    const filtered = await hooks.applyFilters(
        'db.kv.create:filter:input',
        input
    );
    await hooks.doAction('db.kv.create:action:before', {
        entity: filtered,
        tableName: 'kv',
    });
    const value = parseOrThrow(KvCreateSchema, filtered);
    const next = {
        ...value,
        clock: nextClock(value.clock),
    };
    await db.transaction('rw', getWriteTxTableNames(db, 'kv'), async () => {
        await dbTry(
            () => db.kv.put(next),
            { op: 'write', entity: 'kv', action: 'create' },
            { rethrow: true }
        );
    });
    await hooks.doAction('db.kv.create:action:after', {
        entity: next,
        tableName: 'kv',
    });
    return next;
}

/**
 * Purpose:
 * Upsert a KV record using the full schema.
 *
 * Behavior:
 * Validates, updates clock values, and writes to Dexie with hooks.
 *
 * Constraints:
 * - Requires a fully shaped `Kv` value.
 *
 * Non-Goals:
 * - Does not merge partial updates.
 */
export async function upsertKv(value: Kv): Promise<void> {
    const db = getDb();
    await ensureDbOpen(db);
    const hooks = useHooks();
    const filtered = await hooks.applyFilters(
        'db.kv.upsert:filter:input',
        value
    );
    await hooks.doAction('db.kv.upsert:action:before', {
        entity: filtered,
        tableName: 'kv',
    });
    await db.transaction('rw', getWriteTxTableNames(db, 'kv'), async () => {
        const validated = parseOrThrow(KvSchema, filtered);
        const existing = await dbTry(() => db.kv.get(validated.id), {
            op: 'read',
            entity: 'kv',
            action: 'get',
        });
        const next = {
            ...validated,
            clock: nextClock(existing?.clock ?? validated.clock),
        };
        await dbTry(
            () => db.kv.put(next),
            { op: 'write', entity: 'kv', action: 'upsert' },
            { rethrow: true }
        );
        await hooks.doAction('db.kv.upsert:action:after', {
            entity: next,
            tableName: 'kv',
        });
    });
}

/**
 * Purpose:
 * Hard delete a KV record by id.
 *
 * Behavior:
 * Reads the record, emits delete hooks, and removes it from Dexie.
 *
 * Constraints:
 * - No-op if the record does not exist.
 *
 * Non-Goals:
 * - Does not clear related caches.
 */
export async function hardDeleteKv(id: string): Promise<void> {
    const db = getDb();
    await ensureDbOpen(db);
    const hooks = useHooks();
    await db.transaction(
        'rw',
        getWriteTxTableNames(db, 'kv', { includeTombstones: true }),
        async () => {
        const existing = await dbTry(() => db.kv.get(id), {
            op: 'read',
            entity: 'kv',
            action: 'get',
        });
        if (!existing) return;
        await hooks.doAction('db.kv.delete:action:hard:before', {
            entity: existing,
            id,
            tableName: 'kv',
        });
        await db.kv.delete(id);
        await hooks.doAction('db.kv.delete:action:hard:after', {
            entity: existing,
            id,
            tableName: 'kv',
        });
    });
}

/**
 * Purpose:
 * Fetch a KV record by id with hook filtering.
 *
 * Behavior:
 * Reads the row and applies output filters.
 *
 * Constraints:
 * - Returns undefined when missing or filtered out.
 *
 * Non-Goals:
 * - Does not parse stored values.
 */
export async function getKv(id: string) {
    const db = getDb();
    await ensureDbOpen(db);
    const hooks = useHooks();
    const res = await dbTry(() => db.kv.get(id), {
        op: 'read',
        entity: 'kv',
        action: 'get',
    });
    if (!res) return undefined;
    return hooks.applyFilters('db.kv.get:filter:output', res);
}

/**
 * Purpose:
 * Fetch a KV record by name.
 *
 * Behavior:
 * Queries on the `name` index and applies output filters.
 *
 * Constraints:
 * - Uses the provided DB instance when supplied.
 *
 * Non-Goals:
 * - Does not create the record if missing.
 */
export async function getKvByName(name: string, targetDb: Or3DB = getDb()) {
    await ensureDbOpen(targetDb);
    const hooks = useHooks();
    const res = await dbTry(() => targetDb.kv.where('name').equals(name).first(), {
        op: 'read',
        entity: 'kv',
        action: 'getByName',
    });
    return hooks.applyFilters('db.kv.getByName:filter:output', res);
}

// Convenience helpers for auth/session flows
/**
 * Purpose:
 * Set or update a KV record by name.
 *
 * Behavior:
 * Creates the record if missing or updates the existing row with clocks.
 *
 * Constraints:
 * - Uses `kv:${name}` as the id for new records.
 *
 * Non-Goals:
 * - Does not perform transactional writes across tables.
 */
export async function setKvByName(
    name: string,
    value: string | null,
    targetDb: Or3DB = getDb()
): Promise<Kv> {
    await ensureDbOpen(targetDb);
    const hooks = useHooks();
    const existing = await dbTry(
        () => targetDb.kv.where('name').equals(name).first(),
        { op: 'read', entity: 'kv', action: 'getByName' }
    );
    const now = nowSec();
    const record: Kv = {
        id: existing?.id ?? `kv:${name}`,
        name,
        value,
        deleted: false,
        created_at: existing?.created_at ?? now,
        updated_at: now,
        clock: nextClock(existing?.clock),
    };
    const filtered = await hooks.applyFilters(
        'db.kv.upsertByName:filter:input',
        record
    );
    const kvEntity: Kv =
        'id' in filtered && 'created_at' in filtered
            ? (filtered as Kv)
            : record;
    await targetDb.transaction(
        'rw',
        getWriteTxTableNames(targetDb, 'kv'),
        async () => {
        parseOrThrow(KvSchema, kvEntity);
        await dbTry(
            () => targetDb.kv.put(kvEntity),
            { op: 'write', entity: 'kv', action: 'upsertByName' },
            { rethrow: true }
        );
        await hooks.doAction('db.kv.upsertByName:action:after', kvEntity);
    });
    return kvEntity;
}

/**
 * Purpose:
 * Hard delete a KV record by name.
 *
 * Behavior:
 * Looks up the record by name, then deletes it with hooks.
 *
 * Constraints:
 * - No-op if the record does not exist.
 *
 * Non-Goals:
 * - Does not delete related data keyed by the KV value.
 */
export async function hardDeleteKvByName(
    name: string,
    targetDb: Or3DB = getDb()
): Promise<void> {
    await ensureDbOpen(targetDb);
    const hooks = useHooks();
    const existing = await dbTry(
        () => targetDb.kv.where('name').equals(name).first(),
        { op: 'read', entity: 'kv', action: 'getByName' }
    );
    if (!existing) return;
    await targetDb.transaction(
        'rw',
        getWriteTxTableNames(targetDb, 'kv', { includeTombstones: true }),
        async () => {
            await hooks.doAction('db.kv.deleteByName:action:hard:before', {
                entity: existing,
                id: existing.id,
                tableName: 'kv',
            });
            await dbTry(
                () => targetDb.kv.delete(existing.id),
                { op: 'write', entity: 'kv', action: 'deleteByName' },
                { rethrow: true }
            );
            await hooks.doAction('db.kv.deleteByName:action:hard:after', {
                entity: existing,
                id: existing.id,
                tableName: 'kv',
            });
        }
    );
}
