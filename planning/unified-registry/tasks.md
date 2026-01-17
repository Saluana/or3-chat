# Implementation Tasks (Expanded + Intern‑Friendly)

This is a **step‑by‑step execution plan** with clear intent per phase. The goal is to avoid regressions while making the unified API discoverable and extensible.

> [!IMPORTANT]
> Each task includes acceptance criteria and implementation hints. Complete tasks in order—later phases depend on earlier ones.

---

## Phase 0 — Discovery & Scoping (Required)

**Outcome:** A complete inventory of all registries and services with their behavior preserved.

**Why this matters:** You cannot wrap something you don't understand. This phase ensures no behavior is lost.

### Tasks

- [ ] **0.1** Read `app/composables/_registry.ts` and document:
  - How `globalThis` is used for HMR persistence
  - How ordering works (order first, then id)
  - How items are frozen after registration
  - What dev warnings exist for duplicate IDs
  
  **Acceptance:** You can explain the registry behavior to a teammate.
  
  【F:app/composables/_registry.ts†L1-L86】

- [ ] **0.2** List all `createRegistry`-based composables and their locations:
  - Sidebar sections
  - Footer actions  
  - Header actions
  - Message actions
  - Editor toolbar
  - Project tree actions
  - Thread history actions
  - Document history actions
  
  **Acceptance:** Spreadsheet/table with composable name, file path, and notes on any special behavior.

- [ ] **0.3** List all **non‑registry services** that need service adapters:
  - `useMultiPane()` — stateful pane management 【F:app/composables/core/useMultiPane.ts】
  - `useHooks()` — typed hook engine 【F:app/core/hooks/useHooks.ts】
  - `useToolRegistry()` — AI tool management 【F:app/utils/chat/tool-registry.ts】
  - `useChatInputBridge()` — programmatic chat input 【F:app/composables/chat/useChatInputBridge.ts】
  
  **Acceptance:** Each service documented with its key methods and state.

- [ ] **0.4** Document validation/normalization for complex registries:
  - Sidebar pages: Zod schema, async component wrapping, lifecycle hooks
  - Pane apps: Zod schema, async factories
  - Dashboard: inline page normalization, component caching
  
  **Acceptance:** Know exactly what validation exists and cannot be bypassed.
  
  【F:app/composables/sidebar/useSidebarPages.ts†L84-L176】
  【F:app/composables/core/usePaneApps.ts†L36-L140】
  【F:app/composables/dashboard/useDashboardPlugins.ts†L90-L200】

- [ ] **0.5** Document composer actions special handling:
  - Uses manual Map (not `createRegistry`)
  - TipTap editor context for visibility/disabled
  
  **Acceptance:** Understand why this cannot use standard registry adapter.
  
  【F:app/composables/sidebar/useComposerActions.ts†L74-L182】

---

## Phase 1 — Core Infrastructure

**Outcome:** A working `or3client` with type exports and Nuxt injection.

**Why this matters:** This is the foundation. Nothing else works without it.

### Directory Setup

- [ ] **1.1** Create directory structure:
  ```
  app/core/or3client/
  ├── index.ts
  ├── client.ts
  ├── types.ts
  ├── utils.ts
  ├── define.ts
  └── adapters/
      └── index.ts
  ```
  
  **How:** `mkdir -p app/core/or3client/adapters`

### Core Files

- [ ] **1.2** Create `utils.ts` with adapter interfaces:
  ```ts
  // RegistryAdapter<T> interface
  // ServiceAdapter<T> interface
  // clientOnlyAdapter() utility
  ```
  
  **Acceptance:** Types compile, clientOnlyAdapter returns no-op on server.
  
  **Reference:** See design.md Section 3 for exact interface definitions.

- [ ] **1.3** Create `types.ts` with re-exports:
  ```ts
  // Re-export types from source modules
  // DO NOT DUPLICATE TYPE DEFINITIONS
  export type { SidebarPageDef } from '~/composables/sidebar/useSidebarPages';
  // ... etc
  ```
  
  **Acceptance:** All type imports resolve. No duplicate type declarations.

