import { db } from './client';
import { parseOrThrow } from './util';
import { KvCreateSchema, KvSchema, type Kv, type KvCreate } from './schema';

export async function createKv(input: KvCreate): Promise<Kv> {
    const value = parseOrThrow(KvCreateSchema, input);
    await db.kv.put(value);
    return value;
}

export async function upsertKv(value: Kv): Promise<void> {
    parseOrThrow(KvSchema, value);
    await db.kv.put(value);
}

export async function hardDeleteKv(id: string): Promise<void> {
    await db.kv.delete(id);
}

export function getKv(id: string) {
    return db.kv.get(id);
}

export function getKvByName(name: string) {
    return db.kv.where('name').equals(name).first();
}
