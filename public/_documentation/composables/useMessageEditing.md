# useMessageEditing

Encapsulates the UI + persistence flow for editing a chat message. Handles toggling edit mode, keeping a draft buffer, and writing the updated content back to Dexie.

---

## What it handles

`useMessageEditing` wraps all state required for an inline message editor:

-   Tracks whether the message is currently being edited
-   Keeps a draft copy of the text with undo (cancel) support
-   Persists the change to the `messages` table via `upsert`
-   Works with plain objects or `Ref`-wrapped messages (streaming tail vs finalized)

---

## Quick example

```ts
import { useMessageEditing } from '~/composables/chat/useMessageEditing';

const props = defineProps<{ message: UiChatMessage }>();
const editing = useMessageEditing(props.message);

function onSave() {
    editing.saveEdit();
}
```

In a template you can wire the state like this:

```vue
<template>
    <div v-if="editing.editing.value" class="message-editor">
        <textarea v-model="editing.draft.value" rows="3" class="retro-input" />
        <div class="flex gap-2 mt-2">
            <button
                class="retro-btn"
                :disabled="editing.saving.value"
                @click="editing.saveEdit"
            >
                Save
            </button>
            <button
                class="retro-btn"
                :disabled="editing.saving.value"
                @click="editing.cancelEdit"
            >
                Cancel
            </button>
        </div>
    </div>
    <div v-else>
        {{ props.message.text }}
        <button class="retro-btn" @click="editing.beginEdit">Edit</button>
    </div>
</template>
```

---

## API

| Property / Method | Type                  | Description                                                             |
| ----------------- | --------------------- | ----------------------------------------------------------------------- |
| `editing`         | `Ref<boolean>`        | `true` while the UI is in edit mode.                                    |
| `draft`           | `Ref<string>`         | Draft text bound to the editor input.                                   |
| `original`        | `Ref<string>`         | Snapshot of the message content before editing (used for cancel).       |
| `saving`          | `Ref<boolean>`        | `true` while the composable is persisting the update.                   |
| `beginEdit()`     | `() => void`          | Initialise draft/original values and switch to edit mode.               |
| `cancelEdit()`    | `() => void`          | Exit edit mode without saving, resetting buffers.                       |
| `saveEdit()`      | `() => Promise<void>` | Persist trimmed draft text to Dexie and update the live message object. |

### Message input contract

The `message` argument can be:

-   A `UiChatMessage` object with `text` and/or `content`
-   A `Ref` wrapping such an object (useful when the message swaps underneath, e.g., streaming tail to stored message)

`saveEdit()` writes the new text to both `content` and `text` if present so renderers stay in sync.

---

## Under the hood

1. **Message accessor** — `getMessage()` unwraps refs and returns the latest object before each action.
2. **Draft prep** — `beginEdit()` pulls the existing content from `message.content` or falls back to `message.text`.
3. **Persistence** — `saveEdit()` fetches the stored record via `db.messages.get(id)` and calls `upsert.message(...)` with the updated text and `updated_at` timestamp.
4. **State updates** — After persistence, it updates the in-memory message object so the UI reflects the new content immediately.
5. **Guard rails** — Empty drafts short-circuit to `cancelEdit()`. Missing IDs abort silently.

---

## Tips & edge cases

-   **Streaming messages**: Because it accepts refs, you can start editing a message that transitions from “tail” to finalized without losing the editor state.
-   **Concurrent edits**: `saving` prevents duplicate writes; external overrides should listen for `saving.value` before issuing new edits.
-   **No-op on blank**: Saving trims whitespace; if the result is empty it cancels instead of writing an empty record.
-   **Error handling**: Errors during persistence are caught by the `try/finally` block—state resets `saving` back to `false`, but you might want to wrap `saveEdit()` in a try/catch to display UI feedback.

---

## Related composables

-   `useMessageActions` — expose an “Edit” action that toggles this composable.
-   `useChat` — source of `UiChatMessage` records this composable edits.
-   `~/db/upsert` — the Dexie helper invoked during `saveEdit()`.
