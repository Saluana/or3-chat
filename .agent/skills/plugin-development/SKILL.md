---
name: OR3 Plugin Development
description: How to develop all types of plugins for OR3 (dashboard, pane apps, sidebar, AI tools)
---

# Plugin Development Skill

This skill covers developing all types of OR3 plugins: dashboard tiles, pane applications, sidebar extensions, AI tools, and more.

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────────────┐
│                  app/plugins/*.client.ts                       │
│              (Nuxt client plugins - entry point)               │
└───────────────────────────┬────────────────────────────────────┘
                            │
         ┌──────────────────┼──────────────────┬─────────────────┐
         ▼                  ▼                  ▼                 ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────┐ ┌─────────────┐
│  Dashboard      │ │  Sidebar        │ │  Pane Apps  │ │  AI Tools   │
│  Plugins        │ │  Extensions     │ │             │ │             │
└─────────────────┘ └─────────────────┘ └─────────────┘ └─────────────┘
```

---

## Plugin Types Summary

| Type | Registry Function | Use Case |
|------|-------------------|----------|
| Dashboard Tile | `registerDashboardPlugin()` | Settings pages, tools, mini-apps |
| Message Action | `registerMessageAction()` | Buttons on chat messages |
| Sidebar Section | `registerSidebarSection()` | Custom widgets in sidebar |
| Sidebar Footer | `registerSidebarFooterAction()` | Footer icon buttons |
| Header Action | `registerHeaderAction()` | Header icon buttons |
| Sidebar Page | `registerSidebarPage()` | Full sidebar page (like Home, History) |
| AI Tool | `useToolRegistry().register()` | LLM function calling |
| Pane App | `multiPaneApi.registerAppType()` | Custom pane content |

---

## 1. Basic Plugin Structure

```typescript
// app/plugins/my-plugin.client.ts
export default defineNuxtPlugin(() => {
    // Register extensions here

    // HMR cleanup
    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            // Unregister everything
        });
    }
});
```

**File naming**: `<name>.client.ts` (client-only plugins)

---

## 2. Dashboard Plugins

### Simple Tile

```typescript
registerDashboardPlugin({
    id: 'my-plugin:main',
    icon: 'pixelarticons:star',
    label: 'My Plugin',
    description: 'Plugin description',
    order: 250,
    handler() {
        useToast().add({ title: 'Hello!' });
    },
});
```

### Multi-Page Dashboard Plugin

```typescript
registerDashboardPlugin({
    id: 'my-plugin:settings',
    icon: 'pixelarticons:settings',
    label: 'Settings',
    order: 120,
    pages: [
        {
            id: 'overview',
            title: 'Overview',
            icon: 'pixelarticons:dashboard',
            component: async () => await import('./my-plugin/OverviewPage.vue'),
        },
        {
            id: 'advanced',
            title: 'Advanced',
            icon: 'pixelarticons:cog',
            component: async () => await import('./my-plugin/AdvancedPage.vue'),
        },
    ],
});
```

---

## 3. Message Actions

Add contextual buttons to chat messages (copy, retry, save, etc.):

### Basic Registration

```typescript
registerMessageAction({
    id: 'my-plugin:save',
    icon: 'pixelarticons:save',
    tooltip: 'Save message',
    showOn: 'both', // 'user' | 'assistant' | 'both'
    order: 300,
    async handler({ message, threadId }) {
        console.log('Message:', message.content);
        console.log('Thread:', threadId);
    },
});
```

### Full API Options

```typescript
registerMessageAction({
    id: 'my-plugin:analyze',
    icon: 'pixelarticons:chart-bar',
    tooltip: 'Analyze message',
    showOn: 'assistant',      // Only on AI messages
    order: 280,               // Lower = appears first
    
    // Conditional visibility
    visible: ({ message }) => message.content.length > 100,
    
    // Conditional disabled state
    disabled: ({ message }) => message.pending === true,
    
    async handler({ message, threadId, paneId }) {
        // Full context available
        console.log('Message ID:', message.id);
        console.log('Role:', message.role);
        console.log('Content:', message.content);
        console.log('Thread:', threadId);
        console.log('Pane:', paneId);
        
        // Show feedback
        useToast().add({ title: 'Analyzed!' });
    },
});
```

### Advanced: Create Document from Message

```typescript
registerMessageAction({
    id: 'my-plugin:to-doc',
    icon: 'pixelarticons:note-plus',
    tooltip: 'Save as document',
    showOn: 'assistant',
    order: 290,
    async handler({ message }) {
        const { createDocument } = await import('~/db');
        
        await createDocument({
            title: `Message ${new Date().toLocaleDateString()}`,
            content: {
                type: 'doc',
                content: [
                    { type: 'paragraph', content: [{ type: 'text', text: message.content }] },
                ],
            },
        });
        
        useToast().add({ title: 'Document created' });
    },
});
```

### HMR Cleanup

```typescript
if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        unregisterMessageAction?.('my-plugin:save');
    });
}
```

---

## 4. Sidebar Extensions

### Section

```typescript
registerSidebarSection({
    id: 'my-plugin:stats',
    component: MyStatsComponent,
    placement: 'top', // 'top' | 'main' | 'bottom'
    order: 240,
});
```

### Footer Action

```typescript
registerSidebarFooterAction({
    id: 'my-plugin:export',
    icon: 'pixelarticons:download',
    tooltip: 'Export thread',
    order: 260,
    visible: (ctx) => !!ctx.activeThreadId,
    disabled: (ctx) => ctx.isCollapsed,
    handler(ctx) {
        console.log('Thread:', ctx.activeThreadId);
    },
});
```

### Header Action

```typescript
registerHeaderAction({
    id: 'my-plugin:search',
    icon: 'pixelarticons:search',
    tooltip: 'Quick search',
    order: 280,
    handler() { /* ... */ },
});
```

### Sidebar Page

```typescript
registerSidebarPage({
    id: 'my-plugin:page',
    label: 'My Page',
    icon: () => useIcon('ui.star').value,
    order: 50,
    component: shallowRef(MyPageComponent),
});
```

---

## 5. AI Tools (Function Calling)

```typescript
import { useToolRegistry, defineTool } from '~/utils/chat/tools-public';

