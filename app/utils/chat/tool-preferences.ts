import { getKvRecordByName } from '~/db/kv';
import type { Or3DB } from '~/db/client';

/** The master gate never changes the remembered individual selection. */
export interface ChatToolPreferences {
    enabled: boolean;
    tools: Record<string, boolean>;
}

export function chatToolPreferenceKey(threadId?: string | null, draftId?: string): string {
    return threadId ? `chat-tools:${threadId}` : `chat-tools-draft:${draftId ?? 'default'}`;
}

export async function readChatToolPreferences(db: Or3DB, threadId?: string | null, draftId?: string): Promise<ChatToolPreferences> {
    const { row } = await getKvRecordByName(chatToolPreferenceKey(threadId, draftId), db);
    if (row?.value) {
        try {
            const saved = JSON.parse(row.value) as Partial<ChatToolPreferences> | null;
            if (typeof saved?.enabled !== 'boolean' || !saved.tools || typeof saved.tools !== 'object'
                || Array.isArray(saved.tools) || Object.values(saved.tools).some(value => typeof value !== 'boolean')) {
                return { enabled: false, tools: {} };
            }
            return { enabled: saved.enabled, tools: saved.tools };
        } catch { return { enabled: false, tools: {} }; }
    }
    const { row: defaults } = await getKvRecordByName('ai_settings', db);
    try {
        return { enabled: defaults?.value ? JSON.parse(defaults.value)?.defaultToolsEnabled === true : false, tools: {} };
    } catch { return { enabled: false, tools: {} }; }
}
