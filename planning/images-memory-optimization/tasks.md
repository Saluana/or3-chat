# Tasks: Images Grid Memory Optimization

artifact_id: 9d6ab2f0-3f5f-4d38-b79e-6ad52d6c0c9c

## 1. Build shared preview cache

-   [x] Implement `usePreviewCache` composable with LRU eviction (`ensure`, `promote`, `release`, `flushAll`). (Requirements: 1, 2)
-   [x] Add dev-only metrics accessor and console logging hook. (Requirements: 3)

## 2. Integrate cache with grid & viewer

-   [x] Refactor `GalleryGrid.vue` to use cache, supply viewport-aware eviction list, and flush on visibility change. (Requirements: 1)
-   [x] Update `ImageViewer.vue` to reuse cache entries and downgrade on close. (Requirements: 2)
-   [x] Wire options object (caps, device-memory defaults) in a single config module. (Requirements: 3)

## 3. Verification

-   [x] Add Vitest coverage for cache hit/miss/eviction and grid/viewer reuse. (Requirements: 1, 2)
-   [x] Document tuning knobs + dev logging in `docs/`. (Requirements: 3)
-   [ ] Manual scroll smoke: log heap snapshot before/after 500 images, confirm stay within cap. (Requirements: 1)
