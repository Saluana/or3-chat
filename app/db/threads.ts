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
import { preservedProjectEntries, projectEntryIdentity } from '~/utils/projects/normalizeProjectData';
import { useRuntimeConfig } from '#imports';
import { getDb, type Or3DB } from './client';
import { dbTry } from './dbTry';
import { useHooks } from '../core/hooks/useHooks';
import { resolveRootThreadId } from '../utils/chat/compaction/history';
import { resolveSidebarFamilyId, pruneRetiredFamilyPreference } from '../utils/sidebar/thread-families';
import {
    newId,
    nowSec,
    parseOrThrow,
    nextClock,
    getWriteTxTableNames,
} from './util';
import { generateHLC } from '../core/sync/hlc';
import {
    ThreadCreateSchema,
    ThreadSchema,
    type Thread,
    type ThreadCreate,
    type Message,
} from './schema';
import type { TypedHookEngine } from '../core/hooks/typed-hooks';

export interface CreateThreadContext {
    assertCurrent?: () => void;
    hooks?: TypedHookEngine;
    limits?: {
        enabled?: boolean;
        maxConversations?: number;
    };
}

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
    return createThreadInDb(getDb(), input);
}

/**
 * Create a thread in an explicitly captured workspace database.
 *
 * Long-running request flows must use this variant so a workspace switch
 * cannot redirect an admitted request into the newly active database.
 */
