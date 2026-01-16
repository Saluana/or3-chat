# Unified Registry Design: `or3client`

## 1. Overview
The `or3client` is a unified, strongly-typed, and hierarchical API for all client-side extensibility in the OR3 application. It replaces disparate `createRegistry` calls and standalone composables with a single discoverable entry point.

### Vision
- **One Import**: `const client = useOR3Client()` (or auto-imported `or3client`).
- **Discoverability**: IntelliSense guides the developer from `client.ui` -> `sidebar` -> `sections`.
- **Consistency**: All registries share a common interface (`register`, `unregister`, `useItems`).
- **Reactivity**: Built on Vue's reactivity system (refs/computed) for seamless UI integration.

## 2. Core Architecture

### 2.1 The `OR3Client` Singleton
The system is anchored by the `OR3Client` class. It is instantiated once per app context (Server Request or Client Browser).

```typescript
export class OR3Client {
    public readonly ui: UIClient;
    public readonly ai: AIClient;
    public readonly core: CoreClient;
    public readonly plugins: PluginRegistry;

    constructor() {
        this.ui = new UIClient(this);
        this.ai = new AIClient(this);
        this.core = new CoreClient(this);
        this.plugins = new PluginRegistry(this);
    }
}
```

### 2.2 Generic Registry Pattern
Most extension points are simple collections of items. They inherit from `Registry<T>`.

```typescript
export interface RegistryItem {
    id: string;
    order?: number;
}

export class Registry<T extends RegistryItem> {
    /**
     * Register an item. Overwrites existing items with the same ID.
     */
    register(item: T): void;

    /**
     * Unregister an item by ID.
     */
    unregister(id: string): void;

    /**
     * Get a single item by ID.
     */
    get(id: string): T | undefined;

    /**
     * Get a reactive, sorted list of items.
     */
    useItems(): ComputedRef<T[]>;

    /**
     * Get a raw snapshot of items.
     */
    snapshot(): T[];
}
```

## 3. Detailed API Reference

### 3.1 `or3client.ui`
Manages all user interface extensions.

#### `ui.sidebar`
- **`sections`**: `Registry<SidebarSection>`
    - Custom sections in the sidebar (e.g., "Chats", "Projects").
- **`pages`**: `Registry<SidebarPage>`
    - Full-sidebar pages (e.g., specific search views, custom tools).
- **`footerActions`**: `Registry<SidebarFooterAction>`
    - Icons at the bottom of the sidebar (e.g., Settings, Profile).
- **`headerActions`**: `Registry<HeaderAction>`
    - Icons in the top header area.
- **`composer`**: `Registry<ComposerAction>`
    - Actions available in the sidebar composer/input area.

#### `ui.dashboard`
Replaces `useDashboardPlugins`.
- **`plugins`**: `Registry<DashboardPlugin>`
    - Top-level dashboard grid items.
- **`pages`**: `DashboardPageRegistry`
    - Sub-pages within dashboard plugins.
- **`navigation`**: `DashboardNavigationService`
    - Methods: `openPlugin(id)`, `openPage(pluginId, pageId)`, `goBack()`.
    - State: `useNavigationState()`.

#### `ui.chat`
- **`messageActions`**: `Registry<ChatMessageAction>`
    - Actions on individual messages (Copy, Edit, Fork).
- **`input`**: `ChatInputService`
    - Methods: `setText(text)`, `focus()`, `attachFile(file)`.

#### `ui.editor`
- **`toolbar`**: `Registry<EditorToolbarButton>`
    - Buttons in the Tiptap editor toolbar.
- **`extensions`**: `Registry<EditorExtensionDef>`
    - Custom Tiptap extensions.

#### `ui.panes`
Wraps `multiPaneApi`.
- **`manager`**: `PaneManager`
    - Methods: `split()`, `close(id)`, `addPane()`.
    - State: `usePanes()`, `activePane`.
- **`apps`**: `Registry<PaneAppDef>`
    - Applications that can run inside a pane (Chat, Doc, Browser, etc.).

#### `ui.projects`
- **`treeActions`**: `Registry<ProjectTreeAction>`
    - Context menu items for the project file tree.

#### `ui.toasts`
Wraps `useToast`.
- **`show(notification)`**: Display a notification.

### 3.2 `or3client.ai`
Manages AI capabilities.

#### `ai.tools`
Replaces `tool-registry.ts`.
- **`register(tool)`**: Register a new tool.
- **`execute(name, args)`**: Execute a tool with validation/timeout.
- **`useTools()`**: List enabled tools.

#### `ai.models`
Wraps `models-service.ts` and `useModelStore`.
- **`list()`**: Fetch available models.
- **`active`**: Get/Set active model ID.
- **`providers`**: Registry of custom LLM providers?

#### `ai.prompts`
- **`system`**: Registry/Service for managing system prompts.
- **`templates`**: `Registry<PromptTemplate>` (e.g., "Fix Grammar", "Summarize").

### 3.3 `or3client.core`
Fundamental app services.

#### `core.auth`
Wraps `useUser`, `useAuth`.
- **`user`**: Reactive user state.
- **`login()`**: Trigger login flow.
- **`logout()`**: Trigger logout.
- **`tokens`**: Token management.

#### `core.theme`
Wraps `useTheme`.
- **`current`**: Reactive current theme.
- **`setTheme(id)`**: Change theme.
- **`register(themeDef)`**: Register a custom theme.

#### `core.hooks`
Wraps `app/core/hooks`.
- **`on(event, handler)`**: Subscribe to global events.
- **`emit(event, payload)`**: Emit global events.

#### `core.search`
- **`providers`**: `Registry<SearchProvider>`
    - Register sources for the global command palette (Cmd+K).

## 4. Implementation Details

### 4.1 Nuxt Plugin (`plugins/or3client.ts`)
We inject the client into the Nuxt context.

```typescript
export default defineNuxtPlugin((nuxtApp) => {
    const client = new OR3Client();

    // Server-side: ensure isolation per request
    // Client-side: singleton is fine

    return {
        provide: {
            or3client: client
        }
    };
});
```

### 4.2 Composable (`useOR3Client`)
Auto-imported helper.

```typescript
export const useOR3Client = () => {
    const { $or3client } = useNuxtApp();
    return $or3client;
}
```

### 4.3 Migration Strategy (Phased Rollout)

**Phase 1: Proxies**
We will keep existing composables (e.g., `useSidebarSections`) but rewrite them to call `or3client` internally.

*Old:*
```typescript
// useSidebarSections.ts
const registry = createRegistry(...);
export function registerSidebarSection(...) { registry.register(...) }
```

*New:*
```typescript
// useSidebarSections.ts
export function registerSidebarSection(section) {
    useOR3Client().ui.sidebar.sections.register(section);
}
```

**Phase 2: Deprecation**
Add `@deprecated` tags to the old composables.

**Phase 3: Direct Usage**
Update all internal plugins to use `or3client` directly.

## 5. Developer Experience

### 5.1 Auto-Import
`or3client` or `useOR3Client` will be auto-imported by Nuxt.

### 5.2 Typing
We will export all types from a central location:
```typescript
import type { SidebarSection, ChatMessageAction } from '~/core/or3client/types';
```

### 5.3 HMR Support
The `Registry` class will detect if it's running in development mode and use `globalThis` to persist registered items across Hot Module Reloads, preventing items from disappearing during editing.
