/**
 * @module composables/chat/useMessageEditing
 *
 * **Purpose**
 * Provides a lightweight composable for editing chat messages (user or assistant).
 * Manages edit state (draft, original), save operations, and DB persistence. Designed
 * to be used per-message in UI components (not singleton).
 *
 * **Responsibilities**
 * - Track editing state (editing/saving flags)
 * - Maintain draft and original text values
 * - Save edited messages to Dexie DB via `upsert.message`
 * - Update message object in-place after save (for UI sync)
 * - Support both `Ref<EditableMessage>` and plain object sources
 *
 * **Non-responsibilities**
 * - Does NOT re-render message history (caller must watch message object)
 * - Does NOT handle optimistic updates (save is committed before UI reflects)
 * - Does NOT emit hooks (future enhancement if needed)
 * - Does NOT validate message ownership or permissions
 *
 * **State Lifecycle**
 * - `beginEdit()` captures original text and enters edit mode
 * - `draft` ref is bound to UI input (editable by user)
 * - `cancelEdit()` discards changes and exits edit mode
 * - `saveEdit()` persists to DB, updates message object, and exits edit mode
 * - Each composable instance is isolated (not singleton)
 *
 * **Message Object Support**
 * - Accepts `EditableMessage` (plain object or Ref)
 * - Reads from `message.content` or `message.text` (fallback chain)
 * - Writes to both `content` and `text` fields on save for renderer compatibility
 * - Supports reactive message sources (e.g., streaming tail → finalized message)
 *
 * **Error Handling Contract**
 * - If message ID is missing, `saveEdit()` returns early (no-op)
 * - If message not found in DB, throws `Error('Message not found')`
 * - **Caller must catch and handle save errors** (e.g., show toast, log, etc.)
 * - `saving` flag is always reset in finally block (guaranteed cleanup)
 * - Empty drafts are treated as cancel (no save)
 *
 * **UI Expectations**
 * - UI should bind `draft` ref to input field
 * - UI should display loading state via `saving` ref
 * - **UI should catch save errors from `saveEdit()` and show user feedback**
 * - UI should disable cancel/save buttons when `saving` is true
 */

import { ref, isRef, type Ref } from 'vue';
import { upsert } from '~/db';
import { getDb } from '~/db/client';
import { nowSec } from '~/db/util';
import type { Message } from '~/db/schema';

export interface EditableMessage {
    id?: string;
    text?: string;
    content?: string;
}

type EditableMessageSource =
    | EditableMessage
    | Ref<EditableMessage | undefined>
    | undefined;

/**
 * Composable for editing a chat message.
 *
 * **Behavior**
 * - Returns reactive state for editing UI (editing flag, draft text, saving flag)
 * - Provides functions to begin/cancel/save edit operations
 * - Supports reactive message sources (Ref or plain object)
 *
 * **Usage**
 * ```ts
 * const { editing, draft, saving, beginEdit, cancelEdit, saveEdit } = useMessageEditing(message);
 * // bind draft to input, call beginEdit/cancelEdit/saveEdit on user actions
 * ```
 *
 * @param message - Message to edit (EditableMessage, Ref<EditableMessage>, or undefined)
 * @returns Object with reactive state and control functions
 */
export function useMessageEditing(message: EditableMessageSource) {
    // Support passing a Ref so caller can swap underlying message object (e.g., streaming tail -> finalized)
    const getMessage = (): EditableMessage | undefined =>
        isRef(message) ? message.value : message;
    const editing = ref(false);
    const draft = ref('');
    const original = ref('');
    const saving = ref(false);

    /**
     * Begins edit mode.
     *
     * **Behavior**
     * - Captures current message text as `original` and `draft`
     * - Sets `editing` flag to true
     * - Reads from `message.content` or `message.text` (fallback)
     * - Idempotent (no-op if already editing)
     */
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

    /**
     * Cancels edit mode.
     *
     * **Behavior**
     * - Discards draft changes
     * - Exits edit mode (sets `editing` to false)
     * - No-op if currently saving
     */
    function cancelEdit() {
        if (saving.value) return;
        editing.value = false;
        draft.value = '';
        original.value = '';
    }

    /**
     * Saves the edited message to DB.
     *
     * **Behavior**
     * - Validates message ID exists
     * - Trims draft text; treats empty as cancel
     * - Loads existing message from DB
     * - Updates `data.content` field via `upsert.message`
     * - Updates message object in-place (both `content` and `text` fields)
     * - Exits edit mode on success
     *
     * **Error Handling**
     * - Throws `Error('Message not found')` if DB record missing
     * - **Caller must catch and handle errors** (e.g., show toast)
     * - `saving` flag is reset in finally block (guaranteed cleanup)
     *
     * @throws {Error} If message not found in DB
     */
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
            const db = getDb();
            const existing: Message | undefined = await db.messages.get(id);
            if (!existing) throw new Error('Message not found');
            const existingData =
                existing.data && typeof existing.data === 'object'
                    ? (existing.data as Record<string, unknown>)
                    : {};
            await upsert.message({
                ...existing,
                data: { ...existingData, content: trimmed },
                updated_at: nowSec(),
            });
            // Persist to both fields so renderers using either stay in sync
            m.content = trimmed;
            m.text = trimmed;
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
