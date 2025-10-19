# useDocumentsStore

Stateful document manager that loads Dexie records, stages edits, debounces autosaves, and coordinates pane-level hooks. It is the backbone for rich text documents in OR3’s multi-pane UI.

---

## Purpose

`useDocumentsStore` exposes a suite of helpers around a shared `documentsMap` cache:

-   Loads documents via `loadDocument()` and caches them per ID.
-   Tracks pending title/content changes and auto-flushes after 750 ms of inactivity.
-   Sends toast notifications when create/load/save actions fail.
-   Emits `$hooks` events (`ui.pane.doc:action:saved`, `:changed`, etc.) so panes stay in sync.
-   Provides low-level helpers like `releaseDocument()` to drop heavy TipTap JSON from memory.

The map lives in module scope, so every component shares the same live state.

---

## Basic Example

```ts
import {
    newDocument,
    loadDocument,
    setDocumentTitle,
    setDocumentContent,
    useDocumentState,
} from '~/composables/documents/useDocumentsStore';

const doc = await newDocument({ title: 'Untitled doc' });

await loadDocument(doc.id);

setDocumentTitle(doc.id, 'My Notes');
setDocumentContent(doc.id, editorStateJSON);

const state = useDocumentState(doc.id);
watch(
    () => state.status,
    (status) => {
        if (status === 'saved') console.log('Document persisted');
    }
);
```

---

## How to use it

### 1. Create or load records

-   Use `newDocument(initial?)` to create a Dexie record and seed the store.
-   Call `loadDocument(id)` to fetch an existing record into memory. The function resolves to the record (or `null` if missing) and surfaces toasts for not-found errors.

### 2. Stage edits

-   `setDocumentTitle(id, title)` and `setDocumentContent(id, content)` mark changes as pending and schedule a save.
-   Saves batch after 750 ms (configurable via `scheduleSave`’s default).

### 3. Flush explicitly when needed

-   Invoke `flush(id)` to force an immediate save, e.g., before navigation.
-   Pass `{ flush: false }` into `releaseDocument()` if you’ve already flushed.

### 4. Observe status

-   `useDocumentState(id)` returns the shared `DocState` (record, status, pending fields, last error).
-   Status cycles through `'loading' → 'idle' → 'saving' → 'saved'` (or `'error'`).

### 5. Release heavy content

Call `releaseDocument(id, { flush?: boolean, deleteEntry?: boolean })` when you leave a pane to reclaim memory. This clears timers, optional flushes, and drops the record reference so the GC can free the TipTap payload.

---

## What you get back

| Helper                            | Description                                                          |
| --------------------------------- | -------------------------------------------------------------------- |
| `newDocument(initial?)`           | Creates a document and primes the store; emits toast on failure.     |
| `loadDocument(id)`                | Fetches from Dexie, updates cache, and returns the record or `null`. |
| `setDocumentTitle(id, title)`     | Marks a new title and schedules a save.                              |
| `setDocumentContent(id, content)` | Stages TipTap JSON and schedules a save.                             |
| `flush(id)`                       | Persists pending fields immediately.                                 |
| `releaseDocument(id, opts?)`      | Clears timers, optionally flushes, and removes cached state.         |
| `useDocumentState(id)`            | Returns the `DocState` entry for reactive inspection.                |
| `useAllDocumentsState()`          | Gives you the reactive map (for debugging tooling).                  |
| `__hasPendingDocumentChanges(id)` | Internal helper to check for staged edits.                           |
| `__peekDocumentStatus(id)`        | Internal helper to read status without touching reactivity.          |

`DocState` looks like:

```ts
interface DocState {
    record: Document | null;
    status: 'idle' | 'saving' | 'saved' | 'error' | 'loading';
    lastError?: any;
    pendingTitle?: string;
    pendingContent?: any;
    timer?: any;
}
```

---

## Under the hood

1. **Shared map** – `documentsMap` (reactive `Map<string, DocState>`) ensures every component edits the same instance.
2. **Debounced saves** – `scheduleSave()` coalesces rapid edits into a single `flush()` invocation.
3. **Dexie helpers** – Uses `createDocument`, `updateDocument`, and `getDocument` from `~/db/documents`.
4. **Toast feedback** – Failures call `useToast().add()` with consistent retro styling.
5. **Pane events** – After `flush()`, the store locates open document panes via the global multi-pane API and triggers `ui.pane.doc:action:saved` events through `$hooks`.
6. **Memory hygiene** – `releaseDocument()` clears timers, removes `content`, and optionally deletes the map entry.

---

## Edge cases & tips

-   **Missing record**: `loadDocument()` returns `null` and shows a toast; callers should handle the `null` case.
-   **Autosave race**: Multiple rapid edits reset the same timer, so only the final state flushes.
-   **Manual flush before unload**: Call `await flush(id)` in route guards/modals to guarantee persistence.
-   **Pane hooks**: Tests or integrations can call `__hasPendingDocumentChanges()` to decide whether to force a save before closing a pane.
-   **Deleting entries**: After releasing with `{ deleteEntry: true }`, calling `useDocumentState(id)` recreates a fresh placeholder.

---

## Related

-   `usePaneDocuments` — orchestrates pane switching on top of this store.
-   `~/composables/core/useMultiPane` — pane runtime referenced when emitting hook actions.
-   `~/db/documents` — Dexie CRUD implementation backing all operations.

---

## TypeScript

```ts
function useDocumentState(id: string): DocState;
function useAllDocumentsState(): Map<string, DocState>;
async function loadDocument(id: string): Promise<Document | null>;
async function newDocument(initial?: {
    title?: string;
    content?: any;
}): Promise<Document>;
function setDocumentTitle(id: string, title: string): void;
function setDocumentContent(id: string, content: any): void;
async function flush(id: string): Promise<void>;
async function releaseDocument(
    id: string,
    opts?: { flush?: boolean; deleteEntry?: boolean }
): Promise<void>;
```
