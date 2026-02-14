# Unified Registry Design: `or3client` (S‑Tier Spec)

## 1) Design Principles (What must never change)
1. **Adapter‑first**: Wrap existing registries/services instead of rewriting.
2. **Behavior‑preserving**: Validation, ordering, async loading, persistence, and HMR rules are part of the public API.
3. **SSR‑safe**: Server must be request‑scoped; client is singleton.
4. **Typed discoverability**: Types are exported from their source, not duplicated.
5. **Services are not registries**: Multi‑pane, tool registry, hooks, and chat input bridge remain services.
6. **Versioned API**: Include version field for plugin compatibility checks.

---

## 2) OR3 Client Shape (Public API)

### 2.1 Top‑level interface
```ts
export interface OR3Client {
  /** API version for plugin compatibility checks */
  readonly version: 1;
  
  ui: UIClient;
  ai: AIClient;
  core: CoreClient;
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
  // NOTE: models and prompts are reserved for future phases.
  // Do not implement until requirements are defined.
}
```

### 2.4 Core namespace
```ts
export interface CoreClient {
  hooks: HookClient;
  // NOTE: theme and search are reserved for future phases.
  // Do not implement until requirements are defined.
}
```

---

## 3) Adapter Contracts (How we wrap without breaking)

### 3.1 Registry Adapter (minimal and safe)
```ts
/**
 * Standard interface for registry adapters.
 * All methods delegate to existing composables—no new logic here.
 */
export interface RegistryAdapter<T extends { id: string }> {
  /** Register a new item. Delegates to existing composable. */
  register(item: T): void;
  
  /** Unregister by ID. Delegates to existing composable. */
  unregister(id: string): void;
  
  /** Get a single item by ID. Returns undefined if not found. */
  get(id: string): T | undefined;
  
  /** Non‑reactive snapshot of all items. */
  list(): Readonly<T[]>;
  
  /** Reactive list for use in Vue components. */
  useItems(): ComputedRef<readonly T[]>;
  
  /** List of all registered IDs. */
  listIds(): string[];
}
```

**Implementation rule:** This adapter **delegates** to existing composables; it does **not** re‑implement validation or sorting.

### 3.2 Service Adapter (for stateful systems)
```ts
/**
 * Standard interface for service adapters.
 * Returns the underlying service/composable instance.
 */
export interface ServiceAdapter<T> {
  /** Returns the service instance (calls underlying composable). */
  use(): T;
}
```

Use a service adapter for:
- `useMultiPane()`
- `useToolRegistry()`
- `useHooks()`
- `useChatInputBridge()`

### 3.3 SSR Guard Utility
```ts
/**
 * Wraps a registry adapter factory to return no-op on server.
 * Use this for client-only registries (sidebar pages, tools, etc).
 * 
 * @example
 * export const sidebarPagesAdapter = clientOnlyAdapter(() => {
 *   const api = useSidebarPages();
 *   return { ... };
 * });
 */
export function clientOnlyAdapter<T extends { id: string }>(
  factory: () => RegistryAdapter<T>
): RegistryAdapter<T> {
  // Server: return no-op adapter
  if (import.meta.server) {
    return {
      register: () => {},
      unregister: () => {},
      get: () => undefined,
      list: () => [],
      useItems: () => computed(() => []),
      listIds: () => [],
    };
  }
  // Client: call factory and return real adapter
  return factory();
}
```

---

## 4) Explicit Mapping to Current Systems (No Guessing)
Below we define the exact adapters and their backing implementations.

### 4.1 UI / Sidebar

