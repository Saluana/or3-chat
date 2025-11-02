# tasks.v2.md

1. Registry & State

- [x] Implement `app/composables/sidebar/useSidebarPages.ts` with global Map registry and sorted computed list.
- [x] Add unit tests for registry (register, overwrite, async component wrapping, ordering).
- [x] Create `app/composables/sidebar/useActiveSidebarPage.ts` handling state, persistence, activation hooks.

2. Default Page Extraction

- [x] Move current `SideNavContent` body into `app/components/sidebar/SidebarHomePage.vue`.
- [x] Register home page via new registry during app bootstrap (client plugin or composable init).
- [x] Refactor the component to consume the new sidebar helpers (projects/threads/docs) instead of prop drilling while keeping emitted events identical.

3. Sidebar Environment Layer

- [x] Implement `provideSidebarEnvironment` in `SideNavContent.vue` and export `SidebarEnvironmentKey`.
- [x] Create helper composables (`useSidebarProjects`, `useSidebarThreads`, `useSidebarDocuments`, `useSidebarSections`, `useSidebarMultiPane`, `useSidebarPostsApi`, `useSidebarPageControls`) with focused unit tests.
- [x] Build the trimmed `SidebarMultiPaneApi` adapter that delegates to `useMultiPane` but exposes only `{ openApp, openChat, openDoc, closePane, panes, activePaneId }`.

4. `SideNavContent.vue` Refactor

- [x] Replace inline `SidebarVirtualList` usage with dynamic page renderer + suspense/keepAlive support.
- [x] Wire header visibility to `usesDefaultHeader`; forward events to active page via inline emits while the environment handles data access.
- [x] Emit analytics hook (`ui.sidebar.page:action:open`) when active page changes.
- [x] Add regression test or snapshot for default page render.

5. Collapsed Navigation

- [ ] Inject page list into `SideNavContentCollapsed.vue` and render ordered icon buttons.
- [ ] Highlight active page, respect `page.canActivate`, and maintain keyboard accessibility.
- [ ] Provide visual regression/screenshot coverage if available.

6. Plugin DX Helpers

- [ ] Create `app/composables/sidebar/registerSidebarPage.ts` exporting register helper + HMR cleanup.
- [ ] Ship `useSidebarPageControls.ts` plus environment-backed helpers to surface multi-pane/posts APIs without tight coupling.
- [ ] Update type exports/barrels so plugins import from a stable path.

7. Example & Migration Aids

- [ ] Update `custom-pane-todo-example.client.ts` to register a sidebar page that lists todos and opens panes.
- [ ] Add README/guide snippet explaining sidebar page + pane app interplay.
- [ ] Provide migration notes referencing V1 vs V2 behaviour.

8. Testing & QA

- [ ] Extend unit/integration tests covering page switching, error fallback, activation hooks.
- [ ] Ensure default sidebar interactions (search, new chat/doc/project, footer actions) still operate when default page active.
- [ ] Add E2E scenario toggling between default page and plugin page in collapsed + expanded modes.

9. Documentation & Hooks

- [ ] Document new APIs in `docs/sidebar-extensions.md` (or existing plugin docs).
- [ ] Update hook reference with `ui.sidebar.page:action:open`.
- [ ] Cross-link V2 docs from original Custom Pane Apps planning folder.
