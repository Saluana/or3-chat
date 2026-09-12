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
    withoutSupersededMessages,
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
        const DexieMod = (await import('dexie')).default;
        const db = getDb();
        const all = await db.messages
            .where('[thread_id+index]')
            .between(
                [targetThreadId, DexieMod.minKey],
                [targetThreadId, DexieMod.maxKey]
            )
            .filter((m: Message) => !m.deleted)
            .toArray();

        all.sort(compareMessageOrder);

        // Retry-superseded turns stay in storage but leave the branch: later
        // sends and reloads reconstruct only the selected branch.
        const visible = withoutSupersededMessages(all);

        const nextMessages = projectTranscriptForOpenRouter(
            storedMessagesToCanonicalTranscript(visible)
        );

        // The database read can complete after navigation selects another
        // thread. Never commit an older thread's transcript into the new view.
        if (threadIdRef.value !== targetThreadId) return false;
        messages.value = nextMessages;
        historyLoadedFor.value = targetThreadId;
        return true;
    } catch (e) {
        console.warn('[useChat.ensureThreadHistoryLoaded] failed', e);
        return false;
    }
}
