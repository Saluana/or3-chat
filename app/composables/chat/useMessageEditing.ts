import { ref, isRef } from 'vue';
import { upsert } from '~/db';
import { nowSec } from '~/db/util';

// Lightweight composable for editing a chat message (assistant/user)
export function useMessageEditing(message: any) {
    // Support passing a Ref so caller can swap underlying message object (e.g., streaming tail -> finalized)
    const getMessage = () => (isRef(message) ? message.value : message);
    const editing = ref(false);
    const draft = ref('');
    const original = ref('');
    const saving = ref(false);

    function beginEdit() {
        if (editing.value) return;
        // Some message objects use .text (UiChatMessage), others .content; fall back gracefully.
        const m = getMessage() || {};
        const base =
            typeof m.content === 'string'
                ? m.content
                : typeof m.text === 'string'
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
            if (m) {
                (m as any).content = trimmed;
                if ('text' in m) (m as any).text = trimmed;
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
