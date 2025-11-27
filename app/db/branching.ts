import Dexie from 'dexie';
import { db } from './client';
import { newId, nowSec } from './util';
import type { Thread, Message } from './schema';
import { useHooks } from '../core/hooks/useHooks';
import type {
    BranchMode,
    BranchForkOptions,
    BranchForkBeforePayload,
    MessageEntity,
    ThreadEntity,
    RetryBranchParams,
} from '../core/hooks/hook-types';

export type ForkMode = BranchMode;

interface ForkThreadParams {
    sourceThreadId: string;
    anchorMessageId: string; // must be a user message in source thread
    mode?: ForkMode;
    titleOverride?: string;
}

const DEFAULT_BRANCH_MODE: BranchMode = 'reference';

function normalizeBranchMode(mode?: ForkMode | null): BranchMode {
    return mode === 'copy' ? 'copy' : DEFAULT_BRANCH_MODE;
}

function normalizeMessageRole(role: string): MessageEntity['role'] {
    return role === 'assistant' || role === 'system' ? role : 'user';
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
    };
}

/**
 * Create a new thread branching off an existing thread at a specific user message.
 * - reference mode: no ancestor messages copied; context builder will stitch.
 * - copy mode: ancestor slice (<= anchor.index) copied into new thread with normalized indexes.
 */
export async function forkThread({
    sourceThreadId,
    anchorMessageId,
    mode = 'reference',
    titleOverride,
}: ForkThreadParams): Promise<{ thread: Thread; anchor: Message }> {
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
    return db.transaction('rw', db.threads, db.messages, async () => {
        const src = await db.threads.get(sourceThreadId);
        if (!src) throw new Error('Source thread not found');

        const anchor = await db.messages.get(anchorMessageId);
        if (!anchor || anchor.thread_id !== sourceThreadId)
            throw new Error('Invalid anchor message');
        // Minimal model: allow either user OR assistant anchor. (User anchors enable alt assistant responses; assistant anchors capture existing reply.)

        const now = nowSec();
        const forkId = newId();

        const fork: Thread = {
            ...src,
            id: forkId,
            title: titleOverride || `${src.title || 'Branch'} - fork`,
            parent_thread_id: sourceThreadId,
            anchor_message_id: anchorMessageId,
            anchor_index: anchor.index,
            branch_mode: branchMode,
            created_at: now,
            updated_at: now,
            last_message_at: null,
            // Preserve some flags; ensure forked boolean set
            forked: true,
        } as Thread;

        const beforePayload: BranchForkBeforePayload = {
            source: toThreadEntity(src),
            anchor: toMessageEntity(anchor),
            mode: branchMode,
            ...(titleOverride ? { options: { titleOverride } } : {}),
        };
        await hooks.doAction('branch.fork:action:before', beforePayload);

        await db.threads.put(fork);

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

            let i = 0;
            for (const m of ancestors) {
                await db.messages.put({
                    ...m,
                    id: newId(),
                    thread_id: forkId,
                    index: i++, // normalize sequential indexes starting at 0
                });
            }
            await db.threads.put({
                ...fork,
                last_message_at: anchor.created_at,
                updated_at: nowSec(),
            });
        }

        await hooks.doAction('branch.fork:action:after', toThreadEntity(fork));
        return { thread: fork, anchor };
    });
}

/**
 * Given an assistant message, locate the preceding user message and fork the thread there.
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
    const assistant = await db.messages.get(assistantMessageId);
    if (!assistant || assistant.role !== 'assistant')
        throw new Error('Assistant message not found');
    // Retry semantics: branch at preceding user (to produce alternate assistant response)
    const prevUser = await db.messages
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
        mode,
        titleOverride,
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
export async function buildContext({ threadId }: BuildContextParams) {
    const hooks = useHooks();
    const t = await db.threads.get(threadId);
    if (!t) return [] as Message[];

    if (!t.parent_thread_id || t.branch_mode === 'copy') {
        return db.messages.where('thread_id').equals(threadId).sortBy('index');
    }

    const [ancestors, locals] = await Promise.all([
        db.messages
            .where('[thread_id+index]')
            // include anchor message by setting includeUpper=true
            .between(
                [t.parent_thread_id, Dexie.minKey],
                [t.parent_thread_id, t.anchor_index!],
                true,
                true
            )
            .sortBy('index'),
        db.messages.where('thread_id').equals(threadId).sortBy('index'),
    ]);

    const combinedMessages = [...ancestors, ...locals];
    const branchMode = normalizeBranchMode(t.branch_mode);
    const messageMap = new Map(combinedMessages.map((m) => [m.id, m]));
    const combinedEntities = combinedMessages.map(toMessageEntity);
    const filteredEntities = await hooks.applyFilters(
        'branch.context:filter:messages',
        combinedEntities,
        threadId,
        branchMode
    );
    const mergedMessages = filteredEntities.map((entity) =>
        mergeMessageEntity(entity, messageMap.get(entity.id))
    );
    await hooks.doAction('branch.context:action:after', {
        threadId,
        mode: branchMode,
        ancestorCount: ancestors.length,
        localCount: locals.length,
        finalCount: mergedMessages.length,
    });
    return mergedMessages;
}
