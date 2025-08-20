import { db } from './client';
import { useHooks } from '../composables/useHooks';
import { parseOrThrow } from './util';
import { KvCreateSchema, KvSchema, type Kv, type KvCreate } from './schema';

export async function createKv(input: KvCreate): Promise<Kv> {
    const hooks = useHooks();
    const filtered = await hooks.applyFilters(
        'db.kv.create:filter:input',
        input
    );
    await hooks.doAction('db.kv.create:action:before', filtered);
    const value = parseOrThrow(KvCreateSchema, filtered);
    await db.kv.put(value);
    await hooks.doAction('db.kv.create:action:after', value);
    return value;
}

export async function upsertKv(value: Kv): Promise<void> {
    const hooks = useHooks();
    const filtered = await hooks.applyFilters(
        'db.kv.upsert:filter:input',
        value
    );
    await hooks.doAction('db.kv.upsert:action:before', filtered);
    parseOrThrow(KvSchema, filtered);
    await db.kv.put(filtered);
    await hooks.doAction('db.kv.upsert:action:after', filtered);
}

export async function hardDeleteKv(id: string): Promise<void> {
    const hooks = useHooks();
    const existing = await db.kv.get(id);
    await hooks.doAction('db.kv.delete:action:hard:before', existing ?? id);
    await db.kv.delete(id);
    await hooks.doAction('db.kv.delete:action:hard:after', id);
}

export async function getKv(id: string) {
    const hooks = useHooks();
    const res = await db.kv.get(id);
    return hooks.applyFilters('db.kv.get:filter:output', res);
}

export async function getKvByName(name: string) {
    const hooks = useHooks();
    const res = await db.kv.where('name').equals(name).first();
    return hooks.applyFilters('db.kv.getByName:filter:output', res);
}

// Convenience helpers for auth/session flows
export async function setKvByName(
    name: string,
    value: string | null
): Promise<Kv> {
    const hooks = useHooks();
    const existing = await db.kv.where('name').equals(name).first();
    const now = Math.floor(Date.now() / 1000);
    const record: Kv = {
        id: existing?.id ?? `kv:${name}`,
        name,
        value,
        created_at: existing?.created_at ?? now,
        updated_at: now,
        clock: (existing?.clock ?? 0) + 1,
    };
    const filtered = await hooks.applyFilters(
        'db.kv.upsertByName:filter:input',
        record
    );
    parseOrThrow(KvSchema, filtered);
    await db.kv.put(filtered);
    await hooks.doAction('db.kv.upsertByName:action:after', filtered);
    return filtered;
}

export async function hardDeleteKvByName(name: string): Promise<void> {
    const hooks = useHooks();
    const existing = await db.kv.where('name').equals(name).first();
    if (!existing) return; // nothing to do
    await hooks.doAction('db.kv.deleteByName:action:hard:before', existing);
    await db.kv.delete(existing.id);
    await hooks.doAction('db.kv.deleteByName:action:hard:after', existing.id);
}