| Adapter Path | Wraps | Source File |
|--------------|-------|-------------|
| `ui.sidebar.sections` | `registerSidebarSection`, `useSidebarSections`, `unregisterSidebarSection` | 【F:app/composables/sidebar/useSidebarSections.ts】 |
| `ui.sidebar.footerActions` | `registerSidebarFooterAction`, `useSidebarFooterActions` | 【F:app/composables/sidebar/useSidebarSections.ts】 |
| `ui.sidebar.headerActions` | `registerHeaderAction`, `useHeaderActions` | 【F:app/composables/sidebar/useHeaderActions.ts】 |
| `ui.sidebar.composerActions` | `registerComposerAction`, `useComposerActions`, `unregisterComposerAction` | 【F:app/composables/sidebar/useComposerActions.ts】 |
| `ui.sidebar.pages` | `useSidebarPages()` return object | 【F:app/composables/sidebar/useSidebarPages.ts】 |

**Why this matters:**
- Sections are grouped by placement (top/main/bottom). Any flattening breaks layout.
- Sidebar pages must keep Zod validation and async component wrapping.
- Composer actions use manual Map (not `createRegistry`); TipTap context filtering must be preserved.

### 4.2 UI / Dashboard

| Adapter Path | Wraps | Source File |
|--------------|-------|-------------|
| `ui.dashboard.plugins` | `registerDashboardPlugin`, `useDashboardPlugins` | 【F:app/composables/dashboard/useDashboardPlugins.ts】 |
| `ui.dashboard.pages` | `registerDashboardPluginPage`, `useDashboardPluginPages` | 【F:app/composables/dashboard/useDashboardPlugins.ts】 |
| `ui.dashboard.navigation` | `useDashboardNavigation`, `resolveDashboardPluginPageComponent` | 【F:app/composables/dashboard/useDashboardPlugins.ts】 |

**Why this matters:**
- Navigation state + error handling are part of the UI contract.

### 4.3 UI / Panes

| Adapter Path | Type | Wraps | Source File |
|--------------|------|-------|-------------|
| `ui.panes.apps` | Registry | `usePaneApps()` registry (with Zod validation) | 【F:app/composables/core/usePaneApps.ts】 |
| `ui.panes.manager` | Service | `useMultiPane()` service (stateful, not a registry) | 【F:app/composables/core/useMultiPane.ts】 |

### 4.4 UI / Chat

| Adapter Path | Type | Wraps | Source File |
|--------------|------|-------|-------------|
| `ui.chat.messageActions` | Registry | `registerMessageAction`, `useMessageActions` | 【F:app/composables/chat/useMessageActions.ts】 |
| `ui.chat.inputBridge` | Service | `registerPaneInput`, `programmaticSend`, `unregisterPaneInput`, `hasPane` | 【F:app/composables/chat/useChatInputBridge.ts】 |

### 4.5 UI / Editor

| Adapter Path | Wraps | Source File |
|--------------|-------|-------------|
| `ui.editor.toolbar` | `registerEditorToolbarButton`, `useEditorToolbarButtons` | 【F:app/composables/editor/useEditorToolbar.ts】 |
| `ui.editor.nodes` | `registerEditorNode`, `listEditorNodes`, `listRegisteredEditorNodeIds` | 【F:app/composables/editor/useEditorNodes.ts】 |
| `ui.editor.marks` | `registerEditorMark`, `listEditorMarks`, `listRegisteredEditorMarkIds` | 【F:app/composables/editor/useEditorNodes.ts】 |
| `ui.editor.extensions` | `registerEditorExtension`, `listEditorExtensions`, `listRegisteredEditorExtensionIds` | 【F:app/composables/editor/useEditorNodes.ts】 |
| `ui.editor.loader` | `loadEditorExtensions`, `createLazyNodeFactory`, `createLazyMarkFactory`, `createLazyExtensionFactory` | 【F:app/composables/editor/useEditorExtensionLoader.ts】 |

**Why this matters:**
- Nodes/marks/extensions are separate registries with ordering and lazy loader support.

### 4.6 UI / Projects + Threads + Documents

