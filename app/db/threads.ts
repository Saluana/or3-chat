/**
 * @module app/db/threads
 *
 * Purpose:
 * Thread persistence helpers with hook integration.
 *
 * Responsibilities:
 * - Validate and store thread records
 * - Provide thread query and deletion helpers
 * - Support fork and system prompt updates
 *
 * Non-responsibilities:
 * - Rendering or formatting thread content
 * - Server-side sync logic
 */
import { getDb } from './client';
import { dbTry } from './dbTry';
import { useHooks } from '../core/hooks/useHooks';
import { newId, nowSec, parseOrThrow, nextClock } from './util';
import { generateHLC } from '../core/sync/hlc';
import {
    ThreadCreateSchema,
    ThreadSchema,
    type Thread,
    type ThreadCreate,
    type Message,
} from './schema';

/**
 * Purpose:
 * Create a new thread record in the local database.
 *
 * Behavior:
 * Applies filters, validates input with defaults, writes to Dexie, and emits hooks.
 *
 * Constraints:
 * - Enforces optional client-side max conversation limits.
 *
 * Non-Goals:
 * - Does not create initial messages.
 */
export async function createThread(input: ThreadCreate): Promise<Thread> {
    const hooks = useHooks();

    // Check maxConversations limit (client-side enforcement)
    if (import.meta.client) {
        const { useRuntimeConfig } = await import('#imports');
        const config = useRuntimeConfig();
        const limits = config.public.limits;
        if (limits.enabled !== false && limits.maxConversations > 0) {
            const count = await getDb()
                .threads
                .filter((thread) => thread.deleted !== true)
                .count();
            if (count >= limits.maxConversations) {
                throw new Error(
                    `Conversation limit reached (${limits.maxConversations}). Delete existing conversations to create new ones.`
                );
            }
        }
    }

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
        hlc: prepared.hlc ?? generateHLC(),
    });
    await hooks.doAction('db.threads.create:action:before', {
        entity: value,
        tableName: 'threads',
    });
    await dbTry(
        () => getDb().threads.put(value),
        { op: 'write', entity: 'threads', action: 'create' },
        { rethrow: true }
    );
    await hooks.doAction('db.threads.create:action:after', {
        entity: value,
        tableName: 'threads',
    });
    return value;
}

/**
 * Purpose:
 * Upsert a thread record with updated clocks.
 *
 * Behavior:
 * Validates the thread, increments clock values, and writes to Dexie.
 *
 * Constraints:
 * - Requires a fully shaped `Thread` value.
 *
 * Non-Goals:
 * - Does not merge partial updates.
 */
export async function upsertThread(value: Thread): Promise<void> {
    const hooks = useHooks();
    const filtered = await hooks.applyFilters(
        'db.threads.upsert:filter:input',
        value
    );
    const validated = parseOrThrow(ThreadSchema, filtered);
    const existing = await dbTry(() => getDb().threads.get(validated.id), {
        op: 'read',
        entity: 'threads',
        action: 'get',
    });
    const next = {
        ...validated,
        clock: nextClock(existing?.clock ?? validated.clock),
        hlc: validated.hlc ?? generateHLC(),
    };
    await hooks.doAction('db.threads.upsert:action:before', {
        entity: next,
        tableName: 'threads',
    });
    await dbTry(
        () => getDb().threads.put(next),
        { op: 'write', entity: 'threads', action: 'upsert' },
        { rethrow: true }
    );
    await hooks.doAction('db.threads.upsert:action:after', {
        entity: next,
        tableName: 'threads',
    });
}

/**
 * Purpose:
 * Fetch threads for a given project.
 *
 * Behavior:
 * Queries by `project_id` and applies output filters.
 *
 * Constraints:
 * - Returns an empty array when no threads are found.
 *
 * Non-Goals:
 * - Does not sort by recency beyond Dexie ordering.
 */
export function threadsByProject(projectId: string) {
    const hooks = useHooks();
    const promise = dbTry(
        () => getDb().threads.where('project_id').equals(projectId).toArray(),
        { op: 'read', entity: 'threads', action: 'byProject' }
    );
    return promise.then((res) =>
        res ? hooks.applyFilters('db.threads.byProject:filter:output', res) : []
    );
}

/**
 * Purpose:
 * Search threads by title substring.
 *
 * Behavior:
 * Performs a case-insensitive substring match and applies output filters.
 *
 * Constraints:
 * - Uses in-memory filtering.
 *
 * Non-Goals:
 * - Does not provide full-text search.
 */
export function searchThreadsByTitle(term: string) {
    const q = term.toLowerCase();
    const hooks = useHooks();
    return getDb().threads
        .filter((t) => (t.title ?? '').toLowerCase().includes(q))
        .toArray()
        .then((res) =>
            hooks.applyFilters('db.threads.searchByTitle:filter:output', res)
        );
}

/**
 * Purpose:
 * Fetch a thread by id with hook filtering.
 *
 * Behavior:
 * Reads the row and applies output filters.
 *
 * Constraints:
 * - Returns undefined when missing or filtered out.
 *
 * Non-Goals:
 * - Does not fetch thread messages.
 */
export function getThread(id: string) {
    const hooks = useHooks();
    return dbTry(() => getDb().threads.get(id), {
        op: 'read',
        entity: 'threads',
        action: 'get',
    }).then((res) =>
        res
            ? hooks.applyFilters('db.threads.get:filter:output', res)
            : undefined
    );
}

