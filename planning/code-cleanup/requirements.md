---
title: Requirements — Codebase Hygiene (Dupes Cleanup, Unused Removal)
artifact_id: a8f2c91b-7c63-4e9c-87ea-11e5b63fbffc
---

# Introduction

This initiative removes unused code and consolidates duplicate logic in the Nuxt 3/Vue 3 codebase without changing observable behavior. It focuses on: centralizing tolerant project data parsing, unifying registry patterns in UI extensions, deduplicating test helpers, removing deprecated shims/aliases, tightening production bundle contents, and normalizing timestamp utilities.

# Functional Requirements

1. Project data parsing is centralized

    - User Story: As a maintainer, I want tolerant project.data parsing in one place so future changes are safe and consistent.
    - Acceptance Criteria:
        - WHEN any component needs to read/modify `project.data` THEN it SHALL call a shared `normalizeProjectData()` utility that returns a consistent structure and gracefully handles missing/invalid JSON.
        - IF `project.data` is invalid or missing THEN the parser SHALL return a valid empty/default structure and never throw.
        - All known call sites in sidebar components SHALL be migrated to use the shared utility.

2. CRUD flows for projects are consolidated into a composable

    - User Story: As a maintainer, I want consistent project CRUD logic in a single composable so UI remains thin and behavior uniform.
    - Acceptance Criteria:
        - WHEN a project is created, renamed, deleted, or updated THEN `useProjectsCrud()` SHALL perform DB updates and return `ServiceResult` for error handling.
        - Emitted events/expansion UI behavior in existing components SHALL remain unchanged.

3. Entry title syncing is standardized

    - User Story: As a maintainer, I want entry title updates to be applied consistently across projects.
    - Acceptance Criteria:
        - WHEN an entry title changes THEN `syncProjectEntryTitle()` SHALL update all references in projects without altering sort order or expansion state.

4. Scroll-related test helpers are deduplicated

    - User Story: As a maintainer, I want a single helper to set scroll metrics in tests to avoid drift.
    - Acceptance Criteria:
        - WHEN chat tests need scroll metrics THEN they SHALL import a single helper `tests/utils/scroll.ts`.
        - All previous inline helpers SHALL be removed.

5. UI extension registries are unified on a small factory

    - User Story: As a maintainer, I want a shared registry factory to reduce repeated Map + reactive logic.
    - Acceptance Criteria:
        - WHEN registering/unregistering actions or sections THEN implementations SHALL use `createRegistry<T>()` while preserving the public API of existing composables.
        - Sorting behavior and de-duplication rules SHALL remain unchanged.

6. Deprecated error toast shim is removed or replaced

    - User Story: As a maintainer, I want to remove deprecated shims to simplify error handling.
    - Acceptance Criteria:
        - IF `useErrorToasts()` has no consumers THEN it SHALL be removed.
        - IF consumers exist THEN they SHALL be migrated to `reportError(..., { toast: true })` or `useToast()` and the shim removed.

7. Trivial timestamp alias is removed

    - User Story: As a maintainer, I want a single canonical timestamp function to reduce confusion.
    - Acceptance Criteria:
        - WHEN code needs epoch seconds THEN it SHALL use `nowSec()` only.
        - `nowSecNumber()` SHALL be removed after replacing all usages.

8. Example/demo files are excluded from production bundles

    - User Story: As a maintainer, I want smaller, safer production bundles.
    - Acceptance Criteria:
        - WHEN building for production THEN `app/plugins/examples/**` and `app/pages/_test.vue` SHALL be excluded.
        - Dev environment SHALL still be able to load examples as before.

9. Timestamp usage is consistent
    - User Story: As a maintainer, I want consistent time semantics.
    - Acceptance Criteria:
        - WHEN epoch seconds are computed in touched files THEN they SHALL call `nowSec()` and not inline math.

# Non-Functional Requirements

-   Backward compatibility: No observable UI/behavior changes. Public composable APIs remain compatible.
-   Reliability: New utilities SHALL be covered by unit tests; existing tests SHALL continue to pass.
-   Performance: Neutral or improved; no new O(n^2) behavior.
-   Security: No change in user permissions or network surfaces.
-   Maintainability: Reduced duplication, clearer responsibilities, consistent patterns.

# Out of Scope

-   Redesigning data models or UX flows.
-   Migrating databases or introducing new persistence layers.
-   Changing public plugin APIs for UI extensions.

