# Duplicate and Unused Code Audit (OR3.chat)

Date: 2025-10-02
Owner: Core maintainers
Scope: Full repo (Nuxt app under `app/`, DB layer, plugins, tests, docs)

This document lists concrete duplicate patterns and likely-unused/deprecated code across the codebase, with exact file pointers and actionable steps to consolidate or remove. Each item includes a proposed fix and references. Implement changes in small PRs per section with quick unit tests where feasible.

---

## A. High‑priority duplicates to consolidate

### A.1 Project `data` parsing and normalization (repeat in multiple places)

Pattern repeated in several components:

```ts
const dataArr = Array.isArray(project.data)
    ? project.data
    : typeof project.data === 'string'
    ? (() => {
          try {
              const parsed = JSON.parse(project.data);
              return Array.isArray(parsed) ? parsed : [];
          } catch {
              return [];
          }
      })()
    : [];
```

Occurrences:

-   `app/components/sidebar/SideNavContent.vue`
    -   ~1012–1032 (add chat path)
    -   ~1047–1069 (add document path)
    -   ~1115–1142 (rename entry)
    -   ~1188–1196 (remove from project)
    -   ~1312–1355 (add to project: create/select project)
    -   ~1343–1366 (add to existing project)
-   `app/components/sidebar/SideNavHeader.vue`
    -   ~458–493, ~490–507 (create project / modal)
-   `app/components/sidebar/SidebarProjectTree.vue`
    -   `normalizeProjectData` local function ~235–248 (same logic in function form)
-   `app/components/sidebar/SidebarVirtualList.vue`
    -   Declares local `Project`/`ProjectEntry` types that mirror others

Proposed fix:

-   Create a single utility: `app/utils/projects/normalizeProjectData.ts`
    -   Contract: `normalizeProjectData(raw: unknown): Array<{ id: string; name?: string; kind?: 'chat' | 'doc' }>`
    -   Behavior: Accepts array or JSON string; returns array; tolerates malformed JSON; coerces unknown kinds to `'chat'` unless explicitly `'doc'`.
-   Replace all ad‑hoc parsing with the util.
-   Keep `SidebarProjectTree.vue`’s coercion to `'chat'|'doc'` (or move into util and use consistently in UI code).
-   Add unit tests for malformed JSON, string/array inputs, unknown kinds.

Notes:

-   While refactoring `SideNavContent.vue`’s multiple copies, also extract a small helper to write `project.data` back and stamp `updated_at`.

---

### A.2 Project CRUD and rename logic duplicated (header vs content)

Occurrences:

-   `app/components/sidebar/SideNavContent.vue`
    -   Project creation ~1224–1252; rename modal and save ~1081+ and ~1115+; delete handler ~1047 block context
-   `app/components/sidebar/SideNavHeader.vue`
    -   Project creation modal + submit ~458–507; rename modal + save ~422–463; create modal again ~490+

Proposed fix:

-   Extract a composable `app/composables/useProjectsCrud.ts` exposing:
    -   `createProject({ name, description }): Promise<string>` (returns id)
    -   `renameProject(id, name)`
    -   `deleteProject(id, { soft = true })`
    -   `updateProjectEntries(id, entries)` (internal helper used by add/remove)
-   Replace both components’ logic with calls to the composable. Keep UI only for modals/state.
-   Add minimal tests for the composable where possible (mock Dexie layer).

Benefit: One source of truth and consistent error handling/toasts.

---

### A.3 Title sync inside project entries (duplicated loops)

Occurrences:

-   `app/components/sidebar/SideNavContent.vue`
    -   Thread rename sync: ~877–905
    -   Document rename sync: ~841–870

Proposed fix:

-   Extract `syncProjectEntryTitle(id: string, kind: 'chat'|'doc', name: string)` into `useProjectsCrud.ts` and reuse.

---

### A.4 Repeated test helper `setScrollMetrics` across chat tests

Duplicated helper appears in multiple test suites:

-   `app/components/chat/__tests__/AutoScrollBehavior.test.ts` ~23–44
-   `app/components/chat/__tests__/finalizeNoJump.test.ts` ~6–24
-   `app/components/chat/__tests__/restickDelay.test.ts` ~6–24

Proposed fix:

-   Create `tests/utils/scroll.ts` with `setScrollMetrics(el, { scrollTop, scrollHeight, clientHeight })` and share across tests.
-   Update imports in the three files accordingly.

---

### A.5 Project tree row/type duplication

Occurrences:

-   `app/components/sidebar/SidebarProjectTree.vue` defines `ProjectEntryKind`, local `ProjectEntry`, `TreeItem`.
-   `app/composables/ui-extensions/projects/useProjectTreeActions.ts` defines `ProjectTreeKind`, `ProjectTreeChild`, `ProjectTreeRoot`.

Proposed fix:

-   Consolidate tree types in `useProjectTreeActions.ts` or a dedicated `types/project-tree.d.ts` and import them in `SidebarProjectTree.vue`.
-   Keep UI‑specific `TreeItem` where required by the UI library, but import shared `ProjectTreeKind`.

---

### A.6 Registry patterns duplicated across UI extension composables

Similar Map→reactive list registries:

-   `app/composables/ui-extensions/projects/useProjectTreeActions.ts`
-   `app/composables/ui-extensions/chrome/useHeaderActions.ts`
-   `app/composables/ui-extensions/chrome/useSidebarSections.ts`
-   (likely) message/doc/thread history registries under `app/plugins/examples/*`

Proposed fix:

-   Extract a small factory in `app/composables/ui-extensions/_registry.ts`:
    -   `createRegistry<T>(globalKey: string, sort?: (a,b)=>number)` returns `{ register, unregister, listIds, useItems }`.
