import { db } from './client';
import { dbTry } from './dbTry';
import { useHooks } from '../core/hooks/useHooks';
import { parseOrThrow, nowSec, nextClock } from './util';
import { KvCreateSchema, KvSchema, type Kv, type KvCreate } from './schema';

export async function createKv(input: KvCreate): Promise<Kv> {
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
    await dbTry(
        () => db.kv.put(value),
        { op: 'write', entity: 'kv', action: 'create' },
        { rethrow: true }
    );
    await hooks.doAction('db.kv.create:action:after', {
        entity: value,
        tableName: 'kv',
    });
    return value;
}

export async function upsertKv(value: Kv): Promise<void> {
    const hooks = useHooks();
    const filtered = await hooks.applyFilters(
        'db.kv.upsert:filter:input',
        value
    );
    await hooks.doAction('db.kv.upsert:action:before', {
        entity: filtered,
        tableName: 'kv',
    });
    parseOrThrow(KvSchema, filtered);
    await dbTry(
        () => db.kv.put(filtered),
        { op: 'write', entity: 'kv', action: 'upsert' },
        { rethrow: true }
    );
    await hooks.doAction('db.kv.upsert:action:after', {
        entity: filtered,
        tableName: 'kv',
    });
}

export async function hardDeleteKv(id: string): Promise<void> {
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
    const hooks = useHooks();
    const res = await dbTry(() => db.kv.get(id), {
        op: 'read',
        entity: 'kv',
        action: 'get',
    });
    if (!res) return undefined;
    return hooks.applyFilters('db.kv.get:filter:output', res);
}

export async function getKvByName(name: string) {
    const hooks = useHooks();
    const res = await dbTry(() => db.kv.where('name').equals(name).first(), {
        op: 'read',
        entity: 'kv',
        action: 'getByName',
    });
    return hooks.applyFilters('db.kv.getByName:filter:output', res);
}

// Convenience helpers for auth/session flows
export async function setKvByName(
    name: string,
    value: string | null
): Promise<Kv> {
    const hooks = useHooks();
    const existing = await dbTry(
        () => db.kv.where('name').equals(name).first(),
        { op: 'read', entity: 'kv', action: 'getByName' }
    );
    const now = nowSec();
    const record: Kv = {
        id: existing?.id ?? `kv:${name}`,
        name,
        value,
        created_at: existing?.created_at ?? now,
        updated_at: now,
        clock: nextClock(existing?.clock),
    };
    const filtered = await hooks.applyFilters(
        'db.kv.upsertByName:filter:input',
        record
    );
    // Ensure filtered is a full Kv entity (type guard)
    const kvEntity: Kv =
        'id' in filtered && 'created_at' in filtered
            ? (filtered as Kv)
            : record;
    parseOrThrow(KvSchema, kvEntity);
    await dbTry(
        () => db.kv.put(kvEntity),
        { op: 'write', entity: 'kv', action: 'upsertByName' },
        { rethrow: true }
    );
    await hooks.doAction('db.kv.upsertByName:action:after', kvEntity);
    return kvEntity;
}

export async function hardDeleteKvByName(name: string): Promise<void> {
    const hooks = useHooks();
    const existing = await dbTry(
        () => db.kv.where('name').equals(name).first(),
        { op: 'read', entity: 'kv', action: 'getByName' }
    );
    if (!existing) return; // nothing to do
    await hooks.doAction('db.kv.deleteByName:action:hard:before', {
        entity: existing,
        id: existing.id,
        tableName: 'kv',
    });
    await dbTry(
        () => db.kv.delete(existing.id),
        { op: 'write', entity: 'kv', action: 'deleteByName' },
        { rethrow: true }
    );
    await hooks.doAction('db.kv.deleteByName:action:hard:after', {
        entity: existing,
        id: existing.id,
        tableName: 'kv',
    });
}
