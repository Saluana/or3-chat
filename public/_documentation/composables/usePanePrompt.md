# usePanePrompt

Tiny helper that tracks a “pending system prompt” per pane. It lets the UI stage a prompt that will be applied when the user creates their next thread in that pane.

---

## What does it do?

`usePanePrompt` exposes three functions backed by a reactive map:

-   `setPanePendingPrompt(paneId, promptId)` — stage a prompt identifier
-   `getPanePendingPrompt(paneId)` — read the pending prompt (if any)
-   `clearPanePendingPrompt(paneId)` — forget the association once it’s used

Because the backing store is reactive, other consumers can watch it for UI hints, and HMR/devtools expose the map for inspection.

---

## Basic Example

```ts
import {
    setPanePendingPrompt,
    getPanePendingPrompt,
    clearPanePendingPrompt,
} from '~/composables/core/usePanePrompt';

setPanePendingPrompt('pane-1', 'prompt-active-user');

const pending = getPanePendingPrompt('pane-1');
// => 'prompt-active-user'

clearPanePendingPrompt('pane-1');
```

---

## How to use it

### 1. Stage a prompt when the user picks one

When the prompt selector changes, call `setPanePendingPrompt(paneId, promptId)` so the next thread creation uses it.

### 2. Read before creating a thread

Inside your thread creation flow, read `getPanePendingPrompt(paneId)` and pass the ID to the chat builder if it exists.

### 3. Clear after applying

Once the system prompt is attached to the thread, call `clearPanePendingPrompt(paneId)` to avoid reusing it accidentally.

---

## API

```ts
setPanePendingPrompt(paneId: string, promptId: string | null): void;
getPanePendingPrompt(paneId: string): string | null | undefined;
clearPanePendingPrompt(paneId: string): void;
```

| Function                 | Description                                                                             |
| ------------------------ | --------------------------------------------------------------------------------------- |
| `setPanePendingPrompt`   | Store the prompt ID (or `null` to explicitly clear it).                                 |
| `getPanePendingPrompt`   | Return the stored ID, `null` if explicitly cleared, or `undefined` if it was never set. |
| `clearPanePendingPrompt` | Remove the key entirely from the map.                                                   |

The underlying map lives in a `reactive({})`, so Vue watchers/computed values respond to changes.

---

## Under the hood

1. Keeps a module-level reactive object `pendingByPane` keyed by pane ID.
2. Exported helpers mutate or read that map directly.
3. In dev mode, the map is exposed on `globalThis.__or3PanePendingPrompts` for debugging.

There’s no persistence; entries reset on full reload.

---

## Edge cases & tips

-   **`null` vs `undefined`**: A stored `null` means “explicitly cleared”, while `undefined` means nothing was ever set for that pane.
-   **No SSR concerns**: The composable uses in-memory state only; safe to import anywhere.
-   **Pane lifecycle**: When a pane closes, remember to call `clearPanePendingPrompt` if you want to drop staged prompts immediately.

---

## Related

-   `useMultiPane` — orchestrates pane state and is a natural place to call these helpers.
-   `useActivePrompt` — resolves prompt details once you have the ID.
-   Hooks `ui.pane.thread:action:changed` — good trigger for clearing pending prompts.