| Adapter Path | Wraps | Source File |
|--------------|-------|-------------|
| `ui.projects.treeActions` | `registerProjectTreeAction`, `useProjectTreeActions` | 【F:app/composables/projects/useProjectTreeActions.ts】 |
| `ui.threads.historyActions` | `registerThreadHistoryAction`, `useThreadHistoryActions` | 【F:app/composables/threads/useThreadHistoryActions.ts】 |
| `ui.documents.historyActions` | `registerDocumentHistoryAction`, `useDocumentHistoryActions` | 【F:app/composables/documents/useDocumentHistoryActions.ts】 |

### 4.7 AI / Tools

| Adapter Path | Type | Wraps | Source File |
|--------------|------|-------|-------------|
| `ai.tools` | Service | `useToolRegistry()` | 【F:app/utils/chat/tool-registry.ts】 |

**Why this matters:**
- Tool registry persists enabled states and validates JSON schema params; this cannot be flattened into a list.

### 4.8 Core / Hooks

| Adapter Path | Type | Wraps | Source File |
|--------------|------|-------|-------------|
| `core.hooks` | Service | `useHooks()` + `useHookEffect()` helper | 【F:app/core/hooks/useHooks.ts】【F:app/composables/core/useHookEffect.ts】 |

**Why this matters:**
- Hook subscription + cleanup patterns are a key extension mechanism; must remain typed and HMR‑safe.

---

## 5) SSR + HMR Rules (Implementation detail)

### 5.1 SSR
- **Server**: create `OR3Client` per request (no shared state).
- **Client**: singleton instance (provided by Nuxt plugin).
- For client‑only registries (sidebar pages, tools), adapters must use the `clientOnlyAdapter` utility (Section 3.3).

### 5.2 HMR
- Keep `globalThis` registries intact; no extra caching layers in adapters.
- Avoid duplicating registry items on hot reload; rely on existing `createRegistry` warnings.

---

## 6) Type Exports + Inference Helpers

### 6.1 Central types export
- A file like `app/core/or3client/types.ts` must **re‑export** types from their source composables, not re‑declare them.
- This prevents type drift and keeps "source of truth" clear.

```ts
// app/core/or3client/types.ts

// Re-export from source files - DO NOT DUPLICATE TYPES
export type { SidebarPageDef } from '~/composables/sidebar/useSidebarPages';
export type { SidebarSection } from '~/composables/sidebar/useSidebarSections';
export type { HeaderAction } from '~/composables/sidebar/useHeaderActions';
export type { ComposerAction } from '~/composables/sidebar/useComposerActions';
export type { DashboardPlugin, DashboardPluginPage } from '~/composables/dashboard/useDashboardPlugins';
export type { PaneApp } from '~/composables/core/usePaneApps';
export type { ToolDefinition } from '~/utils/chat/tool-registry';
// ... add more as adapters are implemented
```

### 6.2 `defineX` helpers
- Provide helpers like:
```ts
/**
 * Helper for type inference when defining a sidebar page.
 * This is purely for IDE autocomplete—it returns the input unchanged.
 */
export function defineSidebarPage(def: SidebarPageDef): SidebarPageDef {
  return def;
}

export function definePaneApp(def: PaneAppDef): PaneAppDef {
  return def;
}

export function defineTool(def: ToolDefinition): ToolDefinition {
  return def;
}
```
- This is purely for inference and consistency with `defineTool`.

---

## 7) Concrete Example: Sidebar Pages Adapter

This example shows the complete implementation pattern for a complex registry adapter.

```ts
// app/core/or3client/adapters/sidebar-pages.ts

import { computed } from 'vue';
import { useSidebarPages, type SidebarPageDef } from '~/composables/sidebar/useSidebarPages';
import { clientOnlyAdapter, type RegistryAdapter } from '../utils';

/**
 * Creates the sidebar pages adapter.
 * Wraps useSidebarPages() and preserves all existing behavior:
 * - Zod validation on register
 * - Async component wrapping with retry + timeout
 * - SSR no-op registration
 * - Lifecycle hooks (provideContext, canActivate, onActivate, onDeactivate)
 */
function createSidebarPagesAdapter(): RegistryAdapter<SidebarPageDef> {
  const api = useSidebarPages();
  
  return {
    register: api.registerSidebarPage,
    unregister: api.unregisterSidebarPage,
    get: api.getSidebarPage,
    list: () => api.listSidebarPages.value.slice(),
    useItems: () => api.listSidebarPages,
    listIds: () => api.listSidebarPages.value.map(p => p.id),
  };
}

// Export wrapped in clientOnlyAdapter for SSR safety
export const sidebarPagesAdapter = () => clientOnlyAdapter(createSidebarPagesAdapter);
```

