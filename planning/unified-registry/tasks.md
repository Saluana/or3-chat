# Implementation Tasks (Expanded)

## Phase 0 — Discovery & Scoping (Required)
- [ ] **Inventory all extension points** and confirm their owners:
  - `createRegistry`‑based registries (message actions, header actions, etc.). 【F:app/composables/_registry.ts†L1-L86】
  - Custom registries (Dashboard, Sidebar Pages, Tool Registry). 【F:app/composables/dashboard/useDashboardPlugins.ts†L1-L620】【F:app/composables/sidebar/useSidebarPages.ts†L1-L292】【F:app/utils/chat/tool-registry.ts†L1-L357】
  - Services (Multi‑pane, Hooks, Chat Input Bridge). 【F:app/composables/core/useMultiPane.ts†L1-L240】【F:app/core/hooks/useHooks.ts†L1-L34】【F:app/composables/chat/useChatInputBridge.ts†L1-L75】
- [ ] **Define public type exports** by re‑exporting types from these sources.

## Phase 1 — Core Infrastructure
- [ ] Create `app/core/or3client/` with:
  - [ ] `client.ts` (OR3Client factory)
  - [ ] `types.ts` (re‑export registry/service types)
  - [ ] `adapters/` (per subsystem)
- [ ] Add Nuxt plugin: `app/plugins/or3client.ts` to inject `$or3client`.
- [ ] Add composable: `useOR3Client`.
- [ ] Add SSR guard utilities (e.g., `ensureClientOnly` or per‑adapter guards) for client‑only registries.

## Phase 2 — Simple Registry Adapters
Implement adapters that delegate to existing `createRegistry` composables.
- [ ] `ui.chat.messageActions` (useMessageActions). 【F:app/composables/chat/useMessageActions.ts†L1-L50】
- [ ] `ui.editor.toolbar` (useEditorToolbar). 【F:app/composables/editor/useEditorToolbar.ts†L1-L66】
- [ ] `ui.projects.treeActions` (useProjectTreeActions). 【F:app/composables/projects/useProjectTreeActions.ts†L1-L83】
- [ ] `ui.threads.historyActions` + `ui.documents.historyActions`. 【F:app/composables/threads/useThreadHistoryActions.ts†L1-L82】【F:app/composables/documents/useDocumentHistoryActions.ts†L1-L82】
- [ ] `ui.sidebar.sections` + `ui.sidebar.footerActions`. 【F:app/composables/sidebar/useSidebarSections.ts†L100-L206】
- [ ] `ui.sidebar.headerActions`. 【F:app/composables/sidebar/useHeaderActions.ts†L10-L123】

## Phase 3 — Complex Registry Adapters
- [ ] `ui.sidebar.pages` adapter over `useSidebarPages`.
  - Must preserve Zod validation, async component normalization, SSR no‑op registration, and lifecycle hooks. 【F:app/composables/sidebar/useSidebarPages.ts†L12-L292】
- [ ] `ui.dashboard` adapter over dashboard plugin/page registries + navigation service.
  - Must preserve component caching and error reporting. 【F:app/composables/dashboard/useDashboardPlugins.ts†L90-L620】
- [ ] `ui.editor.extensions` adapter over editor nodes/marks/extensions + loader.
  - Expose `nodes`, `marks`, `extensions`, `loader`. 【F:app/composables/editor/useEditorNodes.ts†L1-L170】【F:app/composables/editor/useEditorExtensionLoader.ts†L1-L132】
- [ ] `ai.tools` adapter over tool registry with persistence + execution. 【F:app/utils/chat/tool-registry.ts†L1-L357】
- [ ] `ui.panes.apps` adapter over `usePaneApps`.
  - Keep Zod validation and async component factories. 【F:app/composables/core/usePaneApps.ts†L36-L176】

## Phase 4 — Service Adapters
- [ ] `ui.panes.manager` adapter over `useMultiPane()`.
  - Provide a factory method rather than a singleton. 【F:app/composables/core/useMultiPane.ts†L1-L240】
- [ ] `ui.chat.inputBridge` adapter over chat input bridge functions. 【F:app/composables/chat/useChatInputBridge.ts†L1-L75】
- [ ] `core.hooks` adapter over `useHooks()` + `useHookEffect()`.
  - Expose typed `on/off/applyFilters/doAction` and helper registration. 【F:app/core/hooks/useHooks.ts†L1-L34】【F:app/composables/core/useHookEffect.ts†L1-L39】

## Phase 5 — Proxy Migration (Non‑Breaking)
- [ ] Update existing composables to call `useOR3Client()` under the hood.
- [ ] Add `@deprecated` tags to old API entry points but keep runtime behavior intact.

## Phase 6 — Documentation
- [ ] New docs page: `docs/` or `public/_documentation` entry for or3client.
- [ ] Update docmap.json to include unified registry docs.
- [ ] Provide a migration guide with before/after examples for plugin authors.

## Phase 7 — Validation & Testing
- [ ] Unit tests for adapters that wrap registry functions without altering behavior.
- [ ] SSR smoke tests to confirm no shared server state.
- [ ] Ensure HMR safety by verifying no duplicate registration warnings or missing items.

