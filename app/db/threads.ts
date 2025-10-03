import { db } from './client';
import { dbTry } from './dbTry';
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
    await dbTry(
        () => db.threads.put(value),
        { op: 'write', entity: 'threads', action: 'create' },
        { rethrow: true }
    );
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
    await dbTry(
        () => db.threads.put(filtered),
        { op: 'write', entity: 'threads', action: 'upsert' },
        { rethrow: true }
    );
    await hooks.doAction('db.threads.upsert:action:after', filtered);
}

export function threadsByProject(projectId: string) {
    const hooks = useHooks();
    const promise = dbTry(
        () => db.threads.where('project_id').equals(projectId).toArray(),
        { op: 'read', entity: 'threads', action: 'byProject' }
    );
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
    return dbTry(() => db.threads.get(id), {
        op: 'read',
        entity: 'threads',
        action: 'get',
    })?.then((res) => hooks.applyFilters('db.threads.get:filter:output', res));
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
        const t = await dbTry(() => db.threads.get(id), {
            op: 'read',
            entity: 'threads',
            action: 'get',
        });
        if (!t) return;
        await hooks.doAction('db.threads.delete:action:soft:before', t);
        await db.threads.put({
            ...t,
            deleted: true,
            updated_at: nowSec(),
        });
        await hooks.doAction('db.threads.delete:action:soft:after', t);
    });
}

export async function hardDeleteThread(id: string): Promise<void> {
    const hooks = useHooks();
    const existing = await dbTry(() => db.threads.get(id), {
        op: 'read',
        entity: 'threads',
        action: 'get',
    });
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
        const src = await dbTry(
            () => db.threads.get(sourceThreadId),
            { op: 'read', entity: 'threads', action: 'get' },
            { rethrow: true }
        );
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
        await dbTry(
            () => db.threads.put(fork),
            { op: 'write', entity: 'threads', action: 'fork' },
            { rethrow: true }
        );

        if (options.copyMessages) {
            const msgs =
                (await dbTry(
                    () =>
                        db.messages
                            .where('thread_id')
                            .equals(src.id)
                            .sortBy('index'),
                    {
                        op: 'read',
                        entity: 'messages',
                        action: 'forkCopyMessages',
                    }
                )) || [];
            for (const m of msgs) {
                await dbTry(
                    () =>
                        db.messages.put({
                            ...m,
                            id: newId(),
                            thread_id: forkId,
                        }),
                    {
                        op: 'write',
                        entity: 'messages',
                        action: 'forkCopyMessage',
                    },
                    { rethrow: true }
                );
            }
            if (msgs.length > 0) {
                await dbTry(
                    () =>
                        db.threads.put({
                            ...fork,
                            last_message_at: now,
                            updated_at: now,
                        }),
                    {
                        op: 'write',
                        entity: 'threads',
                        action: 'forkUpdateMeta',
                    },
                    { rethrow: true }
                );
            }
        }
        await hooks.doAction('db.threads.fork:action:after', fork);
        return fork;
    });
}

export async function updateThreadSystemPrompt(
    threadId: string,
    promptId: string | null
): Promise<void> {
    const hooks = useHooks();
    await db.transaction('rw', db.threads, async () => {
        const thread = await dbTry(() => db.threads.get(threadId), {
            op: 'read',
            entity: 'threads',
            action: 'get',
        });
        if (!thread) return;
        const updated = {
            ...thread,
            system_prompt_id: promptId,
            updated_at: nowSec(),
        };
        await hooks.doAction('db.threads.updateSystemPrompt:action:before', {
            thread,
            promptId,
        });
        await dbTry(
            () => db.threads.put(updated),
            { op: 'write', entity: 'threads', action: 'updateSystemPrompt' },
            { rethrow: true }
        );
        await hooks.doAction('db.threads.updateSystemPrompt:action:after', {
            thread: updated,
            promptId,
        });
    });
}

export async function getThreadSystemPrompt(
    threadId: string
): Promise<string | null> {
    const hooks = useHooks();
    const thread = await dbTry(() => db.threads.get(threadId), {
        op: 'read',
        entity: 'threads',
        action: 'get',
    });
    const result = thread?.system_prompt_id ?? null;
    return hooks.applyFilters(
        'db.threads.getSystemPrompt:filter:output',
        result
    );
}