export async function createThreadInDb(
    db: Or3DB,
    input: ThreadCreate,
    context: CreateThreadContext = {}
): Promise<Thread> {
    context.assertCurrent?.();
    const hooks = context.hooks ?? useHooks();

    // Check maxConversations limit (client-side enforcement)
    if (import.meta.client) {
        const limits =
            context.limits ?? useRuntimeConfig().public.limits;
        const maxConversations = limits.maxConversations ?? 0;
        if (limits.enabled !== false && maxConversations > 0) {
            const count = await db.threads
                .filter((thread) => thread.deleted !== true)
                .count();
            if (count >= maxConversations) {
                throw new Error(
                    `Conversation limit reached (${maxConversations}). Delete existing conversations to create new ones.`
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
    await db.transaction('rw', getWriteTxTableNames(db, value.project_id ? ['threads', 'projects'] : ['threads']), async () => {
        context.assertCurrent?.();
        if (value.project_id) {
            const project = await db.projects.get(value.project_id);
            if (!project || project.deleted) throw new Error('Owning project unavailable.');
            const entries = preservedProjectEntries(project.data);
            if (!entries.some(entry => projectEntryIdentity(entry) === `chat:${value.id}`)) await db.projects.put({ ...project,
                data: [...entries, { kind: 'chat', id: value.id, name: value.title || 'Chat' }], clock: nextClock(project.clock), updated_at: nowSec() });
        }
        rejectGenericCompactionTransition(value);
        rejectGenericCompactionTransition(value, await db.threads.get(value.id));
        await dbTry(
            () => db.threads.put(value),
            { op: 'write', entity: 'threads', action: 'create' },
            { rethrow: true }
        );
        context.assertCurrent?.();
    });
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
    const db = getDb();
    await db.transaction('rw', getWriteTxTableNames(db, 'threads'), async () => {
        const existing = await dbTry(() => db.threads.get(validated.id), {
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
        rejectGenericCompactionTransition(next, existing);
        await dbTry(
            () => db.threads.put(next),
            { op: 'write', entity: 'threads', action: 'upsert' },
            { rethrow: true }
        );
        await hooks.doAction('db.threads.upsert:action:after', {
            entity: next,
            tableName: 'threads',
        });
    });
}

/** Only the atomic compaction writer may create or replace a summary boundary. */
function rejectGenericCompactionTransition(next: Thread, existing?: Thread | null): void {
    const protectedFields = ['branch_mode', 'parent_thread_id', 'anchor_message_id', 'anchor_index',
        'summary_message_id', 'root_thread_id', 'fork_reason'] as const;
    if (next.branch_mode === 'compacted' || existing?.branch_mode === 'compacted') {
        if (!existing || existing.branch_mode !== 'compacted'
            || protectedFields.some((field) => next[field] !== existing[field])) {
            throw new Error('Compacted forks require the validated atomic writer.');
        }
    }
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
    const db = getDb();
    const existing = await db.threads.get(id);
    if (!existing || existing.deleted) return;
    const deleted = await db.transaction(
        'rw',
        getWriteTxTableNames(db, 'threads', { include: ['kv', 'chat_request_recoveries'], includeTombstones: true }),
        async () => {
        const t = await dbTry(() => db.threads.get(id), {
            op: 'read',
            entity: 'threads',
            action: 'get',
        });
        if (!t) return;
        if (t.deleted) return;
        // Before hooks share the write transaction; after hooks run after commit.
        await hooks.doAction('db.threads.delete:action:soft:before', {
            entity: t, id, tableName: 'threads',
        });
        const current = await db.threads.get(id);
        if (!current || current.deleted) return;
        const rootId = await resolveSidebarFamilyId(db, current);
        await db.threads.put({
            ...current,
            deleted: true,
            updated_at: nowSec(),
            clock: nextClock(current.clock),
            hlc: generateHLC(),
        });
        await db.chat_request_recoveries.delete(id);
        await pruneRetiredFamilyPreference(db, rootId);
        return t;
        }
    );
    if (deleted) await hooks.doAction('db.threads.delete:action:soft:after', {
        entity: deleted, id, tableName: 'threads',
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
export class ThreadHasDescendantsError extends Error {
    readonly code = 'thread_has_descendants';
    constructor(readonly threadId: string) {
        super('This conversation has branches. Move it to Trash to preserve their original links.');
        this.name = 'ThreadHasDescendantsError';
    }
}

export async function hardDeleteThread(id: string): Promise<void> {
    const hooks = useHooks();
    const db = getDb();
    const source = await db.threads.get(id);
    if (!source) return;
    if (await db.threads.where('parent_thread_id').equals(id).first()) throw new ThreadHasDescendantsError(id);
    const deleted = await db.transaction(
        'rw',
        getWriteTxTableNames(db, 'threads', {
            include: ['messages', 'kv', 'chat_request_recoveries'],
            includeTombstones: true,
        }),
        async () => {
        const existing = await dbTry(() => db.threads.get(id), {
            op: 'read',
            entity: 'threads',
            action: 'get',
        });
        if (!existing) return;
        await hooks.doAction('db.threads.delete:action:hard:before', {
            entity: existing, id, tableName: 'threads',
        });
        if (!await db.threads.get(id)) return;
        const rootId = await resolveSidebarFamilyId(db, existing);
        // Include soft-deleted children: their retained links still depend on
        // this parent. The same transaction prevents a concurrent local fork.
        if (await db.threads.where('parent_thread_id').equals(id).first()) {
            throw new ThreadHasDescendantsError(id);
        }
        await db.messages.where('thread_id').equals(id).delete();
        await db.threads.delete(id);
        await db.chat_request_recoveries.delete(id);
        await pruneRetiredFamilyPreference(db, rootId);
        return existing;
    });
    if (deleted) await hooks.doAction('db.threads.delete:action:hard:after', {
        entity: deleted, id, tableName: 'threads',
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
    overrides = structuredClone(overrides);
    options = { ...options };
    const hooks = useHooks();
    const db = getDb();
    const { resolveChatProject, moveChatProjectRows, notifyChatProjectMove } = await import('./project-workspace');
    const src = await dbTry(
        () => db.threads.get(sourceThreadId),
        { op: 'read', entity: 'threads', action: 'get' },
        { rethrow: true }
    );
    if (!src || src.deleted) throw new Error('Source thread not found');
    const projectId = await resolveChatProject(db, src.id);
    // Only project forks need the authenticated workspace boundary; ordinary
    // and guest forks keep the unscoped write path.
    const scope = projectId
        ? (await import('~/utils/projects/context')).captureProjectOperation(undefined, sourceThreadId)
        : null;
    if (scope && scope.db !== db) throw new Error('Workspace changed before forking. Try again.');
    if (overrides.project_id !== undefined && overrides.project_id !== projectId)
        throw new Error('Ordinary forks must retain the source project. Move the new chat explicitly instead.');
    if (overrides.branch_mode === 'compacted') throw new Error('Compacted forks require the validated atomic writer.');
    const rootThreadId = await resolveRootThreadId(src.id, db);
    const now = nowSec();
    const forkId = overrides.id ?? newId();
    let fork = parseOrThrow(ThreadSchema, {
        ...src,
        id: forkId,
        forked: true,
        created_at: now,
        updated_at: now,
        last_message_at: null,
        clock: nextClock(),
        ...overrides,
        project_id: projectId,
        parent_thread_id: src.id,
        root_thread_id: rootThreadId,
        summary_message_id: null,
        fork_reason: 'manual',
        branch_mode: options.copyMessages ? 'copy' : overrides.branch_mode ?? null,
        anchor_message_id: overrides.anchor_message_id ?? null,
        anchor_index: overrides.anchor_index ?? null,
    });
    await hooks.doAction('db.threads.fork:action:before', {
        source: structuredClone(src),
        fork,
    });
    fork = parseOrThrow(ThreadSchema, fork);
    if (fork.id !== forkId) throw new Error('Invalid ordinary fork identity.');
    let membership!: Awaited<ReturnType<typeof moveChatProjectRows>>;
    const result = await db.transaction('rw', getWriteTxTableNames(db, ['threads', 'messages', 'projects']), async () => {
        scope?.assertCurrent('write');
        const current = await db.threads.get(src.id);
        if (JSON.stringify(current) !== JSON.stringify(src)
            || await resolveChatProject(db, src.id) !== projectId
            || await resolveRootThreadId(src.id, db) !== rootThreadId)
            throw new Error('The source chat changed while preparing its fork. Try again.');
        rejectGenericCompactionTransition(fork);
        const existingFork = await db.threads.get(fork.id);
        rejectGenericCompactionTransition(fork, existingFork);
        if (existingFork) throw new Error('The fork identity already exists.');
        if (fork.project_id !== projectId || fork.parent_thread_id !== src.id || fork.root_thread_id !== rootThreadId || fork.summary_message_id != null
            || fork.fork_reason !== 'manual') throw new Error('Invalid ordinary fork lineage.');
        if (fork.branch_mode === 'reference') {
            const anchor = fork.anchor_message_id ? await db.messages.get(fork.anchor_message_id) : undefined;
            if (!anchor || anchor.deleted || anchor.thread_id !== src.id) throw new Error('Invalid reference anchor.');
        }
        await dbTry(
            () => db.threads.put(fork),
            { op: 'write', entity: 'threads', action: 'fork' },
            { rethrow: true }
        );
        membership = scope ? await moveChatProjectRows(scope, fork.id, projectId) : { projects: [], threads: [] };

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
            const newMessages: Message[] = msgs.map((m) => ({
                ...m,
                id: newId(),
                thread_id: forkId,
                clock: nextClock(),
            }));
            await dbTry(
                () => db.messages.bulkPut(newMessages),
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
        scope?.assertCurrent('write');
        return fork;
    });
    await notifyChatProjectMove(membership);
    try { await hooks.doAction('db.threads.fork:action:after', result); }
    catch (error) { console.warn('[threads] Fork committed; notification failed', error); }
    return result;
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
    const db = getDb();
    await db.transaction('rw', getWriteTxTableNames(db, 'threads'), async () => {
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
