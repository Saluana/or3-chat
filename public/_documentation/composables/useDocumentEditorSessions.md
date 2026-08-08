# useDocumentEditorSessions

Registry of active document editor sessions. Editors register themselves per document and workspace, and other code can find them, wait for them, or ask them to capture content.

## Purpose

The module exports:

-   `registerDocumentEditorSession(session)` — register a session and return an unregister function. Accepts a modern `ActiveDocumentEditorSession` (carrying `documentId`, `paneId`, `tabId`, `captureContent`, `ensureLocalDurability`) or a deprecated legacy session with its own `documentId`.
-   `getDocumentEditorSession(lookup)` — find the session for a `{ paneId, tabId }` lookup.
-   `waitForDocumentEditorSession(lookup, timeoutMs?)` — wait briefly (default 1.5s) for a lazy editor to register after a tab bind.
-   `captureDocumentEditor(documentId)` — call `captureContent` on every session for a document (for legacy pane hosts).
-   `ensureDocumentEditorLocalDurability(documentId)` — flush every session's local durability for a document.
-   `hasActiveDocumentEditor(documentId)` — whether any session is registered.

## Usage

```ts
import { waitForDocumentEditorSession } from '~/composables/documents/useDocumentEditorSessions';

const session = await waitForDocumentEditorSession({ paneId, tabId });
session?.captureContent();
```

## Notes

-   Modern sessions are keyed by `paneId:tabId`, so a tab in a split resolves the right editor.
-   Duplicate registrations for the same key replace the entry.

## Related

-   `useDocumentsStore` — document content and autosave.
-   `useWorkspaceTabs` — tab bindings that trigger editor registration.