- [ ] **1.4** Create `define.ts` with helper functions:
  ```ts
  export function defineSidebarPage(def: SidebarPageDef): SidebarPageDef { return def; }
  export function definePaneApp(def: PaneAppDef): PaneAppDef { return def; }
  export function defineTool(def: ToolDefinition): ToolDefinition { return def; }
  ```
  
  **Acceptance:** IDE autocomplete works when using defineX helpers.

- [ ] **1.5** Create `client.ts` with OR3Client class:
  ```ts
  export interface OR3Client {
    readonly version: 1;
    ui: UIClient;
    ai: AIClient;
    core: CoreClient;
  }
  
  export function createOR3Client(): OR3Client {
    // Return object with all namespace stubs
    // Adapters will be lazy-loaded
  }
  ```
  
  **Acceptance:** `createOR3Client()` returns typed object. TypeScript happy.

- [ ] **1.6** Create `index.ts` with exports:
  ```ts
  export { createOR3Client, type OR3Client } from './client';
  export * from './types';
  export * from './define';
  export { useOR3Client } from './composable';
  ```

- [ ] **1.7** Create composable `useOR3Client.ts`:
  ```ts
  export function useOR3Client(): OR3Client {
    const { $or3client } = useNuxtApp();
    if (!$or3client) {
      throw new Error('OR3Client not available. Ensure plugin is loaded.');
    }
    return $or3client;
  }
  ```

### Nuxt Integration

- [ ] **1.8** Create Nuxt plugin `app/plugins/or3client.ts`:
  ```ts
  export default defineNuxtPlugin(() => {
    const client = createOR3Client();
    return {
      provide: {
        or3client: client,
      },
    };
  });
  ```
  
  **Acceptance:** `useNuxtApp().$or3client` returns the client instance.

- [ ] **1.9** Verify SSR behavior:
  - Server: each request gets fresh client instance
  - Client: singleton client persists
  
  **How:** Add console.log in plugin, check server logs show multiple instances per request, browser console shows one instance.

---

## Phase 2 — Simple Registry Adapters

**Outcome:** Core registry adapters that map cleanly to `createRegistry` composables.

**Why this matters:** These are low-risk and build confidence before complex adapters.

### Implementation Pattern

For each adapter:
1. Create file in `app/core/or3client/adapters/`
2. Import from source composable
3. Return `RegistryAdapter<T>` that delegates to composable
4. Add to `adapters/index.ts` barrel export
5. Wire up in `client.ts`

### Tasks

- [ ] **2.1** `ui.chat.messageActions` adapter
  - **Wraps:** `registerMessageAction`, `useMessageActions`, `unregisterMessageAction`
  - **File:** `adapters/message-actions.ts`
  - **Test:** Register action, verify it appears in `useItems()`
  
  【F:app/composables/chat/useMessageActions.ts】

- [ ] **2.2** `ui.editor.toolbar` adapter
  - **Wraps:** `registerEditorToolbarButton`, `useEditorToolbarButtons`
  - **File:** `adapters/editor-toolbar.ts`
  
  【F:app/composables/editor/useEditorToolbar.ts】

- [ ] **2.3** `ui.projects.treeActions` adapter
  - **Wraps:** `registerProjectTreeAction`, `useProjectTreeActions`
  - **File:** `adapters/project-tree-actions.ts`
  
  【F:app/composables/projects/useProjectTreeActions.ts】

- [ ] **2.4** `ui.threads.historyActions` adapter
  - **Wraps:** `registerThreadHistoryAction`, `useThreadHistoryActions`
  - **File:** `adapters/thread-history-actions.ts`
  
  【F:app/composables/threads/useThreadHistoryActions.ts】

- [ ] **2.5** `ui.documents.historyActions` adapter
  - **Wraps:** `registerDocumentHistoryAction`, `useDocumentHistoryActions`
  - **File:** `adapters/document-history-actions.ts`
  
  【F:app/composables/documents/useDocumentHistoryActions.ts】

- [ ] **2.6** `ui.sidebar.sections` adapter
  - **Wraps:** `registerSidebarSection`, `useSidebarSections`, `unregisterSidebarSection`
  - **File:** `adapters/sidebar-sections.ts`
  - **Note:** Preserve grouped output (top/main/bottom)
  
  【F:app/composables/sidebar/useSidebarSections.ts】

