import { db } from './client';
import { useHooks } from '../composables/useHooks';
import { newId, nowSec, parseOrThrow } from './util';
import {
    ThreadCreateSchema,
    ThreadSchema,
    type Thread,
    type ThreadCreate,
} from './schema';

export async function createThread(input: ThreadCreate): Promise<Thread> {
    const hooks = useHooks();
    const filtered = await hooks.applyFilters(
        'db.threads.create:filter:input',
        input
    );
    // Apply create-time defaults (id/clock/timestamps, etc.)
    const prepared = parseOrThrow(ThreadCreateSchema, filtered);
    // Validate against full schema so required defaults (status/pinned/etc.) are present
    const value = parseOrThrow(ThreadSchema, prepared);
    await hooks.doAction('db.threads.create:action:before', value);
    await db.threads.put(value);
    await hooks.doAction('db.threads.create:action:after', value);
    return value;
}

export async function upsertThread(value: Thread): Promise<void> {
    const hooks = useHooks();
    const filtered = await hooks.applyFilters(
        'db.threads.upsert:filter:input',
        value
    );
    await hooks.doAction('db.threads.upsert:action:before', filtered);
    parseOrThrow(ThreadSchema, filtered);
    await db.threads.put(filtered);
    await hooks.doAction('db.threads.upsert:action:after', filtered);
}

export function threadsByProject(projectId: string) {
    const hooks = useHooks();
    const promise = db.threads.where('project_id').equals(projectId).toArray();
    return promise.then((res) =>
        hooks.applyFilters('db.threads.byProject:filter:output', res)
    );
}

export function searchThreadsByTitle(term: string) {
    const q = term.toLowerCase();
    const hooks = useHooks();
    return db.threads
        .filter((t) => (t.title ?? '').toLowerCase().includes(q))
        .toArray()
        .then((res) =>
            hooks.applyFilters('db.threads.searchByTitle:filter:output', res)
        );
}

export function getThread(id: string) {
    const hooks = useHooks();
    return db.threads
        .get(id)
        .then((res) => hooks.applyFilters('db.threads.get:filter:output', res));
}

export function childThreads(parentThreadId: string) {
    const hooks = useHooks();
    return db.threads
        .where('parent_thread_id')
        .equals(parentThreadId)
        .toArray()
        .then((res) =>
            hooks.applyFilters('db.threads.children:filter:output', res)
        );
}

export async function softDeleteThread(id: string): Promise<void> {
    const hooks = useHooks();
    await db.transaction('rw', db.threads, async () => {
        const t = await db.threads.get(id);
        if (!t) return;
        await hooks.doAction('db.threads.delete:action:soft:before', t);
        await db.threads.put({
            ...t,
            deleted: true,
            updated_at: Math.floor(Date.now() / 1000),
        });
        await hooks.doAction('db.threads.delete:action:soft:after', t);
    });
}

export async function hardDeleteThread(id: string): Promise<void> {
    const hooks = useHooks();
    const existing = await db.threads.get(id);
    await db.transaction('rw', db.threads, db.messages, async () => {
        await hooks.doAction(
            'db.threads.delete:action:hard:before',
            existing ?? id
        );
        await db.messages.where('thread_id').equals(id).delete();
        await db.threads.delete(id);
        await hooks.doAction('db.threads.delete:action:hard:after', id);
    });
}

// Fork a thread: clone thread metadata and optionally copy messages
export async function forkThread(
    sourceThreadId: string,
    overrides: Partial<ThreadCreate> = {},
    options: { copyMessages?: boolean } = {}
): Promise<Thread> {
    const hooks = useHooks();
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
        await hooks.doAction('db.threads.fork:action:before', {
            source: src,
            fork,
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
        await hooks.doAction('db.threads.fork:action:after', fork);
        return fork;
    });
}
