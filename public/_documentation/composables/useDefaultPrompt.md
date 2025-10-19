# useDefaultPrompt

Central helper for tracking the default system prompt across chat panes. It wraps the `kv` table, keeps a singleton ref of the active prompt ID, and fires hooks when the default changes so other modules can react.

---

## Purpose

`useDefaultPrompt` gives you a reactive `defaultPromptId` alongside helpers to set or clear it. Behind the scenes it reads from Dexie on first use, stores the value in `kv` under `default_system_prompt_id`, and triggers a hook so panes refresh their copy.

-   Loads once per session (client-side) and caches the id in a shared ref
-   Keeps mutations synced to IndexedDB + in-memory state
-   Exposes `clearDefaultPrompt()` and `ensureLoaded()` helpers
-   Provides a `getDefaultPromptId()` utility for low-level access

---

## Quick start

```ts
import { useDefaultPrompt } from '~/composables/chat/useDefaultPrompt';

const { defaultPromptId, setDefaultPrompt, clearDefaultPrompt } =
    useDefaultPrompt();

watch(defaultPromptId, (id) => {
    console.log('Default prompt is now', id ?? 'not set');
});

await setDefaultPrompt('prompt-123');
// ... later
await clearDefaultPrompt();
```

---

## API

| Member                 | Type                                    | Description                                                           |
| ---------------------- | --------------------------------------- | --------------------------------------------------------------------- |
| `defaultPromptId`      | `ReadonlyRef<string \| null>`           | Reactive id for the default system prompt (or `null`).                |
| `setDefaultPrompt(id)` | `(id: string \| null) => Promise<void>` | Persist a new default prompt id (or `null`) and broadcast hook event. |
| `clearDefaultPrompt()` | `() => Promise<void>`                   | Convenience alias for `setDefaultPrompt(null)`.                       |
| `ensureLoaded()`       | `() => Promise<void>`                   | Force-load the cached value (useful during SSR guards).               |

### Standalone helper

| Function               | Description                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- |
| `getDefaultPromptId()` | Async function that reads directly from Dexie and returns the stored id without touching the singleton store. |

---

## How it works

1. **Singleton state** — The ref `_defaultPromptId` lives at module scope, so every caller shares the same reactive value.
2. **Lazy load** — `loadOnce()` reads `kv` only the first time a browser caller uses the composable. On SSR it no-ops because Dexie isn’t available.
3. **Updates** — `setDefaultPrompt()` updates the ref, persists via `setKvByName`, then fires `chat.systemPrompt.default:action:update` with the new id so listeners refresh.
4. **Clearing** — `clearDefaultPrompt()` simply calls `setDefaultPrompt(null)`.
5. **Direct access** — `getDefaultPromptId()` is exported for non-reactive flows (e.g. server actions) that just need the value once.

---

## Usage patterns

### Create a settings toggle

```ts
const { defaultPromptId, setDefaultPrompt } = useDefaultPrompt();

async function applyPrompt(promptId: string) {
    await setDefaultPrompt(promptId);
}
```

### Guard before loading prompt content

```ts
const { ensureLoaded, defaultPromptId } = useDefaultPrompt();

await ensureLoaded();
if (defaultPromptId.value) {
    await loadPrompt(defaultPromptId.value);
}
```

### Server-side lookup

```ts
import { getDefaultPromptId } from '~/composables/chat/useDefaultPrompt';

const promptId = await getDefaultPromptId();
if (promptId) {
    // fetch prompt details from db
}
```

---

## Edge cases & notes

-   **Client-only loading** — The composable guards on `import.meta.client`; SSR imports will see `defaultPromptId` remain `null` until the client hydrates.
-   **Missing record** — If the key isn’t present, the ref is set to `null` and no errors bubble up.
-   **Hook listeners** — Consumers can subscribe with `useHooks().addAction('chat.systemPrompt.default:action:update', handler)` to respond whenever the default changes.
-   **Error handling** — Storage read/write operations are wrapped in try/catch; failures simply keep the ref at `null`.

---

## Related references

-   `useActivePrompt` — to manage prompt details once you have the id.
-   `~/db/kv` — utility wrapping Dexie’s key-value store.
-   `chat.systemPrompt.default:action:update` — hook dispatched after every update.
