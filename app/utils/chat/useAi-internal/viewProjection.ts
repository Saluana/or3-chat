import { ref } from 'vue';
import type { StreamAccumulatorApi } from '~/composables/chat/useStreamAccumulator';
import type { ChatMessage } from '~/utils/chat/types';
import { ensureUiMessage, type UiChatMessage } from '~/utils/chat/uiMessages';
import { associateUiToolResultMessages } from '~/utils/chat/transcript';

// Canonical presentation fields contain JSON-like data. Non-plain objects retain
// identity semantics instead of being mistaken for equal empty objects.
function sameValue(a: unknown, b: unknown): boolean {
    if (Object.is(a, b)) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (!Array.isArray(a)) {
        const aPrototype = Object.getPrototypeOf(a);
        const bPrototype = Object.getPrototypeOf(b);
        if ((aPrototype !== Object.prototype && aPrototype !== null) ||
            (bPrototype !== Object.prototype && bPrototype !== null)) return false;
    }
    const keys = Reflect.ownKeys(a);
    return keys.length === Reflect.ownKeys(b).length && keys.every(key =>
        Object.hasOwn(b, key) && sameValue(Reflect.get(a, key), Reflect.get(b, key)));
}

function sameUiMessage(previous: UiChatMessage, next: UiChatMessage): boolean {
    const keys = Reflect.ownKeys(next).filter(key => key !== '_expanded');
    return keys.length === Reflect.ownKeys(previous).filter(key => key !== '_expanded').length &&
        keys.every(key => Object.hasOwn(previous, key) &&
            (key === 'text' ? Object.is(Reflect.get(previous, key), Reflect.get(next, key))
                : sameValue(Reflect.get(previous, key), Reflect.get(next, key))));
}

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
            const previous = previousById.get(message.id);
            if (previous && sameUiMessage(previous, message)) return previous;
            return message;
        });
    }

    return { messages, rawMessages, tailAssistant, flushTailAssistant, resolveUiMessage,
        syncTailAccumulator, applyLocalEdit, replaceCanonicalHistory };
}