-   Refactor registries to use the shared helper (preserving existing public APIs and sort semantics).
-   Add a single unit test validating base behavior for the factory.

---

## B. Likely unused or deprecated code to remove (or quarantine)

> Marked “likely” where full usage analysis is not in this doc; confirm with a quick grep before removal.

### B.1 `useErrorToasts()` (deprecated shim)

-   File: `app/utils/errors.ts` ~199+ (explicitly marked deprecated; returns noop `toasts: []`)
-   Docs: `docs/error-handling.md` instruct to remove legacy usage.

Proposed fix:

-   Grep for occurrences of `useErrorToasts(`; if none (outside tests), delete function and update docs accordingly.
-   If usages exist, migrate each site to `reportError(...)` + `useToast()` where UI toast is desired.

### B.2 `nowSecNumber()` (proxy for `nowSec`)

-   File: `app/db/files-util.ts` ~50–55
-   Purpose: trivial proxy; introduces unnecessary alias.

Proposed fix:

-   Replace imports/usages with `nowSec` from `app/db/util.ts` directly; remove `nowSecNumber` export.
-   Verify via grep: `nowSecNumber(`.

### B.3 Dev/demo artifacts bundled by default

-   Example plugins: `app/plugins/examples/*`
-   Debug console patch: `app/plugins/examples/dev-debug-console.client.ts`
-   Test page: `app/pages/_test.vue`

Proposed fix:

-   Ensure production builds exclude these via `nuxt.config.ts > ignore` (comment suggests partial coverage). Add explicit patterns if missing:
    -   `app/plugins/examples/**`
    -   `app/pages/_test.vue`
-   Alternatively, move examples to `dev_examples/` and update README to point to them.

### B.4 Local duplicated Project/ProjectEntry types

-   `app/components/sidebar/SidebarVirtualList.vue` declares `ProjectEntry` and `Project` types; prefer importing from DB schema or shared project types once the util from A.1 is introduced.

Proposed fix:

-   Introduce `app/utils/projects/types.ts` exporting a shared `ProjectEntry` type and import where needed.

---

## C. Minor cleanups / consistency

-   Prefer `nowSec()` (DB util) instead of direct `Math.floor(Date.now()/1000)` scattered across components (several spots in `SideNavContent.vue`, `Sidebar*` files). Replace for consistency and testability.
-   Ensure `SidebarProjectTree.vue` uses the new `normalizeProjectData` util (see A.1) and removes its own `normalizeProjectData` duplicate if fully covered by the util.
-   In `SidebarProjectTree.vue`, `onSelect` handlers call `e.preventDefault()` for root; confirm this is required by `UTree` and document rationale.

---

## D. Action checklist (PR‑sized tasks)

-   [ ] A.1 Create `app/utils/projects/normalizeProjectData.ts` and replace all call sites listed above. Add unit tests.
-   [ ] A.2 Extract `useProjectsCrud.ts` and migrate header/content components. Add tests to cover create/rename/delete happy paths (mock DB).
-   [ ] A.3 Extract `syncProjectEntryTitle` and use in thread/doc rename flows (`SideNavContent.vue`).
-   [ ] A.4 Add `tests/utils/scroll.ts` and deduplicate test helpers; update three test files.
-   [ ] A.5 Unify project tree types (import from composable/types file).
-   [ ] A.6 Add `_registry.ts` factory and refactor action registries to use it. Add a small unit test.
-   [ ] B.1 Remove `useErrorToasts()` after verifying no usages.
-   [ ] B.2 Remove `nowSecNumber()` and replace usages with `nowSec`.
-   [ ] B.3 Exclude example plugins and `_test.vue` from production build in `nuxt.config.ts` (or move to `dev_examples/`). Update README.
-   [ ] C. Sweep for `Math.floor(Date.now()/1000)` and replace with `nowSec()`.

---

## E. References (snippets & line guides)

-   SideNavContent parsing blocks:
    -   `app/components/sidebar/SideNavContent.vue` ~1012–1069, ~1115–1142, ~1188–1196, ~1312–1366
-   SideNavHeader project creation:
    -   `app/components/sidebar/SideNavHeader.vue` ~458–507
-   SidebarProjectTree normalization:
    -   `app/components/sidebar/SidebarProjectTree.vue` ~235–248 (`normalizeProjectData`)
-   Test helpers duplication:
    -   `app/components/chat/__tests__/AutoScrollBehavior.test.ts` ~23–44
    -   `app/components/chat/__tests__/finalizeNoJump.test.ts` ~6–24
    -   `app/components/chat/__tests__/restickDelay.test.ts` ~6–24
-   Deprecated shim:
    -   `app/utils/errors.ts` ~199+ (`useErrorToasts`)
-   Proxy alias:
    -   `app/db/files-util.ts` ~50–55 (`nowSecNumber`)

Line ranges are approximate and based on current repo state; adjust if surrounding code shifts.

---

## F. Risk & test notes

-   Parsing refactor (A.1) should not alter persisted `data` shape; add tests for malformed JSON and unknown `kind`.
-   CRUD composable (A.2) centralizes DB updates—verify existing hooks still fire (`useHooks()` wrappers in DB layer remain unchanged).
-   Test helper consolidation (A.4) is risk‑free; ensures consistent jsdom shims.
-   Removing `useErrorToasts` (B.1) is safe if no usages; if any, migrate to `reportError` to surface toasts consistently per docs.

---

## G. Optional future improvements

-   Consider storing project entries in a typed table instead of free‑form `data` to enable Dexie queries and remove ad‑hoc parsing entirely.
-   Add E2E smoke test to validate project tree interactions after refactors (expand, add/remove, rename).
