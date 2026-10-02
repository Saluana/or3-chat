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

        const nextMessages = projectTranscriptForOpenRouter(
            storedMessagesToCanonicalTranscript(visible)
        );

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
