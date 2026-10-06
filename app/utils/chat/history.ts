/**
 * @module app/utils/chat/history
 *
 * Purpose:
 * Loads persisted chat history for a thread into reactive state.
 *
 * Constraints:
 * - Uses Dexie directly and runs only on the client.
 */

import type { Ref } from 'vue';
import type { ChatMessage } from './types';
import { getDb, getWorkspaceGeneration } from '~/db/client';
import { resolveThreadProjection } from './compaction/history';
import {
    projectTranscriptForOpenRouter,
    storedMessagesToCanonicalTranscript,
} from './transcript';

/**
 * `ensureThreadHistoryLoaded`
 *
 * Purpose:
 * Loads messages for the active thread once and populates UI state.
 */
export async function ensureThreadHistoryLoaded(
    threadIdRef: Ref<string | undefined>,
    historyLoadedFor: Ref<string | null>,
    messages: Ref<ChatMessage[]>
) {
    const targetThreadId = threadIdRef.value;
    if (!targetThreadId) return false;
    if (historyLoadedFor.value === targetThreadId) return true;

    try {
        const db = getDb();
        const generation = getWorkspaceGeneration();
        const { messages: visible } = await resolveThreadProjection(targetThreadId, db);

        const storedById = new Map(visible.map((row) => [row.id, row]));
        const nextMessages = projectTranscriptForOpenRouter(
            storedMessagesToCanonicalTranscript(visible)
        ).map((message) => {
            const storedData = message.id ? storedById.get(message.id)?.data : undefined;
            const data = storedData && typeof storedData === 'object'
                ? storedData as Record<string, unknown>
                : undefined;
            // Provider history omits presentation metadata. Retain the saved
            // receipt when navigation reloads the same canonical message.
            return data?.project_context
                ? {
                      ...message,
                      data: {
                          ...message.data,
                          project_context: data.project_context,
                          project_context_iterations: data.project_context_iterations,
                      },
                  }
                : message;
        });

        // The database read can complete after navigation selects another
        // thread. Never commit an older thread's transcript into the new view.
        if (threadIdRef.value !== targetThreadId || getDb() !== db || getWorkspaceGeneration() !== generation) return false;
        messages.value = nextMessages;
        historyLoadedFor.value = targetThreadId;
        return true;
    } catch (e) {
        console.warn('[useChat.ensureThreadHistoryLoaded] failed', e);
        return false;
    }
}
