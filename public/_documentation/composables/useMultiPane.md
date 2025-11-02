# useMultiPane

State manager that powers OR3’s multi-pane chat/document workspace. It keeps the active pane list, loads messages on demand, enforces pane limits, and fires hook events so plugins can react to pane lifecycle changes.

---

## What does it do?

`useMultiPane` centralises all window management logic outside the UI layer:

-   Creates, focuses, and closes panes with automatic fallback when the last pane would disappear
-   Loads chat message history for each pane (with Dexie-backed fallback)
-   Tracks the active pane index, preventing focus bugs
-   Emits hook events for pane open/close/switch so extensions stay in sync
-   Supports a configurable pane cap, custom message loaders, and document flush callbacks
-   Launches registered custom pane apps while enforcing pane limits

---

## Basic Example

```ts
import { useMultiPane } from '~/composables/core/useMultiPane';

const multiPane = useMultiPane({ initialThreadId: 'thread-123', maxPanes: 4 });

multiPane.addPane();
await multiPane.setPaneThread(1, 'thread-456');
multiPane.setActive(1);
```

---

## How to use it

### 1. Create the store

```ts
const multiPane = useMultiPane({
    initialThreadId: '',
    maxPanes: 3,
    onFlushDocument: async (docId) => {
        await saveDraft(docId);
    },
});
```

### 2. Bind to UI

Use `multiPane.panes` to render your pane tabs and `multiPane.activePaneIndex` to highlight the current one. Buttons can call `addPane`, `closePane(i)`, or `setActive(i)`.

### 3. Load or switch chats

Hook `setPaneThread(index, threadId)` to any thread picker.

```ts
await multiPane.setPaneThread(activeIndex.value, selectedThreadId);
```

### 4. Keyboard shortcuts

`focusPrev(current)` and `focusNext(current)` make it easy to wire ⌥← / ⌥→ navigation.

### 5. Open custom pane apps

Launch a registered pane app (see `usePaneApps`) with optional initial record reuse.

```ts
await multiPane.newPaneForApp('custom-todo', { initialRecordId: todoId });
```

### 6. Keep at least one pane alive

Call `ensureAtLeastOne()` if you manipulate `panes` directly (rare, but handy in dev tools).

---

## API

```ts
const multiPane = useMultiPane(options?: UseMultiPaneOptions);
```

| Option            | Type                                                | Description                                                      |
| ----------------- | --------------------------------------------------- | ---------------------------------------------------------------- |
| `initialThreadId` | `string`                                            | Starting thread for the first pane (empty string for new chat).  |
| `maxPanes`        | `number`                                            | Maximum simultaneous panes (default `3`).                        |
| `onFlushDocument` | `(id: string) => void \| Promise<void>`             | Called before closing a document pane so you can persist drafts. |
| `loadMessagesFor` | `(threadId: string) => Promise<MultiPaneMessage[]>` | Override message loader (defaults to Dexie query).               |

### Returned object

| Property / Method                | Type                                                                    | Purpose                                                                             |
| -------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `panes`                          | `Ref<PaneState[]>`                                                      | Reactive list of panes in open order.                                               |
| `activePaneIndex`                | `Ref<number>`                                                           | Index of the currently focused pane.                                                |
| `canAddPane`                     | `ComputedRef<boolean>`                                                  | `true` when below `maxPanes`.                                                       |
| `newWindowTooltip`               | `ComputedRef<string>`                                                   | Pre-baked tooltip text for “new pane” buttons.                                      |
| `addPane()`                      | `() => void`                                                            | Append a blank pane and focus it.                                                   |
| `closePane(index)`               | `(index: number) => Promise<void> \| void`                              | Close a pane; never removes the last one.                                           |
| `setActive(index)`               | `(index: number) => void`                                               | Mark a pane as focused, firing switch hooks.                                        |
| `focusPrev(current)`             | `(current: number) => void`                                             | Focus the previous pane if available.                                               |
| `focusNext(current)`             | `(current: number) => void`                                             | Focus the next pane if available.                                                   |
| `setPaneThread(index, threadId)` | `(index: number, threadId: string) => Promise<void>`                    | Load messages for a chat and attach it to the pane. Pass `''` to clear.             |
| `loadMessagesFor`                | `(threadId: string) => Promise<MultiPaneMessage[]>`                     | Exposed loader (useful for tests).                                                  |
| `ensureAtLeastOne()`             | `() => void`                                                            | Guarantees at least one pane exists.                                                |
| `newPaneForApp(appId, opts?)`    | `(appId: string, opts?: { initialRecordId?: string }) => Promise<void>` | Opens a pane for a registered custom pane app, optionally reusing a record.         |
| `updatePane(index, updates)`     | `(index: number, updates: Partial<PaneState>) => void`                  | Mutates pane metadata (e.g., `mode`, `documentId`) while keeping reactivity intact. |

`PaneState` consists of:

```ts
interface PaneState {
    id: string;
    mode: 'chat' | 'doc' | string; // Custom pane apps can extend mode with their own identifiers
    threadId: string;
    documentId?: string;
    messages: MultiPaneMessage[];
    validating: boolean;
}
```

> **Note:** The `mode` field accepts `'chat'` and `'doc'` for built-in pane types. Custom pane apps can register with arbitrary mode identifiers; see the [Custom Pane Apps](../../custom-pane-apps.md) guide for details.

---

## Under the hood

1. **Pane creation** — `createEmptyPane()` generates a UUID (via `crypto.randomUUID` fallback) and seeds a blank chat pane.
2. **Message loading** — The default loader queries Dexie for non-deleted messages, normalises content/reasoning text, and returns a lightweight list suited for pane previews.
3. **Hooks integration** — Every major action (`open`, `close`, `switch`, `active`, `blur`, thread changes) dispatches hook events so plugins and side panels can respond.
4. **Focus logic** — `setActive` handles focus order, blur hooks, and ensures active index stays in range when panes close.
5. **Global exposure** — Stores the API on `globalThis.__or3MultiPaneApi` so extensions or devtools can orchestrate panes externally.

---

## Edge cases & tips

-   **Thread veto**: Filters registered on `ui.pane.thread:filter:select` can return `false` to block a thread switch.
-   **Document panes**: When `mode === 'doc'` and `documentId` is set, `closePane` calls `onFlushDocument` before removing the pane—use it to save unsaved edits.
-   **Pane limit**: `addPane()` silently no-ops once `maxPanes` is reached; pair with `canAddPane` to disable UI affordances.
-   **Custom modes**: `newPaneForApp` sets `mode` to the app id, so use `updatePane` if your app needs to adjust metadata after loading.
-   **Hot reload**: On HMR the latest instance overwrites `__or3MultiPaneApi`, so developer tooling always hits the freshest store.
-   **Testing**: Pass `loadMessagesFor` to inject fixtures without touching Dexie.

---

## Related

-   `usePanePrompt` — tracks pending system prompts per pane.
-   `useChat` — main consumer of pane message state.
-   Hooks: `ui.pane.*` actions/filters documented in `docs/core-hook-map.md`.
