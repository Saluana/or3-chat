# requirements.md

artifact_id: 9f1b8d83-3c9c-4d4c-9f7a-9f5f3ec8a7c4

## Introduction

Add a minimal TipTap-based document editor to the existing chat app. Users can create, view, and edit simple rich-text documents (paragraphs, headings, bold/italic/underline/code, bullet & ordered lists, horizontal rule, undo/redo). Documents open inside panes just like chats so a user can split-screen a chat and a document (or multiple documents). Keep scope intentionally small: no collaborative editing, no complex schema migrations, no version history right now.

## Requirements

### 1. Create Documents

User Story: As a user, I want to create a new document so that I can take notes while chatting.
Acceptance Criteria:

-   WHEN the user clicks a "New Document" action in the sidebar or pane toolbar THEN a new blank document SHALL be created locally with an auto-generated id, default title "Untitled" and empty content.
-   WHEN creation succeeds THEN the document SHALL appear in the documents list/tree immediately.
-   IF creation fails (Dexie/db error) THEN an error toast SHALL display and no partial document is left referenced in UI.

### 2. Open / Edit Document In Pane

User Story: As a user, I want to open a document in a pane so that I can read or edit it beside a chat.
Acceptance Criteria:

-   WHEN a document is selected from the sidebar THEN it SHALL load into the active pane (reusing multi-pane infra) with its title and content.
-   WHEN switching panes THEN each pane SHALL retain its own currently opened document or chat thread id without interference.
-   IF the pane already has unsaved edits and the user opens a different document THEN pending edits SHALL be auto-saved first (best effort) before loading the new one.
-   IF a document id does not exist or is deleted THEN the pane SHALL show a not-found placeholder and offer a back action.

### 3. Basic Rich Text Editing

User Story: As a user, I want simple formatting tools so that I can structure my notes.
Acceptance Criteria:

-   Toolbar SHALL provide: Bold, Italic, Code, Heading toggle (H1/H2/Paragraph), Bullet List, Ordered List, Horizontal Rule, Undo, Redo.
-   Keyboard shortcuts (native TipTap defaults) SHALL work (e.g., Mod-B, Mod-I, Mod-Z/Y).
-   Selection based formatting state SHALL reflect active mark/block (button active style) within 100ms of selection change.
-   Editor content SHALL auto-save (debounced <= 1s idle) after changes.

### 4. Title Editing

User Story: As a user, I want to rename a document so that I can identify it later.
Acceptance Criteria:

-   Title field SHALL be inline editable (single-line input) above the editor.
-   Title changes SHALL persist using same debounce as body content.
-   IF user clears title to empty THEN it SHALL revert to "Untitled" on save.

### 5. Persistence & Data Model

User Story: As a developer, I want to store documents consistently so the feature stays maintainable.
Acceptance Criteria:

-   Document schema SHALL reuse existing `posts` or a new minimal `documents` table/file as already stubbed (`documents.ts`). We'll store: id, title, content (JSON from TipTap), created_at, updated_at, deleted flag.
-   Storage format for content SHALL be TipTap JSON (not HTML) for simplicity.
-   Updated_at SHALL update on each persisted change.

### 6. Auto Save & Feedback

User Story: As a user, I want confidence my edits are saved.
Acceptance Criteria:

-   A subtle status text ("Saved" / "Saving…") SHALL reflect debounce cycle.
-   IF save fails THEN status SHALL show "Error" and a retry occurs automatically on next edit.

### 7. Pane Integration

User Story: As a user, I want the document editor to behave like chats in panes.
Acceptance Criteria:

-   Each pane SHALL track whether it is displaying a chat thread or a document (mutually exclusive).
-   Switching active pane SHALL not unload background pane editors.
-   Closing a pane with unsaved edits SHALL attempt an immediate flush save.

### 8. Minimal Navigation / Listing

User Story: As a user, I want to find my documents.
Acceptance Criteria:

-   Sidebar SHALL list documents by updated_at desc with their title.
-   Clicking an item SHALL open it in active pane.
-   New document SHALL appear at top after first save.

### 9. Performance / Non-Functional

Acceptance Criteria:

-   Initial editor mount SHALL complete in < 200ms on a typical modern laptop (single instantiation) excluding dependency download.
-   Debounced save SHALL not trigger more than 1 write per 750ms of continuous typing.
-   No blocking operations on the main thread longer than 16ms in common actions (format toggle, typing).

### 10. Error Handling

Acceptance Criteria:

-   Any Dexie failures SHALL be caught and surfaced via toast with message prefix "Document: ".
-   Corrupt JSON content (parse error) SHALL fallback to empty doc without crashing pane.

### 11. Out of Scope (Explicit)

-   Real-time collaboration
-   Multi-user sync
-   Version history / diffing
-   Full-text search indexing (future)
-   Embedding documents inside chats automatically
