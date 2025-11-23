import { ref, isRef, type Ref } from 'vue';
import { upsert } from '~/db';
import { nowSec } from '~/db/util';

/**
 * Editable message interface
 */
export interface EditableMessage {
    id?: string;
    content?: string;
    text?: string;
    [key: string]: unknown;
}

// Lightweight composable for editing a chat message (assistant/user)
export function useMessageEditing(message: EditableMessage | Ref<EditableMessage>) {
    // Support passing a Ref so caller can swap underlying message object (e.g., streaming tail -> finalized)
    const getMessage = (): EditableMessage => (isRef(message) ? message.value : message);
    const editing = ref(false);
    const draft = ref('');
    const original = ref('');
    const saving = ref(false);

    function beginEdit() {
        if (editing.value) return;
        // Some message objects use .text (UiChatMessage), others .content; fall back gracefully.
        const m = getMessage();
        const base =
            typeof m?.content === 'string'
                ? m.content
                : typeof m?.text === 'string'
                ? m.text
                : '';
        original.value = base;
        draft.value = base;
        editing.value = true;
    }
    function cancelEdit() {
        if (saving.value) return;
        editing.value = false;
        draft.value = '';
        original.value = '';
    }
    async function saveEdit() {
        if (saving.value) return;
        const m = getMessage();
        const id = m?.id;
        if (!id) return;
        const trimmed = draft.value.trim();
        if (!trimmed) {
            cancelEdit();
            return;
        }
        try {
            saving.value = true;
            const { db } = await import('~/db/client');
            const existing = await db.messages.get(id);
            if (!existing) throw new Error('Message not found');
            await upsert.message({
                ...existing,
                data: { 
                    ...(typeof existing.data === 'object' && existing.data !== null ? existing.data : {}), 
                    content: trimmed 
                },
                updated_at: nowSec(),
            });
            // Persist to both fields so renderers using either stay in sync
            if (m) {
                (m as EditableMessage).content = trimmed;
                if ('text' in m) (m as EditableMessage).text = trimmed;
            }
            editing.value = false;
        } finally {
            saving.value = false;
        }
    }
    return {
        editing,
        draft,
        original,
        saving,
        beginEdit,
        cancelEdit,
        saveEdit,
    };
}