const registry = useToolRegistry();

const myTool = defineTool<{ query: string }>({
    name: 'search_data',
    description: 'Search within data',
    parameters: {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'Search query' },
        },
        required: ['query'],
    },
    ui: {
        label: 'Search',
        icon: 'pixelarticons:search',
    },
});

const unregister = registry.register(myTool, async ({ query }) => {
    return { results: [], query };
});
```

---

## 6. Pane Applications

For full custom pane content (like the Snake game example):

```typescript
const multiPaneApi = useMultiPaneApi();

// Register app type
multiPaneApi.registerAppType({
    type: 'my-app',
    label: 'My App',
    icon: 'pixelarticons:gamepad',
    component: shallowRef(MyAppPane),
});

// Open pane with app
multiPaneApi.addPane({
    type: 'my-app',
    data: { appId: 'instance-1' },
});
```

See `app/plugins/examples/custom-pane-todo-example.client.ts` for complete example.

---

## 7. HMR Cleanup Pattern

**Critical**: Always clean up on hot reload:

```typescript
export default defineNuxtPlugin(() => {
    const cleanups: (() => void)[] = [];

    // Register and collect cleanup functions
    registerDashboardPlugin({ id: 'my:plugin', /* ... */ });
    cleanups.push(registry.register(tool, handler));

    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            unregisterDashboardPlugin?.('my:plugin');
            cleanups.forEach(fn => fn());
        });
    }
});
```

---

## 8. Data Persistence

### Using KV Store

```typescript
import { createKv, readKv } from '~/db';

// Write
await createKv({ name: 'my-plugin:setting', value: { enabled: true } });

// Read
const setting = await readKv('my-plugin:setting');
```

### Using Custom Post Type

```typescript
import { createPost, queryPostsByType } from '~/db';

// Create
await createPost({
    postType: 'my-plugin:item',
    title: 'My Item',
    data: { /* structured data */ },
});

// Query
const items = await queryPostsByType('my-plugin:item');
```

---

## 9. Example Plugins Reference

| Example | Path | Features |
|---------|------|----------|
| Calculator Tool | `examples/demo-calculator-tool.client.ts` | AI tool, math operations |
| Todo Pane | `examples/custom-pane-todo-example.client.ts` | Custom pane, persistence |
| Snake Game | `examples/snake/` | Full pane app, sidebar page |
| Message Actions | `examples/message-actions-test.client.ts` | Message buttons |
| Dashboard Pages | `examples/dashboard-pages-example.client.ts` | Multi-page dashboard |
| Hook Inspector | `examples/z-hook-inspector-test.client.ts` | Hook system debugging |

---

## 10. Best Practices

| Practice | Details |
|----------|---------|
| **Namespaced IDs** | Use `my-plugin:feature` format |
| **Lazy Imports** | Use async imports for Vue components |
| **Error Handling** | Wrap in try-catch, show toast on failure |
| **HMR Cleanup** | Always unregister in `import.meta.hot.dispose` |
| **Order Values** | Core: <100, Standard: 100-300, Low priority: >300 |
| **Type Safety** | Use `defineTool<T>()` for type inference |

---

## 11. Documentation Resources

| Topic | Path |
|-------|------|
| Plugin Quickstart | `public/_documentation/start/plugin-quickstart.md` |
| Snake Game Tutorial | `public/_documentation/start/snake-game-tutorial.md` |
| Mini App Tutorial | `public/_documentation/start/mini-app-tutorial.md` |
| Dashboard Plugins | `public/_documentation/composables/useDashboardPlugins.md` |
| Sidebar Pages | `public/_documentation/composables/useSidebarPages.md` |
| Tool Registry | `public/_documentation/utils/tool-registry.md` |

---

## 12. Debugging

```typescript
// Check registered plugins
console.log(listRegisteredDashboardPluginIds());
console.log(useToolRegistry().listTools());

// Check hooks
console.log(useHooks()._engine._diagnostics);

// Check pane state
console.log(useMultiPaneApi().panes.value);
```
