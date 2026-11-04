import { ref } from 'vue';
import type { StreamAccumulatorApi } from '~/composables/chat/useStreamAccumulator';
import type { ChatMessage } from '~/utils/chat/types';
import { ensureUiMessage, type UiChatMessage } from '~/utils/chat/uiMessages';
import { associateUiToolResultMessages } from '~/utils/chat/transcript';

/** Owns the in-memory presentation of a thread, not its durable outcome. */
export function createChatViewProjection(msgs: ChatMessage[], getAccumulator: () => StreamAccumulatorApi) {
    const messages = ref<UiChatMessage[]>(associateUiToolResultMessages(msgs
        .filter(message => message.role !== 'tool').map(message => ensureUiMessage(message)), msgs));
    const rawMessages = ref<ChatMessage[]>([...msgs]);
    const tailAssistant = ref<UiChatMessage | null>(null);
    /**
     * Purpose:
     * Flushes the in-progress assistant message into the UI list.
     *
     * Behavior:
     * - Adds tail assistant to messages if missing
     * - Clears tail reference afterwards
     *
     * Constraints:
     * - No-op when no tail assistant exists
     */
    function flushTailAssistant() {
        const tail = tailAssistant.value;
        if (!tail) return;
        if (!messages.value.find((m) => m.id === tail.id)) {
            messages.value.push(tail);
        }
        tailAssistant.value = null;
    }

    /**
     * Purpose:
     * Resolves a UI message by id, preferring the tail assistant.
     *
     * Behavior:
     * - Returns tail assistant when ids match
     * - Falls back to messages list
     */
    function resolveUiMessage(messageId: string): UiChatMessage | null {
        if (tailAssistant.value?.id === messageId) return tailAssistant.value;
        return messages.value.find((m) => m.id === messageId) ?? null;
    }

    function syncTailAccumulator(
        messageId: string,
        nextContent: string,
        delta: string
    ): boolean {
        if (tailAssistant.value?.id !== messageId) return false;
        const streamAcc = getAccumulator();
        const streamState = streamAcc.state;
        if (!nextContent) {
            streamAcc.reset();
            return true;
        }

        const currentContent = streamState.text || '';
        const canAppendDelta =
            delta.length > 0 &&
            nextContent.length === currentContent.length + delta.length &&
            nextContent.startsWith(currentContent);

        if (canAppendDelta) {
            streamAcc.append(delta, { kind: 'text' });
            return true;
        }

        streamAcc.reset();
        streamAcc.append(nextContent, { kind: 'text' });
        return true;
    }

    /**
     * Purpose:
     * Applies a local text edit to in-memory message state.
     *
     * Behavior:
     * - Updates raw and UI message caches
     * - Updates tail assistant if it matches
     *
     * Constraints:
     * - Does not persist to IndexedDB
     */
    function applyLocalEdit(id: string, text: string) {
        let updated = false;
        const rawIdx = rawMessages.value.findIndex((m) => m.id === id);
        const raw = rawIdx !== -1 ? rawMessages.value[rawIdx] : undefined;
        if (raw) {
            if (Array.isArray(raw.content)) {
                raw.content = raw.content.map((p) =>
                    p.type === 'text' ? { ...p, text } : p
                );
            } else {
                raw.content = text;
            }
            rawMessages.value = [...rawMessages.value];
            updated = true;
        }
        const uiIdx = messages.value.findIndex((m) => m.id === id);
        if (uiIdx !== -1) {
            const uiMsg = messages.value[uiIdx];
            if (uiMsg) {
                uiMsg.text = text;
                messages.value = [...messages.value];
                updated = true;
            }
        }
        if (tailAssistant.value?.id === id) {
            tailAssistant.value.text = text;
            updated = true;
        }
        return updated;
    }

    /** Atomically replaces both provider and presentation history projections. */
    function replaceCanonicalHistory(nextMessages: ChatMessage[]) {
        const previousById = new Map(messages.value.map((message) => [message.id, message]));
        const nextRaw = nextMessages.map((message) => ({ ...message }));
        const nextUi = nextRaw
            .filter((message) => message.role !== 'tool')
            .map((message) => ensureUiMessage(message));
        rawMessages.value = nextRaw;
        messages.value = associateUiToolResultMessages(nextUi, nextRaw).map((message) => {
            // A canonical refresh can change storage/provider fields without
            // changing this row's presentation. Keep those mounted rows idle;
            // new metadata references and removed fields still replace the row.
            const previous = previousById.get(message.id);
            const keys = Reflect.ownKeys(message);
            if (previous && keys.length === Reflect.ownKeys(previous).length &&
                keys.every((key) => Object.hasOwn(previous, key) &&
                    Object.is(Reflect.get(previous, key), Reflect.get(message, key)))) {
                return previous;
            }
            return message;
        });
    }

    return { messages, rawMessages, tailAssistant, flushTailAssistant, resolveUiMessage,
        syncTailAccumulator, applyLocalEdit, replaceCanonicalHistory };
}
