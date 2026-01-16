# Unified Registry System Requirements (S‑Tier Edition)

## Executive Summary
We want a single developer‑friendly entry point (`or3client`) that is **discoverable**, **extendable**, and **safe** across SSR/client boundaries. The current plan is too vague and ignores crucial implementation realities (e.g., validation, async component wrapping, per-request SSR isolation, persistent tool state, and HMR behaviors). This document captures *all* existing registry patterns, their quirks, and the required semantics so we can unify them without breaking anything.

---

## 1) Current Reality (Inventory + Known Behaviors)
This section is **not optional**. Every item below exists today and must be preserved by `or3client`.

### 1.1 Generic registry factory
- `createRegistry()` provides a global Map‑backed registry with:
  - stable sort (order + id),
  - immutable items (frozen),
  - `useItems()` computed list,
  - HMR‑safe `globalThis` storage.
  - Default ordering: 200. 【F:app/composables/_registry.ts†L1-L86】

### 1.2 UI registries with custom behaviors
- **Sidebar Sections / Footer Actions**
  - `createRegistry`‑based with contextual visibility/disabled handling, placement grouping, and computed lists. 【F:app/composables/sidebar/useSidebarSections.ts†L1-L206】
- **Header Actions**
  - Context‑aware visibility/disabled with route + mobile info. 【F:app/composables/sidebar/useHeaderActions.ts†L1-L123】
- **Composer Actions**
  - Uses global Map (not `createRegistry`), tracks a reactive list manually, supports visibility/disabled in editor context. 【F:app/composables/sidebar/useComposerActions.ts†L1-L182】
- **Sidebar Pages**
  - Validated via Zod, wraps async component factories using `defineAsyncComponent`, has activation hooks, default header handling, SSR no‑op registration on server, and explicit reactive invalidation via a version counter. 【F:app/composables/sidebar/useSidebarPages.ts†L1-L292】
- **Dashboard Plugins & Pages**
  - Complex: global plugin registry, per‑plugin page registry, page component caching, navigation state, and error handling. Also normalizes async components and supports plugin page resolution. 【F:app/composables/dashboard/useDashboardPlugins.ts†L1-L620】
- **Pane Apps**
  - Zod validation, supports async component factories, optional `postType`, and initial record creation. Reactivity via registry copy. 【F:app/composables/core/usePaneApps.ts†L1-L176】
- **Multi‑pane runtime**
  - Not a registry but a stateful service with Dexie queries, hook integration, and localStorage persistence. It must remain a service, not a list registry. 【F:app/composables/core/useMultiPane.ts†L1-L240】
- **Project Tree Actions / Message Actions / History Actions / Editor Toolbar**
  - These use `createRegistry` with ordering and filtered computed lists. 【F:app/composables/projects/useProjectTreeActions.ts†L1-L83】【F:app/composables/chat/useMessageActions.ts†L1-L50】【F:app/composables/threads/useThreadHistoryActions.ts†L1-L82】【F:app/composables/documents/useDocumentHistoryActions.ts†L1-L82】【F:app/composables/editor/useEditorToolbar.ts†L1-L66】

### 1.3 Editor extension registries
- Nodes/marks/extensions have **three** registries, explicit ordering, manual reactive lists, and allow lazy extension factories. 【F:app/composables/editor/useEditorNodes.ts†L1-L170】
- Extension loader resolves lazy factories and skips failures. 【F:app/composables/editor/useEditorExtensionLoader.ts†L1-L132】

### 1.4 Tool registry (AI)
- Stores **enabled state** in localStorage and debounces persistence.
- Validates arguments against JSON schema, enforces timeouts, exposes `getEnabledDefinitions` and `executeTool`.
- Registry state is HMR‑safe and uses shallow reactive Map. 【F:app/utils/chat/tool-registry.ts†L1-L357】

