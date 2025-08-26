# tasks.md

artifact_id: 5f6c46d2-420e-4b5b-9dbb-c014e9ceaf73

## Task List (Max 3 Top-Level)

### 1. Implement unified sidebar search composable

-   [x] 1.1 Create `app/composables/useSidebarSearch.ts` modeled after `useThreadSearch` (Req: 1,4,5)
-   [x] 1.2 Define index schema `{ id, kind, title, updated_at }` and build logic merging threads, projects, docs (Req:1,2,3,4)
-   [x] 1.3 Implement rebuild signature check to avoid unnecessary rebuilds (Req:4)
-   [x] 1.4 Implement debounced `runSearch` with token cancellation (Req:1,4,5)
-   [x] 1.5 Implement fallback substring path (single pass) if Orama import/search fails (Req:4)
-   [x] 1.6 Expose `{ query, threadResults, projectResults, documentResults, ready, busy }` (Req:5)
-   [ ] 1.7 Unit tests for logic (empty, match across kinds, fallback) (Req:8)

### 2. Integrate composable into sidebar UI

-   [x] 2.1 Replace `useThreadSearch` usage in `SideNavContent.vue` with new composable (Req:1,6)
-   [x] 2.2 Bind existing search input `v-model` to unified `query` and add `aria-label="Search"` (Req:1,7)
-   [x] 2.3 Adjust `displayThreads` to use `threadResults` (Req:1)
-   [x] 2.4 Add computed to filter projects + their entries when query active (Req:2)
-   [x] 2.5 Add computed to filter documents list when query active (Req:3)
-   [x] 2.6 Insert empty state placeholders for projects/documents when no matches (Req:2,3)
-   [x] 2.7 ESC key handler to clear query if focused (Req:7)
-   [ ] 2.8 Verify create/rename/delete unaffected (manual smoke) (Req:6)

### 3. Testing & Performance Verification

-   [ ] 3.1 Unit tests for project containment filtering (Req:2,3,8)
-   [ ] 3.2 Unit test clearing query restores originals (Req:6,8)
-   [ ] 3.3 Mock failure path to cover fallback branch (Req:4,8)
-   [ ] 3.4 Lightweight performance test with synthetic ~1500 items measuring build + first search under threshold (Req:4,8)
-   [ ] 3.5 Add brief README snippet or doc comment in composable explaining usage (Req:5)

## Mapping Summary

-   Requirements 1: Tasks 1.1-1.6,2.1-2.5
-   Requirements 2: Tasks 1.2,2.4,3.1
-   Requirements 3: Tasks 1.2,2.5,2.6,3.1
-   Requirements 4: Tasks 1.2,1.3,1.4,1.5,3.3,3.4
-   Requirements 5: Tasks 1.1,1.4,1.6,3.5
-   Requirements 6: Tasks 2.1,2.8,3.2
-   Requirements 7: Tasks 2.2,2.7
-   Requirements 8: Tasks 1.7,3.1-3.4