- [ ] **2.7** `ui.sidebar.footerActions` adapter
  - **Wraps:** `registerSidebarFooterAction`, `useSidebarFooterActions`
  - **File:** `adapters/sidebar-footer-actions.ts`
  
  【F:app/composables/sidebar/useSidebarSections.ts】

- [ ] **2.8** `ui.sidebar.headerActions` adapter
  - **Wraps:** `registerHeaderAction`, `useHeaderActions`
  - **File:** `adapters/sidebar-header-actions.ts`
  - **Note:** Preserve context (route + mobile) handling
  
  【F:app/composables/sidebar/useHeaderActions.ts】

- [ ] **2.9** `ui.sidebar.composerActions` adapter
  - **Wraps:** `registerComposerAction`, `useComposerActions`, `unregisterComposerAction`
  - **File:** `adapters/sidebar-composer-actions.ts`
  - **Note:** This is NOT createRegistry-based. Uses manual Map. Preserve TipTap context filtering.
  
  【F:app/composables/sidebar/useComposerActions.ts】

---

## Phase 3 — Complex Registry Adapters

**Outcome:** Wrap registries with additional logic (validation, caching, navigation).

**Why this matters:** These registries have behavior that would break if simplified.

### Tasks

- [ ] **3.1** `ui.sidebar.pages` adapter
  - **Wraps:** `useSidebarPages()` return object
  - **File:** `adapters/sidebar-pages.ts`
  - **Must preserve:**
    - Zod validation (id pattern, label length, order bounds)
    - Async component wrapping with retry + timeout
    - SSR no-op registration (use `clientOnlyAdapter`)
    - Lifecycle hooks: `provideContext`, `canActivate`, `onActivate`, `onDeactivate`
  - **Test:** Register page with invalid id, verify Zod error thrown
  
  【F:app/composables/sidebar/useSidebarPages.ts】

- [ ] **3.2** `ui.dashboard.plugins` adapter
  - **Wraps:** `registerDashboardPlugin`, `useDashboardPlugins`
  - **File:** `adapters/dashboard-plugins.ts`
  - **Must preserve:** Inline page normalization
  
  【F:app/composables/dashboard/useDashboardPlugins.ts】

- [ ] **3.3** `ui.dashboard.pages` adapter
  - **Wraps:** `registerDashboardPluginPage`, `useDashboardPluginPages`
  - **File:** `adapters/dashboard-pages.ts`
  
  【F:app/composables/dashboard/useDashboardPlugins.ts】

- [ ] **3.4** `ui.dashboard.navigation` adapter
  - **Wraps:** `useDashboardNavigation`, `resolveDashboardPluginPageComponent`
  - **File:** `adapters/dashboard-navigation.ts`
  - **Must preserve:** Component cache + error handling state
  
  【F:app/composables/dashboard/useDashboardPlugins.ts】

- [ ] **3.5** `ui.editor.nodes` adapter
  - **Wraps:** `registerEditorNode`, `listEditorNodes`, `listRegisteredEditorNodeIds`
  - **File:** `adapters/editor-nodes.ts`
  
  【F:app/composables/editor/useEditorNodes.ts】

- [ ] **3.6** `ui.editor.marks` adapter
  - **Wraps:** `registerEditorMark`, `listEditorMarks`, `listRegisteredEditorMarkIds`
  - **File:** `adapters/editor-marks.ts`
  
  【F:app/composables/editor/useEditorNodes.ts】

- [ ] **3.7** `ui.editor.extensions` adapter
  - **Wraps:** `registerEditorExtension`, `listEditorExtensions`, `listRegisteredEditorExtensionIds`
  - **File:** `adapters/editor-extensions.ts`
  - **Must preserve:** Lazy factory support
  
  【F:app/composables/editor/useEditorNodes.ts】

- [ ] **3.8** `ui.editor.loader` adapter
  - **Wraps:** `loadEditorExtensions`, `createLazyNodeFactory`, `createLazyMarkFactory`, `createLazyExtensionFactory`
  - **File:** `adapters/editor-loader.ts`
  
  【F:app/composables/editor/useEditorExtensionLoader.ts】

