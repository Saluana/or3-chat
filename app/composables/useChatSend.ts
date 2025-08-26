/**
 * useChatSend
 * Encapsulates message send payload assembly & dispatch.
 * Requirements: 3.5 (Input Handling Separation), 4 (Docs)
 */
import { ref } from 'vue';
// Avoid Nuxt path alias in unit tests (direct relative import)
import { newId, nowSec } from '../db/util';
// TODO: integrate with actual DB/message persistence once available

export interface ChatSendPayload {
    threadId: string;
    text: string;
    attachments?: string[];
    meta?: Record<string, any>;
}

export interface ChatSendResult {
    id: string;
    createdAt: number;
}

export interface ChatSendApi {
    sending: Ref<boolean>;
    error: Ref<Error | null>;
    send: (payload: ChatSendPayload) => Promise<ChatSendResult>;
}

export function useChatSend(): ChatSendApi {
    const sending = ref(false);
    const error = ref<Error | null>(null);

    async function send(payload: ChatSendPayload): Promise<ChatSendResult> {
        if (!payload.text?.trim()) throw new Error('Empty message');
        sending.value = true;
        error.value = null;
        try {
            const id = newId();
            const createdAt = nowSec();
            // Placeholder: persist to Dexie/messages store when implemented
            // await db.messages.add(...)
            return { id, createdAt };
        } catch (e) {
            error.value = e as Error;
            throw e;
        } finally {
            sending.value = false;
        }
    }

    return { sending, error, send };
}
