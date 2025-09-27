artifact_id: 7c49c9af-7b57-4b38-917a-3c963f1c3a7a

# Extensibility & Plugin Surface Unification — Requirements

## Introduction

This initiative standardizes and expands the application’s extension surface. We will:

-   Publish a stable, typed hook map (namespaces, payloads, veto/transform semantics).
-   Complete the message lifecycle hooks and streaming events.
-   Provide editor (TipTap) UI registries: toolbar buttons, slash commands, nodes/marks.
-   Provide consistent UI chrome registries for sidebar/header/composer.
-   Finalize thread/document history action registries and document hooks.
-   Introduce a minimal plugin capability manifest with basic enforcement and UX.
-   Ship a developer “Hook Inspector” dashboard page for diagnostics.

Scope is app-level only (no server changes). We align with existing patterns used by theme and dashboard plugin systems: global registries persisted across HMR, reactive projections, default order 200, stable IDs, and typed helper APIs.

## Requirements

### 1. Hook map publication and typing

As a plugin author, I want a canonical, typed catalog of hook keys and payloads so that I can discover stable extension points and get IDE/type support.

-   Acceptance Criteria
    -   WHEN I import `HookKey` and payload types from `app/utils/hook-keys.ts` THEN I SHALL see a union of documented hook names and TypeScript payload types.
    -   WHEN I register a hook with a wrong name, THEN TypeScript SHALL flag it (via helper wrappers) or docs SHALL include validation guidance.
    -   WHEN I inspect the docs, THEN each hook SHALL indicate whether it is an action or filter, its veto/transform semantics, and its phase (before/after/complete/error).

### 2. Message lifecycle hooks (send/stream/save)

As a plugin author, I want reliable hooks around sending, streaming, and finalizing messages so I can implement moderation, analytics, and custom rendering.

-   Acceptance Criteria
    -   IF a user sends a message, THEN `ui.chat.message:filter:outgoing` SHALL allow transformation or veto (returning `false` or empty string skips append and network call).
    -   WHEN a request is prepared, THEN `ai.chat.send:action:before` SHALL fire with thread/model and IDs.
    -   WHEN streaming deltas arrive, THEN `ai.chat.stream:action:delta` and `ai.chat.stream:action:reasoning` SHALL fire for each segment with context.
    -   WHEN streaming ends successfully, THEN a `ai.chat.stream:action:complete` action SHALL fire.
    -   WHEN streaming errors/aborts, THEN a `ai.chat.stream:action:error` action SHALL fire with error or aborted flag.
    -   WHEN the assistant text is finalized, THEN `ui.chat.message:filter:incoming` SHALL allow transformation before persist.

### 3. Editor extension registries (TipTap surface)

As a plugin author, I want to contribute editor UI and behavior without forking the editor implementation.

-   Acceptance Criteria
    -   WHEN I register a toolbar button via `registerEditorToolbarButton`, THEN the button SHALL appear in the editor toolbar in order (default 200).
    -   WHEN I register a slash command via `registerEditorSlashCommand`, THEN typing the matching trigger SHALL show my command with keywords and run handler.
    -   WHEN I register a node/mark extension via `registerEditorNode`/`registerEditorMark`, THEN the editor SHALL load the extension on initialization.
    -   All editor registries SHALL mirror message/project-tree registry ergonomics: global singleton, reactive lists, order default 200, HMR-safe.

### 4. UI chrome registries (sidebar/header/composer)

As a plugin author, I want consistent extension points for app chrome.

-   Acceptance Criteria
    -   WHEN I register a sidebar section or footer control, THEN it SHALL appear ordered in the sidebar.
    -   WHEN I register a header action, THEN it SHALL render in the top bar with icon/tooltip and click handler.
    -   WHEN I register a composer action, THEN it SHALL render near the chat input (pre-send), with context provided.
    -   All follow the same registry conventions and rejection on duplicate ID in dev with console warning.

### 5. Thread/document history action registries completion

As a plugin author, I want to extend thread/document history views with actions.

-   Acceptance Criteria
    -   GIVEN `useThreadHistoryActions` and `useDocumentHistoryActions` composables, WHEN I register actions, THEN they SHALL render in those views in order.
    -   WHEN I unregister, THEN the actions SHALL disappear immediately.

### 6. Document hooks (title/content/save)

As a plugin author, I need hooks to enforce naming, decorate content, and integrate with external systems.

-   Acceptance Criteria
    -   WHEN creating/updating a document, THEN `db.documents.create|update:*` hooks SHALL be documented and expose title/content.
    -   WHEN saving, THEN `db.documents.update:action:*` SHALL fire before/after with the final row.
    -   WHEN formatting title, THEN a `db.documents.title:filter` SHALL be available to normalize names (optional addition).

### 7. File pipeline hooks (attach → hash → store)

As a plugin author, I want to inspect or reject attachments.

-   Acceptance Criteria
    -   WHEN files are attached or generated by the assistant, THEN pre/post hooks SHALL fire (`files.attach:filter:input`, `files.attach:action:after`).
    -   IF a filter returns `false`, THEN the file SHALL be rejected and a user-visible error SHALL be raised.

### 8. Capability/permission model for plugins

As a user, I want to trust plugins by understanding and limiting what they can do.

-   Acceptance Criteria
    -   WHEN a dashboard plugin registers, THEN it MAY declare `capabilities: string[]` (e.g., `canReadMessages`, `canWriteDocs`, `canSend`, `canReadFiles`).
    -   WHEN a plugin attempts a guarded operation without capability, THEN it SHALL be blocked and an error toast SHALL indicate missing permission.
    -   WHEN viewing plugin details, THEN declared capabilities SHALL be visible.

### 9. Hook Inspector dashboard page

As a developer, I want to inspect hook timings, counts, and errors to debug plugins.

-   Acceptance Criteria
    -   WHEN I open the Hook Inspector page, THEN I SHALL see totals for actions/filters, per-hook timings (min/p95/max/avg), and error counts.
    -   WHEN I click an entry, THEN recent invocations SHALL be listed with durations.
    -   Page SHALL be available via a dashboard plugin tile (Dev Tools → Hook Inspector).

### 10. Documentation and examples

As a developer, I want clear examples and docs.

-   Acceptance Criteria
    -   A short “Core Hook Map” doc SHALL be added to `docs/` and linked from the dashboard page.
    -   Example plugins SHALL demonstrate: message veto, editor toolbar button, slash command, header action, and file filter.

### 11. Performance and stability

As a maintainer, I want minimal overhead and stable API.

-   Acceptance Criteria
    -   Hook dispatch overhead SHALL remain low (<= ~0.3ms per callback avg in dev; no noticeable UI jank).
    -   All registries SHALL be HMR-safe and leak-free (disposers and global singletons maintained).
    -   Backwards compatibility SHALL be preserved for existing hook names.

## Non-functional Requirements

-   DX: Type-safe helpers, clear console warnings in dev, comprehensive examples.
-   Security: Capability gating for sensitive flows (send, write docs, file read).
-   Observability: Hook Inspector surfacing diagnostics from `hooks._diagnostics`.
-   Testability: Unit tests for registries and hook events; integration tests around send/stream and document saves.

## Out of Scope

-   Server-side permissioning or remote plugin installation.
-   Full-blown RBAC; we only implement a minimal capability manifest and client-side enforcement.
