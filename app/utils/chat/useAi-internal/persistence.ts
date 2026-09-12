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
import type { ToolCallInfo } from '~/utils/chat/uiMessages';
import { createForegroundGenerationLease } from '~/utils/chat/generation-lease';

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
        reasoning,
        toolCalls,
        finalize = false, // When true, clears pending flag to trigger sync
    }: {
        content?: string;
        reasoning?: string | null;
        toolCalls?: ToolCallInfo[] | null;
        finalize?: boolean;
    }): Promise<string | null> {
        // Build only the owned delta. The merge against the latest row happens
        // atomically inside patchMessageInDb's write transaction, so concurrent
        // plugin metadata, synced edits, or file references cannot be
        // overwritten by a stale read. `undefined` means "not supplied";
        // `null` explicitly clears reasoning/tool calls.
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
            ...(hasReasoning ? { reasoning_text: reasoning } : {}),
            ...(hasToolCalls
                ? { tool_calls: (toolCalls ?? []).map((t) => ({ ...t })) }
                : {}),
            ...(finalize ? { generation_state: 'complete' } : {}),
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
            assistantDbMsg
        );
        if (ownedSerialized !== undefined) {
            lastSerialized = ownedSerialized ?? null;
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
    existing?: StoredMessage | null
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
        existing ?? null
    );
}
