# Implementation Tasks

- [ ] **Core Infrastructure**
    - [ ] Create `app/core/or3client` directory structure.
    - [ ] Implement `Registry<T>` generic class (with HMR support).
    - [ ] Implement `OR3Client` class and sub-clients (`UIClient`, `AIClient`, `CoreClient`).
    - [ ] Create `app/plugins/or3client.ts` Nuxt plugin.
    - [ ] Create `useOR3Client` composable.

- [ ] **Phase 1: Registry Migration (Simple Collections)**
    - [ ] **Sidebar**: Port `useSidebarSections`, `useHeaderActions` to `or3client.ui.sidebar`.
    - [ ] **Chat**: Port `useMessageActions` to `or3client.ui.chat`.
    - [ ] **Editor**: Port `useEditorToolbar` to `or3client.ui.editor`.
    - [ ] **Projects**: Port `useProjectTreeActions` to `or3client.ui.projects`.
    - [ ] **History**: Port `useThreadHistoryActions`, `useDocumentHistoryActions`.

- [ ] **Phase 2: Complex System Migration**
    - [ ] **Dashboard**: Refactor `useDashboardPlugins` into `or3client.ui.dashboard` (handle recursive page structure and navigation).
    - [ ] **AI Tools**: Refactor `tool-registry.ts` into `or3client.ai.tools`.
    - [ ] **Panes**: Wrap `multiPaneApi` into `or3client.ui.panes`.

- [ ] **Phase 3: Service Wrappers**
    - [ ] **Auth**: Wrap `useUser`/`useAuth` in `or3client.core.auth`.
    - [ ] **Theme**: Wrap `useTheme` in `or3client.core.theme`.
    - [ ] **Hooks**: Wrap `app/core/hooks` in `or3client.core.hooks`.

- [ ] **Phase 4: Cleanup & Documentation**
    - [ ] Update all old composables to proxy to `or3client`.
    - [ ] Add `@deprecated` warnings to old composables.
    - [ ] Write API documentation for `or3client`.
    - [ ] Verify HMR works for all registries.
