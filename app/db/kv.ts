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
