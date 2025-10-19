# useActivePrompt

Reactive composable that manages the currently selected system prompt for chat conversations.

This composable provides a module-singleton selection state (id + content) so multiple components
and composables can read the active system prompt consistently without creating duplicate refs.

It integrates with the local prompt database (`~/db/prompts`) to load prompt content and emits a
hook event after a prompt is selected so other subsystems can react.

---

## Features

-   Shared, readonly reactive `activePromptId` and `activePromptContent` that are visible across
    all consumers in the same Vite/SSR process (module-singleton pattern).
-   `setActivePrompt(id)` loads the prompt from the DB and updates the shared state.
-   Calls the hooks engine: `chat.systemPrompt.select:action:after` with the selected id/content.
-   `clearActivePrompt()` resets the selection to `null`.

---

## Installation

No installation required — the composable is part of the app and can be imported directly:

```ts
import { useActivePrompt } from '~/composables/chat/useActivePrompt';
```

---

## Usage

Basic usage in a component:

```vue
<script setup lang="ts">
import { watch } from 'vue';
import { useActivePrompt } from '~/composables/chat/useActivePrompt';

const {
    activePromptId,
    activePromptContent,
    setActivePrompt,
    clearActivePrompt,
} = useActivePrompt();

// react to changes
watch(activePromptId, (id) => {
    console.log('Active prompt id changed:', id);
});

// select a prompt by id (async)
async function select(id: string) {
    await setActivePrompt(id);
}

// clear selection
function clear() {
    clearActivePrompt();
}
</script>
```

### Example: use in a send-flow

When sending a message you can include the active system prompt like this:

```ts
const { getActivePromptContent } = useActivePrompt();
const systemPrompt = getActivePromptContent();
// attach systemPrompt to the outgoing message payload if present
```

Note: `getActivePromptContent()` returns the raw content value (or `null`) and is synchronous.

---

## API

-   activePromptId: Readonly<Ref<string | null>> — readonly reactive id of the selected prompt.
-   activePromptContent: Readonly<Ref<any | null>> — readonly reactive prompt content loaded from DB.
-   setActivePrompt(id: string | null): Promise<void> — set selection. Passing `null` clears. If the
    id is not found the selection will be cleared.
-   clearActivePrompt(): void — convenience that clears the selection (calls `setActivePrompt(null)`).
-   getActivePromptContent(): any | null — synchronous getter returning the raw content value.

---

## Types

The composable exposes the following TypeScript shape (approx):

```ts
export interface ActivePromptState {
    activePromptId: string | null;
    activePromptContent: any | null;
}

function useActivePrompt(): {
    activePromptId: Readonly<Ref<string | null>>;
    activePromptContent: Readonly<Ref<any | null>>;
    setActivePrompt(id: string | null): Promise<void>;
    clearActivePrompt(): void;
    getActivePromptContent(): any | null;
};
```

---

## Internals & Notes

-   Module-singleton: the composable uses module-scoped `ref`s so every import/consumer shares the
    same state. This is intentional to keep selection consistent across UI components.
-   `setActivePrompt` is asynchronous and will call `getPrompt(id)` from `~/db/prompts`.
-   After a successful selection the composable dispatches a hook action using the app hooks
    engine: `hooks.doAction('chat.systemPrompt.select:action:after', { id, content })`.
-   If the requested prompt id does not exist the composable clears the active selection.
-   Concurrency: callers should await `setActivePrompt` if they depend on the state being updated
    immediately; multiple concurrent calls may race and the last-resolved call wins.
-   Do not mutate `activePromptContent` or `activePromptId` directly — use the provided methods.

### SSR / Client considerations

-   The composable relies on the DB helper `getPrompt` which is typically a client-side data source
    (Dexie/IndexedDB). Avoid calling `setActivePrompt` during server-side rendering. Reading the
    readonly refs is safe but may initially be `null` on the server.

---

## Related

-   `~/db/prompts` — prompt storage and retrieval used by `setActivePrompt`
-   hooks engine — event emitted: `chat.systemPrompt.select:action:after`

---

## Example (full)

```vue
<template>
    <div>
        <div v-if="activePromptContent">Active: {{ activePromptId }}</div>
        <button @click="select('builtin:short_instruct')">
            Select built-in
        </button>
        <button @click="clear">Clear</button>
    </div>
</template>

<script setup lang="ts">
import { useActivePrompt } from '~/composables/chat/useActivePrompt';

const {
    activePromptId,
    activePromptContent,
    setActivePrompt,
    clearActivePrompt,
} = useActivePrompt();

function select(id: string) {
    setActivePrompt(id);
}
function clear() {
    clearActivePrompt();
}

// exported to template
const activePrompt = { activePromptId, activePromptContent, select, clear };
</script>
```

---

Document generated from `app/composables/chat/useActivePrompt.ts` implementation.
