# Design: Theme Custom Components

## Table of Contents
- [Section A — Problem Statement & Prior Art](#section-a)
- [Section B — Architecture Overview](#section-b)
- [Section C — Type System (`types.ts`)](#section-c)
- [Section D — Component Registry (`theme-components-registry.ts`)](#section-d)
- [Section E — Plugin Integration (`90.theme.client.ts`)](#section-e)
- [Section F — Compilation Pass-through](#section-f)
- [Section G — Injection Sites & Props Contracts](#section-g)
- [Section H — External Theme Support](#section-h)
- [Section I — Error Handling & Fallbacks](#section-i)
- [Section J — SSR Considerations](#section-j)
- [Section K — HMR & Dev Experience](#section-k)
- [Section L — Testing Strategy](#section-l)

---

<a id="section-a"></a>
## Section A — Problem Statement & Prior Art

### Why not a per-instance composable?
The intuitive approach is a `useThemeComponent('chat-message', Fallback)` composable that each component instance calls during setup. This creates a local `computed()` watcher per-instance.

**Cost analysis for a 500-message chat thread:**
| Metric | Per-instance composable | Global map (this design) |
|---|---|---|
| Vue watchers created | 500 | 0 |
| Closures allocated | 500 | 0 |
| Theme-switch dependency flush | 500 graph nodes | 1 shallowRef trigger |
| Memory overhead | ~40KB (80 bytes × 500) | ~0KB |

The per-instance approach is $O(n)$ in the number of rendered instances. This design is $O(1)$.

### Why not `provide/inject`?
Vue's `provide/inject` could propagate a component map down the tree without per-instance `computed()`. However:
1. It requires careful placement of `provide()` at a high-enough ancestor.
2. `inject()` still allocates per-call in every consuming component's setup.
3. It doesn't play well with Nuxt's plugin-level global state pattern.

The `$theme` plugin is already globally accessible via `useNuxtApp().$theme`. Adding one more property to it is zero-cost and consistent with the existing architecture.

---

<a id="section-b"></a>
## Section B — Architecture Overview

```
┌────────────────────────────────────────────────────────────────────┐
│                        Theme Activation Flow                       │
│                                                                    │
│  theme.ts (author)                                                 │
│    └─ customComponents: { 'chat-message': './comp/MyMsg.vue' }     │
│                                                                    │
│  ┌──────────────┐    ┌──────────────────────┐    ┌──────────────┐  │
│  │ theme-manifest│───▶│ 90.theme.client.ts   │───▶│ ThemePlugin  │  │
│  │ .ts           │    │ ensureThemeLoaded()   │    │ .$theme      │  │
│  │               │    │                      │    │              │  │
│  │ Vite glob     │    │ compiledTheme =      │    │ active       │  │
│  │ discovers     │    │   { ...definition,   │    │ Components   │  │
│  │ .vue files    │    │     customComponents │    │ : ShallowRef │  │
│  └──────────────┘    │   }                   │    └──────┬───────┘  │
│                      │                      │           │          │
│  ┌──────────────┐    │ createThemeComponent  │           │          │
│  │ theme-comps-  │◀──│ Map(dirName, custom,  │           │          │
│  │ registry.ts   │    │      defaults)        │           │          │
│  │               │───▶│                      │           │          │
│  │ Returns map:  │    │ activeComponents     │           │          │
│  │ Record<Key,   │    │ .value = newMap      │───────────┘          │
│  │   Component>  │    └──────────────────────┘                     │
│  └──────────────┘                                                  │
│                                                                    │
│  Consuming templates:                                              │
│    <component :is="$theme.activeComponents.value['chat-message']"> │
│    Zero computed(), zero watchers, O(1) dictionary read.           │
└────────────────────────────────────────────────────────────────────┘
```

**Core principles:**
1. **Single source of truth**: `$theme.activeComponents` is the one `ShallowRef` holding the entire component map.
2. **Atomic swap**: When `setActiveTheme()` runs, the map is rebuilt from scratch and assigned as a whole object. Vue's reactivity system triggers exactly one update cycle.
3. **Lazy loading**: Custom overrides use `defineAsyncComponent(loader)`. The `.vue` chunk is only fetched when the component first renders.
4. **Memoization**: `defineAsyncComponent` wrappers are cached by `themeDirName:key` so switching back to a previously used theme reuses the same async chunk reference (no re-download, no component identity change).

---

<a id="section-c"></a>
## Section C — Type System (`types.ts`)

### C.1 — The `AppThemeComponent` union type

```typescript
/**
 * Strict union of component keys that themes are allowed to override.
 * Adding a new key here is the ONLY step needed to make a new component overridable.
 */
export type AppThemeComponent =
    | 'sidebar'              // SideBar.vue — expanded desktop nav
    | 'sidebar-collapsed'    // SideNavContentCollapsed.vue — mobile/compact nav
    | 'chat-page'            // ChatContainer.vue — top-level chat orchestrator
    | 'chat-message'         // ChatMessage.vue — individual message block
    | 'chat-input'           // ChatInputDropper.vue — composer/text area
    | 'document-editor'      // DocumentEditorAsync — document editing pane
    | 'dashboard-modal'      // Dashboard.vue — settings/dashboard modal
    | 'model-selector'       // ModelSelect.vue — model dropdown
    | 'system-prompts-modal' // SystemPromptsModal.vue — system prompt picker
    | 'model-catalog-modal'  // ModelCatalog.vue — model catalog browser
    | 'sidebar-auth-button'  // SidebarAuthButton.vue — profile/auth block
    | 'documentation-shell'  // DocumentationShell.vue — docs layout wrapper
    | 'workflow-status';     // WorkflowExecutionStatus.vue — agentic task tree
```

### C.2 — ThemeDefinition changes

```typescript
export interface ThemeDefinition {
    // ... all existing properties unchanged ...

    /**
     * Map core application component keys to custom Vue files in the theme folder.
     * 
     * Paths are relative to the theme directory root:
     *   customComponents: { 'chat-message': './components/MyMessage.vue' }
     * 
     * Only keys defined in AppThemeComponent are accepted.
     * Missing keys fall back to the application's built-in component.
     */
    customComponents?: Partial<Record<AppThemeComponent, string>>;
}
```

### C.3 — CompiledTheme changes

```typescript
export interface CompiledTheme {
    // ... all existing properties unchanged ...

    /** Pass-through of resolved custom component paths from the definition */
    customComponents?: Partial<Record<AppThemeComponent, string>>;
}
```

### C.4 — ThemePlugin changes

```typescript
import type { Component, ShallowRef } from 'vue';

export interface ThemePlugin {
    // ... all existing properties unchanged ...

    /** 
     * Global O(1) component lookup map. 
     * Each key resolves to either the default built-in or a theme-provided async override.
     * Reassigned atomically on every theme switch.
     */
    activeComponents: ShallowRef<Record<AppThemeComponent, Component>>;
}
```

---

<a id="section-d"></a>
## Section D — Component Registry (`theme-components-registry.ts`)

New file: `app/theme/_shared/theme-components-registry.ts`

### D.1 — Vite glob index

```typescript
/**
 * Static Vite analysis pass that indexes every .vue file inside theme directories.
 * These are lazy loaders — the actual chunk is only fetched on first use.
 * 
 * The glob pattern `../*\/**\/*.vue` captures files like:
 *   ../retro/components/CustomSidebar.vue  →  key: "../retro/components/CustomSidebar.vue"
 *   ../cyberpunk/comp/MyChat.vue           →  key: "../cyberpunk/comp/MyChat.vue"
 */
const themeVueModules = import.meta.glob('../*/**/*.vue', {
    import: 'default',
}) as Record<string, () => Promise<Component>>;
```

**Important**: The `import: 'default'` option ensures we receive the component's default export directly rather than a module wrapper. This makes the loader compatible with `defineAsyncComponent()` without extra unwrapping.

### D.2 — Async chunk memoization cache

```typescript
/**
 * Cache for defineAsyncComponent wrappers.
 * Key: `${themeDirName}:${componentKey}` (e.g. "cyberpunk:chat-message")
 * 
 * Why memoize?
 * Vue uses reference identity to determine if a <component :is="X"> changed.
 * If we create a NEW defineAsyncComponent wrapper on every theme activation,
 * Vue will unmount and remount even if the underlying loader is identical.
 * Memoizing preserves reference stability across theme re-activations.
 */
const asyncChunkCache = new Map<string, Component>();
```

### D.3 — Default component map

```typescript
import SideBar from '~/components/sidebar/SideBar.vue';
import SideNavContentCollapsed from '~/components/sidebar/SideNavContentCollapsed.vue';
import ChatContainer from '~/components/chat/ChatContainer.vue';
import ChatMessage from '~/components/chat/ChatMessage.vue';
import ChatInputDropper from '~/components/chat/ChatInputDropper.vue';
import ModelSelect from '~/components/chat/ModelSelect.vue';
import SidebarAuthButton from '~/components/sidebar/SidebarAuthButton.vue';
import DocumentationShell from '~/components/DocumentationShell.vue';
import WorkflowExecutionStatus from '~/components/chat/WorkflowExecutionStatus.vue';

// Lazy defaults for heavier components (modals/editors behind user action)
const DashboardModalDefault = defineAsyncComponent(
    () => import('~/components/dashboard/Dashboard.vue')
);
const SystemPromptsModalDefault = defineAsyncComponent(
    () => import('~/components/chat/SystemPromptsModal.vue')
);
const ModelCatalogModalDefault = defineAsyncComponent(
    () => import('~/components/modal/ModelCatalog.vue')
);
const DocumentEditorDefault = defineAsyncComponent(
    () => import('~/components/documents/DocumentEditor.vue')
);

/**
 * The canonical default component for every overridable key.
 * This is the fallback used when a theme does not specify a custom override.
 */
export const CORE_APP_COMPONENT_DEFAULTS: Record<AppThemeComponent, Component> = {
    'sidebar': SideBar,
    'sidebar-collapsed': SideNavContentCollapsed,
    'chat-page': ChatContainer,
    'chat-message': ChatMessage,
    'chat-input': ChatInputDropper,
    'document-editor': DocumentEditorDefault,
    'dashboard-modal': DashboardModalDefault,
    'model-selector': ModelSelect,
    'system-prompts-modal': SystemPromptsModalDefault,
    'model-catalog-modal': ModelCatalogModalDefault,
    'sidebar-auth-button': SidebarAuthButton,
    'documentation-shell': DocumentationShell,
    'workflow-status': WorkflowExecutionStatus,
};
```

**Design decision**: Components that are always visible on screen load (sidebar, chat-message, chat-input) use direct eager imports. Components behind modals or lazy panes (dashboard, system-prompts, model-catalog, document-editor) use `defineAsyncComponent` even in the defaults map — this keeps the main bundle small regardless of whether themes override them.

### D.4 — `createThemeComponentMap()`

```typescript
/**
 * Creates a complete component map for a given theme.
 * 
 * @param themeDirName - The directory name of the theme (e.g. "retro", "cyberpunk")
 * @param customConfig - The theme's customComponents declaration (may be empty/undefined)
 * @param defaults     - The CORE_APP_COMPONENT_DEFAULTS map
 * @returns A Record<AppThemeComponent, Component> ready for assignment to shallowRef
 */
export function createThemeComponentMap(
    themeDirName: string,
    customConfig: Partial<Record<AppThemeComponent, string>> = {},
    defaults: Record<AppThemeComponent, Component> = CORE_APP_COMPONENT_DEFAULTS
): Record<AppThemeComponent, Component> {
    // Shallow clone — we never mutate the defaults object
    const map = { ...defaults };

    for (const [key, relativePath] of Object.entries(customConfig)) {
        const componentKey = key as AppThemeComponent;

        // Normalize theme-relative path to Vite glob key
        let globKey = relativePath;
        if (globKey.startsWith('./')) {
            globKey = `../${themeDirName}/${globKey.slice(2)}`;
        }

        const loader = themeVueModules[globKey];
        if (!loader) {
            if (import.meta.dev) {
                console.warn(
                    `[theme:components] Custom component "${relativePath}" for key "${key}" ` +
                    `not found in theme "${themeDirName}". Using default. ` +
                    `Expected Vite glob key: "${globKey}".`
                );
            }
            continue; // default stays in place
        }

        // Memoize the defineAsyncComponent wrapper
        const cacheKey = `${themeDirName}:${componentKey}`;
        if (!asyncChunkCache.has(cacheKey)) {
            asyncChunkCache.set(cacheKey, defineAsyncComponent(loader));
        }
        map[componentKey] = asyncChunkCache.get(cacheKey)!;
    }

    return map;
}
```

### D.5 — Cache invalidation (HMR only)

```typescript
/**
 * Clears the async chunk cache for a specific theme.
 * Called during HMR when a theme's definition changes.
 */
export function invalidateThemeComponentCache(themeDirName: string): void {
    for (const key of asyncChunkCache.keys()) {
        if (key.startsWith(`${themeDirName}:`)) {
            asyncChunkCache.delete(key);
        }
    }
}
```

---

<a id="section-e"></a>
## Section E — Plugin Integration (`90.theme.client.ts`)

### E.1 — Initialization

At the top of the plugin, after the manifest is loaded and `themeRegistry` is created:

```typescript
import { shallowRef } from 'vue';
import { 
    createThemeComponentMap, 
    CORE_APP_COMPONENT_DEFAULTS,
    invalidateThemeComponentCache 
} from '~/theme/_shared/theme-components-registry';

// Initialize with defaults — no theme override yet
const activeComponents = shallowRef<Record<AppThemeComponent, Component>>(
    { ...CORE_APP_COMPONENT_DEFAULTS }
);
```

### E.2 — Integration into `ensureThemeLoaded()`

Where the `CompiledTheme` object is assembled (around line 384 in the current codebase):

```typescript
const compiledTheme: CompiledTheme = {
    name: definition.name,
    // ... all existing properties ...
    customComponents: definition.customComponents,  // ← NEW: pass through
};
```

This is a pure pass-through. The `customComponents` dictionary travels from the `ThemeDefinition` authored by the theme into the `CompiledTheme` stored in `themeRegistry`.

### E.3 — Integration into `setActiveTheme()`

After the theme is fully loaded and CSS/backgrounds are applied (end of `setActiveTheme`, before `bumpResolversVersion()`):

```typescript
// Rebuild the component map for the newly active theme
const manifest = themeManifest.get(target);
const compiled = themeRegistry.get(target);
if (manifest && compiled) {
    activeComponents.value = createThemeComponentMap(
        manifest.dirName,
        compiled.customComponents,
        CORE_APP_COMPONENT_DEFAULTS
    );
}
```

**Critical**: `activeComponents.value = newMap` performs an atomic reassignment. Vue's `shallowRef` triggers exactly one update cycle. All `<component :is="$theme.activeComponents.value[key]">` bindings across the entire app re-evaluate simultaneously.

### E.4 — Expose on ThemePlugin

```typescript
const themeApi: ThemePlugin = {
    // ... all existing properties ...
    activeComponents,  // ← NEW
};
```

---

<a id="section-f"></a>
## Section F — Compilation Pass-through

The `customComponents` field requires **no transformation** during compilation. Unlike `overrides` (which are parsed, scored for specificity, and compiled), component paths are simple strings that only need to exist in the Vite glob index at runtime.

The compilation step is therefore a direct pass-through:
```
ThemeDefinition.customComponents → CompiledTheme.customComponents
```

No changes needed in `compiler-core.ts`.

---

<a id="section-g"></a>
## Section G — Injection Sites & Props Contracts

This section documents every location in the codebase where a default component will be replaced by a `<component :is="...">` binding, and the props/events contract that custom components **must** satisfy.

### G.1 — `sidebar` 
**File**: `app/components/PageShell.vue` (line ~4)  
**Current**: `<SidenavSideBar ref="sideNavExpandedRef" :active-thread="..." @chat-selected="..." @new-chat="..." @new-document="..." @document-selected="..." @toggle-dashboard="..." />`  
**Props contract**:
| Prop | Type | Required |
|---|---|---|
| `activeThread` | `string \| null` | Yes |

**Events contract**:
| Event | Payload |
|---|---|
| `chat-selected` | `string` (threadId) |
| `new-chat` | none |
| `new-document` | none |
| `document-selected` | `string` (docId) |
| `toggle-dashboard` | none |

### G.2 — `sidebar-collapsed`
**File**: `app/components/PageShell.vue` (line ~15)  
**Current**: `<sidebar-side-nav-content-collapsed :active-thread="..." @new-chat="..." @new-document="..." @new-project="..." @focus-search="..." @toggle-dashboard="..." @expand-sidebar="..." />`  
**Props contract**:
| Prop | Type | Required |
|---|---|---|
| `activeThread` | `string \| null` | Yes |

**Events contract**:
| Event | Payload |
|---|---|
| `new-chat` | none |
| `new-document` | none |
| `new-project` | none |
| `focus-search` | none |
| `toggle-dashboard` | none |
| `expand-sidebar` | none |

### G.3 — `chat-message`
**File**: `app/components/chat/ChatContainer.vue` (line ~38)  
**Current**: `<LazyChatMessage :message="item" :thread-id="props.threadId" @retry="..." @continue="..." @branch="..." @edited="..." @begin-edit="..." @cancel-edit="..." @save-edit="..." />`  
**⚠️ Performance-critical**: This component is rendered inside a virtual-scroll `v-for`. There must be **zero per-instance computed overhead**. The `<component :is="...">` binding reads directly from `$theme.activeComponents.value['chat-message']`.  
**Props contract**:
| Prop | Type | Required |
|---|---|---|
| `message` | `UiChatMessage` | Yes |
| `threadId` | `string` | Yes |

**Events contract**:
| Event | Payload |
|---|---|
| `retry` | `UiChatMessage` |
| `continue` | `UiChatMessage` |
| `branch` | `{ message, direction }` |
| `edited` | `UiChatMessage` |
| `begin-edit` | `string` (messageId) |
| `cancel-edit` | `string` (messageId) |
| `save-edit` | `string` (messageId) |

### G.4 — `chat-input`
**File**: `app/components/chat/ChatContainer.vue` (line ~88)  
**Current**: `<lazy-chat-input-dropper :loading="..." :streaming="..." :container-width="..." :thread-id="..." :pane-id="..." @send="..." @model-change="..." @stop-stream="..." @pending-prompt-selected="..." @resize="..." />`  
**Props contract**:
| Prop | Type | Required |
|---|---|---|
| `loading` | `boolean` | Yes |
| `streaming` | `boolean` | Yes |
| `containerWidth` | `number` | Yes |
| `threadId` | `string` | Yes |
| `paneId` | `string` | No |

**Events contract**:
| Event | Payload |
|---|---|
| `send` | `{ content, attachments?, ... }` |
| `model-change` | `string` (modelId) |
| `stop-stream` | none |
| `pending-prompt-selected` | `SystemPrompt` |
| `resize` | `number` (height) |

### G.5 — `chat-page`
**File**: `app/components/PageShell.vue` — `resolvePaneComponent()` (line ~588)  
**Current**: Returns `ChatContainer` when `pane.mode === 'chat'`.  
**Note**: This is resolved via function, not inline template. The function will read `$theme.activeComponents.value['chat-page']` directly.

### G.6 — `document-editor`
**File**: `app/components/PageShell.vue` — `resolvePaneComponent()` (line ~596)  
**Current**: Returns `DocumentEditorAsync` when `pane.mode === 'doc'`.

### G.7 — `dashboard-modal`
**File**: `app/components/PageShell.vue`  
**Current**: `<lazy-dashboard v-if="dashboardEnabled" v-model:showModal="showDashboardModal" />`  
**Props contract**:
| Prop | Type | Required |
|---|---|---|
| `showModal` (v-model) | `boolean` | Yes |

### G.8 — `model-selector`
**File**: `app/components/chat/ChatInputDropper.vue`  
**Current**: `<ModelSelect>` within the input controls area.

### G.9 — `system-prompts-modal`
**File**: `app/components/chat/ChatInputDropper.vue` (line ~306)  
**Current**: `<LazyChatSystemPromptsModal>`

### G.10 — `model-catalog-modal`
**Files**: `app/components/chat/ChatInputDropper.vue` (line ~305), `app/components/sidebar/SideBottomNav.vue` (line ~92)  
**Current**: `<lazy-modal-model-catalog v-model:showModal="showModelCatalog" />`

### G.11 — `sidebar-auth-button`
**File**: `app/components/sidebar/SideBottomNav.vue` (line ~43)  
**Current**: `<SidebarAuthButton />`

### G.12 — `documentation-shell`
**File**: `app/components/documentation/DocumentationPageShell.vue` (line ~2)  
**Current**: `<DocumentationShell />`

### G.13 — `workflow-status`
**File**: `app/components/chat/ChatMessage.vue` (line ~14)  
**Current**: `<WorkflowChatMessage>` (which internally uses `WorkflowExecutionStatus`)

---

<a id="section-h"></a>
## Section H — External Theme Support

External themes (like `or3-theme-cyberpunk`) are installed as packages and their files are copied into `app/theme/<name>/` at build time. The Vite glob `import.meta.glob('../*/**/*.vue')` automatically discovers `.vue` files placed inside these directories.

**No special handling is required.** An external theme author simply:
1. Places their custom `.vue` files inside a `components/` subdirectory of their theme.
2. References them with relative paths in `customComponents`:
   ```typescript
   customComponents: {
       'chat-message': './components/CyberpunkMessage.vue'
   }
   ```
3. The glob picks them up at build time, and `createThemeComponentMap` resolves them at runtime.

---

<a id="section-i"></a>
## Section I — Error Handling & Fallbacks

### I.1 — Missing glob key (bad path)
If `themeVueModules[globKey]` is `undefined`, the registry logs a `console.warn` in dev mode and keeps the default component in the map. **The user sees no error.** The built-in component renders normally.

### I.2 — Async chunk load failure (network error)
`defineAsyncComponent` wraps Vue's standard async component error handling. If the chunk fails to load:
- Vue renders nothing for that slot (empty vnode).
- A runtime warning appears in the console.
- The app does not crash.

We can optionally provide `loadingComponent` and `errorComponent` options to `defineAsyncComponent` for a better UX, but this is a follow-up enhancement, not a launch blocker.

### I.3 — Theme switches during loading
Because we reassign the entire map atomically (`activeComponents.value = newMap`), a mid-flight theme switch simply replaces the map. Any in-progress async loads for the old theme's components become orphaned promises — Vue naturally ignores their results since the component identity in the template has already changed.

---

<a id="section-j"></a>
## Section J — SSR Considerations

The theme component registry uses `import.meta.glob` which Vite resolves at build time for both client and server bundles. However:

1. **SSR renders use defaults**: During server-side rendering, no theme cookie resolution happens before the component map is built. The server always renders with `CORE_APP_COMPONENT_DEFAULTS`. This is correct because:
   - The initial HTML is theme-neutral (CSS variables handle visual theming).
   - Custom components are an enhancement that activates after hydration.

2. **Hydration mismatch avoidance**: Since `ChatMessage` and other hot-path components are wrapped in `<ClientOnly>` or `<Or3Scroll>` (which itself is client-only), there is no risk of server-rendered HTML disagreeing with the client's dynamically resolved component.

3. **The server theme plugin (`90.theme.server.ts`)** does not need `activeComponents` — it only injects CSS variables. No changes to the server plugin are required.

---

<a id="section-k"></a>
## Section K — HMR & Dev Experience

### K.1 — Theme definition changes
When a theme author modifies their `theme.ts` (adding/removing keys from `customComponents`), the existing HMR pipeline in the client plugin re-loads the definition and re-calls `setActiveTheme()`. This naturally rebuilds `activeComponents.value` via `createThemeComponentMap()`.

### K.2 — Custom component file changes
When a `.vue` file inside a theme directory is edited, Vite's standard HMR handles the hot-reload of that specific module. Because `defineAsyncComponent` wraps a loader function, and the loader points to a Vite module ID, the HMR update propagates through automatically.

### K.3 — Cache invalidation
The `invalidateThemeComponentCache(themeDirName)` function clears memoized `defineAsyncComponent` wrappers when a theme's definition changes during dev. This ensures stale async chunks don't persist after path changes.

---

<a id="section-l"></a>
## Section L — Testing Strategy

### L.1 — Unit tests (`theme-components-registry.test.ts`)
- `createThemeComponentMap()` with empty `customConfig` returns exact copy of defaults.
- `createThemeComponentMap()` with valid path returns `defineAsyncComponent` wrapper for that key, defaults for all others.
- `createThemeComponentMap()` with invalid path logs warning and returns default for that key.
- Memoization: calling `createThemeComponentMap()` twice with same theme+key returns same component reference (`===`).
- `invalidateThemeComponentCache()` clears only the specified theme's entries.

### L.2 — Integration tests
- Theme switch from `retro` (no overrides) to a test theme (with overrides) correctly swaps `activeComponents.value`.
- Theme switch back restores defaults.
- `$theme.activeComponents.value['chat-message']` resolves to the custom component after activation.

### L.3 — Visual verification (manual)
- Create `app/theme/retro/components/TestChatMessage.vue` with a visually distinct marker.
- Add `customComponents: { 'chat-message': './components/TestChatMessage.vue' }` to retro's `theme.ts`.
- Load a thread with 150+ messages, confirm all render the custom component.
- Switch to another theme, confirm default ChatMessage renders.
- Verify Vue DevTools shows zero extra watchers per message instance.
