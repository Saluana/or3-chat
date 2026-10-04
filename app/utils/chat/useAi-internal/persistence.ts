import { readRequestUsage } from '~~/shared/chat/compaction';
/**
 * @module app/utils/chat/useAi-internal/persistence
 *
 * Purpose:
 * Persistence helpers for useAi to write assistant output to Dexie.
 *
 * Behavior:
 * - Creates a persister that batches content/tool-call updates
 * - Updates message records and keeps `data.error` in sync
 *
 * Constraints:
 * - Internal API only
 */

import { nowSec } from '~/db/util';
import type { Or3DB } from '~/db/client';
import { patchMessageInDb } from '~/db/messages';
import { serializeFileHashes } from '~/db/files-util';
import type { StoredMessage, AssistantPersister } from './types';
import {
    createForegroundGenerationLease,
    FOREGROUND_GENERATION_LEASE_MS,
} from '~/utils/chat/generation-lease';

/** Keep a live request owned even while the model or a tool is quiet. */
export function startForegroundGenerationHeartbeat(
    db: Or3DB,
    messageId: string,
    leaseId: string,
    signal: AbortSignal
): () => void {
    let stopped = signal.aborted;
    let writing = false;
    const timer = setInterval(() => {
        if (stopped || writing) return;
        writing = true;
        void updateMessageRecord(
            db,
            messageId,
            { data: createForegroundGenerationLease(leaseId) },
            null,
            (latest) => {
                const data = latest?.data as Record<string, unknown> | null;
                return !stopped && latest?.pending === true && !latest.deleted &&
                    data?.generation_lease_id === leaseId &&
                    data.generation_state !== 'superseded' &&
                    typeof data.background_job_id !== 'string' &&
                    typeof data.superseded_by !== 'string';
            }
        ).catch(() => {
            // Retry on the next heartbeat. A transient local write failure
            // must not cancel a healthy provider request.
        }).finally(() => {
            writing = false;
        });
    }, FOREGROUND_GENERATION_LEASE_MS / 3);
    const stop = () => {
        stopped = true;
        clearInterval(timer);
        signal.removeEventListener('abort', stop);
    };
    signal.addEventListener('abort', stop, { once: true });
    if (stopped) stop();
    return stop;
}

/**
 * `makeAssistantPersister`
 *
 * Purpose:
 * Creates a persister that incrementally writes assistant output to Dexie.
 */
export function makeAssistantPersister(
    db: Or3DB,
    assistantDbMsg: StoredMessage,
    assistantFileHashes: string[],
    generationLeaseId?: string
): AssistantPersister {
    // Cache last serialized file hashes to avoid recomputing on each write
    let lastSerialized: string | null = assistantDbMsg.file_hashes || null;

    return async function persist({
        content,
        usage,
        reasoning,
        toolCalls,
        finalize = false, // When true, clears pending flag to trigger sync
        terminalState,
        ifCurrent,
    }: Parameters<AssistantPersister>[0]): Promise<string | null> {
        // Build only the owned delta. The merge against the latest row happens
        // atomically inside patchMessageInDb's write transaction, so concurrent
        // plugin metadata, synced edits, or file references cannot be
        // overwritten by a stale read. `undefined` means "not supplied";
        // `null` explicitly clears reasoning/tool calls.
        const acceptedUsage = readRequestUsage(usage);
        const hasContent = content !== undefined;
        const hasReasoning = reasoning !== undefined;
        const hasToolCalls = toolCalls !== undefined;
        const ownedSerialized = assistantFileHashes.length
            ? serializeFileHashes(assistantFileHashes)
            : undefined;
        const fileChanged =
            ownedSerialized !== undefined &&
            ownedSerialized !== lastSerialized;
        if (
            !acceptedUsage &&
            !hasContent &&
            !hasReasoning &&
            !hasToolCalls &&
            !finalize &&
            !fileChanged
        ) {
            return lastSerialized;
        }
        const dataPatch: Record<string, unknown> = {
            ...(hasContent ? { content } : {}),
            ...(acceptedUsage ? { usage: acceptedUsage } : {}),
            ...(hasReasoning ? { reasoning_text: reasoning } : {}),
            ...(hasToolCalls
                ? { tool_calls: (toolCalls ?? []).map((t) => ({ ...t })) }
                : {}),
            ...(finalize
                ? { generation_state: terminalState ?? 'complete' }
                : {}),
            ...(generationLeaseId && !finalize
                ? createForegroundGenerationLease(generationLeaseId)
                : {}),
        };
        const patch: Partial<StoredMessage> = {
            data: dataPatch,
            ...(ownedSerialized !== undefined
                ? { file_hashes: ownedSerialized }
                : {}),
            ...(finalize ? { pending: false } : {}),
            updated_at: nowSec(),
        };
        await patchMessageInDb(
            db,
            assistantDbMsg.id,
            patch as Partial<StoredMessage>,
            assistantDbMsg,
            generationLeaseId && !finalize
                ? (latest) => {
                    const data = latest?.data as Record<string, unknown> | null;
                    return latest?.pending === true && !latest.deleted &&
                        data?.generation_lease_id === generationLeaseId &&
                        data.generation_state !== 'superseded' &&
                        typeof data.superseded_by !== 'string' &&
                        (ifCurrent?.(latest) ?? true);
                }
                : ifCurrent
        );
        if (ownedSerialized !== undefined) {
            lastSerialized = ownedSerialized;
            return lastSerialized;
        }
        // Best-effort freshness for the return value only; the write itself
        // did not depend on this read.
        try {
            const current = (await db.messages.get(assistantDbMsg.id)) as
                | StoredMessage
                | undefined;
            return current?.file_hashes ?? lastSerialized;
        } catch {
            return lastSerialized;
        }
    };
}

/**
 * `updateMessageRecord`
 *
 * Purpose:
 * Updates an existing message record and keeps `data.error` in sync.
 */
export async function updateMessageRecord(
    db: Or3DB,
    id: string,
    patch: Partial<StoredMessage>,
    existing?: StoredMessage | null,
    ifCurrent?: Parameters<typeof patchMessageInDb>[4]
): Promise<void> {
    // Merge the caller's delta against the latest row inside a single write
    // transaction (see patchMessageInDb). Never read-then-write across two
    // transactions here: a concurrent writer could commit between the read
    // and the write and lose its update.
    // If error is being updated, patchMessageInDb also mirrors it into
    // data.error for reliable sync (data uses v.any() and syncs reliably;
    // top-level error may not).
    await patchMessageInDb(
        db,
        id,
        {
            ...patch,
            updated_at: patch.updated_at ?? nowSec(),
        } as Partial<StoredMessage>,
        existing ?? null,
        ifCurrent
    );
}
