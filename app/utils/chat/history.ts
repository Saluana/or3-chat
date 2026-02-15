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
import type { ChatMessage, ContentPart } from './types';
import { deriveMessageContent } from './messages';
import { getDb } from '~/db/client';
import type { Message } from '~/db/schema';

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

        all.sort((a: Message, b: Message) => (a.index || 0) - (b.index || 0));

        messages.value = all.map((dbMsg: Message) => {
            const data = dbMsg.data as Record<string, unknown> | null | undefined;
            const content = deriveMessageContent({
                content: (dbMsg as { content?: string | ContentPart[] | null }).content,
                data,
            });
            return {
                role: dbMsg.role as ChatMessage['role'],
                content,
                id: dbMsg.id,
                stream_id: dbMsg.stream_id ?? undefined,
                file_hashes: dbMsg.file_hashes,
                pending: dbMsg.pending ?? false,
                error: dbMsg.error ?? null,
                reasoning_text:
                    typeof data?.reasoning_text === 'string'
                        ? data.reasoning_text
                        : null,
                data: data || null,
                index:
                    typeof dbMsg.index === 'number'
                        ? dbMsg.index
                        : null,
                created_at:
                    typeof dbMsg.created_at === 'number' ? dbMsg.created_at : null,
            };
        });

        historyLoadedFor.value = threadIdRef.value;
    } catch (e) {
        console.warn('[useChat.ensureThreadHistoryLoaded] failed', e);
    }
}
