# useMessageActions

Extensible action registry for chat messages. Lets core UI and plugins add contextual buttons (copy, retry, favorite, etc.) in a consistent order with minimal wiring.

---

## Purpose

`useMessageActions` maintains a global list of action descriptors keyed by an id. Components register their actions once, and when rendering an individual message you can pull the filtered, sorted list for that message’s role.

-   Stores actions in a singleton Map (survives HMR)
-   Exposes helpers to register/unregister actions
-   Provides a computed list scoped to user or assistant messages
-   Supports ordering via an optional `order` property (default 200)

---

## Registering an action

```ts
import { registerMessageAction } from '~/composables/chat/useMessageActions';

registerMessageAction({
    id: 'copy-text',
    icon: 'i-heroicons-clipboard-document',
    tooltip: 'Copy to clipboard',
    showOn: 'assistant',
    order: 150,
    async handler({ message }) {
        await navigator.clipboard.writeText(message.text);
    },
});
```

Built-in actions from core components typically use orders below 200. Plugins can pick `order >= 200` to appear after defaults unless they intentionally override.

---

## API

| Export                             | Type                                                                             | Description                                                           |
| ---------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `registerMessageAction(action)`    | `(action: ChatMessageAction) => void`                                            | Add or replace an action descriptor in the registry.                  |
| `unregisterMessageAction(id)`      | `(id: string) => void`                                                           | Remove an action by id (optional cleanup).                            |
| `useMessageActions(message)`       | `(message: { role: 'user' \| 'assistant' }) => ComputedRef<ChatMessageAction[]>` | Get a computed, role-filtered, ordered list for a specific message.   |
| `listRegisteredMessageActionIds()` | `() => string[]`                                                                 | Return all registered ids (useful for debugging or collision checks). |

### `ChatMessageAction`

```ts
interface ChatMessageAction {
    id: string;
    icon: string;
    tooltip: string;
    showOn: 'user' | 'assistant' | 'both';
    order?: number; // defaults to 200
    handler: (ctx: { message: any; threadId?: string }) => void | Promise<void>;
}
```

---

## Using in a component

```vue
<template>
    <div class="message-actions">
        <UButton
            v-for="action in actions"
            :key="action.id"
            :icon="action.icon"
            variant="ghost"
            size="xs"
            :aria-label="action.tooltip"
            @click="action.handler({ message, threadId })"
        />
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useMessageActions } from '~/composables/chat/useMessageActions';

const props = defineProps<{
    message: { role: 'user' | 'assistant'; id: string };
}>();
const threadId = useCurrentThreadId();

const actionsComputed = useMessageActions(props.message);
const actions = computed(() => actionsComputed.value);
</script>
```

---

## Internals

1. **Registry Map** — Stored on `globalThis` so repeated imports share data even with HMR.
2. **Reactive mirror** — A `reactiveList` array mirrors the Map contents so Vue can track changes. Every register/unregister call re-syncs the array.
3. **Computed filtering** — `useMessageActions` filters `reactiveList.items` based on `showOn` and sorts by `order ?? 200`.
4. **Cleanup** — `unregisterMessageAction` helps modules remove actions when disabled or disposed.

---

## Tips & edge cases

-   **ID collisions**: registering with an existing `id` overwrites the previous action; use `listRegisteredMessageActionIds()` to audit.
-   **Async handlers**: You can return promises; the caller decides whether to await or fire-and-forget.
-   **Context object**: `handler` receives `{ message, threadId }`; extend as needed but keep the shape consistent for plugin compatibility.
-   **Role filtering**: Use `showOn: 'both'` for universal actions (e.g., “pin”), otherwise scope to `user` or `assistant`.

---

## Related modules

-   `ChatMessage.vue` — built-in consumer that renders the buttons.
-   `useMessageEditing` — often paired to expose “Edit message” action.
-   `pane plugin API` — natural spot to add custom actions when a plugin activates.