/**
 * Purpose:
 * Fetch child threads for a parent thread.
 *
 * Behavior:
 * Queries by `parent_thread_id` and applies output filters.
 *
 * Constraints:
 * - Returns an empty array when there are no children.
 *
 * Non-Goals:
 * - Does not include the parent thread itself.
 */
export function childThreads(parentThreadId: string) {
    const hooks = useHooks();
    return getDb().threads
        .where('parent_thread_id')
        .equals(parentThreadId)
        .toArray()
        .then((res) =>
            hooks.applyFilters('db.threads.children:filter:output', res)
        );
}

/**
 * Purpose:
 * Soft delete a thread by marking it deleted.
 *
 * Behavior:
 * Updates deletion flags and timestamps with hooks.
 *
 * Constraints:
 * - No-op if the thread does not exist.
 *
 * Non-Goals:
 * - Does not delete messages.
 */
export async function softDeleteThread(id: string): Promise<void> {
    const hooks = useHooks();
    await getDb().transaction('rw', getDb().threads, async () => {
        const t = await dbTry(() => getDb().threads.get(id), {
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
        await getDb().threads.put({
            ...t,
            deleted: true,
            updated_at: nowSec(),
            clock: nextClock(t.clock),
            hlc: generateHLC(),
        });
        await hooks.doAction('db.threads.delete:action:soft:after', {
            entity: t,
            id: t.id,
            tableName: 'threads',
        });
    });
}

/**
 * Purpose:
 * Hard delete a thread and its messages.
 *
 * Behavior:
 * Deletes messages and the thread row in a transaction with hooks.
 *
 * Constraints:
 * - No-op if the thread does not exist.
 *
 * Non-Goals:
 * - Does not delete attachments or files referenced by messages.
 */
export async function hardDeleteThread(id: string): Promise<void> {
    const hooks = useHooks();
    const existing = await dbTry(() => getDb().threads.get(id), {
        op: 'read',
        entity: 'threads',
        action: 'get',
    });
    await getDb().transaction('rw', getDb().threads, getDb().messages, async () => {
        await hooks.doAction('db.threads.delete:action:hard:before', {
            entity: existing!,
            id,
            tableName: 'threads',
        });
        await getDb().messages.where('thread_id').equals(id).delete();
        await getDb().threads.delete(id);
        await hooks.doAction('db.threads.delete:action:hard:after', {
            entity: existing!,
            id,
            tableName: 'threads',
        });
    });
}

/**
 * Purpose:
 * Fork a thread with optional message copying.
 *
 * Behavior:
 * Creates a new thread derived from the source and optionally clones messages.
 *
 * Constraints:
 * - Requires the source thread to exist.
 *
 * Non-Goals:
 * - Does not normalize message indexes in the new thread.
 */
export async function forkThread(
    sourceThreadId: string,
    overrides: Partial<ThreadCreate> = {},
    options: { copyMessages?: boolean } = {}
): Promise<Thread> {
    const hooks = useHooks();
    return getDb().transaction('rw', getDb().threads, getDb().messages, async () => {
        const src = await dbTry(
            () => getDb().threads.get(sourceThreadId),
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
            () => getDb().threads.put(fork),
            { op: 'write', entity: 'threads', action: 'fork' },
            { rethrow: true }
        );

        if (options.copyMessages) {
            const msgs =
                (await dbTry(
                    () =>
                        getDb().messages
                            .where('thread_id')
                            .equals(src.id)
                            .sortBy('index'),
                    {
                        op: 'read',
                        entity: 'messages',
                        action: 'forkCopyMessages',
                    }
                )) || [];
            const newMessages: Message[] = msgs.map((m) => ({
                ...m,
                id: newId(),
                thread_id: forkId,
                clock: nextClock(),
            }));
            await dbTry(
                () => getDb().messages.bulkPut(newMessages),
                {
                    op: 'write',
                    entity: 'messages',
                    action: 'forkCopyMessages',
                },
                { rethrow: true }
            );
            if (msgs.length > 0) {
                await dbTry(
                    () =>
                        getDb().threads.put({
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

/**
 * Purpose:
 * Update the system prompt association for a thread.
 *
 * Behavior:
 * Updates `system_prompt_id` and emits hooks.
 *
 * Constraints:
 * - No-op if the thread does not exist.
 *
 * Non-Goals:
 * - Does not validate prompt existence.
 */
export async function updateThreadSystemPrompt(
    threadId: string,
    promptId: string | null
): Promise<void> {
    const hooks = useHooks();
    await getDb().transaction('rw', getDb().threads, async () => {
        const thread = await dbTry(() => getDb().threads.get(threadId), {
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
            () => getDb().threads.put(updated),
            { op: 'write', entity: 'threads', action: 'updateSystemPrompt' },
            { rethrow: true }
        );
        await hooks.doAction('db.threads.updateSystemPrompt:action:after', {
            thread: updated,
            promptId,
        });
    });
}

/**
 * Purpose:
 * Retrieve the system prompt id associated with a thread.
 *
 * Behavior:
 * Reads the thread and applies output filters to the prompt id.
 *
 * Constraints:
 * - Returns null when the thread is missing.
 *
 * Non-Goals:
 * - Does not fetch the prompt record itself.
 */
export async function getThreadSystemPrompt(
    threadId: string
): Promise<string | null> {
    const hooks = useHooks();
    const thread = await dbTry(() => getDb().threads.get(threadId), {
        op: 'read',
        entity: 'threads',
        action: 'get',
    });
    if (!thread) return null;
    const result = thread.system_prompt_id;
    return hooks.applyFilters(
        'db.threads.getSystemPrompt:filter:output',
        result ?? null
    );
}
