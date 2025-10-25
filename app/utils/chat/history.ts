import type { Ref } from 'vue';
import type { ChatMessage } from './types';
import { db } from '~/db';
export async function ensureThreadHistoryLoaded(
    threadIdRef: Ref<string | undefined>,
    historyLoadedFor: Ref<string | null>,
    messages: Ref<ChatMessage[]>
) {
    if (!threadIdRef.value) return;
    if (historyLoadedFor.value === threadIdRef.value) return;

    try {
        const DexieMod = (await import('dexie')).default;
        const all = await db.messages
            .where('[thread_id+index]')
            .between(
                [threadIdRef.value, DexieMod.minKey],
                [threadIdRef.value, DexieMod.maxKey]
            )
            .filter((m: any) => !m.deleted)
            .toArray();

        all.sort((a: any, b: any) => (a.index || 0) - (b.index || 0));

        messages.value = all.map((dbMsg: any) => ({
            role: dbMsg.role,
            content:
                typeof dbMsg?.data?.content === 'string'
                    ? dbMsg.data.content
                    : (dbMsg as any)?.content || '',
            id: dbMsg.id,
            stream_id: dbMsg.stream_id,
            file_hashes: dbMsg.file_hashes,
            reasoning_text:
                typeof dbMsg?.data?.reasoning_text === 'string'
                    ? dbMsg.data.reasoning_text
                    : null,
            data: dbMsg.data || null,
            index:
                typeof dbMsg.index === 'number'
                    ? dbMsg.index
                    : typeof dbMsg.index === 'string'
                      ? Number(dbMsg.index) || null
                      : null,
            created_at:
                typeof dbMsg.created_at === 'number'
                    ? dbMsg.created_at
                    : null,
        }));

        historyLoadedFor.value = threadIdRef.value;
    } catch (e) {
        console.warn('[useChat.ensureThreadHistoryLoaded] failed', e);
    }
}
