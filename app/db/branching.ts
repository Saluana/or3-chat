/**
 * @module app/db/branching
 *
 * Purpose:
 * Branching utilities for threads, including fork and retry flows and
 * context assembly across parent and child threads.
 *
 * Responsibilities:
 * - Create forked threads using hook-aware workflows
 * - Resolve branch context for AI prompt building
 * - Normalize branch mode semantics for callers
 *
 * Non-responsibilities:
 * - Rendering or formatting context for providers
 * - Server-side branching operations
 */
import Dexie from 'dexie';
import { getDb } from './client';
import { newId, nowSec, nextClock, getWriteTxTableNames } from './util';
import type { Thread, Message } from './schema';
import { useHooks } from '../core/hooks/useHooks';
import { resolveRootThreadId } from '../utils/chat/compaction/history';
import type {
    BranchMode,
    BranchForkOptions,
    BranchForkBeforePayload,
    MessageEntity,
    ThreadEntity,
    RetryBranchParams,
} from '../core/hooks/hook-types';

/**
 * Purpose:
 * Public alias for branch mode selection in callers.
 *
 * Behavior:
 * Mirrors `BranchMode` from the hook type map.
 *
 * Constraints:
 * - Only supports `reference` and `copy`.
 *
 * Non-Goals:
 * - Does not introduce new branch modes.
 */
export type ForkMode = Exclude<BranchMode, 'compacted'>;

interface ForkThreadParams {
    sourceThreadId: string;
    anchorMessageId: string; // must be a user message in source thread
    mode?: ForkMode;
    titleOverride?: string;
    reason?: 'manual' | 'retry';
}

const DEFAULT_BRANCH_MODE: ForkMode = 'reference';

function normalizeBranchMode(mode?: BranchMode | null): Exclude<BranchMode, 'compacted'> {
    if (mode === 'compacted') throw new Error('Compacted forks require the validated atomic writer.');
    return mode === 'copy' ? 'copy' : DEFAULT_BRANCH_MODE;
}

function normalizeMessageRole(role: string): MessageEntity['role'] {
    return role === 'assistant' || role === 'system' || role === 'tool' ? role : 'user';
}

function toMessageEntity(message: Message): MessageEntity {
    return {
        id: message.id,
        thread_id: message.thread_id,
        role: normalizeMessageRole(message.role),
        data: message.data as Record<string, unknown>,
        index: message.index,
        created_at: message.created_at,
        updated_at: message.updated_at,
    };
}

function mergeMessageEntity(entity: MessageEntity, base?: Message): Message {
    const fallback: Message =
        base ??
        ({
            id: entity.id,
            thread_id: entity.thread_id,
            role: entity.role,
            data: entity.data,
            index: entity.index,
            created_at: entity.created_at,
            updated_at: entity.updated_at ?? entity.created_at,
            deleted: false,
            error: null,
            clock: 0,
            file_hashes: undefined,
            stream_id: undefined,
        } as Message);

    return {
        ...fallback,
        id: entity.id,
        thread_id: entity.thread_id,
        role: entity.role,
        data: entity.data,
        index: entity.index,
        created_at: entity.created_at,
        updated_at: entity.updated_at ?? entity.created_at,
    };
}

function toThreadEntity(thread: Thread): ThreadEntity {
    return {
        id: thread.id,
        title: thread.title ?? null,
        created_at: thread.created_at,
        updated_at: thread.updated_at,
        last_message_at: thread.last_message_at ?? null,
        parent_thread_id: thread.parent_thread_id ?? null,
        anchor_message_id: thread.anchor_message_id ?? null,
        anchor_index: thread.anchor_index ?? null,
        branch_mode:
            thread.branch_mode === 'copy' ? 'copy' : thread.branch_mode ?? null,
        status: thread.status,
        deleted: thread.deleted,
        pinned: thread.pinned,
        clock: thread.clock,
        forked: thread.forked,
        project_id: thread.project_id ?? null,
        system_prompt_id: thread.system_prompt_id ?? null,
        root_thread_id: thread.root_thread_id ?? null,
        summary_message_id: thread.summary_message_id ?? null,
        fork_reason: thread.fork_reason,
    };
}

/**
 * Create a new thread branching off an existing thread at a specific user message.
 * - reference mode: no ancestor messages copied; context builder will stitch.
 * - copy mode: ancestor slice (<= anchor.index) copied into new thread with normalized indexes.
 */
