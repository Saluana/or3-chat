# requirements.md

artifact_id: 5b7a9baf-5fd8-4e02-92b2-f7423f2704fd

## Introduction

This plan remediates the documentation, type-safety, maintainability, and error-handling issues identified in [planning/di-chat-composables.md](../di-chat-composables.md) for chat-related composables and the mentions indexing plugin.

Primary goal: make the system understandable and safer to change **without any breaking changes** (no removed exports, no behavioral changes that alter user-visible outcomes, no required call-site changes).

Scope (by file family):

- Mentions indexing: app/plugins/ChatMentions/useChatMentions.ts
- Chat AI orchestration: app/composables/chat/useAi.ts
- Workflow stream rendering accumulator: app/composables/chat/useWorkflowStreamAccumulator.ts
- Stream accumulator: app/composables/chat/useStreamAccumulator.ts
- Other chat composables referenced by docs and review: app/composables/chat/*

Non-scope:

- New user-facing features
- Changes to storage schema or migrations
- Major behavior changes in streaming/sync/auth

## Requirements

### 1. Non-breaking change policy

1.1 As a maintainer, I want remediation work to be non-breaking, so that existing plugins/components keep working.

Acceptance criteria:
- WHEN changes are merged THEN all existing exported symbols and public composable return shapes SHALL remain available.
- IF an export must be replaced THEN a compatibility wrapper SHALL remain for at least one release cycle and SHALL be marked with `@deprecated` plus migration notes.
- WHEN remediation is done THEN existing unit/integration tests SHALL continue passing.

### 2. Module-level documentation (doc-maker compliant)

2.1 As a developer, I want every critical chat composable and mention indexing module to have a clear module header, so that I can understand responsibilities and constraints quickly.

Acceptance criteria:
- WHEN opening each targeted file THEN the top of the file SHALL include an `@module` header with: Purpose, Responsibilities, Non-responsibilities, SSR notes (if applicable), Performance notes, and Extension points/hooks.
- WHEN a file has complex internal subsystems (streaming, jobs, tools, workflows) THEN the module docs SHALL include a “High-level flow” section.

### 3. JSDoc for public APIs

3.1 As a developer, I want JSDoc on exported functions and public return members, so that IDE autocomplete explains correct usage.

Acceptance criteria:
- WHEN a symbol is exported from a module THEN it SHALL have JSDoc describing inputs, outputs, error behavior, and side effects.
- IF an exported function has options THEN those options SHALL be documented and defaults SHALL be explicit.

### 4. Mentions indexing: lifecycle + Orama constraints documented

4.1 As a developer, I want the mentions indexing lifecycle documented, so that I can modify or extend mention sources safely.

Acceptance criteria:
- WHEN reading the mentions module docs THEN it SHALL explain: init timing, schema fields, why `id` is excluded from schema, enrichment behavior, fair per-group limiting, and reset behavior.
- WHEN reading the docs THEN it SHALL state Orama field constraints and what is/isn’t indexed.

### 5. Replace `any` in mentions indexing with safe types

5.1 As a developer, I want `any` removed from the mentions plugin, so that TypeScript catches schema mistakes.

Acceptance criteria:
- WHEN building TypeScript THEN the mentions module SHALL have no `any` in function signatures or core data transformations (except where unavoidable for third-party library types, which SHALL be isolated behind a type alias).
- WHEN reading the code THEN types for Dexie rows (docs/threads/messages) SHALL be explicit (imported from DB schema/types where available or locally defined minimal interfaces).

### 6. Error handling: no silent failures, no behavioral breaking

6.1 As a developer, I want failures in indexing/search/resolve to be observable, so that production issues can be detected.

Acceptance criteria:
- WHEN an indexing/search/resolve operation fails THEN the system SHALL report the error using the unified error API (`reportError`) with domain tags.
- IF current behavior returns `[]` or `null` THEN it SHALL continue returning the same values (to avoid breaking callers) while still emitting an observable error hook/toast policy consistent with existing guidelines.
- WHEN an operation is best-effort THEN docs SHALL state that it is best-effort and how to observe failures.

### 7. Document and standardize the module-singleton state pattern

7.1 As a developer, I want composables that use module-scoped refs to document why and when state is shared, so that I don’t accidentally create duplicate stores.

Acceptance criteria:
- WHEN a composable uses module-scoped state THEN its module docs SHALL explicitly state singleton semantics, lifecycle, and cleanup expectations.
- WHEN cleanup is required (pane teardown/HMR) THEN docs SHALL describe how to unregister/cleanup and what happens if you don’t.

### 8. useWorkflowStreamAccumulator architecture documentation

8.1 As a developer, I want the workflow accumulator to explain subflows, nesting, and performance strategy, so that I can change rendering safely.

Acceptance criteria:
- WHEN reading module docs THEN it SHALL document: branch/subflow keying strategy, event-to-state mapping, ordering semantics, and performance characteristics.
- WHEN reading docs THEN it SHALL document error propagation and what UI should render on failures.

### 9. useAi maintainability remediation without breaking imports

9.1 As a maintainer, I want the 3k+ line useAi.ts file split into focused internal modules, so that changes are reviewable and testable.

Acceptance criteria:
- WHEN refactoring is complete THEN `useAi` export SHALL remain in the same module path and provide the same runtime behavior.
- WHEN internal modules are introduced THEN they SHALL not be part of the public API by default (internal imports), unless explicitly re-exported for compatibility.
- WHEN refactoring THEN each extracted module SHALL have its own module header and narrow responsibilities.

### 10. Dead/unclear exports handled safely (UnifiedStreamingState)

10.1 As a maintainer, I want unused exports cleaned up without breaking users, so that APIs stay clear.

Acceptance criteria:
- IF `UnifiedStreamingState` is unused externally THEN it SHALL be deprecated first and removed only after a deprecation window.
- IF it is used THEN it SHALL be documented with when-to-use guidance and kept stable.

### 11. Documentation system alignment

11.1 As a maintainer, I want code docs and site docs to agree, so that developers don’t get conflicting guidance.

Acceptance criteria:
- WHEN updating module docs THEN the corresponding docs pages referenced in public/_documentation/docmap.json SHALL be reviewed for consistency.
- IF docs are outdated THEN they SHALL be updated (or docmap corrected) as part of remediation.
