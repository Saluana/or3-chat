# Unified Registry Design: `or3client` (S‑Tier Spec)

## 1) Design Principles
1. **Adapter‑first**: Wrap existing registries/services instead of rewriting them.
2. **Preserve semantics**: Behaviors like validation, ordering, and persistence are part of the public API.
3. **Explicit SSR boundaries**: server instances are per‑request; client is singleton.
4. **Typed, discoverable API**: everything lives under a namespaced client with known types.
5. **Composable services are *not* registries**: Multi‑pane, tool registry, hooks, chat input bridge, etc. remain services.

---

## 2) OR3 Client Shape

### 2.1 Client structure (top‑level)
```ts
export interface OR3Client {
  ui: UIClient;
  ai: AIClient;
  core: CoreClient;
  plugins: PluginClient; // optional future extension
}
```

### 2.2 Sub‑clients
```ts
export interface UIClient {
  sidebar: SidebarClient;
  dashboard: DashboardClient;
  chat: ChatClient;
  editor: EditorClient;
  panes: PaneClient;
  projects: ProjectClient;
  threads: ThreadClient;
  documents: DocumentClient;
}

export interface AIClient {
  tools: ToolClient;
  models: ModelClient;
  prompts: PromptClient;
}

export interface CoreClient {
  hooks: HookClient;
  theme: ThemeClient;
  search: SearchClient;
}
```

---

## 3) Registry Adapter Contract
We **do not** use a single `Registry<T>` for everything. Instead we define a minimal adapter interface and implement it per system, using the *existing* registry/composable internally.

```ts
export interface RegistryAdapter<T> {
  register(item: T): void;
  unregister(id: string): void;
  list(): Readonly<T[]>; // non‑reactive snapshot
  useItems(): ComputedRef<readonly T[]>; // reactive list
  listIds(): string[];
}
```

- Each adapter delegates to the existing registry functions, preserving behaviors (freeze, sorting, validation, HMR).
- Adapters are **thin** and must not re‑implement logic.

---

## 4) Mapping: Existing APIs → or3client
This section *defines the new API surface* and explicitly references current implementations to avoid guessing.

### 4.1 UI / Sidebar
| or3client | Current implementation | Notes |
| --- | --- | --- |
| `ui.sidebar.sections` | `registerSidebarSection`, `useSidebarSections`, `unregisterSidebarSection` | Grouped by placement + computed sorting. 【F:app/composables/sidebar/useSidebarSections.ts†L100-L206】 |
| `ui.sidebar.footerActions` | `registerSidebarFooterAction`, `useSidebarFooterActions` | Contextual visible/disabled. 【F:app/composables/sidebar/useSidebarSections.ts†L116-L205】 |
| `ui.sidebar.headerActions` | `registerHeaderAction`, `useHeaderActions` | Route + mobile context. 【F:app/composables/sidebar/useHeaderActions.ts†L10-L123】 |
| `ui.sidebar.composerActions` | `registerComposerAction`, `useComposerActions` | Manual registry sync; visibility + disabled. 【F:app/composables/sidebar/useComposerActions.ts†L74-L182】 |
| `ui.sidebar.pages` | `useSidebarPages()` | Zod validation, async components, SSR no‑op registration. 【F:app/composables/sidebar/useSidebarPages.ts†L84-L292】 |

### 4.2 UI / Dashboard
- `ui.dashboard.plugins`: adapter over `registerDashboardPlugin` / `useDashboardPlugins`.
- `ui.dashboard.pages`: adapter over `registerDashboardPluginPage` / `useDashboardPluginPages`.
- `ui.dashboard.navigation`: adapter over `useDashboardNavigation` + `resolveDashboardPluginPageComponent`.
- Preserve navigation state, error handling, and async component resolution. 【F:app/composables/dashboard/useDashboardPlugins.ts†L1-L620】

### 4.3 UI / Panes & Multi‑pane
- `ui.panes.apps`: adapter for `usePaneApps` registry. 【F:app/composables/core/usePaneApps.ts†L1-L176】
- `ui.panes.manager`: a service wrapper around `useMultiPane()`. This is **not** a registry. 【F:app/composables/core/useMultiPane.ts†L1-L240】