/**
 * Purpose:
 * Fork a thread at a specific anchor message, producing a new branch.
 *
 * Behavior:
 * Creates a new thread, optionally copies ancestor messages, and emits hooks
 * around the fork lifecycle.
 *
 * Constraints:
 * - Anchor message must belong to the source thread.
 * - `copy` mode duplicates messages up to the anchor index.
 *
 * Non-Goals:
 * - Does not merge threads or resolve conflicts.
 */
export async function forkThread({
    sourceThreadId,
    anchorMessageId,
    mode = 'reference',
    titleOverride,
    reason = 'manual',
}: ForkThreadParams): Promise<{ thread: Thread; anchor: Message }> {
    const db = getDb();
    const hooks = useHooks();
    const filteredOptions = await hooks.applyFilters(
        'branch.fork:filter:options',
        {
            sourceThreadId,
            anchorMessageId,
            mode,
            titleOverride,
        } satisfies BranchForkOptions
    );
    sourceThreadId = filteredOptions.sourceThreadId;
    anchorMessageId = filteredOptions.anchorMessageId;
    const branchMode = normalizeBranchMode(filteredOptions.mode ?? mode);
    titleOverride = filteredOptions.titleOverride;
    const { resolveChatProject, moveChatProjectRows, notifyChatProjectMove } = await import('./project-workspace');
    if (getDb() !== db) throw new Error('Workspace changed before forking. Try again.');
    const src = await db.threads.get(sourceThreadId);
    if (!src || src.deleted) throw new Error('Source thread not found');
    const projectId = await resolveChatProject(db, src.id);
    // Only project forks need the authenticated workspace boundary; ordinary
    // and guest forks keep the unscoped write path.
    const scope = projectId
        ? (await import('~/utils/projects/context')).captureProjectOperation(undefined, sourceThreadId)
        : null;
    if (scope && scope.db !== db) throw new Error('Workspace changed before forking. Try again.');
    scope?.assertCurrent('write');
    const rootThreadId = await resolveRootThreadId(src.id, db);

    const anchor = await db.messages.get(anchorMessageId);
    if (!anchor || anchor.deleted || anchor.thread_id !== sourceThreadId)
        throw new Error('Invalid anchor message');
    // Minimal model: allow either user OR assistant anchor. (User anchors enable alt assistant responses; assistant anchors capture existing reply.)

    const now = nowSec();
    const forkId = newId();

    const fork: Thread = {
        ...src,
        project_id: projectId,
        id: forkId,
        title: titleOverride || `${src.title || 'Branch'} - fork`,
        parent_thread_id: sourceThreadId,
        anchor_message_id: anchorMessageId,
        anchor_index: anchor.index,
        branch_mode: branchMode,
        root_thread_id: rootThreadId,
        summary_message_id: null,
        fork_reason: reason,
        created_at: now,
        updated_at: now,
        last_message_at: null,
        // Preserve some flags; ensure forked boolean set
        forked: true,
        clock: nextClock(),
    } as Thread;

    const beforePayload: BranchForkBeforePayload = {
        source: toThreadEntity(src),
        anchor: toMessageEntity(anchor),
        mode: branchMode,
        ...(titleOverride ? { options: { titleOverride } } : {}),
    };
    await hooks.doAction('branch.fork:action:before', beforePayload);
    let membership!: Awaited<ReturnType<typeof moveChatProjectRows>>;
    const result = await db.transaction('rw', getWriteTxTableNames(db, ['threads', 'messages', 'projects']), async () => {
        scope?.assertCurrent('write');
        const current = await db.threads.get(src.id);
        if (JSON.stringify(current) !== JSON.stringify(src)
            || await resolveChatProject(db, src.id) !== projectId
            || await resolveRootThreadId(src.id, db) !== rootThreadId)
            throw new Error('The source chat changed while preparing its fork. Try again.');
        if (await db.threads.get(fork.id)) throw new Error('The fork identity already exists.');
        if (JSON.stringify(await db.messages.get(anchor.id)) !== JSON.stringify(anchor))
            throw new Error('The anchor changed while preparing its fork. Try again.');

        await db.threads.put(fork);
        membership = scope ? await moveChatProjectRows(scope, fork.id, projectId) : { projects: [], threads: [] };

        if (branchMode === 'copy') {
            const ancestors = await db.messages
                .where('[thread_id+index]')
                // includeLower=true, includeUpper=true to include anchor row
                .between(
                    [sourceThreadId, Dexie.minKey],
                    [sourceThreadId, anchor.index],
                    true,
                    true
                )
                .sortBy('index');

            const messagesToCopy = ancestors.map((m, i) => ({
                ...m,
                id: newId(),
                thread_id: forkId,
                index: i, // normalize sequential indexes starting at 0
                clock: nextClock(),
            }));
            await db.messages.bulkPut(messagesToCopy);
            await db.threads.put({
                ...fork,
                last_message_at: anchor.created_at,
                updated_at: nowSec(),
                clock: nextClock(fork.clock),
            });
        }

        scope?.assertCurrent('write');
        return { thread: fork, anchor };
    });
    await notifyChatProjectMove(membership);
    try { await hooks.doAction('branch.fork:action:after', toThreadEntity(result.thread)); }
    catch (error) { console.warn('[threads] Fork committed; notification failed', error); }
    return result;
}

