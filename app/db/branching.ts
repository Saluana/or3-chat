import Dexie from 'dexie';
import { db } from './client';
import { newId, nowSec } from './util';
import type { Thread, Message } from './schema';

export type ForkMode = 'reference' | 'copy';

interface ForkThreadParams {
    sourceThreadId: string;
    anchorMessageId: string; // must be a user message in source thread
    mode?: ForkMode;
    titleOverride?: string;
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
            branch_mode: mode,
            created_at: now,
            updated_at: now,
            last_message_at: null,
            // Preserve some flags; ensure forked boolean set
            forked: true,
        } as Thread;

        await db.threads.put(fork);

        if (mode === 'copy') {
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

        return { thread: fork, anchor };
    });
}

interface RetryBranchParams {
    assistantMessageId: string;
    mode?: ForkMode;
    titleOverride?: string;
}

/**
 * Given an assistant message, locate the preceding user message and fork the thread there.
 */
export async function retryBranch({
    assistantMessageId,
    mode = 'reference',
    titleOverride,
}: RetryBranchParams) {
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
    return forkThread({
        sourceThreadId: assistant.thread_id,
        anchorMessageId: prevUser.id,
        mode,
        titleOverride,
    });
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

    return [...ancestors, ...locals];
}
