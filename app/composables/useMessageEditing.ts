import { ref } from 'vue';
import { upsert } from '~/db';
import { nowSec } from '~/db/util';

// Lightweight composable for editing a chat message (assistant/user)
export function useMessageEditing(message: any) {
    const editing = ref(false);
    const draft = ref('');
    const original = ref('');
    const saving = ref(false);

    function beginEdit() {
        if (editing.value) return;
        // Some message objects use .text (UiChatMessage), others .content; fall back gracefully.
        const base =
            typeof message.content === 'string'
                ? message.content
                : typeof message.text === 'string'
                ? message.text
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
        const id = message.id;
        if (!id) return;
        const trimmed = draft.value.trim();
        if (!trimmed) {
            cancelEdit();
            return;
        }
        try {
            saving.value = true;
            const existing: any = await (
                await import('~/db/client')
            ).db.messages.get(id);
            if (!existing) throw new Error('Message not found');
            await upsert.message({
                ...existing,
                data: { ...(existing.data || {}), content: trimmed },
                updated_at: nowSec(),
            });
            // Persist to both fields so renderers using either stay in sync
            message.content = trimmed;
            if ('text' in message) message.text = trimmed;
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