### 4.4 UI / Chat & Editor
- `ui.chat.messageActions`: adapter to `registerMessageAction` / `useMessageActions`. 【F:app/composables/chat/useMessageActions.ts†L1-L50】
- `ui.chat.inputBridge`: service adapter to `useChatInputBridge` (register pane input, programmatic send). 【F:app/composables/chat/useChatInputBridge.ts†L1-L75】
- `ui.editor.toolbar`: adapter to `registerEditorToolbarButton` / `useEditorToolbarButtons`. 【F:app/composables/editor/useEditorToolbar.ts†L1-L66】
- `ui.editor.extensions`: **three registries** (nodes/marks/extensions) with lazy loading support; should be exposed as sub‑clients rather than a single flat registry. 【F:app/composables/editor/useEditorNodes.ts†L1-L170】【F:app/composables/editor/useEditorExtensionLoader.ts†L1-L132】

### 4.5 UI / Projects / Threads / Documents
- `ui.projects.treeActions`: adapter to `registerProjectTreeAction` / `useProjectTreeActions`. 【F:app/composables/projects/useProjectTreeActions.ts†L1-L83】
- `ui.threads.historyActions`: adapter to `registerThreadHistoryAction` / `useThreadHistoryActions`. 【F:app/composables/threads/useThreadHistoryActions.ts†L1-L82】
- `ui.documents.historyActions`: adapter to `registerDocumentHistoryAction` / `useDocumentHistoryActions`. 【F:app/composables/documents/useDocumentHistoryActions.ts†L1-L82】

### 4.6 AI / Tools
- `ai.tools` maps to `useToolRegistry()`.
- Must preserve: enabled persistence, timeout execution, JSON schema validation, `getEnabledDefinitions`. 【F:app/utils/chat/tool-registry.ts†L1-L357】

### 4.7 Core / Hooks
- `core.hooks` maps to `useHooks()` and `useHookEffect()`.
- The adapter must expose `on`, `off`, `doAction`, `applyFilters`, and optional helper `useHookEffect`. 【F:app/core/hooks/useHooks.ts†L1-L34】【F:app/composables/core/useHookEffect.ts†L1-L39】

---

## 5) SSR + HMR Strategy
### 5.1 SSR rules
- The `OR3Client` instance is **per‑request** on the server.
- Client uses a singleton (normal Nuxt plugin state).
- Client‑only systems (Sidebar Pages, Tool Registry) should be **lazy** and/or no‑op on server. 【F:app/composables/sidebar/useSidebarPages.ts†L178-L238】【F:app/utils/chat/tool-registry.ts†L1-L357】

### 5.2 HMR rules
- Respect existing HMR behavior in registries (globalThis maps + warnings).
- Provide wrapper methods that do not add extra state; keep registry ownership where it is today.

---

## 6) Types & DX
### 6.1 Central types export
Provide a single public export path (e.g., `~/core/or3client/types`) that re‑exports registry types **verbatim** from existing files. This prevents duplicate source of truth.

### 6.2 defineX helpers
Follow the tool registry pattern (see `defineTool` in tools‑public) for any area where inference is weak (e.g., sidebar pages, dashboard pages). The helper should simply return its input but improve inference.

---

## 7) Example: Adapter Implementation (Sidebar Sections)
```ts
import {
  registerSidebarSection,
  unregisterSidebarSection,
  useSidebarSections,
  type SidebarSection,
} from '~/composables/sidebar/useSidebarSections';

export const sidebarSectionsAdapter: RegistryAdapter<SidebarSection> = {
  register: registerSidebarSection,
  unregister: unregisterSidebarSection,
  useItems: () => useSidebarSections().value.main, // or return grouped API
  list: () => useSidebarSections().value.main.slice(),
  listIds: listRegisteredSidebarSectionIds,
};
```

> Note: some registries return **grouped** data (`useSidebarSections`). Adapters should preserve these shapes; do not flatten unless explicitly required by UI.

---

## 8) Migration Strategy
1. **Phase 0:** Create the client with empty adapters (types only).
2. **Phase 1:** Adapt “simple registries” (message actions, editor toolbar, tree actions).
3. **Phase 2:** Adapt complex registries (dashboard, sidebar pages, tools, pane apps).
4. **Phase 3:** Proxies: update old composables to call `or3client` internally.
5. **Phase 4:** Deprecation tags and docs.

This keeps risk low while still delivering discoverability.

