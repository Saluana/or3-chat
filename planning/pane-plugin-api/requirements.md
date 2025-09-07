# requirements.md

artifact_id: 4c6d8a8d-8c0d-4442-9ec9-9d2e00f8c9e4

## Introduction

Provide a **minimal, low‑overhead plugin API** allowing a plugin to (a) send a chat message into a specific pane (creating a thread if needed) and (b) mutate the currently open document content or title in a pane. Emphasis: _simplicity, tiny surface, zero unnecessary abstraction, minimal lines of code, leverage existing composables/state._

## Requirements

### 1. Plugin can send a chat message to an existing chat thread pane

User Story: As a plugin developer, I want to send a message into a pane that already has a chat thread, so that my plugin can inject system or helper messages.
Acceptance Criteria:

-   WHEN a plugin calls `paneApi.sendMessage({ paneId, text })` AND the target pane is mode `chat` with a valid threadId THEN the system SHALL append a user-role message (or assistant if specified) using existing `tx.appendMessage` + `useChat` hooks pipeline.
-   IF `paneId` not found OR pane not in `chat` mode OR has no `threadId` THEN the call SHALL reject with an error object `{ code: 'pane_not_chat' | 'not_found' | 'no_thread' }`.
-   IF message append succeeds THEN SHALL trigger normal pane message sent hooks (`ui.pane.msg:action:sent`).

### 2. Plugin can send a chat message creating a new thread in a chat pane without one

User Story: As a plugin developer, I want to send a message into a chat pane that is empty (no thread yet), so that I can bootstrap conversations.
Acceptance Criteria:

-   WHEN `paneApi.sendMessage({ paneId, text, createIfMissing: true })` is called on a `chat` pane with empty `threadId` THEN system SHALL create a new thread (reuse existing create.thread) and bind it to pane before appending the message.
-   SHALL emit `ui.pane.thread:action:changed` followed by `ui.pane.msg:action:sent`.
-   IF `createIfMissing` is false (or omitted) and pane has no thread THEN SHALL reject `{ code: 'no_thread' }`.

### 3. Plugin can edit (replace) the current document content JSON in a doc pane

User Story: As a plugin developer, I want to replace the open document content with generated structured content, so users see immediate changes.
Acceptance Criteria:

-   WHEN `paneApi.updateDocumentContent({ paneId, content })` called AND pane is `doc` with `documentId` THEN system SHALL set pending content and schedule save (existing `setDocumentContent`).
-   SHALL NOT immediately flush; debounce stays intact.
-   IF invalid pane or not doc mode or missing id -> reject with `{ code: 'pane_not_doc' | 'not_found' | 'no_document' }`.

### 4. Plugin can patch (merge) partial document content

User Story: As a plugin developer, I want to shallow merge into existing document JSON (e.g. append a paragraph) without rewriting whole tree.
Acceptance Criteria:

-   WHEN `paneApi.patchDocumentContent({ paneId, patch })` THEN system SHALL fetch current doc JSON, perform shallow merge at top-level `content` array (concatenate if both arrays) else assign keys, then schedule save.
-   IF base content missing or not an object THEN treat as empty doc root `{ type:'doc', content:[] }`.

### 5. Plugin can change the document title

User Story: As a plugin developer, I want to set a new title for the open document for clarity.
Acceptance Criteria:

-   WHEN `paneApi.setDocumentTitle({ paneId, title })` on doc pane THEN SHALL call existing `setDocumentTitle` and schedule save.

### 6. Basic permission / safety guard

User Story: As a maintainer, I want minimal safety so malicious plugins cannot spam silently.
Acceptance Criteria:

-   SHALL require passing a short `source` string argument (plugin id) for each mutating call; if absent -> reject `{ code: 'missing_source' }`.
-   SHALL emit a dev console log summarizing mutation including source and target pane/thread/doc id in dev mode only.

### 7. Error handling consistency

User Story: As a plugin developer, I want predictable errors.
Acceptance Criteria:

-   All rejections SHALL return `{ ok:false, code, message }` objects.
-   Success responses SHALL return `{ ok:true, ...payload }`.

### 8. Lightweight exposure

User Story: As a plugin developer, I need an easy entry point.
Acceptance Criteria:

-   API SHALL be attached to `globalThis.__or3PanePluginApi` with methods only (no classes), created once.
-   Size: Added code SHALL NOT exceed ~120 lines including helpers & types (excluding comments) ideally.

### 9. Hooks integration transparency

User Story: As a plugin developer, I expect existing hooks to fire normally.
Acceptance Criteria:

-   Message injections SHALL go through existing append logic so downstream hooks see them.
-   Document mutations SHALL rely on `setDocumentContent` / `setDocumentTitle` so autosave & saved hooks occur.

### 10. No additional dependencies

Acceptance Criteria:

-   SHALL use only existing composables and db utilities; no new external packages.

### 11. TypeScript minimal types

Acceptance Criteria:

-   SHALL expose `PanePluginApi` TypeScript interface colocated with implementation for easy import.

### 12. Non-functional: simplicity & performance

Acceptance Criteria:

-   Critical path operations (sendMessage & doc update) SHALL be O(1) over panes.
-   No extra watchers / reactive overhead introduced.
