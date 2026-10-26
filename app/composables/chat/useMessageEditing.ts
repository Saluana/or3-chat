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
 * - Save content deltas into the originating workspace's current message row
 * - Update message object in-place after save (for UI sync)
 * - Support both `Ref<EditableMessage>` and plain object sources
 *
 * **Non-responsibilities**
 * - Does NOT re-render message history (caller must watch message object)
 * - Does NOT handle optimistic updates (save is committed before UI reflects)
 * - Does NOT emit hooks (future enhancement if needed)
 * - Does NOT authorize server operations
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

import { ref, isRef, getCurrentScope, onScopeDispose, type Ref } from 'vue';
import { useRuntimeConfig } from '#imports';
import { getCachedSessionContext } from '~/composables/auth/useSessionContext';
import { getDb, getWorkspaceGeneration } from '~/db/client';
import { patchMessageInDb } from '~/db/messages';

/**
 * How a `saveEdit()` call ended:
 * - `saved`: changed text was persisted
 * - `unchanged`: text matches the original; nothing was written
 * - `cancelled`: empty draft; the edit was discarded
 * - `ignored`: nothing ran (a save is in progress, or there is no message id)
 */
export type EditSaveOutcome = 'saved' | 'unchanged' | 'cancelled' | 'ignored';

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
    let disposed = false;
    if (getCurrentScope()) onScopeDispose(() => { disposed = true; });
    // Capture scalar authorization fields: session objects may update in place.
    const identity = () => {
        const session = getCachedSessionContext();
        return JSON.stringify([session?.authenticated, session?.user?.id,
            session?.workspace?.id, session?.role, session?.authorizationRevision]);
    };
    let origin: { db: ReturnType<typeof getDb>; generation: number; identity: string; id?: string } | undefined;
    const assertCurrent = () => {
        const session = getCachedSessionContext();
        if (disposed || !origin || origin.db !== getDb()
            || origin.generation !== getWorkspaceGeneration() || origin.identity !== identity()
            || origin.id !== getMessage()?.id) throw new Error('The originating message is no longer available.');
        if (useRuntimeConfig().public.ssrAuthEnabled === true
            && (!session?.authenticated || !['owner', 'editor'].includes(session.role ?? '')
                || (session.expiresAt && Date.parse(session.expiresAt) <= Date.now()))) {
            throw new Error('Workspace write access is no longer available.');
        }
    };

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
        origin = { db: getDb(), generation: getWorkspaceGeneration(), identity: identity(), id: m.id };
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
     * - Trims draft text; treats empty as cancel (no write)
     * - Text identical to the original exits edit mode without a write
     * - Loads existing message from DB
     * - Patches `data.content` on the latest live row with a live parent thread
     * - Updates message object in-place (both `content` and `text` fields)
     * - Exits edit mode on success
     *
     * **Error Handling**
     * - Throws `Error('Message not found')` if DB record missing
     * - **Caller must catch and handle errors** (e.g., show toast)
     * - `saving` flag is reset in finally block (guaranteed cleanup)
     *
     * @returns How the call ended; only `saved` changed the stored text
     * @throws {Error} If message not found in DB
     */
    // Deleted targets are not retryable; the code selects accurate user copy.
    const notFound = (message: string) => Object.assign(new Error(message), { code: 'ERR_NOT_FOUND' as const });
    async function saveEdit(): Promise<EditSaveOutcome> {
        if (saving.value) return 'ignored';
        const m = getMessage();
        const id = m?.id;
        if (!id) return 'ignored';
        const trimmed = draft.value.trim();
        if (!trimmed) {
            cancelEdit();
            return 'cancelled';
        }
        if (trimmed === original.value.trim()) {
            editing.value = false;
            return 'unchanged';
        }
        try {
            saving.value = true;
            assertCurrent();
            const db = origin!.db;
            const existing = await db.messages.get(id);
            assertCurrent();
            if (!existing || existing.deleted) throw notFound('Message not found');
            const saved = await patchMessageInDb(db, id, { data: { content: trimmed } }, undefined,
                current => {
                    assertCurrent();
                    return Boolean(current && !current.deleted && current.thread_id === existing.thread_id);
                }, undefined, { tables: ['threads'], assertCurrent: async () => {
                    assertCurrent();
                    const thread = await db.threads.get(existing.thread_id);
                    assertCurrent();
                    if (!thread || thread.deleted) throw notFound('Conversation not found');
                } });
            if (!saved) throw notFound('Message not found');
            // A committed write can outlive its presentation owner.
            if (disposed || getMessage() !== m || origin?.db !== getDb()
                || origin.generation !== getWorkspaceGeneration() || origin.identity !== identity()) return 'saved';
            // Persist to both fields so renderers using either stay in sync
            const content = (saved.data as Record<string, unknown> | null)?.content;
            m.content = typeof content === 'string' ? content : trimmed;
            m.text = m.content;
            editing.value = false;
            return 'saved';
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
