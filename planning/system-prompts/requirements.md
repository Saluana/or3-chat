# requirements.md

artifact_id: 4c9d8c5c-6b68-4c5c-9b9e-8d6b4d3e5b37

## 1. Introduction

Add simple "System Prompts" feature. A System Prompt is a stored rich-text document (TipTap JSON) whose `postType` is `prompt` (parallel to existing `doc`). Users can create, view, select, rename, edit, and soft-delete these prompt records. Selecting a prompt attaches its content as the system message at the top of the active chat thread until changed or cleared. Keep implementation minimal; reuse existing document editor (`DocumentEditor.vue`) and persistence layer patterns with light extension. Provide hook points for customization.

## 2. User Stories & Acceptance Criteria

### 2.1 List Prompts

As a user, I want to open a modal and see all my prompt documents so that I can choose or manage them.
Acceptance Criteria:

-   WHEN the user clicks the "System prompts" button THEN a modal SHALL open listing all non-deleted `postType = 'prompt'` records ordered by `updated_at` desc.
-   IF there are no prompts THEN the modal SHALL show an empty state with a "Create Prompt" button.

### 2.2 Create Prompt

As a user, I want to create a new system prompt so that I can reuse it in chats.
Acceptance Criteria:

-   WHEN user clicks "Create Prompt" THEN a new prompt record SHALL be created with default title "Untitled Prompt" and empty content JSON.
-   AFTER creation the editor view SHALL open focused on the title field (or first editable area) for immediate editing.

### 2.3 Select Prompt

As a user, I want to select a prompt so that it becomes the active system message for the chat.
Acceptance Criteria:

-   WHEN user clicks a prompt row's "Select" action THEN that prompt's content SHALL be emitted to chat layer as current system message.
-   Selecting a prompt SHALL close the modal (unless user is editing inline) and visually indicate active prompt next time modal opens.

### 2.4 Edit / Rename Prompt

As a user, I want to edit prompt content and rename it so I can keep it current.
Acceptance Criteria:

-   WHEN user chooses "Edit" on a prompt THEN `DocumentEditor.vue` SHALL load that prompt's content in-place inside modal (swap list view or split view simple approach).
-   WHEN user changes title or content THEN updates SHALL persist via existing debounced save logic, updating `updated_at` and list order.

### 2.5 Delete (Soft) Prompt

As a user, I want to delete a prompt so unused prompts do not clutter the list.
Acceptance Criteria:

-   WHEN user clicks "Delete" and confirms THEN prompt's `deleted` flag SHALL be set true and it SHALL disappear from list.

### 2.6 Clear Active Prompt

As a user, I want to clear the selected system prompt so chat reverts to default behavior.
Acceptance Criteria:

-   WHEN user clicks "Clear Active Prompt" THEN no system prompt SHALL be applied to future messages and system message at top SHALL be removed for new sends.

### 2.7 Active Prompt Indicator

As a user, I want to know which prompt is currently active.
Acceptance Criteria:

-   Active prompt in list SHALL show a badge or highlight.

### 2.8 Hooks / Extensibility

As a developer, I want hook points to filter or act on prompt CRUD so I can extend behavior.
Acceptance Criteria:

-   Hook namespaces mirroring docs (e.g., `db.prompts.*`) SHALL exist for create, list, get, update, delete, select events.
-   A hook for `chat.systemPrompt.select:action:after` SHALL fire when a prompt is selected.

### 2.9 Performance & Simplicity

Non-Functional.
Acceptance Criteria:

-   Listing prompts SHALL reuse existing IndexedDB posts table without new schema version.
-   All operations SHALL complete locally (no network) with perceived latency < 100ms for typical (<50) prompts.

### 2.10 Accessibility & Keyboard

As a user, basic keyboard usage should work.
Acceptance Criteria:

-   User SHALL be able to navigate list items via Tab order and activate buttons with Enter/Space.

## 3. Out of Scope

-   Sharing prompts between users.
-   Tagging, categorization, or search.
-   Version history.

## 4. Assumptions

-   Existing posts table can hold `postType = 'prompt'` without index changes.
-   `DocumentEditor.vue` save logic is generic enough with minimal adaptation.
-   Chat layer already supports injecting a system message (will add minimal state if missing).

## 5. Glossary

-   Prompt: Stored system prompt document (`postType='prompt'`).
-   Active Prompt: Prompt whose content is injected as system message for current chat thread.
