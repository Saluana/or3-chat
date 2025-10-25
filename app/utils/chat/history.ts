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

        // Build a map of existing messages by ID to preserve object references
        const existingById = new Map(messages.value.map((m) => [m.id, m]));

        // Rebuild the array in correct sorted order from DB
        // Use existing objects where available, create new ones for missing messages
        messages.value = all.map((dbMsg) => {
            const existing = existingById.get(dbMsg.id);
            if (existing) {
                return existing;
            }
            return {
                role: dbMsg.role,
                content: (dbMsg as any)?.data?.content || '',
                id: dbMsg.id,
                stream_id: (dbMsg as any).stream_id,
                file_hashes: (dbMsg as any).file_hashes,
            } as any;
        });

        historyLoadedFor.value = threadIdRef.value;
    } catch (e) {
        console.warn('[useChat.ensureThreadHistoryLoaded] failed', e);
    }
}
