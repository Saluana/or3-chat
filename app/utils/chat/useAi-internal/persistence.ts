/**
 * @module useAi/persistence
 * @description Database persistence helpers for useAi.
 *
 * @responsibilities
 * - Create assistant persisters for incremental message writes
 * - Update message records in Dexie
 * - Manage file hash serialization for messages
 *
 * @non-responsibilities
 * - Stream management (handled by streaming module)
 * - Background job tracking (handled by backgroundJobs module)
 *
 * @dependencies
 * - ~/db for Dexie operations
 * - ~/db/files-util for file hash serialization
 */

import { nowSec } from '~/db/util';
import { upsert } from '~/db';
import { getDb } from '~/db/client';
import { serializeFileHashes } from '~/db/files-util';
import type { StoredMessage, AssistantPersister } from './types';
import type { ToolCallInfo } from '~/utils/chat/uiMessages';

/**
 * Create a persister function for an assistant message.
 * Caches last serialized file hashes to avoid recomputing on each write.
 *
 * @param assistantDbMsg - The initial assistant message from DB
 * @param assistantFileHashes - Array of file hashes to persist
 * @returns Async function to persist content/reasoning/toolCalls
 */
export function makeAssistantPersister(
    assistantDbMsg: StoredMessage,
    assistantFileHashes: string[]
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
        const baseData =
            assistantDbMsg.data && typeof assistantDbMsg.data === 'object'
                ? (assistantDbMsg.data as Record<string, unknown>)
                : {};
        const serialized = assistantFileHashes.length
            ? serializeFileHashes(assistantFileHashes)
            : lastSerialized;
        if (
            serialized !== lastSerialized ||
            content != null ||
            reasoning != null ||
            toolCalls != null ||
            finalize
        ) {
            const payload: StoredMessage = {
                ...assistantDbMsg,
                pending: finalize ? false : assistantDbMsg.pending, // Clear pending on finalize
                data: {
                    ...baseData,
                    content:
                        content ??
                        (typeof baseData.content === 'string'
                            ? baseData.content
                            : ''),
                    reasoning_text:
                        reasoning ??
                        (typeof baseData.reasoning_text === 'string'
                            ? baseData.reasoning_text
                            : null),
                    ...(toolCalls
                        ? {
                              tool_calls: toolCalls.map((t) => ({ ...t })),
                          }
                        : {}),
                },
                file_hashes: serialized,
                updated_at: nowSec(),
            };
            await upsert.message(payload);
            lastSerialized = serialized ?? null;
        }
        return lastSerialized;
    };
}

/**
 * Update an existing message record in Dexie.
 * If error is being updated, also syncs to data.error for reliable sync.
 *
 * @param id - Message ID
 * @param patch - Partial message to merge
 * @param existing - Optional existing message to avoid refetch
 */
export async function updateMessageRecord(
    id: string,
    patch: Partial<StoredMessage>,
    existing?: StoredMessage | null
): Promise<void> {
    const base =
        existing ??
        ((await getDb().messages.get(id)) as StoredMessage | undefined);
    if (!base) return;

    // If error is being updated, also update data.error for reliable sync
    // (data uses v.any() and syncs reliably; top-level error may not)
    let finalPatch = patch;
    if ('error' in patch) {
        const baseData =
            base.data && typeof base.data === 'object'
                ? (base.data as Record<string, unknown>)
                : {};
        const patchData =
            patch.data && typeof patch.data === 'object'
                ? (patch.data as Record<string, unknown>)
                : {};
        finalPatch = {
            ...patch,
            data: {
                ...baseData,
                ...patchData,
                error: patch.error, // Sync error to data.error
            },
        };
    }

    await upsert.message({
        ...base,
        ...finalPatch,
        updated_at: finalPatch.updated_at ?? nowSec(),
    });
}