- [ ] **3.9** `ai.tools` adapter
  - **Wraps:** `useToolRegistry()`
  - **File:** `adapters/tools.ts`
  - **Type:** Service adapter (not registry)
  - **Must preserve:**
    - localStorage persistence for enabled states
    - JSON schema validation
    - Timeout execution (30s)
    - Last error per tool
  - **Use:** `clientOnlyAdapter` for SSR safety
  
  【F:app/utils/chat/tool-registry.ts】

- [ ] **3.10** `ui.panes.apps` adapter
  - **Wraps:** `usePaneApps()` registry
  - **File:** `adapters/pane-apps.ts`
  - **Must preserve:**
    - Zod validation
    - Async component factories
    - Custom `postType` and `createInitialRecord`
  
  【F:app/composables/core/usePaneApps.ts】

---

## Phase 4 — Service Adapters

**Outcome:** Properly expose stateful services without pretending they're lists.

**Why this matters:** Services have state and methods—they're not just collections.

### Tasks

- [ ] **4.1** `ui.panes.manager` adapter
  - **Wraps:** `useMultiPane()` factory
  - **File:** `adapters/multi-pane.ts`
  - **Type:** Service adapter
  - **Note:** Do NOT singleton—each call gets fresh instance
  - **Use:** `clientOnlyAdapter` (Dexie integration)
  
  【F:app/composables/core/useMultiPane.ts】

- [ ] **4.2** `ui.chat.inputBridge` adapter
  - **Wraps:** `registerPaneInput`, `programmaticSend`, `unregisterPaneInput`, `hasPane`
  - **File:** `adapters/chat-input-bridge.ts`
  - **Type:** Service adapter
  
  【F:app/composables/chat/useChatInputBridge.ts】

- [ ] **4.3** `core.hooks` adapter
  - **Wraps:** `useHooks()` + `useHookEffect()` helper
  - **File:** `adapters/hooks.ts`
  - **Type:** Service adapter
  - **Interface:**
    ```ts
    interface HookClient {
      engine: ReturnType<typeof useHooks>;
      useEffect: typeof useHookEffect;
    }
    ```
  
  【F:app/core/hooks/useHooks.ts】
  【F:app/composables/core/useHookEffect.ts】

---

## Phase 5 — Proxy Migration (Non‑Breaking)

**Outcome:** Old composables remain functional but route through `or3client`.

**Why this matters:** Enables gradual adoption without breaking existing code.

> [!CAUTION]
> This phase has the highest risk of regressions. Read carefully.

### Pre-Flight Checks

- [ ] **5.0** Run circular dependency check:
  ```bash
  npx madge --circular app/core/or3client/
  ```
  
  **Acceptance:** No cycles detected.

- [ ] **5.1** Add feature flag for rollback:
  ```ts
  // nuxt.config.ts or .env
  FEATURE_OR3CLIENT_PROXY=true
  ```

### Migration Pattern

For each composable:

```ts
// BEFORE (original implementation)
export function registerSidebarSection(section: SidebarSection) {
  // original logic
}

// AFTER (proxy to or3client)
import { FEATURE_OR3CLIENT_PROXY } from '~/config/feature-flags';

// Keep original implementation as private
function _registerSidebarSection(section: SidebarSection) {
  // original logic
}

// Public export proxies through or3client
export function registerSidebarSection(section: SidebarSection) {
  if (FEATURE_OR3CLIENT_PROXY) {
    const { $or3client } = useNuxtApp();
    return $or3client.ui.sidebar.sections.register(section);
  }
  return _registerSidebarSection(section);
}
```

### Tasks

- [ ] **5.2** Update simple registry composables to proxy:
  - Message actions
  - Editor toolbar
  - Project tree actions
  - Thread/document history actions
  - Sidebar sections/footer actions/header actions

- [ ] **5.3** Update complex registry composables to proxy:
  - Sidebar pages
  - Dashboard plugins/pages
  - Editor nodes/marks/extensions
  - Pane apps

- [ ] **5.4** Update service composables to proxy:
  - Multi-pane
  - Tool registry
  - Chat input bridge
  - Hooks

- [ ] **5.5** Add `@deprecated` JSDoc to all proxied functions:
  ```ts
  /**
   * @deprecated Use `useOR3Client().ui.sidebar.sections.register()` instead.
   * This function will be removed in a future version.
   */
  export function registerSidebarSection(section: SidebarSection) { ... }
  ```

