# Implementation Tasks

- [ ] **Core Setup**
    - [ ] Create directory `app/core/or3client`.
    - [ ] Create `app/core/or3client/registry.ts` (Generic Registry implementation).
    - [ ] Create `app/core/or3client/types.ts` (Centralized types).
    - [ ] Create `app/core/or3client/index.ts` (The `OR3Client` class/factory).

- [ ] **Sub-Registries Implementation**
    - [ ] Implement `UIClient` class (manages `ui.*`).
    - [ ] Implement `AIClient` class (manages `ai.*`).
    - [ ] Port `ToolRegistry` logic to `app/core/or3client/ai/tools.ts`.

- [ ] **Nuxt Integration**
    - [ ] Create `app/plugins/or3client.ts`.
    - [ ] Export `useOR3Client` composable.

- [ ] **Migration (Phase 1: Proxies)**
    - [ ] Update `useSidebarSections.ts` to use `or3client.ui.sidebar.sections`.
    - [ ] Update `useMessageActions.ts` to use `or3client.ui.chat.messageActions`.
    - [ ] Update `useToolRegistry.ts` to use `or3client.ai.tools`.
    - [ ] Update other composables (`useHeaderActions`, `useProjectTreeActions`, etc.).

- [ ] **Cleanup**
    - [ ] Mark old `createRegistry` as deprecated (or remove if fully migrated).
    - [ ] Update documentation.
