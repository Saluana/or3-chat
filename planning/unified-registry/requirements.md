# Unified Registry System Requirements (S‑Tier Edition)

## Executive Summary
We need a **single, discoverable, strongly‑typed entry point** (`or3client`) that lets developers and plugin authors add UI actions, pages, tools, and services without hunting for scattered composables. The unified API must **wrap** existing registries/services rather than rewriting them, because those registries already encode important behavior (validation, async component handling, HMR persistence, and SSR‑safe no‑ops). This document spells out **every behavior that must be preserved** and adds concrete notes on how to implement each property so the migration is safe and predictable.

---

## 1) Current Reality (Inventory + Behavior Breakdown)
This section is **mandatory reading** before any implementation. Each item below is a real system in the codebase with **specific semantics** that cannot be lost.

### 1.1 Generic registry factory (`createRegistry`)
The base registry provides the following guarantees:
- **Global persistence via `globalThis`** for HMR survival.
- **Stable ordering** (order first, then id for deterministic ties).
- **Frozen payloads** to avoid external mutation after registration.
- **Reactive list access** via `useItems()` computed.
- **Convenience helpers**: `listIds()` and snapshot copy.

Implementation notes:
- `createRegistry` uses a Map stored on `globalThis`, a `shallowRef` list, and syncs after every mutation. It warns in dev if an ID is replaced, then freezes the item. These behaviors must remain intact if an adapter wraps it. 【F:app/composables/_registry.ts†L1-L86】

### 1.2 Sidebar Sections + Footer Actions
**Behavioral details:**
- Sections are grouped by placement (`top/main/bottom`).
- Footer actions are context‑aware (visibility + disabled state), then sorted by order.
- Both use `createRegistry` and default to order `200`.

Implementation notes:
- Adapters must preserve **grouped** output for sections (top/main/bottom) and the `SidebarFooterActionEntry` structure for footer actions (action + disabled). Flattening would lose UI semantics. 【F:app/composables/sidebar/useSidebarSections.ts†L100-L206】

### 1.3 Header Actions
**Behavioral details:**
- Accept route + mobile context.
- Filter visibility, compute disabled, then sort by order.

Implementation notes:
- The adapter should forward `context()` and return the computed list of `{ action, disabled }`, not just raw actions. 【F:app/composables/sidebar/useHeaderActions.ts†L10-L123】

### 1.4 Composer Actions
**Behavioral details:**
- Uses a manual Map + reactive list (not `createRegistry`).
- Freezes action payloads.
- Filters by visibility + disabled logic based on TipTap editor context.

Implementation notes:
- or3client must call existing `registerComposerAction`, `useComposerActions`, etc., rather than replacing with a generic registry to avoid breaking reactivity or visibility logic. 【F:app/composables/sidebar/useComposerActions.ts†L74-L182】

### 1.5 Sidebar Pages
**Behavioral details (critical):**
- Validates input via **Zod** (id pattern, label length, order bounds).
- Wraps async components in `defineAsyncComponent` with retry + timeout.
- Supports lifecycle hooks: `provideContext`, `canActivate`, `onActivate`, `onDeactivate`.
- Defaults `usesDefaultHeader` and `order` values.
- SSR guard: registration is a **no‑op** on server.
- Reactivity is manually triggered via a version counter.

Implementation notes:
- This is not just a list. Any adapter must preserve validation, wrapping, and lifecycle hooks as‑is. SSR no‑op is non‑negotiable. 【F:app/composables/sidebar/useSidebarPages.ts†L12-L292】

### 1.6 Dashboard Plugins + Pages
**Behavioral details:**
- Two registries: plugins + pages (per‑plugin map).
- Page component caching (avoid repeated async loads).
- Navigation state with explicit error handling (missing plugin/page, resolve errors).
- Pages can be inline on plugin registration (auto‑normalized).

Implementation notes:
- or3client should expose a **dashboard service** that wraps navigation and page resolution. A pure Registry<T> abstraction is insufficient. 【F:app/composables/dashboard/useDashboardPlugins.ts†L1-L620】

### 1.7 Pane Apps + Multi‑pane runtime
**Pane app registry behavior:**
- Validates with Zod (id pattern, label length, order bounds).
- Supports async component factories.
- Allows custom `postType` and `createInitialRecord` handler.

**Multi‑pane runtime behavior:**
- Stateful service with Dexie integration, persistence, and hook usage.