### 1.5 Hooks engine
- `useHooks()` provides the typed global hook engine, with fallback if no Nuxt injection exists. 【F:app/core/hooks/useHooks.ts†L1-L34】
- `useHookEffect()` provides safe cleanup across unmount/HMR. 【F:app/composables/core/useHookEffect.ts†L1-L39】

### 1.6 Chat input bridge (imperative API)
- Global registry of chat input handlers with safe programmatic send and HMR behavior. This is *not* a simple list registry; it’s a service API. 【F:app/composables/chat/useChatInputBridge.ts†L1-L75】

---

## 2) Why the Original Plan Is Insufficient
### Missing or under‑specified pieces:
1. **Registry heterogeneity** is ignored. Many “registries” are not list‑only (Dashboard, Sidebar Pages, Tools, Multi‑pane). A single generic `Registry<T>` is not enough. 【F:app/composables/dashboard/useDashboardPlugins.ts†L1-L620】【F:app/composables/sidebar/useSidebarPages.ts†L1-L292】【F:app/utils/chat/tool-registry.ts†L1-L357】
2. **SSR boundaries** are non‑trivial. Some registries are client‑only or guard with `process.client` (Sidebar Pages). `or3client` must preserve SSR no‑op behavior without leaking global state across requests. 【F:app/composables/sidebar/useSidebarPages.ts†L178-L238】
3. **Validation and normalization** are required (Zod for pane apps + sidebar pages, async component normalization, markRaw). If the unified API doesn’t mirror this, it will regress developer experience and runtime safety. 【F:app/composables/core/usePaneApps.ts†L36-L140】【F:app/composables/sidebar/useSidebarPages.ts†L84-L176】
4. **HMR behaviors** differ per system. `createRegistry` already warns on duplicate IDs and freezes payloads; other registries manage their own reactivity. A single “Registry<T>” class cannot overwrite these patterns without re‑implementing the nuanced behaviors. 【F:app/composables/_registry.ts†L29-L86】【F:app/composables/sidebar/useComposerActions.ts†L76-L138】
5. **Service boundaries** are blurred. Multi‑pane, tool registry, chat input bridge, and hooks are stateful services; they are not pure registries. Treating them as just registries will be a functional regression. 【F:app/composables/core/useMultiPane.ts†L1-L240】【F:app/utils/chat/tool-registry.ts†L1-L357】【F:app/composables/chat/useChatInputBridge.ts†L1-L75】

---

## 3) Requirements (Must‑Haves)

### 3.1 Unified entry point (developer UX)
- `useOR3Client()` (and/or auto‑injected `$or3client`) is the single source of truth.
- `or3client` must expose **typed**, **discoverable** namespaces (e.g., `ui.sidebar.pages`, `ai.tools`, `core.hooks`).

### 3.2 Preserve existing semantics
- **No breaking behavior**: existing composables must continue to work by proxying to the new API.
- Preserve existing HMR behavior, warnings, item freezing, validation, component wrapping, error handling, and localStorage persistence.

### 3.3 Extendability
- The unified API must be *itself* extendable: a new feature should be able to add a namespace or registry without rewriting core.
- Must support “service‑style” sub‑clients (not only lists).

### 3.4 SSR/client boundaries
- Per‑request isolation on server, singleton on client.
- Client‑only registries must no‑op or lazily initialize in SSR contexts.

### 3.5 Types are the product
- Provide a central type map and registry interfaces that mirror existing shapes.
- Provide `defineX()` helpers where better inference is needed (similar to `defineTool`).

---

## 4) Non‑Goals
- Rewriting internal systems (Dashboard, Multi‑pane, Tool Registry) is **out of scope** for initial unification.
- Removing existing composables is **not** required for the first iteration.
- Changing UI behavior or ordering is **explicitly forbidden**.

---

## 5) Success Criteria
- Dev can type `useOR3Client().ui...` and discover all extension points.
- Existing plugin registrations still work unchanged.
- SSR does not leak state between requests.
- No regressions in:
  - Sidebar pages async loading
  - Tool registry persistence
  - Dashboard navigation
  - Zod validation for pane apps/pages

