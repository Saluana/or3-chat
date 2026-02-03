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
import { upsert } from '~/db';
import { getDb } from '~/db/client';
import { serializeFileHashes } from '~/db/files-util';
import type { StoredMessage, AssistantPersister } from './types';
import type { ToolCallInfo } from '~/utils/chat/uiMessages';

/**
 * `makeAssistantPersister`
 *
 * Purpose:
 * Creates a persister that incrementally writes assistant output to Dexie.
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
 * `updateMessageRecord`
 *
 * Purpose:
 * Updates an existing message record and keeps `data.error` in sync.
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
