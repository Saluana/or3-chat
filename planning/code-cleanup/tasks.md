---
title: Tasks — Codebase Hygiene (Dupes Cleanup, Unused Removal)
artifact_id: 5a4a76c1-5f9b-4267-86c7-6f7af8f63951
---

# Tasks

All changes must be behavior-preserving. Run tests after each subsection. Line numbers are approximate; search within files if they drift.

## 1. Add shared utilities

-   [x] 1.1 Create `app/utils/projects/normalizeProjectData.ts`

    -   Contents: tolerant parser returning `ProjectEntry[]` (see design).
    -   Requirements: 1.1

-   [x] 1.2 Create registry factory `app/composables/ui-extensions/_registry.ts`

    -   Contents: `createRegistry<T>(key, sort?)` (see design).
    -   Requirements: 5

-   [x] 1.3 Add `tests/utils/scroll.ts`

    -   Export `setScrollMetrics(el, { scrollTop, scrollHeight, clientHeight })`.
    -   Requirements: 4

-   [x] 1.4 Add `app/composables/useProjectsCrud.ts`
    -   Expose `createProject`, `renameProject`, `deleteProject`, `updateProjectEntries`, `syncProjectEntryTitle`.
    -   Requirements: 2, 3

## 2. Replace duplicated project.data parsing

-   [ ] 2.1 `app/components/sidebar/SidebarProjectTree.vue`

    -   Remove local `normalizeProjectData` (~235–248) and import the util.
    -   Requirements: 1.1

-   [ ] 2.2 `app/components/sidebar/SideNavContent.vue`

    -   Replace parsing blocks at:
        -   ~1012–1069 (add chat)
        -   ~1047–1069 (add doc)
        -   ~1115–1142 (rename entry)
        -   ~1188–1196 (remove from project)
        -   ~1312–1366 (add to project create/select)
    -   Requirements: 1.1

-   [ ] 2.3 `app/components/sidebar/SideNavHeader.vue`

    -   Replace parsing in project create paths (~458–507).
    -   Requirements: 1.1

-   [ ] 2.4 `app/components/sidebar/SidebarVirtualList.vue`
    -   If needed, import shared types; remove local duplicates.
    -   Requirements: 1.1

## 3. Migrate project CRUD to composable (no UI changes)

-   [ ] 3.1 `SideNavContent.vue`: use `useProjectsCrud()` for create/rename/delete and entry updates.

    -   Keep current emits and expansion logic.
    -   Requirements: 2, 3

-   [ ] 3.2 `SideNavHeader.vue`: use `useProjectsCrud()` for create/rename.
    -   Requirements: 2

## 4. Unify registries (internal refactor, preserve API)

-   [ ] 4.1 `app/composables/ui-extensions/projects/useProjectTreeActions.ts`

    -   Re-implement with `_registry` factory; preserve exported functions and sorting `(a.order ?? 200)`.
    -   Requirements: 5

-   [ ] 4.2 `app/composables/ui-extensions/chrome/useHeaderActions.ts`

    -   Swap internal Map+reactive logic to factory. Preserve warnings and API.
    -   Requirements: 5

-   [ ] 4.3 `app/composables/ui-extensions/chrome/useSidebarSections.ts`
    -   Same as 4.2.
    -   Requirements: 5

## 5. Deduplicate test helpers

-   [ ] 5.1 Update chat tests to import `tests/utils/scroll.ts`:
    -   `app/components/chat/__tests__/AutoScrollBehavior.test.ts` (~23–44)
    -   `app/components/chat/__tests__/finalizeNoJump.test.ts` (~6–24)
    -   `app/components/chat/__tests__/restickDelay.test.ts` (~6–24)
    -   Requirements: 4

## 6. Remove unused/deprecated shims

-   [ ] 6.1 Grep usages of `useErrorToasts(`; migrate or remove.

    -   If no usages: delete function from `app/utils/errors.ts` (~199+).
    -   If usages exist: replace with `reportError(..., { toast:true })` or direct `useToast()`.
    -   Requirements: 6

-   [ ] 6.2 Remove `nowSecNumber()` alias
    -   Replace with `nowSec()` and delete from `app/db/files-util.ts` (~50–55).
    -   Requirements: 7, 9

## 7. Exclude dev-only files from production

-   [ ] 7.1 Update `nuxt.config.ts > ignore` to exclude:
    -   `app/plugins/examples/**`
    -   `app/pages/_test.vue`
    -   Verify dev still loads examples (ignore only in production build if necessary).
    -   Requirements: 8

## 8. Consistency sweep for timestamps

-   [ ] 8.1 Replace `Math.floor(Date.now()/1000)` with `nowSec()` in touched files.
    -   Requirements: 9

## 9. Tests

-   [ ] 9.1 Unit tests for `normalizeProjectData`.
-   [ ] 9.2 Unit tests for `_registry` factory.
-   [ ] 9.3 Unit tests for `useProjectsCrud` (mock DB layer).
-   [ ] 9.4 Chat tests updated to use shared scroll util and PASS.

## 10. Verification (do not skip)

-   [ ] Build & typecheck pass.
-   [ ] Run unit tests; ensure no regressions.
-   [ ] Manual smoke:
    -   Projects: expand/collapse, create, rename, delete, add chat/doc, remove entry.
    -   Project tree actions (built-ins and example plugins in dev).
    -   Chat list virtualization (basic scroll behaviors unaffected).

---

Requirements mapping summary:

