# tasks.v2.md

1. Registry & State

- [ ] Implement `app/composables/sidebar/useSidebarPages.ts` with global Map registry and sorted computed list.
- [ ] Add unit tests for registry (register, overwrite, async component wrapping, ordering).
- [ ] Create `app/composables/sidebar/useActiveSidebarPage.ts` handling state, persistence, activation hooks.

2. Default Page Extraction

- [ ] Move current `SideNavContent` body into `app/components/sidebar/SidebarHomePage.vue`.
- [ ] Register home page via new registry during app bootstrap (client plugin or composable init).
- [ ] Verify existing props/events still flow through (no behavioural drift).

3. `SideNavContent.vue` Refactor

- [ ] Replace inline `SidebarVirtualList` usage with dynamic page renderer + suspense/keepAlive support.
- [ ] Wire header visibility to `usesDefaultHeader`; forward events to active page via shared context.
- [ ] Emit analytics hook (`ui.sidebar.page:action:open`) when active page changes.
- [ ] Add regression test or snapshot for default page render.

4. Collapsed Navigation

- [ ] Inject page list into `SideNavContentCollapsed.vue` and render ordered icon buttons.
- [ ] Highlight active page, respect `page.canActivate`, and maintain keyboard accessibility.
- [ ] Provide visual regression/screenshot coverage if available.

5. Plugin DX Helpers

- [ ] Create `app/composables/sidebar/registerSidebarPage.ts` exporting register helper + HMR cleanup.
- [ ] Ship `useSidebarPageContext.ts` to expose shared APIs (multiPane, panePluginApi, setActivePage, resetToDefault).
- [ ] Update type exports/barrels so plugins import from a stable path.

6. Example & Migration Aids

- [ ] Update `custom-pane-todo-example.client.ts` to register a sidebar page that lists todos and opens panes.
- [ ] Add README/guide snippet explaining sidebar page + pane app interplay.
- [ ] Provide migration notes referencing V1 vs V2 behaviour.

7. Testing & QA

- [ ] Extend unit/integration tests covering page switching, error fallback, activation hooks.
- [ ] Ensure default sidebar interactions (search, new chat/doc/project, footer actions) still operate when default page active.
- [ ] Add E2E scenario toggling between default page and plugin page in collapsed + expanded modes.

8. Documentation & Hooks

- [ ] Document new APIs in `docs/sidebar-extensions.md` (or existing plugin docs).
- [ ] Update hook reference with `ui.sidebar.page:action:open`.
- [ ] Cross-link V2 docs from original Custom Pane Apps planning folder.
