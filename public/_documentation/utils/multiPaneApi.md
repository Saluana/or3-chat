# Multi-Pane API

Global access to the multi-pane layout, plus type-safe helpers for reading pane state. Follows the same singleton pattern as `sidebarLayoutApi`.

The multi-pane API lets any component or plugin reach the active panes without prop drilling. The API instance itself lives on `globalThis`; helpers turn that state into simple answers like "is this document open?".

---

## Purpose

The multi-pane utilities provide:

- **Global API access** — Get or set the shared `UseMultiPaneApi` instance
- **Pane queries** — Active pane list, open document and thread IDs
- **Openness checks** — Safe `isDocumentOpen` / `isThreadOpen` helpers
- **Safe fallbacks** — Empty results when the API is not initialized

---

## Basic Example

```ts
import { isDocumentOpen } from '~/utils/multiPaneHelpers';

if (isDocumentOpen('doc_123')) {
    // A pane already shows this document
}
```

---

## How to use it

### 1. Get the global API

```ts
import { getGlobalMultiPaneApi } from '~/utils/multiPaneApi';

const api = getGlobalMultiPaneApi();
if (api) {
    api.switchToApp('or3-documents', { recordId: 'doc_123' });
}
```

Returns `undefined` before the app initializes the API.

### 2. Set the global API

```ts
import { setGlobalMultiPaneApi } from '~/utils/multiPaneApi';

setGlobalMultiPaneApi(api);        // called by the app during setup
setGlobalMultiPaneApi(undefined);  // cleanup on teardown
```

Usually only the app shell calls this.

### 3. Query pane state without the API

```ts
import {
    getActivePanes,
    getOpenDocumentIds,
    getOpenThreadIds,
} from '~/utils/multiPaneHelpers';

const panes = getActivePanes();          // PaneState[]
const docs = getOpenDocumentIds();       // string[]
const threads = getOpenThreadIds();      // string[]
```

### 4. Check if something is open

```ts
import { isDocumentOpen, isThreadOpen } from '~/utils/multiPaneHelpers';

isDocumentOpen(documentId);   // true when any pane shows the document
isThreadOpen(threadId);       // true when any pane shows the thread
```

---

## API Reference

### `getGlobalMultiPaneApi()`

Return the global multi-pane API, or `undefined` when unset.

```ts
function getGlobalMultiPaneApi(): UseMultiPaneApi | undefined
```

The instance is stored on `globalThis` as `__or3MultiPaneApi`. The
`UseMultiPaneApi` type comes from `~/composables/core/useMultiPane`.

### `setGlobalMultiPaneApi(api)`

Register or clear the global multi-pane API.

```ts
function setGlobalMultiPaneApi(api: UseMultiPaneApi | undefined): void
```

### `getActivePanes()`

Return the current pane state list. Empty array when uninitialized.

```ts
function getActivePanes(): PaneState[]
```

### `getOpenDocumentIds()`

Return document IDs currently open in panes (deduplicated by pane).

```ts
function getOpenDocumentIds(): string[]
```

### `getOpenThreadIds()`

Return thread IDs currently open in panes.

```ts
function getOpenThreadIds(): string[]
```

### `isDocumentOpen(documentId)`

Return `true` when any pane shows the document.

```ts
function isDocumentOpen(documentId: string): boolean
```

### `isThreadOpen(threadId)`

Return `true` when any pane shows the thread.

```ts
function isThreadOpen(threadId: string): boolean
```

---

## How it works

1. The app shell creates the multi-pane composable and registers it via `setGlobalMultiPaneApi`
2. Helpers read the instance from `globalThis`
3. No instance means the layout has not initialized — helpers return empty results instead of throwing
4. Document and thread helpers filter panes by `mode` and map the matching ID field

---

## Important notes

- **Client-side only** — The API exists only in the browser
- **Don't cache the instance** — It may be unset and re-registered during teardown or remounts
- **Read-only helpers** — `multiPaneHelpers` never mutate pane state

---

## Related

- `useMultiPane` — The composable that owns the pane state
- `sidebarLayoutApi` — The sibling singleton pattern for the sidebar
- `usePaneApps` — Application registration for panes

---

## TypeScript

```ts
function getGlobalMultiPaneApi(): UseMultiPaneApi | undefined;
function setGlobalMultiPaneApi(api: UseMultiPaneApi | undefined): void;

function getActivePanes(): PaneState[];
function getOpenDocumentIds(): string[];
function getOpenThreadIds(): string[];
function isDocumentOpen(documentId: string): boolean;
function isThreadOpen(threadId: string): boolean;
```

---

Document generated from `app/utils/multiPaneApi.ts` and `app/utils/multiPaneHelpers.ts` implementations.
