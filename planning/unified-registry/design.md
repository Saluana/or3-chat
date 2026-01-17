# Unified Registry Design: `or3client` (S‑Tier Spec)

## 1) Design Principles (What must never change)
1. **Adapter‑first**: Wrap existing registries/services instead of rewriting.
2. **Behavior‑preserving**: Validation, ordering, async loading, persistence, and HMR rules are part of the public API.
3. **SSR‑safe**: Server must be request‑scoped; client is singleton.
4. **Typed discoverability**: Types are exported from their source, not duplicated.
5. **Services are not registries**: Multi‑pane, tool registry, hooks, and chat input bridge remain services.

---

## 2) OR3 Client Shape (Public API)

### 2.1 Top‑level interface
```ts
export interface OR3Client {
  ui: UIClient;
  ai: AIClient;
  core: CoreClient;
  plugins?: PluginClient; // reserved for future
}
```

### 2.2 UI namespace
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
```

### 2.3 AI namespace
```ts
export interface AIClient {
  tools: ToolClient;
  models: ModelClient;  // wrapper around model store/service
  prompts: PromptClient; // system prompts + templates
}
```

### 2.4 Core namespace
```ts
export interface CoreClient {
  hooks: HookClient;
  theme: ThemeClient;
  search: SearchClient;
}
```

---

## 3) Adapter Contracts (How we wrap without breaking)

### 3.1 Registry Adapter (minimal and safe)
```ts
export interface RegistryAdapter<T> {
  register(item: T): void;
  unregister(id: string): void;
  list(): Readonly<T[]>;           // non‑reactive snapshot
  useItems(): ComputedRef<readonly T[]>; // reactive list
  listIds(): string[];
}
```

**Implementation rule:** this adapter **delegates** to existing composables; it does **not** re‑implement validation or sorting.

### 3.2 Service Adapter (for stateful systems)
```ts
export interface ServiceAdapter<T> {
  use(): T;              // returns existing composable/service instance
  get?(): T;             // optional singleton getter for stateless services
}
```

Use a service adapter for:
- `useMultiPane()`
- `useToolRegistry()`
- `useHooks()`
- `useChatInputBridge()`

---

## 4) Explicit Mapping to Current Systems (No Guessing)
Below we define the exact adapters and their backing implementations.

### 4.1 UI / Sidebar
- `ui.sidebar.sections` → wraps `registerSidebarSection`, `useSidebarSections`, `unregisterSidebarSection`.
- `ui.sidebar.footerActions` → wraps `registerSidebarFooterAction`, `useSidebarFooterActions`.
- `ui.sidebar.headerActions` → wraps `registerHeaderAction`, `useHeaderActions`.
- `ui.sidebar.composerActions` → wraps `registerComposerAction`, `useComposerActions`.
- `ui.sidebar.pages` → wraps `useSidebarPages()` return object.

**Why this matters:**
- Sections are grouped by placement (top/main/bottom). Any flattening breaks layout. 【F:app/composables/sidebar/useSidebarSections.ts†L100-L206】
- Sidebar pages must keep Zod validation and async component wrapping. 【F:app/composables/sidebar/useSidebarPages.ts†L84-L176】

### 4.2 UI / Dashboard
- `ui.dashboard.plugins` → `registerDashboardPlugin`, `useDashboardPlugins`.
- `ui.dashboard.pages` → `registerDashboardPluginPage`, `useDashboardPluginPages`.
- `ui.dashboard.navigation` → `useDashboardNavigation`, `resolveDashboardPluginPageComponent`.

**Why this matters:**
- Navigation state + error handling are part of the UI contract. 【F:app/composables/dashboard/useDashboardPlugins.ts†L90-L620】

### 4.3 UI / Panes
- `ui.panes.apps` → `usePaneApps()` registry (with Zod validation). 【F:app/composables/core/usePaneApps.ts†L36-L176】
- `ui.panes.manager` → `useMultiPane()` service (stateful, not a registry). 【F:app/composables/core/useMultiPane.ts†L1-L240】

### 4.4 UI / Chat
- `ui.chat.messageActions` → `registerMessageAction`, `useMessageActions`.
- `ui.chat.inputBridge` → `registerPaneInput`, `programmaticSend`, `unregisterPaneInput`, `hasPane`. 【F:app/composables/chat/useChatInputBridge.ts†L1-L75】

### 4.5 UI / Editor
- `ui.editor.toolbar` → `registerEditorToolbarButton`, `useEditorToolbarButtons`.
- `ui.editor.nodes` → `registerEditorNode`, `listEditorNodes`, `listRegisteredEditorNodeIds`.
- `ui.editor.marks` → `registerEditorMark`, `listEditorMarks`, `listRegisteredEditorMarkIds`.
- `ui.editor.extensions` → `registerEditorExtension`, `listEditorExtensions`, `listRegisteredEditorExtensionIds`.
- `ui.editor.loader` → `loadEditorExtensions` + `createLazyNodeFactory` / `createLazyMarkFactory` / `createLazyExtensionFactory`.

**Why this matters:**
- Nodes/marks/extensions are separate registries with ordering and lazy loader support. 【F:app/composables/editor/useEditorNodes.ts†L1-L170】【F:app/composables/editor/useEditorExtensionLoader.ts†L1-L132】

### 4.6 UI / Projects + Threads + Documents
- `ui.projects.treeActions` → `registerProjectTreeAction`, `useProjectTreeActions`.
- `ui.threads.historyActions` → `registerThreadHistoryAction`, `useThreadHistoryActions`.
- `ui.documents.historyActions` → `registerDocumentHistoryAction`, `useDocumentHistoryActions`.

### 4.7 AI / Tools
- `ai.tools` → `useToolRegistry()`.

**Why this matters:**
- Tool registry persists enabled states and validates JSON schema params; this cannot be flattened into a list. 【F:app/utils/chat/tool-registry.ts†L1-L357】

### 4.8 Core / Hooks
- `core.hooks` → `useHooks()` + `useHookEffect()` helper.

**Why this matters:**
- Hook subscription + cleanup patterns are a key extension mechanism; must remain typed and HMR‑safe. 【F:app/core/hooks/useHooks.ts†L1-L34】【F:app/composables/core/useHookEffect.ts†L1-L39】

---

## 5) SSR + HMR Rules (Implementation detail)

### 5.1 SSR
- **Server**: create `OR3Client` per request (no shared state).
- **Client**: singleton instance (provided by Nuxt plugin).
- For client‑only registries (sidebar pages, tools), adapters must **no‑op** or lazily initialize when `process.server` is true.

### 5.2 HMR
- Keep `globalThis` registries intact; no extra caching layers in adapters.
- Avoid duplicating registry items on hot reload; rely on existing `createRegistry` warnings.

---

## 6) Type Exports + Inference Helpers

### 6.1 Central types export
- A file like `app/core/or3client/types.ts` must **re‑export** types from their source composables, not re‑declare them.
- This prevents type drift and keeps “source of truth” clear.

### 6.2 `defineX` helpers
- Provide helpers like:
```ts
export function defineSidebarPage(def: SidebarPageDef): SidebarPageDef {
  return def;
}
```
- This is purely for inference and consistency with `defineTool`.

---

## 7) Concrete Example (Sidebar Pages Adapter)
```ts
import { useSidebarPages } from '~/composables/sidebar/useSidebarPages';

export function sidebarPagesAdapter() {
  const api = useSidebarPages();
  return {
    register: api.registerSidebarPage,
    unregister: api.unregisterSidebarPage,
    get: api.getSidebarPage,
    list: () => api.listSidebarPages.value.slice(),
  };
}
```

**Key details preserved:** Zod validation, async component wrapping, SSR no‑op registration, activation lifecycle hooks. 【F:app/composables/sidebar/useSidebarPages.ts†L84-L292】

---

## 8) Migration Strategy (Safe, incremental)
1. **Phase 0**: Add or3client skeleton + type re‑exports.
2. **Phase 1**: Wrap simple registries (message actions, editor toolbar, tree actions).
3. **Phase 2**: Wrap complex registries (dashboard, sidebar pages, tools, pane apps).
4. **Phase 3**: Proxy existing composables to or3client; add deprecations.
5. **Phase 4**: Update docs + examples.

