import { db } from './client';
import { dbTry } from './dbTry';
import { useHooks } from '../core/hooks/useHooks';
import { newId, nowSec, parseOrThrow, nextClock } from './util';
import {
    ThreadCreateSchema,
    ThreadSchema,
    type Thread,
    type ThreadCreate,
} from './schema';

export async function createThread(input: ThreadCreate): Promise<Thread> {
    const hooks = useHooks();
    const filtered = (await hooks.applyFilters(
        'db.threads.create:filter:input',
        input
    )) as ThreadCreate;
    // Apply create-time defaults (id/clock/timestamps, etc.)
    const prepared = parseOrThrow(ThreadCreateSchema, filtered);
    // Validate against full schema so required defaults (status/pinned/etc.) are present
    const value = parseOrThrow(ThreadSchema, {
        ...prepared,
        clock: nextClock(prepared.clock),
    });
    await hooks.doAction('db.threads.create:action:before', {
        entity: value,
        tableName: 'threads',
    });
    await dbTry(
        () => db.threads.put(value),
        { op: 'write', entity: 'threads', action: 'create' },
        { rethrow: true }
    );
    await hooks.doAction('db.threads.create:action:after', {
        entity: value,
        tableName: 'threads',
    });
    return value;
}

export async function upsertThread(value: Thread): Promise<void> {
    const hooks = useHooks();
    const filtered = await hooks.applyFilters(
        'db.threads.upsert:filter:input',
        value
    );
    const validated = parseOrThrow(ThreadSchema, filtered);
    const existing = await dbTry(() => db.threads.get(validated.id), {
        op: 'read',
        entity: 'threads',
        action: 'get',
    });
    const next = {
        ...validated,
        clock: nextClock(existing?.clock ?? validated.clock),
    };
    await hooks.doAction('db.threads.upsert:action:before', {
        entity: next,
        tableName: 'threads',
    });
    await dbTry(
        () => db.threads.put(next),
        { op: 'write', entity: 'threads', action: 'upsert' },
        { rethrow: true }
    );
    await hooks.doAction('db.threads.upsert:action:after', {
        entity: next,
        tableName: 'threads',
    });
}

export function threadsByProject(projectId: string) {
    const hooks = useHooks();
    const promise = dbTry(
        () => db.threads.where('project_id').equals(projectId).toArray(),
        { op: 'read', entity: 'threads', action: 'byProject' }
    );
    return promise.then((res) =>
        res ? hooks.applyFilters('db.threads.byProject:filter:output', res) : []
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
    }).then((res) =>
        res
            ? hooks.applyFilters('db.threads.get:filter:output', res)
            : undefined
    );
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
        await hooks.doAction('db.threads.delete:action:soft:before', {
            entity: t,
            id: t.id,
            tableName: 'threads',
        });
        await db.threads.put({
            ...t,
            deleted: true,
            updated_at: nowSec(),
            clock: nextClock(t.clock),
        });
        await hooks.doAction('db.threads.delete:action:soft:after', {
            entity: t,
            id: t.id,
            tableName: 'threads',
        });
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
        await hooks.doAction('db.threads.delete:action:hard:before', {
            entity: existing!,
            id,
            tableName: 'threads',
        });
        await db.messages.where('thread_id').equals(id).delete();
        await db.threads.delete(id);
        await hooks.doAction('db.threads.delete:action:hard:after', {
            entity: existing!,
            id,
            tableName: 'threads',
        });
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
            clock: nextClock(),
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
                            clock: nextClock(),
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
                            clock: nextClock(fork.clock),
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
            clock: nextClock(thread.clock),
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
