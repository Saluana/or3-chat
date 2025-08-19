import { db } from './client';
import { newId, nowSec, parseOrThrow } from './util';
import {
    ThreadCreateSchema,
    ThreadSchema,
    type Thread,
    type ThreadCreate,
} from './schema';

export async function createThread(input: ThreadCreate): Promise<Thread> {
    const value = parseOrThrow(ThreadCreateSchema, input);
    await db.threads.put(value);
    return value;
}

export async function upsertThread(value: Thread): Promise<void> {
    parseOrThrow(ThreadSchema, value);
    await db.threads.put(value);
}

export function threadsByProject(projectId: string) {
    return db.threads.where('project_id').equals(projectId).toArray();
}

export function searchThreadsByTitle(term: string) {
    const q = term.toLowerCase();
    return db.threads
        .filter((t) => (t.title ?? '').toLowerCase().includes(q))
        .toArray();
}

export async function softDeleteThread(id: string): Promise<void> {
    await db.transaction('rw', db.threads, async () => {
        const t = await db.threads.get(id);
        if (!t) return;
        await db.threads.put({
            ...t,
            deleted: true,
            updated_at: Math.floor(Date.now() / 1000),
        });
    });
}

export async function hardDeleteThread(id: string): Promise<void> {
    await db.transaction('rw', db.threads, db.messages, async () => {
        await db.messages.where('thread_id').equals(id).delete();
        await db.threads.delete(id);
    });
}

// Fork a thread: clone thread metadata and optionally copy messages
export async function forkThread(
    sourceThreadId: string,
    overrides: Partial<ThreadCreate> = {},
    options: { copyMessages?: boolean } = {}
): Promise<Thread> {
    return db.transaction('rw', db.threads, db.messages, async () => {
        const src = await db.threads.get(sourceThreadId);
        if (!src) throw new Error('Source thread not found');
        const now = nowSec();
        const forkId = newId();
        const fork = parseOrThrow(ThreadSchema, {
            ...src,
            id: forkId,
            forked: true,
            parent_thread_id: src.id,
            created_at: now,
            updated_at: now,
            last_message_at: null,
            ...overrides,
        });
        await db.threads.put(fork);

        if (options.copyMessages) {
            const msgs = await db.messages
                .where('thread_id')
                .equals(src.id)
                .sortBy('index');
            for (const m of msgs) {
                await db.messages.put({ ...m, id: newId(), thread_id: forkId });
            }
            if (msgs.length > 0) {
                await db.threads.put({
                    ...fork,
                    last_message_at: now,
                    updated_at: now,
                });
            }
        }
        return fork;
    });
}
