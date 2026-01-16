# Implementation Tasks (Expanded + Readable)

This is a **step‑by‑step execution plan** with clear intent per phase. The goal is to avoid regressions while making the unified API discoverable and extensible.

---

## Phase 0 — Discovery & Scoping (Required)
**Outcome:** A complete inventory of all registries and services with their behavior preserved.
- [ ] Confirm all `createRegistry`‑based registries and document their ordering + filtering semantics. 【F:app/composables/_registry.ts†L1-L86】
- [ ] List all **non‑registry services** (multi‑pane, hooks, tool registry, chat input bridge) and mark them as service adapters. 【F:app/composables/core/useMultiPane.ts†L1-L240】【F:app/core/hooks/useHooks.ts†L1-L34】【F:app/utils/chat/tool-registry.ts†L1-L357】【F:app/composables/chat/useChatInputBridge.ts†L1-L75】
- [ ] Enumerate validation/normalization behavior for sidebar pages and pane apps (Zod + async components). 【F:app/composables/sidebar/useSidebarPages.ts†L84-L176】【F:app/composables/core/usePaneApps.ts†L36-L140】

---

## Phase 1 — Core Infrastructure
**Outcome:** A working `or3client` with type exports and Nuxt injection.
- [ ] Create `app/core/or3client/` directory.
  - [ ] `client.ts` with the `OR3Client` class and sub‑clients.
  - [ ] `types.ts` to re‑export types (no duplication).
  - [ ] `adapters/` folder for individual subsystem adapters.
- [ ] Add Nuxt plugin `app/plugins/or3client.ts` to inject `$or3client`.
- [ ] Add composable `useOR3Client` that returns injected client.
- [ ] Add SSR guard utilities for client‑only registries.

---

## Phase 2 — Simple Registry Adapters
**Outcome:** Core registry adapters that map cleanly to `createRegistry` composables.
- [ ] `ui.chat.messageActions` → `useMessageActions`. 【F:app/composables/chat/useMessageActions.ts†L1-L50】
- [ ] `ui.editor.toolbar` → `useEditorToolbarButtons`. 【F:app/composables/editor/useEditorToolbar.ts†L1-L66】
- [ ] `ui.projects.treeActions` → `useProjectTreeActions`. 【F:app/composables/projects/useProjectTreeActions.ts†L1-L83】
- [ ] `ui.threads.historyActions` → `useThreadHistoryActions`. 【F:app/composables/threads/useThreadHistoryActions.ts†L1-L82】
- [ ] `ui.documents.historyActions` → `useDocumentHistoryActions`. 【F:app/composables/documents/useDocumentHistoryActions.ts†L1-L82】
- [ ] `ui.sidebar.sections` and `ui.sidebar.footerActions` → `useSidebarSections` / `useSidebarFooterActions`. 【F:app/composables/sidebar/useSidebarSections.ts†L100-L206】
- [ ] `ui.sidebar.headerActions` → `useHeaderActions`. 【F:app/composables/sidebar/useHeaderActions.ts†L10-L123】

---

## Phase 3 — Complex Registry Adapters
**Outcome:** Wrap registries with additional logic (validation, caching, navigation).
- [ ] `ui.sidebar.pages` adapter over `useSidebarPages()`.
  - Preserve Zod validation, async component wrapping, SSR no‑op registration, and lifecycle hooks. 【F:app/composables/sidebar/useSidebarPages.ts†L12-L292】
- [ ] `ui.dashboard` adapter:
  - `plugins` → `registerDashboardPlugin` / `useDashboardPlugins`.
  - `pages` → `registerDashboardPluginPage` / `useDashboardPluginPages`.
  - `navigation` → `useDashboardNavigation` + `resolveDashboardPluginPageComponent`.
  - Preserve component cache + error handling. 【F:app/composables/dashboard/useDashboardPlugins.ts†L90-L620】
- [ ] `ui.editor.extensions` adapter:
  - `nodes`, `marks`, `extensions` registries + loader helpers.
  - Preserve lazy factory loading behavior. 【F:app/composables/editor/useEditorNodes.ts†L1-L170】【F:app/composables/editor/useEditorExtensionLoader.ts†L1-L132】
- [ ] `ai.tools` adapter:
  - Wrap `useToolRegistry()` (register, execute, enable/disable, list).
  - Preserve persistence, validation, timeout handling. 【F:app/utils/chat/tool-registry.ts†L1-L357】
- [ ] `ui.panes.apps` adapter:
  - Wrap `usePaneApps()` with Zod validation + async factories. 【F:app/composables/core/usePaneApps.ts†L36-L176】

---

## Phase 4 — Service Adapters
**Outcome:** Properly expose stateful services without pretending they’re lists.
- [ ] `ui.panes.manager` → `useMultiPane()` factory (do **not** singleton). 【F:app/composables/core/useMultiPane.ts†L1-L240】
- [ ] `ui.chat.inputBridge` → chat input bridge functions. 【F:app/composables/chat/useChatInputBridge.ts†L1-L75】
- [ ] `core.hooks` → `useHooks()` + `useHookEffect()` helper. 【F:app/core/hooks/useHooks.ts†L1-L34】【F:app/composables/core/useHookEffect.ts†L1-L39】

---

## Phase 5 — Proxy Migration (Non‑Breaking)
**Outcome:** Old composables remain functional but route through `or3client`.
- [ ] Update existing composables to call `useOR3Client()` internally.
- [ ] Add `@deprecated` JSDoc with replacement paths.
- [ ] Ensure no runtime behavior changes.

---

## Phase 6 — Documentation
**Outcome:** Plugin authors can discover and use the unified API quickly.
- [ ] New docs page for `or3client` in `public/_documentation`.
- [ ] Update `docmap.json` with the new entry.
- [ ] Provide migration examples (old vs new registration).

---

## Phase 7 — Validation & Testing
**Outcome:** Regression‑free rollout.
- [ ] Unit tests for adapters (ensure they delegate and preserve behavior).
- [ ] SSR smoke test: ensure per‑request isolation.
- [ ] HMR sanity checks: ensure no duplicate registry entries.