---

title: Codebase Hygiene: Duplicate Consolidation and Unused Removal
artifact_id: 3b2f8b4b-2a2c-4a99-9d7f-4d4d3b2dc3a3

---

# Requirements

## Introduction

This effort removes unused/deprecated code and consolidates duplicated logic into shared utilities without changing user-visible behavior. Focus areas: project data parsing, project CRUD flows, registry patterns, test helpers, and minor shims. All changes must preserve current functionality and pass existing tests.

## Functional Requirements (User Stories with Acceptance Criteria)

1. As a developer, I want a single utility to parse `project.data`, so that all components handle arrays and JSON strings consistently.

    - WHEN `project.data` is an array, THEN the utility SHALL return it unchanged (typed) and SHALL not mutate.
    - WHEN `project.data` is a JSON string of an array, THEN the utility SHALL `JSON.parse` it and return an array; on malformed JSON, it SHALL return `[]`.
    - WHEN entries include unknown `kind`, THEN the UI SHALL treat them as `'chat'` (existing behavior).
    - Call sites to update (no behavior change):
        - `app/components/sidebar/SideNavContent.vue` (~1012–1069, ~1115–1142, ~1188–1196, ~1312–1366)
        - `app/components/sidebar/SideNavHeader.vue` (~458–507)
        - `app/components/sidebar/SidebarProjectTree.vue` (remove local `normalizeProjectData` ~235–248; use shared)
        - `app/components/sidebar/SidebarVirtualList.vue` (import shared types if needed)

2. As a developer, I want project creation/rename/delete logic centralized, so that header and content use the same behavior and error handling.

    - Introduce `useProjectsCrud.ts` composable with `createProject`, `renameProject`, `deleteProject`, `updateProjectEntries`.
    - WHEN invoked from header/content, THEN UI behavior SHALL match current flows (modals, expanded list, emits).
    - SHALL reuse DB hooks so existing side-effects remain.

3. As a developer, I want a helper to sync entry titles inside projects when a thread/doc is renamed, so that project lists remain in sync.

    - Provide `syncProjectEntryTitle(id, kind, name)`; used in SideNavContent rename flows (~841–905 and ~877–905).
    - THEN project rows in all projects SHALL reflect the new title.

4. As a contributor, I want a shared test helper for scroll metrics in chat list tests, so that test code is DRY.

    - Create `tests/utils/scroll.ts` with `setScrollMetrics(...)`.
    - Update tests: `AutoScrollBehavior.test.ts`, `finalizeNoJump.test.ts`, `restickDelay.test.ts`.
    - Tests SHALL remain passing.

5. As a developer, I want a shared registry factory for UI extension registries, so that action registries follow a consistent pattern.

    - Add `app/composables/ui-extensions/_registry.ts` exposing `createRegistry<T>(key, sort?)`.
    - Migrate: `useProjectTreeActions.ts`, `useHeaderActions.ts`, `useSidebarSections.ts` (and similar) with no public API change.

6. As a maintainer, I want deprecated `useErrorToasts()` removed (or callers migrated), so that the error surface is unified.

    - IF repository grep shows no usage outside tests, THEN the function SHALL be deleted.
    - ELSE callers SHALL be migrated to `reportError(...)/useToast()` maintaining current UX.

7. As a maintainer, I want to remove trivial alias `nowSecNumber()` and use `nowSec()` directly, to reduce API noise.

    - All usages SHALL be replaced; new code SHALL import `nowSec` from `app/db/util.ts`.

8. As a maintainer, I want example plugins and test pages excluded from production bundles, so that the app size stays small.

    - Update `nuxt.config.ts > ignore` to exclude `app/plugins/examples/**` and `app/pages/_test.vue` for production.
    - Dev experience SHALL remain unchanged.

9. As a maintainer, I want consistent timestamp usage, so that code clarity improves with no behavior change.
    - Replace `Math.floor(Date.now()/1000)` with `nowSec()` across touched files.

## Non‑functional Requirements

-   No behavior change. Sidebar interactions, project add/remove/rename, and chat/doc flows must remain identical.
-   Type-safe utilities with unit tests for new shared code.
-   Performance neutral or better (no additional DB round trips on hot paths).
-   Backward-compatible registries; existing example plugins keep working in dev.
-   All tests pass; add minimal tests for new utilities.