Implementation notes:
- Pane apps are a registry; multi‑pane is a service. They must remain **distinct** in the unified API. 【F:app/composables/core/usePaneApps.ts†L1-L176】【F:app/composables/core/useMultiPane.ts†L1-L240】

### 1.8 Editor nodes/marks/extensions
**Behavioral details:**
- Three registries (nodes, marks, extensions) each with ordering.
- Extensions can be lazy‑loaded via factories.
- Loader resolves factories and skips failed extensions.

Implementation notes:
- A single registry cannot represent this. or3client should expose `editor.nodes`, `editor.marks`, `editor.extensions`, and a `loader` helper. 【F:app/composables/editor/useEditorNodes.ts†L1-L170】【F:app/composables/editor/useEditorExtensionLoader.ts†L1-L132】

### 1.9 Tool registry (AI)
**Behavioral details:**
- Stores enabled state in localStorage (debounced persistence).
- Validates arguments against JSON schema.
- Executes tools with timeout + error handling, storing last error per tool.
- Returns enabled definitions for OpenRouter payloads.

Implementation notes:
- This is a service registry with stateful behavior; it must be exposed as such, not as a generic list. 【F:app/utils/chat/tool-registry.ts†L1-L357】

### 1.10 Hooks engine + Hook effect
**Behavioral details:**
- `useHooks()` returns typed engine or fallback.
- `useHookEffect()` auto‑cleans on unmount/HMR.

Implementation notes:
- The unified API must provide direct access to the typed hook engine and a helper for safe subscription. 【F:app/core/hooks/useHooks.ts†L1-L34】【F:app/composables/core/useHookEffect.ts†L1-L39】

### 1.11 Chat Input Bridge
**Behavioral details:**
- Registry of chat input APIs keyed by paneId.
- `programmaticSend` triggers the real input pipeline (so hooks fire).

Implementation notes:
- Treat as a service API, not a list registry. 【F:app/composables/chat/useChatInputBridge.ts†L1-L75】

---

## 2) Problems With the Original Plan
1. **It conflates registries and services**, which would break systems like dashboard navigation, tool execution, and multi‑pane state. 【F:app/composables/dashboard/useDashboardPlugins.ts†L1-L620】【F:app/utils/chat/tool-registry.ts†L1-L357】
2. **It ignores validation + normalization**, which are core to sidebar pages and pane apps. 【F:app/composables/sidebar/useSidebarPages.ts†L84-L176】【F:app/composables/core/usePaneApps.ts†L36-L140】
3. **It does not address SSR no‑ops** for client‑only registration paths (e.g., sidebar pages). 【F:app/composables/sidebar/useSidebarPages.ts†L178-L238】
4. **It lacks migration details**, leaving devs to reverse‑engineer composables to know what to wrap.

---

## 3) Requirements (Must‑Haves)

### 3.1 Unified entry point
- `useOR3Client()` (and `$or3client` injection) is the only import needed for extensions.
- Namespaces are organized by **domain** (`ui`, `ai`, `core`).

### 3.2 Preserve existing semantics
- Every adapter must preserve the semantics listed in Section 1.
- No breaking behavior: old composables must proxy to the unified API.

### 3.3 Extendability
- New extension points should be added by registering new adapter modules under `or3client`, not by editing core components.

### 3.4 SSR/client boundaries
- Server: new `OR3Client` instance per request.
- Client: singleton instance, HMR‑stable.
- Client‑only registries must no‑op or lazily initialize on SSR.

### 3.5 Typed discoverability
- Type exports must be centralized (re‑export from existing composables, **no duplication**).
- Provide `defineX` helpers for inference where needed.

### 3.6 Versioning
- The `OR3Client` interface must include a `version` field to enable future compatibility checks.
- Plugins can check `or3client.version` to verify API compatibility.

---

## 4) Non‑Goals
- Rewriting registries into a new system.
- Removing old composables immediately.
- Changing UI order or behavior.

---

## 5) Success Criteria
- Dev can type `useOR3Client().ui.sidebar...` and discover all extension points.
- Existing plugins continue to work unchanged.
- SSR does not leak registry state between requests.
- No regressions in:
  - Sidebar pages async loading
  - Tool registry persistence
  - Dashboard navigation
  - Zod validation for pane apps/pages
- All tests pass (unit + integration).
- No circular dependencies in import graph.
