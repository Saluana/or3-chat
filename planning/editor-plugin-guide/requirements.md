# Editor Extensibility Requirements

artifact_id: 8a8f1a6b-8f4b-43f3-8f58-6e2f4f37f3e2

## Introduction

Enable third-party developers to extend the OR3 TipTap/ProseMirror editor via simple OR3 plugins (Nuxt .client.ts files) without modifying core code. Plugins must be able to register TipTap extensions (nodes and marks), add toolbar buttons, and hook into the editor lifecycle safely with HMR, order control, and reactive updates.

## Functional Requirements

1. Toolbar Button Registration

    - User Story: As a plugin developer, I want to register toolbar buttons so users can trigger editor commands.
    - Acceptance Criteria:
        - WHEN a plugin calls registerEditorToolbarButton() with a valid EditorToolbarButton THEN the button SHALL appear in the toolbar in order-sorted position.
        - WHEN isActive returns true for the current editor state THEN the button SHALL render in an active style.
        - IF visible is provided and returns false THEN the button SHALL be hidden.
        - WHEN onClick is invoked THEN the provided function SHALL receive the current Editor instance and execute.

2. Node Registration

    - User Story: As a plugin developer, I want to register custom TipTap nodes so I can add new block elements.
    - Acceptance Criteria:
        - WHEN a plugin calls registerEditorNode() with a valid TipTap Extension THEN the node SHALL be included in the editor’s extensions array on creation.
        - WHEN multiple nodes are registered THEN they SHALL be loaded in ascending order by order (default 200).
        - IF a node extension throws during editor init THEN the system SHALL log an error and continue without the failing node, keeping the editor usable.

3. Mark Registration

    - User Story: As a plugin developer, I want to register custom TipTap marks so I can add inline formatting.
    - Acceptance Criteria:
        - WHEN a plugin calls registerEditorMark() with a valid TipTap Extension THEN the mark SHALL be included in the editor’s extensions array on creation.
        - WHEN multiple marks are registered THEN they SHALL be loaded in ascending order by order (default 200).
        - IF a mark extension throws during editor init THEN the system SHALL log an error and continue without the failing mark, keeping the editor usable.

4. HMR-Safe Registries

    - User Story: As a developer, I want HMR-safe registries so reloading plugins doesn’t duplicate extensions.
    - Acceptance Criteria:
        - WHEN the same plugin file is reloaded during development THEN re-registering by the same id SHALL replace the prior registration, not duplicate it.
        - WHEN duplicate ids occur across plugins THEN the most recent SHALL replace the older and a console warning SHALL be emitted.

5. Reactive Discovery

    - User Story: As a developer, I want reactive access to registered toolbar buttons for rendering the toolbar.
    - Acceptance Criteria:
        - WHEN useEditorToolbarButtons(editorRef) is used THEN it SHALL return a computed, order-sorted list that updates when registrations change or when visible changes.
        - WHEN editorRef changes (editor ready/destroyed) THEN the list SHALL re-evaluate isActive/visible safely.

6. Ordered Loading

    - User Story: As a developer, I want deterministic ordering to interleave core and plugin items.
    - Acceptance Criteria:
        - GIVEN built-ins use order < 200 and plugins default to 200 THEN plugins SHALL load after built-ins unless a plugin sets a smaller order value.
        - WHEN items share the same order THEN they SHALL be sorted by the current implementation’s behavior (ascending order, tie handling is implementation-defined) without breaking UI usage.

7. Editor Lifecycle Hooks

    - User Story: As a plugin developer, I want to hook into editor lifecycle to perform custom behavior.
    - Acceptance Criteria:
        - WHEN the editor is created THEN a hook editor.created:action:after SHALL be emitted with the Editor instance.
        - WHEN the editor updates content THEN a hook editor.updated:action:after SHALL be emitted with minimal payload (doc JSON or transaction meta) without performance regressions.

8. Developer Diagnostics

    - User Story: As a developer, I want simple functions to introspect registrations.
    - Acceptance Criteria:
        - WHEN listRegisteredEditorToolbarButtonIds(), listRegisteredEditorNodeIds(), and listRegisteredEditorMarkIds() are called THEN they SHALL return the current ordered ids.
        - WHEN invalid inputs are passed to register functions THEN a descriptive console error SHALL be logged.

9. SSR/Client Safety

    - User Story: As a developer, I want a clear, safe execution environment.
    - Acceptance Criteria:
        - WHEN a plugin is placed in app/plugins/\*.client.ts THEN registration SHALL execute client-side only.
        - IF a plugin is accidentally loaded server-side THEN registration functions SHALL no-op gracefully without crashing SSR.

10. Backward Compatibility

    - User Story: As a maintainer, I want the feature to coexist with existing editor behavior.
    - Acceptance Criteria:
        - WHEN no plugins are installed THEN the editor SHALL behave as before with only built-in extensions.
        - WHEN plugins are removed at runtime (HMR replace) THEN the toolbar and editor SHALL reflect removals/updates without reload.

11. Error Isolation
    - User Story: As a user, I want the editor to remain usable when a plugin fails.
    - Acceptance Criteria:
        - IF a plugin button’s isActive/visible throws THEN the toolbar rendering SHALL catch and treat it as inactive/visible=false and log once.
        - IF a plugin button’s onClick throws THEN the error SHALL be caught, logged, and SHALL NOT crash the editor instance.

## Non-Functional Requirements

1. Performance

    - Editor creation with up to 30 plugin extensions (combined nodes/marks) SHALL add ≤ 40 ms median overhead on a modern laptop.
    - Toolbar re-computation due to state changes SHALL not trigger unnecessary re-renders (visible/isActive evaluated efficiently and defensively).

2. DX and Documentation

    - Public TypeScript interfaces SHALL be exported for EditorToolbarButton, EditorNode, and EditorMark.
    - The developer guide in planning/editor-plugin-guide/EDITOR_EXTENSIBILITY_GUIDE.md SHALL remain accurate with code references.

3. Security

    - No unsanitized raw HTML injection pathways SHALL be introduced by default APIs.

4. Testing

    - Unit tests SHALL cover registration, ordering, deduplication, and error handling.
    - Integration tests SHALL verify end-to-end plugin behavior in a minimal editor instance.

5. Observability
    - Console warnings/errors for duplicate ids, invalid payloads, and extension failures SHALL be implemented in development builds.

## Out of Scope

-   Server-side plugin execution and persistence of plugin state in the database.
-   Arbitrary plugin code sandboxing beyond normal browser isolation.
