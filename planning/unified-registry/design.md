# Unified Registry Design: `or3client`

## Overview
We propose a unified plugin system anchored by a global `or3client` object. This object acts as a central registry for all extendable parts of the application, replacing scattered `createRegistry` calls.

The system is designed to be **discoverable**, **type-safe**, and **reactive** (Vue-compatible).

## Architecture

### The `OR3Client` Singleton
The core of the system is the `OR3Client` class, exposed as a Nuxt plugin and a composable.

```typescript
// Conceptual Structure
const or3client = {
  ui: {
    sidebar: {
      sections: Registry<SidebarSection>,
      footerActions: Registry<SidebarFooterAction>,
      headerActions: Registry<HeaderAction>
    },
    chat: {
      messageActions: Registry<ChatMessageAction>
    },
    // ... other UI modules
  },
  ai: {
    tools: ToolRegistry // Specialized registry
  },
  // Generic key-value store for arbitrary plugins
  plugins: Registry<PluginDefinition>
}
```

### The Generic `Registry<T>`
All sub-registries inherit from a standard `Registry<T>` class.

```typescript
export class Registry<T extends { id: string, order?: number }> {
  /** Register a new item. Replaces existing item with same ID. */
  register(item: T): void;

  /** Remove an item by ID. */
  unregister(id: string): void;

  /** Get a snapshot of all items (non-reactive). */
  snapshot(): T[];

  /** Get a Vue ComputedRef of items, sorted by order. */
  useItems(): ComputedRef<T[]>;

  /** Get a specific item by ID. */
  get(id: string): T | undefined;
}

**Note on HMR**: The Registry implementation must use `globalThis` or similar techniques to persist state across Hot Module Replacement (HMR) during development, ensuring that registered plugins don't disappear when files are edited.
```

## API Reference

### `or3client.ui`
Organized by UI region.

#### `or3client.ui.sidebar`
- **`sections`**: Custom sections in the sidebar (e.g., "Chats", "Projects").
- **`footerActions`**: Buttons at the bottom of the sidebar (e.g., "Settings", "Profile").
- **`headerActions`**: Actions in the sidebar header.

#### `or3client.ui.chat`
- **`messageActions`**: Actions available on individual chat messages (e.g., "Copy", "Retry", "Create Document").

#### `or3client.ui.editor`
- **`toolbar`**: Buttons in the document editor toolbar.

#### `or3client.ui.projects`
- **`treeActions`**: Context menu or hover actions for project tree items.

#### `or3client.ui.threads`
- **`historyActions`**: Actions for thread history items.

### `or3client.ai`
Organized by AI capability.

#### `or3client.ai.tools`
A specialized registry for AI tools (formerly `tool-registry.ts`).
- **`register(tool)`**: Registers a tool definition + handler.
- **`execute(name, args)`**: Executes a tool with timeout and validation.
- **`useTools()`**: Reactive list of enabled tools.

## Developer Experience (DX)

### Auto-completion
By typing `or3client.`, developers will see `ui`, `ai`, `plugins`.
By typing `or3client.ui.`, they see `sidebar`, `chat`, etc.

### JSDoc
All methods will be documented.

```typescript
/**
 * Register a generic button in the sidebar footer.
 * @param action The action definition
 */
or3client.ui.sidebar.footerActions.register({
  id: 'my-settings',
  icon: 'i-heroicons-cog',
  handler: () => navigateTo('/settings')
});
```

### Type Safety
The system uses strict TypeScript interfaces.

```typescript
import type { SidebarSection } from '~/core/or3client/types';
```

## Implementation Plan

1.  **Core Implementation**: Create `app/core/or3client/` structure.
2.  **Registry Class**: Implement the generic `Registry` class (refactoring `createRegistry`).
3.  **Client Factory**: Create `createOR3Client()` factory.
4.  **Nuxt Plugin**: Create `plugins/or3client.ts` to inject `$or3client`.
5.  **Migration**: Refactor existing composables (e.g., `useSidebarSections`) to be proxies for `or3client.ui.sidebar.sections`.

## Client vs Server
This design focuses on the **Client** (`app/`).
Since Nuxt runs `app/` code on both server (SSR) and client (hydration), `or3client` will be initialized in both environments.
- **SSR**: Registries are initialized per-request (or globally if stateless).
- **Client**: Registries are reactive and persistent (where applicable).

For purely server-side logic (Nitro routes), a separate `or3server` system would be needed, but is outside the scope of this UI-centric unification.