/**
 * Given an assistant message, locate the preceding user message and fork the thread there.
 */
/**
 * Purpose:
 * Fork a thread by locating the prior user message of an assistant reply.
 *
 * Behavior:
 * Finds the preceding user message and delegates to `forkThread`, while
 * emitting retry-specific hooks.
 *
 * Constraints:
 * - Requires the provided message to be an assistant message.
 *
 * Non-Goals:
 * - Does not generate new assistant responses.
 */
export async function retryBranch({
    assistantMessageId,
    mode = 'reference',
    titleOverride,
}: RetryBranchParams) {
    const hooks = useHooks();
    const filtered = await hooks.applyFilters('branch.retry:filter:options', {
        assistantMessageId,
        mode,
        titleOverride,
    });
    assistantMessageId = filtered.assistantMessageId;
    mode = filtered.mode ?? mode;
    titleOverride = filtered.titleOverride;
    const assistant = await getDb().messages.get(assistantMessageId);
    if (!assistant || assistant.role !== 'assistant')
        throw new Error('Assistant message not found');
    // Retry semantics: branch at preceding user (to produce alternate assistant response)
    const prevUser = await getDb().messages
        .where('[thread_id+index]')
        .between(
            [assistant.thread_id, Dexie.minKey],
            [assistant.thread_id, assistant.index],
            true,
            true
        )
        .filter((m) => m.role === 'user' && m.index < assistant.index)
        .last();
    if (!prevUser) throw new Error('No preceding user message found');
    await hooks.doAction('branch.retry:action:before', {
        assistantMessageId,
        precedingUserId: prevUser.id,
        mode,
    });
    const res = await forkThread({
        sourceThreadId: assistant.thread_id,
        anchorMessageId: prevUser.id,
        mode: normalizeBranchMode(mode),
        titleOverride,
        reason: 'retry',
    });
    await hooks.doAction('branch.retry:action:after', {
        assistantMessageId,
        precedingUserId: prevUser.id,
        newThreadId: res.thread.id,
        mode,
    });
    return res;
}

interface BuildContextParams {
    threadId: string;
}

/**
 * Build AI context for a (possibly branched) thread.
 * - Root or copy branches: just local messages.
 * - Reference branches: ancestor slice (<= anchor_index) from parent + local messages.
 */
/**
 * Purpose:
 * Build the ordered message context for a thread with branching awareness.
 *
 * Behavior:
 * Merges ancestor and local messages, applies hook filters, and returns the
 * resulting message list.
 *
 * Constraints:
 * - Reference branches include ancestor messages up to the anchor index.
 *
 * Non-Goals:
 * - Does not format messages for provider-specific payloads.
 */
export async function buildContext({ threadId }: BuildContextParams) {
    const db = getDb();
    const { resolveThreadProjection } = await import('~/utils/chat/compaction/history');
    const projection = await resolveThreadProjection(threadId, db);
    const combinedMessages = projection.messages;
    const leaf = projection.segments.at(-1)!;
    const branchMode = leaf.thread.branch_mode ?? 'reference';
    const hooks = useHooks();
    const messageMap = new Map(combinedMessages.map((message) => [message.id, message]));
    const filtered = await hooks.applyFilters('branch.context:filter:messages', combinedMessages.map(toMessageEntity), threadId, branchMode);
    const merged = filtered.map((entity) => mergeMessageEntity(entity, messageMap.get(entity.id)));
    await hooks.doAction('branch.context:action:after', { threadId, mode: branchMode,
        ancestorCount: combinedMessages.length - leaf.visible.length, localCount: leaf.visible.length, finalCount: merged.length });
    return merged;
}
