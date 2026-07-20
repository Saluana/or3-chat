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
import { getDb } from '~/db/client';
import type { Message } from '~/db/schema';
import { compareMessageOrder } from '~/db/messages';
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
    if (!threadIdRef.value) return;
    if (historyLoadedFor.value === threadIdRef.value) return;

    try {
        const DexieMod = (await import('dexie')).default;
        const db = getDb();
        const all = await db.messages
            .where('[thread_id+index]')
            .between(
                [threadIdRef.value, DexieMod.minKey],
                [threadIdRef.value, DexieMod.maxKey]
            )
            .filter((m: Message) => !m.deleted)
            .toArray();

        all.sort(compareMessageOrder);

        messages.value = projectTranscriptForOpenRouter(
            storedMessagesToCanonicalTranscript(all)
        );

        historyLoadedFor.value = threadIdRef.value;
    } catch (e) {
        console.warn('[useChat.ensureThreadHistoryLoaded] failed', e);
    }
}
