# Tasks: Dashboard Plugin Navigation & Performance Improvements

**artifact_id:** 2103e7ad-051d-44e8-b8c8-77a3bb2e3135

## 1. Extend Dashboard Composable Navigation

-   [ ] Add navigation state and API (`useDashboardNavigation`) to `useDashboardPlugins.ts` (Requirements: 1, 6)
-   [ ] Implement handler dispatch, single-page routing, and multi-page landing logic within the composable (Requirements: 1)
-   [ ] Surface computed helpers (`dashboardItems`, `landingPages`, `headerPluginLabel`, `activePageTitle`) derived from shared state (Requirements: 1)
-   [ ] Provide structured error objects for missing plugin/page scenarios (Requirements: 1, 6)

## 2. Refactor `Dashboard.vue` to Use Composable State

-   [ ] Replace local refs (`activeView`, `activePluginId`, etc.) with composable bindings (Requirements: 1)
-   [ ] Remove duplicate helper functions (`openPage`, `goBack`, `resetToGrid`) from the component (Requirements: 1)
-   [ ] Adjust template bindings to use composable outputs (Requirements: 1)
-   [ ] Ensure the Tailwind modifiers use valid syntax (`!p-0`, `!hover:bg-…`) (Requirements: 2)

## 3. Consolidate Retro Utility Styling

-   [ ] Create shared stylesheet `app/assets/css/retro.css` with `.sr-only`, `.retro-chip`, `.retro-input` utilities (Requirements: 3)
-   [ ] Import the stylesheet in the global CSS entrypoint (Requirements: 3)
-   [ ] Update Theme/Ai dashboard pages to consume shared classes and remove duplicate scoped CSS (Requirements: 3)
-   [ ] Verify Tailwind builds without warnings & adjust docs (Requirements: 2, 6)

## 4. Optimize Gallery Grid Memory & Observer Behavior

-   [ ] Introduce managed blob URL cache with pruning for inactive items (Requirements: 4)
-   [ ] Add throttled re-observe mechanism to coalesce rapid updates (Requirements: 4)
-   [ ] Write unit tests covering cache lifecycle and throttle timing (Requirements: 4, 6)

## 5. Streamline Workspace Backup Base64 Handling

-   [ ] Implement chunked base64 encoding using streaming readers (Requirements: 5)
-   [ ] Document the 256 KB per-line invariant and update inline comments (Requirements: 5, 6)
-   [ ] Add regression tests for large export scenarios (Requirements: 5, 6)

## 6. Documentation & QA

-   [ ] Update dashboard plugin guide to mention navigation composable usage (Requirements: 6)
-   [ ] Expand docs with retro utility usage examples (Requirements: 3, 6)
-   [ ] Add testing notes to `docs/error-handling.md` or dedicated QA doc as appropriate (Requirements: 6)
