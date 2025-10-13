# usePaneDocuments

Pane-aware controller that lets the dashboard create or switch documents inside the multi-pane workspace. It glues `useDocumentsStore`, pane state, and hook events into two ergonomic methods.

---

## What does it do?

`usePaneDocuments({ panes, activePaneIndex, createNewDoc, flushDocument })` returns helpers that:

-   Create a fresh document in the active pane while flushing/releasing the previous one.
-   Switch the active pane to a different document, honouring hook vetoes and autosave semantics.
-   Emit `$hooks` actions (`ui.pane.doc:action:saved`, `:changed`) so listeners react to transitions.
-   Reuse `useDocumentState` + `releaseDocument` to keep autosave + memory management consistent.

---

## Basic Example

```ts
import { usePaneDocuments } from '~/composables/documents/usePaneDocuments';
import { useMultiPane } from '~/composables/core/useMultiPane';
import {
    newDocument,
    flush,
} from '~/composables/documents/useDocumentsStore';

const { panes, activePaneIndex } = useMultiPane();

const { newDocumentInActive, selectDocumentInActive } = usePaneDocuments({
    panes,
    activePaneIndex,
    createNewDoc: (initial) => newDocument(initial),
    flushDocument: (id) => flush(id),
});

await newDocumentInActive({ title: 'Meeting notes' });
await selectDocumentInActive(existingDocId);
```

---

## How to use it

### 1. Supply pane + document dependencies

-   `panes` / `activePaneIndex` come from `useMultiPane`.
-   `createNewDoc` should return `{ id }` for the newly created record.
-   `flushDocument` flushes staged changes for a given ID (usually `flush()` from `useDocumentsStore`).

### 2. Create a document in the active pane

`await newDocumentInActive(initial?)`:

-   Flushes + releases the currently bound doc (if any), emitting `ui.pane.doc:action:saved` when staged changes existed.
-   Creates the new record via `createNewDoc`.
-   Runs `ui.pane.doc:filter:select` filters, allowing plugins to veto/redirect.
-   Updates the pane (`mode = 'doc'`, sets `documentId`, clears chat state) and fires `ui.pane.doc:action:changed` with `{ created: true }` metadata.

### 3. Switch the active pane to another document

`await selectDocumentInActive(id)`:

-   Applies the same select filter to allow vetoes.
-   Flushes + saves pending edits on the current doc when switching away and emits the saved action if needed.
-   Releases the previous document state to free memory.
-   Updates the pane bindings and emits `ui.pane.doc:action:changed` with `reason: 'select'`.

### 4. Respect hook vetoes

If any filter returns `false`, both helpers abort without changing the pane. Use this to block navigation when validations fail.

---

## What you get back

| Method | Returns | Description |
| --- | --- | --- |
| `newDocumentInActive(initial?)` | `Promise<{ id: string } \| undefined>` | Creates a doc in the active pane; returns the record summary or `undefined` on failure/veto. |
| `selectDocumentInActive(id)` | `Promise<void>` | Switches the active pane to `id`; no-op if vetoed or invalid. |

Both methods run asynchronously and should be awaited to ensure flushes complete before continuing.

---

## Under the hood

1. **Pane lookup** – Reads the current pane via `panes.value[activePaneIndex.value]`.
2. **Pending change detection** – Uses `useDocumentState()` to check `pendingTitle`/`pendingContent` before emitting saved events.
3. **Hooks integration** – Utilises `useHooks()` to call `applyFilters('ui.pane.doc:filter:select', ...)` and `doAction('ui.pane.doc:action:changed' | '...:saved')`.
4. **Memory cleanup** – Calls `releaseDocument(id, { flush: false })` after switching to avoid lingering TipTap trees.
5. **Resets chat state** – Clears `threadId` and `messages` when moving panes back to document mode.

---

## Edge cases & tips

-   **Null pane**: If no pane exists at the active index, helpers exit early.
-   **Duplicate select**: Selecting the already-active doc short-circuits after reset; no extra hook events fire.
-   **Error suppression**: Internal `try { ... } catch {}` blocks ensure hook misbehaviour doesn’t crash the UX—but you should still log within your own filters/actions.
-   **Testing**: You can stub `createNewDoc` / `flushDocument` to use in Vitest without hitting Dexie.

---

## Related

-   `useDocumentsStore` — provides `flush`, `releaseDocument`, and state inspection.
-   `useMultiPane` — pane state machine consumed by this helper.
-   `~/core/hooks/useHooks` — hook engine used for filters/actions.

---

## TypeScript

```ts
interface UsePaneDocumentsOptions {
    panes: Ref<MultiPaneState[]>;
    activePaneIndex: Ref<number>;
    createNewDoc: (initial?: { title?: string }) => Promise<{ id: string }>;
    flushDocument: (id: string) => Promise<void> | void;
}

interface UsePaneDocumentsApi {
    newDocumentInActive(initial?: { title?: string }): Promise<{ id: string } | undefined>;
    selectDocumentInActive(id: string): Promise<void>;
}
```
