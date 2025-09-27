# Tasks: Images Grid Performance & Cleanup

artifact_id: 7b1a1b0d-42c1-4e6b-9c51-64c68545ceff

## 1. Baseline & Guardrails

-   [x] Capture current heap snapshot after scrolling 200 images to document baseline memory (Requirements: 1, 4)
-   [x] Add regression notes to `docs/` or repo wiki describing current observer behavior (Requirements: 4)

## 2. Implement Preview URL Cache

-   [x] Introduce `Map`-based cache in `GalleryGrid.vue` to track `hash -> PreviewUrlCacheEntry` (Requirements: 1)
-   [x] Refactor `ensureUrl` to bail early when cache already holds a URL and to populate the cache after successful blob fetch (Requirements: 1)
-   [x] Create helper to revoke a single URL with try/catch and `reportError` tagging (Requirements: 1)
-   [x] Add watcher diffing `props.items` to call `revokeMissing` before scheduling observer rebinds (Requirements: 1)
-   [x] Ensure `onBeforeUnmount` calls `revokeAll` and clears the cache (Requirements: 1)

## 3. Throttle IntersectionObserver Rebinding

-   [x] Extract observer binding logic into `bindTiles()` that reuses a stored `IntersectionObserver` instance (Requirements: 2)
-   [x] Implement `scheduleObserve()` using `requestIdleCallback` with `setTimeout` fallback to batch rapid prop changes (Requirements: 2)
-   [x] Cancel pending scheduled jobs when new changes arrive, then invoke `bindTiles()` once per burst (Requirements: 2)
-   [x] Verify fallback path executes in environments without `requestIdleCallback` (Requirements: 2)

## 4. Images Page Cleanup

-   [x] Audit imports in `pages/images/index.vue`, removing any unused symbols (Requirements: 3)
-   [x] Consolidate mutation flag logic to reuse existing computed booleans within template & methods (Requirements: 3)
-   [x] Keep mutation union type localized with explanatory comment for future contributors (Requirements: 3)

## 5. Validation & Documentation

-   [x] Add unit/component tests covering URL revocation and throttled observer scheduling (Requirements: 4)
-   [ ] Run linting and Vitest suites to confirm no new warnings or failures (Requirements: 3, 4)
-   [ ] Update `docs/error-handling.md` or add new note summarizing cache + scheduler behavior (Requirements: 4)
-   [ ] Capture post-change memory profile to confirm improved cleanup under large scroll scenarios (Requirements: 1, 4)
