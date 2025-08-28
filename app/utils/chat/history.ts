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
        const existingIds = new Set(messages.value.map((m) => m.id));
        for (const m of all) {
            if (existingIds.has(m.id)) continue;
            messages.value.push({
                role: m.role,
                content: (m as any)?.data?.content || '',
                id: m.id,
                stream_id: (m as any).stream_id,
                file_hashes: (m as any).file_hashes,
            } as any);
        }
        historyLoadedFor.value = threadIdRef.value;
    } catch (e) {
        console.warn('[useChat.ensureThreadHistoryLoaded] failed', e);
    }
}
