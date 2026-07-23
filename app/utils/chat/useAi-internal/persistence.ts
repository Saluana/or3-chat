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
import { upsertMessageInDb } from '~/db/messages';
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
        // Always merge against the latest row. Streaming writes must not erase
        // concurrent plugin metadata, synced edits, or file references.
        const latest =
            ((await db.messages.get(assistantDbMsg.id)) as
                | StoredMessage
                | undefined) ?? assistantDbMsg;
        const baseData = latest.data && typeof latest.data === 'object'
            ? (latest.data as Record<string, unknown>)
            : {};
        const serialized = assistantFileHashes.length
            ? serializeFileHashes(assistantFileHashes)
            : latest.file_hashes ?? lastSerialized;
        if (
            serialized !== lastSerialized ||
            content != null ||
            reasoning != null ||
            toolCalls != null ||
            finalize
        ) {
            const payload: StoredMessage = {
                ...latest,
                pending: finalize ? false : latest.pending,
                data: {
                    ...baseData,
                    ...(content !== undefined ? { content } : {}),
                    ...(reasoning !== undefined
                        ? { reasoning_text: reasoning }
                        : {}),
                    ...(toolCalls !== undefined
                        ? {
                              tool_calls: (toolCalls ?? []).map((t) => ({ ...t })),
                          }
                        : {}),
                    ...(finalize ? { generation_state: 'complete' } : {}),
                    ...(generationLeaseId && !finalize
                        ? createForegroundGenerationLease(generationLeaseId)
                        : {}),
                },
                file_hashes: serialized,
                updated_at: nowSec(),
            };
            await upsertMessageInDb(db, payload);
            lastSerialized = serialized ?? null;
        }
        return lastSerialized;
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
    const base =
        ((await db.messages.get(id)) as StoredMessage | undefined) ??
        existing;
    if (!base) return;

    // If error is being updated, also update data.error for reliable sync
    // (data uses v.any() and syncs reliably; top-level error may not)
    let finalPatch = patch;
    const baseData = base.data && typeof base.data === 'object'
        ? (base.data as Record<string, unknown>)
        : {};
    const patchData = patch.data && typeof patch.data === 'object'
        ? (patch.data as Record<string, unknown>)
        : {};
    finalPatch = {
        ...patch,
        data: {
            ...baseData,
            ...patchData,
            ...('error' in patch ? { error: patch.error } : {}),
        },
    };

    await upsertMessageInDb(db, {
        ...base,
        ...finalPatch,
        updated_at: finalPatch.updated_at ?? nowSec(),
    });
}
