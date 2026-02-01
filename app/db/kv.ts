import { getDb, type Or3DB } from './client';
import { dbTry } from './dbTry';
import { useHooks } from '../core/hooks/useHooks';
import { parseOrThrow, nowSec, nextClock } from './util';
import { KvCreateSchema, KvSchema, type Kv, type KvCreate } from './schema';

async function ensureDbOpen(targetDb: Or3DB): Promise<void> {
    if (!targetDb.isOpen()) {
        await targetDb.open();
    }
}

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
    await dbTry(
        () => db.kv.put(next),
        { op: 'write', entity: 'kv', action: 'create' },
        { rethrow: true }
    );
    await hooks.doAction('db.kv.create:action:after', {
        entity: next,
        tableName: 'kv',
    });
    return next;
}

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
}

export async function hardDeleteKv(id: string): Promise<void> {
    const db = getDb();
    await ensureDbOpen(db);
    const hooks = useHooks();
    const existing = await dbTry(() => db.kv.get(id), {
        op: 'read',
        entity: 'kv',
        action: 'get',
    });
    await hooks.doAction('db.kv.delete:action:hard:before', {
        entity: existing!,
        id,
        tableName: 'kv',
    });
    await db.kv.delete(id);
    await hooks.doAction('db.kv.delete:action:hard:after', {
        entity: existing!,
        id,
        tableName: 'kv',
    });
}

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
    parseOrThrow(KvSchema, kvEntity);
    await dbTry(
        () => targetDb.kv.put(kvEntity),
        { op: 'write', entity: 'kv', action: 'upsertByName' },
        { rethrow: true }
    );
    await hooks.doAction('db.kv.upsertByName:action:after', kvEntity);
    return kvEntity;
}

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