**Key details preserved:**
- Zod validation
- Async component wrapping
- SSR no‑op registration
- Activation lifecycle hooks

---

## 8) Concrete Example: Simple Registry Adapter

This example shows the pattern for simpler registries using `createRegistry`.

```ts
// app/core/or3client/adapters/message-actions.ts

import { 
  registerMessageAction, 
  useMessageActions, 
  unregisterMessageAction,
  type MessageAction 
} from '~/composables/chat/useMessageActions';
import type { RegistryAdapter } from '../utils';

/**
 * Creates the message actions adapter.
 * This is a simple createRegistry-based adapter.
 */
export function messageActionsAdapter(): RegistryAdapter<MessageAction> {
  const { actions } = useMessageActions();
  
  return {
    register: registerMessageAction,
    unregister: unregisterMessageAction,
    get: (id) => actions.value.find(a => a.id === id),
    list: () => actions.value.slice(),
    useItems: () => actions,
    listIds: () => actions.value.map(a => a.id),
  };
}
```

---

## 9) Concrete Example: Service Adapter

This example shows the pattern for stateful services.

```ts
// app/core/or3client/adapters/hooks.ts

import { useHooks } from '~/core/hooks/useHooks';
import { useHookEffect } from '~/composables/core/useHookEffect';
import type { ServiceAdapter } from '../utils';

export interface HookClient {
  /** Get the typed hook engine instance */
  engine: ReturnType<typeof useHooks>;
  
  /** 
   * Subscribe to a hook with automatic cleanup on unmount/HMR.
   * This is a convenience wrapper around useHookEffect.
   */
  useEffect: typeof useHookEffect;
}

/**
 * Creates the hooks service adapter.
 */
export function hooksAdapter(): ServiceAdapter<HookClient> {
  return {
    use: () => ({
      engine: useHooks(),
      useEffect: useHookEffect,
    }),
  };
}
```

---

## 10) Migration Strategy (Safe, incremental)

### Phase 0 — Discovery & Scoping
Validate all requirements before writing code.

### Phase 1 — Core Infrastructure  
Create or3client skeleton + type exports.

### Phase 2 — Simple Registry Adapters
Wrap `createRegistry`-based composables (low risk).

### Phase 3 — Complex Registry Adapters
Wrap registries with validation/caching (medium risk).

### Phase 4 — Service Adapters
Wrap stateful services (medium risk).

### Phase 5 — Proxy Migration
Old composables call or3client internally (high risk—needs careful import graph audit).

### Phase 6 — Documentation
Plugin author docs + migration examples.

### Phase 7 — Validation & Testing
Regression tests + SSR/HMR checks.

See `tasks.md` for detailed task breakdown.

---

## 11) Rollback Strategy

If Phase 5 proxy migration causes issues:

1. **Feature flag**: Add `FEATURE_OR3CLIENT_PROXY` env var.
2. **Conditional routing**: Old composables check flag before delegating to or3client.
3. **Instant rollback**: Set flag to false to restore original behavior.

```ts
// Example rollback pattern in existing composable
export function registerSidebarSection(section: SidebarSection) {
  if (process.env.FEATURE_OR3CLIENT_PROXY === 'true') {
    return useOR3Client().ui.sidebar.sections.register(section);
  }
  // Original implementation
  return _registerSidebarSection(section);
}
```