-   Req 1.1 → Tasks 1.1, 2.x, 9.1
-   Req 2 → Tasks 1.4, 3.x, 9.3
-   Req 3 → Tasks 1.4, 3.1
-   Req 4 → Tasks 1.3, 5.x
-   Req 5 → Tasks 1.2, 4.x, 9.2
-   Req 6 → Tasks 6.1
-   Req 7 → Tasks 6.2
-   Req 8 → Tasks 7.1
-   Req 9 → Tasks 6.2, 8.1

---

Additional findings and tasks (no behavior changes):

## 11. Consolidate Orama search helpers

-   [ ] 11.1 Create `app/utils/search/orama.ts`

    -   Export minimal helpers used by all three search composables:
        -   `importOrama()` dynamic importer with friendly error
        -   `createDb(schema: Record<string, string>)`
        -   `buildIndex<T>(docs: T[])`
        -   `searchWithIndex(db, term: string, limit = 100)`
        -   Token/race guard pattern so stale results don’t overwrite
    -   Requirements: Preserve SSR safety and existing debounce behavior.

-   [ ] 11.2 Refactor `app/composables/useModelSearch.ts`

    -   Replace local `importOrama/createDb/buildIndex/search` with shared helpers.
    -   Keep public API and debounce the same; maintain `lastIndexedCount` semantics.
    -   Approx lines: 1–120, 44–90, 89–115.

-   [ ] 11.3 Refactor `app/composables/useThreadSearch.ts`

    -   Replace local Orama helpers and token guard with shared helpers.
    -   Maintain fallback substring search when index yields no mapped results.

-   [ ] 11.4 Refactor `app/composables/useSidebarSearch.ts`
    -   Replace local Orama helpers and signature computation with shared helpers where feasible, preserving current behavior.

## 12. Unify TipTap JSON → text conversion

-   [ ] 12.1 Use `promptJsonToString` everywhere instead of ad-hoc traversals
    -   File: `app/components/chat/SystemPromptsModal.vue`
        -   Replace custom `extractText`/`contentToText` helpers with `promptJsonToString` from `~/utils/prompt-utils`.
        -   Approx locations: ~336+ (extractText), nearby content-to-text usage.
    -   Double-check other components for similar custom text extraction and swap.

## 13. Dedupe title/content normalization for documents/prompts

-   [ ] 13.1 Create `app/utils/tiptap.ts`

    -   `parseTipTapJson(raw: string | null | undefined): any` tolerant parse with structural guard (doc type)
    -   `emptyDocJSON()` exported (single source of truth)

-   [ ] 13.2 Create `app/utils/titles.ts`

    -   `normalizeTitle(title?: string | null, opts?: { fallback?: string; allowEmpty?: boolean }): string`

-   [ ] 13.3 Refactor DB modules to shared utils
    -   `app/db/documents.ts`: replace local `emptyDocJSON`, `normalizeTitle`, `parseContent` usages
    -   `app/db/prompts.ts`: same replacements
    -   Keep exact behavior for fallbacks and trimming; do not change persistence shapes.

## 14. DRY capability guards toast/error block

-   [ ] 14.1 Factor duplicate toast + reportError into a helper
    -   File: `app/utils/capability-guards.ts`
    -   Introduce `deny(capabilityOrList, operation, details)` that:
        -   Adds a toast via `useToast().add(...)`
        -   Calls `reportError(err('ERR_INTERNAL', msg, { tags }))`
    -   Use in both `guardCapability` (~33+) and `guardAnyCapability` (~86+).

## 15. Legacy ErrorToasts component audit

-   [ ] 15.1 Verify usage of `app/components/ErrorToasts.vue`
    -   If not mounted anywhere: remove component and the deprecated shim.
    -   If mounted: migrate away from `useErrorToasts()` to rely solely on `reportError`’s built-in toast or subscribe to `error:raised` hook to surface custom UI if still desired.
    -   Cross-ref: `app/utils/errors.ts` already toasts via Nuxt UI in `reportError()`; duplication is unnecessary.

## 16. Optional: safe localStorage helpers (low-risk)

-   [ ] 16.1 Create `app/utils/storage.ts`
    -   `readJSON<T>(key: string): T | null` and `writeJSON(key: string, v: any): void` with try/catch and SSR guards.
    -   Adopt in:
        -   `app/composables/useAiSettings.ts` (persist/load)
        -   `app/utils/models-service.ts` (CACHE_KEY read/write)
        -   `app/components/chat/ChatInputDropper.vue` (LAST_MODEL_KEY read/write)
    -   Behavior must remain identical (keys and timing unchanged).

## 17. Nice-to-have: DB get/filter wrapper (later)

-   [ ] 17.1 Consider a tiny internal helper in `app/db/util.ts`
    -   `withFilters<T>(promise: Promise<T>, key: string)` returning `hooks.applyFilters(key, await promise)`
    -   Could reduce repeated `dbTry().then(res => hooks.applyFilters(..., res))` across modules like posts/messages/threads.
    -   Defer until other tasks are complete to avoid broad churn.

## 18. Verification additions

-   [ ] 18.1 Run unit tests for prompt-utils after swapping SystemPromptsModal.
-   [ ] 18.2 Validate search UIs (models/threads/sidebar):
    -   Empty query returns original lists
    -   Debounce preserved
    -   Race guard prevents older results from flashing
-   [ ] 18.3 Smoke test capability guard toasts + errors still show identically.