- [ ] **5.6** Verify no runtime behavior changes:
  - Run full test suite
  - Manual smoke test of all UI features

---

## Phase 6 — Documentation

**Outcome:** Plugin authors can discover and use the unified API quickly.

### Tasks

- [ ] **6.1** Create docs page `public/_documentation/or3client.md`:
  - Quick start guide
  - API reference for each namespace
  - Migration guide (old → new)
  - Examples for common use cases

- [ ] **6.2** Update `docmap.json` with new entry:
  ```json
  {
    "id": "or3client",
    "title": "OR3 Client API",
    "path": "_documentation/or3client.md",
    "category": "extension-api"
  }
  ```

- [ ] **6.3** Add inline JSDoc to all public APIs:
  - `useOR3Client()` and `$or3client`
  - Each defineX helper
  - Each adapter's public methods

- [ ] **6.4** Create migration examples document showing old vs new:
  ```ts
  // OLD
  import { registerSidebarPage } from '~/composables/sidebar/useSidebarPages';
  registerSidebarPage({ id: 'my-page', ... });
  
  // NEW
  const { ui } = useOR3Client();
  ui.sidebar.pages.register({ id: 'my-page', ... });
  ```

---

## Phase 7 — Validation & Testing

**Outcome:** Regression‑free rollout.

### Unit Tests

- [ ] **7.1** Test each adapter preserves behavior:
  ```ts
  describe('sidebar pages adapter', () => {
    it('validates id pattern via Zod', () => {
      expect(() => adapter.register({ id: 'INVALID' })).toThrow();
    });
    
    it('wraps async components', () => {
      adapter.register({ id: 'test', component: () => import('./Test.vue') });
      const page = adapter.get('test');
      expect(page.component.__asyncLoader).toBeDefined();
    });
  });
  ```

- [ ] **7.2** Test that `or3client.ui.X.register()` produces identical results to direct composable call:
  ```ts
  // Register via or3client
  or3client.ui.sidebar.pages.register(pageDef);
  const viaClient = or3client.ui.sidebar.pages.list();
  
  // Register via direct composable
  registerSidebarPage(pageDef);
  const viaDirect = listSidebarPages.value;
  
  expect(viaClient).toEqual(viaDirect);
  ```

### SSR Tests

- [ ] **7.3** SSR smoke test:
  ```ts
  it('creates isolated client per request', async () => {
    const response1 = await $fetch('/api/test-or3client-id');
    const response2 = await $fetch('/api/test-or3client-id');
    expect(response1.clientId).not.toBe(response2.clientId);
  });
  ```

- [ ] **7.4** Client-only adapters return no-op on server:
  ```ts
  it('sidebar pages adapter no-ops on server', () => {
    // In SSR context
    const adapter = sidebarPagesAdapter();
    adapter.register({ id: 'test', ... });
    expect(adapter.list()).toEqual([]); // No-op
  });
  ```

### HMR Tests

- [ ] **7.5** Manual HMR sanity check:
  1. Register a sidebar page
  2. Edit the page component file
  3. Verify HMR updates without duplicate entries
  4. Verify no console warnings about duplicate IDs

### Integration Tests

- [ ] **7.6** Full workflow tests:
  - Register dashboard plugin → navigate → verify page renders
  - Register tool → execute with valid args → verify result
  - Register sidebar page → navigate to it → verify lifecycle hooks fire

### Rollback Test

- [ ] **7.7** Test feature flag rollback:
  1. Set `FEATURE_OR3CLIENT_PROXY=true`, verify proxying works
  2. Set `FEATURE_OR3CLIENT_PROXY=false`, verify direct calls work
  3. No behavior difference between modes

---

## Acceptance Criteria Checklist

Before marking this project complete:

- [ ] `useOR3Client().ui.sidebar...` provides full autocomplete
- [ ] All existing plugins work without code changes
- [ ] SSR does not leak registry state between requests
- [ ] No circular dependencies in import graph
- [ ] All tests pass (unit + integration)
- [ ] Documentation complete and reviewed
- [ ] Feature flag rollback verified working
