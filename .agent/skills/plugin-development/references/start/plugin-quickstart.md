# Plugin Quick Start Guide

This guide shows you how to create plugins for OR3 to extend the dashboard, chat messages, and sidebar. OR3's plugin system is built on Nuxt's plugin architecture with reactive registries that survive hot module replacement.

## Plugin Basics

All OR3 plugins are Nuxt client plugins placed in the `app/plugins/` folder with a `.client.ts` extension. They register actions, components, or pages into global registries that the UI reads reactively.

**File naming convention**: `your-plugin-name.client.ts`

**Basic structure**:

```typescript
export default defineNuxtPlugin(() => {
    // Register your extensions here
    // Plugins run once on app initialization
});
```

## 1. Dashboard Plugins

Dashboard plugins add custom tiles to the dashboard grid and optionally provide full-page experiences with navigation.

### Simple Dashboard Button

Create a basic dashboard tile that shows a toast when clicked:

```typescript
// app/plugins/my-dashboard-plugin.client.ts
export default defineNuxtPlugin(() => {
    registerDashboardPlugin({
        id: 'my-plugin:hello',
        icon: 'pixelarticons:star',
        label: 'Hello World',
        description: 'My first dashboard plugin',
        order: 250,
        handler() {
            useToast().add({
                title: 'Hello from my plugin!',
                description: 'Plugin clicked successfully',
                duration: 2500,
            });
        },
    });
});
```

**Key properties**:

-   `id`: Unique identifier (convention: `namespace:name`)
-   `icon`: Iconify icon name (browse at [iconify.design](https://iconify.design))
-   `label`: Short text shown below the icon
-   `description`: Optional tooltip/description text
-   `order`: Display order (lower = earlier, default: 200)
-   `handler`: Function called when tile is clicked

### Multi-Page Dashboard Plugin

Create a plugin with multiple navigable pages:

```typescript
// app/plugins/my-pages-plugin.client.ts
export default defineNuxtPlugin(() => {
    registerDashboardPlugin({
        id: 'my-plugin:settings',
        icon: 'pixelarticons:settings',
        label: 'My Settings',
        description: 'Configure my plugin preferences',
        order: 120,
        pages: [
            {
                id: 'overview',
                title: 'Overview',
                icon: 'pixelarticons:dashboard',
                description: 'Main settings page',
                component: async () =>
                    await import('./my-plugin/OverviewPage.vue'),
            },
            {
                id: 'advanced',
                title: 'Advanced',
                icon: 'pixelarticons:cog',
                description: 'Advanced configuration',
                component: async () =>
                    await import('./my-plugin/AdvancedPage.vue'),
            },
        ],
    });
});
```

**Page component example** (`app/plugins/my-plugin/OverviewPage.vue`):

```vue
<template>
    <div class="space-y-4">
        <h2 class="text-lg font-semibold">Plugin Settings</h2>
        <p class="text-sm opacity-80">
            Configure your plugin preferences here.
        </p>
        <div class="p-4 rounded-md bg-[var(--md-surface-container)]">
            <!-- Your settings UI here -->
            <UButton @click="handleSave">Save Settings</UButton>
        </div>
    </div>
</template>

<script setup lang="ts">
function handleSave() {
    // Save logic using Dexie kv store or composables
    console.log('Saving settings...');
}
</script>
```

**Note**: Components are lazy-loaded automatically. Use async imports for better performance.

## 2. Chat Message Actions

Message actions add contextual buttons to chat messages (like copy, retry, or custom operations).

### Basic Message Action

Add a button that appears on chat messages:

```typescript
// app/plugins/my-message-action.client.ts
export default defineNuxtPlugin(() => {
    registerMessageAction({
        id: 'my-plugin:save-message',
        icon: 'pixelarticons:save',
        tooltip: 'Save to favorites',
        showOn: 'both', // 'user' | 'assistant' | 'both'
        order: 300,
        async handler({ message, threadId }) {
            // Access message data
            console.log('Message content:', message.content);
            console.log('Message role:', message.role);
            console.log('Thread ID:', threadId);

            // Perform your action
            useToast().add({
                title: 'Message saved',
                description: `Saved ${message.role} message`,
            });
        },
    });
});
```

**Key properties**:

-   `id`: Unique action identifier
-   `icon`: Iconify icon name
-   `tooltip`: Hover text for the button
-   `showOn`: Which message types show this action
    -   `'user'`: Only on user messages
    -   `'assistant'`: Only on AI responses
    -   `'both'`: On all messages
-   `order`: Button order (default: 200, built-ins use < 200)
-   `handler`: Async function receiving message context

### Advanced: Create Document from Message

Convert a message to a document:

```typescript
// app/plugins/message-to-doc.client.ts
export default defineNuxtPlugin(() => {
    registerMessageAction({
        id: 'my-plugin:create-doc',
        icon: 'pixelarticons:note-plus',
        tooltip: 'Create document from message',
        showOn: 'assistant',
        order: 250,
        async handler({ message }) {
            try {
                const { createDocument } = await import('~/db');

                // Create a new document with message content
                const doc = await createDocument({
                    title: `Doc from ${new Date().toLocaleDateString()}`,
                    content: {
                        type: 'doc',
                        content: [
                            {
                                type: 'paragraph',
                                content: [
                                    { type: 'text', text: message.content },
                                ],
                            },
                        ],
                    },
                });

                useToast().add({
                    title: 'Document created',
                    description: `Created: ${doc.title}`,
                });
            } catch (error) {
                console.error('Failed to create document:', error);
                useToast().add({
                    title: 'Error',
                    description: 'Failed to create document',
                    color: 'error',
                });
            }
        },
    });
});
```

## 3. Sidebar Extensions

Extend the sidebar with custom sections, footer actions, and header buttons.

### Sidebar Section

Add a custom component to the sidebar:

```typescript
// app/plugins/my-sidebar-section.client.ts
export default defineNuxtPlugin(() => {
    const MyStatsCard = {
        name: 'MyStatsCard',
        template: `
            <div class="px-3 py-2 text-xs bg-[var(--md-surface-container-low)] rounded-md">
                <p class="font-semibold mb-1">Plugin Stats</p>
                <p class="opacity-70">Messages today: 42</p>
                <p class="opacity-70">Active threads: 3</p>
            </div>
        `,
    };

    registerSidebarSection({
        id: 'my-plugin:stats',
        component: MyStatsCard,
        placement: 'top', // 'top' | 'main' | 'bottom'
        order: 240,
    });

    // Clean up on HMR
    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            unregisterSidebarSection?.('my-plugin:stats');
        });
    }
});
```

**For complex sections**, use a separate `.vue` file:

```typescript
// app/plugins/my-sidebar-plugin.client.ts
import MyCustomSection from './my-plugin/MySidebarSection.vue';

export default defineNuxtPlugin(() => {
    registerSidebarSection({
        id: 'my-plugin:custom',
        component: MyCustomSection,
        placement: 'main',
        order: 200,
    });
});
```

### Sidebar Footer Action

Add a button to the sidebar footer:

```typescript
// app/plugins/my-footer-action.client.ts
export default defineNuxtPlugin(() => {
    registerSidebarFooterAction({
        id: 'my-plugin:export',
        icon: 'pixelarticons:download',
        tooltip: 'Export current thread',
        order: 260,
        async handler(ctx) {
            // Context provides active thread/document info
            if (ctx.activeThreadId) {
                console.log('Exporting thread:', ctx.activeThreadId);
                // Your export logic here
            } else {
                useToast().add({
                    title: 'No active thread',
                    description: 'Open a thread first',
                });
            }
        },
    });

    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            unregisterSidebarFooterAction?.('my-plugin:export');
        });
    }
});
```

### Header Action

Add a button to the sidebar header:

```typescript
// app/plugins/my-header-action.client.ts
export default defineNuxtPlugin(() => {
    registerHeaderAction({
        id: 'my-plugin:quick-search',
        icon: 'pixelarticons:search',
        tooltip: 'Quick search',
        order: 280,
        async handler() {
            // Your search modal or action
            useToast().add({
                title: 'Quick Search',
                description: 'Search feature activated',
            });
        },
    });

    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            unregisterHeaderAction?.('my-plugin:quick-search');
        });
    }
});
```

### Conditional Visibility & Disabled State

Control when actions appear and when they're disabled:

```typescript
export default defineNuxtPlugin(() => {
    registerSidebarFooterAction({
        id: 'my-plugin:thread-action',
        icon: 'pixelarticons:tool',
        tooltip: 'Process thread',
        order: 250,
        // Only show when a thread is active
        visible: (ctx) => !!ctx.activeThreadId,
        // Disable when sidebar is collapsed
        disabled: (ctx) => !!ctx.isCollapsed,
        async handler(ctx) {
            console.log('Processing thread:', ctx.activeThreadId);
        },
    });
});
```

## 4. Registering AI Tools

Plugins can register functions that the AI can call during chat conversations. These "tools" allow the AI to fetch data, perform calculations, or interact with external services.

### Basic Tool Registration

```typescript
// app/plugins/my-calculator-tool.client.ts
import { useToolRegistry, defineTool } from '~/utils/chat/tools-public';

export default defineNuxtPlugin(() => {
    const registry = useToolRegistry();

    const calculatorTool = defineTool<{
        operation: 'add' | 'subtract' | 'multiply' | 'divide';
        a: number;
        b: number;
    }>({
        name: 'calculate',
        description: 'Perform basic math operations',
        parameters: {
            type: 'object',
            properties: {
                operation: {
                    type: 'string',
                    enum: ['add', 'subtract', 'multiply', 'divide'],
                    description: 'The math operation to perform',
                },
                a: { type: 'number', description: 'First number' },
                b: { type: 'number', description: 'Second number' },
            },
            required: ['operation', 'a', 'b'],
        },
        ui: {
            label: 'Calculator',
            icon: 'pixelarticons:calculator',
            descriptionHint: 'Basic arithmetic operations',
        },
    });

    const unregister = registry.register(
        calculatorTool,
        async ({ operation, a, b }) => {
            switch (operation) {
                case 'add':
                    return a + b;
                case 'subtract':
                    return a - b;
                case 'multiply':
                    return a * b;
                case 'divide':
                    if (b === 0) throw new Error('Cannot divide by zero');
                    return a / b;
                default:
                    throw new Error(`Unknown operation: ${operation}`);
            }
        }
    );

    // Cleanup on HMR or unmount
    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            console.log('[Calculator] Cleaning up tool');
            unregister();
        });
    }
});
```

**Key concepts**:

-   `defineTool<T>()`: Helper for TypeScript type inference on handler arguments
-   `name`: Unique tool identifier (sent to AI)
-   `description`: Tells the AI when to use this tool
-   `parameters`: JSON Schema defining the tool's arguments
-   `ui`: Optional display metadata (label, icon, etc.)
-   `handler`: Async function that executes the tool

### Tool with API Integration

```typescript
// app/plugins/weather-tool.client.ts
import { useToolRegistry, defineTool } from '~/utils/chat/tools-public';

export default defineNuxtPlugin(() => {
    const registry = useToolRegistry();

    const weatherTool = defineTool<{
        city: string;
        units?: 'celsius' | 'fahrenheit';
    }>({
        name: 'get_weather',
        description: 'Get current weather conditions for a city',
        parameters: {
            type: 'object',
            properties: {
                city: {
                    type: 'string',
                    description: 'City name (e.g., "San Francisco")',
                },
                units: {
                    type: 'string',
                    enum: ['celsius', 'fahrenheit'],
                    description: 'Temperature units',
                },
            },
            required: ['city'],
        },
        ui: {
            label: 'Weather Lookup',
            icon: 'pixelarticons:cloud',
            category: 'data',
        },
    });

    const unregister = registry.register(
        weatherTool,
        async ({ city, units = 'celsius' }) => {
            try {
                const response = await fetch(
                    `/api/weather?city=${encodeURIComponent(
                        city
                    )}&units=${units}`
                );
                if (!response.ok) {
                    throw new Error(
                        `Weather API error: ${response.statusText}`
                    );
                }
                const data = await response.json();
                return {
                    temperature: data.temp,
                    conditions: data.conditions,
                    humidity: data.humidity,
                };
            } catch (error) {
                console.error('[Weather Tool] Error:', error);
                throw new Error(`Failed to fetch weather for ${city}`);
            }
        }
    );

    if (import.meta.hot) {
        import.meta.hot.dispose(unregister);
    }
});
```

### Tool Lifecycle During Chat

1. **Registration**: Plugin registers tool during app initialization
2. **Discovery**: AI receives tool definition when chat starts
3. **Invocation**: AI decides to use tool and sends arguments
4. **Execution**: Your handler function runs with parsed arguments
5. **Display**: Result shown in chat via `ToolCallIndicator` component

**During streaming**:

-   Tool status starts as `'loading'`
-   UI shows spinner and arguments
-   On success: status → `'complete'`, result displayed
-   On error: status → `'error'`, error message shown

### Multiple Tools in One Plugin

```typescript
// app/plugins/data-tools.client.ts
import { useToolRegistry, defineTool } from '~/utils/chat/tools-public';

export default defineNuxtPlugin(() => {
    const registry = useToolRegistry();
    const cleanups: Array<() => void> = [];

    // Tool 1: Search documents
    const searchTool = defineTool({
        /* ... */
    });
    cleanups.push(
        registry.register(searchTool, async (args) => {
            // Search implementation
        })
    );

    // Tool 2: Create document
    const createTool = defineTool({
        /* ... */
    });
    cleanups.push(
        registry.register(createTool, async (args) => {
            // Create implementation
        })
    );

    // Cleanup all
    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            cleanups.forEach((fn) => fn());
        });
    }
});
```

### Best Practices for Tools

**1. Write clear descriptions**

```typescript
// Good - AI understands when to use it
description: 'Get current weather conditions for any city worldwide';

// Bad - vague, AI won't know when to use
description: 'Weather function';
```

**2. Validate arguments**

```typescript
handler: async ({ city }) => {
    if (!city || city.trim().length === 0) {
        throw new Error('City name is required');
    }
    // ... proceed
};
```

**3. Return structured data**

```typescript
// Good - structured, easy to display
return {
    result: 42,
    unit: 'meters',
    timestamp: new Date().toISOString(),
};

// Avoid - hard to parse
return 'The result is 42 meters at 2024-01-15';
```

**4. Handle errors clearly**

```typescript
try {
    const data = await fetchData();
    return data;
} catch (error) {
    // Provide actionable error message
    throw new Error(`Failed to fetch data: ${error.message}`);
}
```

**5. Use UI metadata for better UX**

```typescript
ui: {
    label: 'Weather Lookup',          // Friendly name
    icon: 'pixelarticons:cloud',      // Visual indicator
    descriptionHint: 'Real-time data', // Extra context
    category: 'data',                 // Grouping
}
```

### Testing Your Tool

**In the chat**:

1. Open a chat thread
2. Type: "Calculate 15 + 27"
3. AI should call your `calculate` tool
4. Result appears inline with status indicator

**Console debugging**:

```typescript
registry.register(tool, async (args) => {
    console.log('[My Tool] Called with:', args);
    const result = await doWork(args);
    console.log('[My Tool] Returning:', result);
    return result;
});
```

**Check registered tools**:

```typescript
const registry = useToolRegistry();
console.log('Registered tools:', registry.listTools());
```

### Reference Implementation

See `app/plugins/demo-calculator-tool.client.ts` for a complete working example with:

-   Four operations (add, subtract, multiply, divide)
-   Error handling (division by zero)
-   Proper TypeScript types
-   HMR cleanup
-   UI metadata

---

## Complete Multi-Feature Plugin Example

Here's a full example combining multiple extension points:

```typescript
// app/plugins/my-complete-plugin.client.ts
import { useToolRegistry, defineTool } from '~/utils/chat/tools-public';

export default defineNuxtPlugin(() => {
    const cleanups: Array<() => void> = [];

    // 1. Dashboard tile with pages
    registerDashboardPlugin({
        id: 'my-plugin:main',
        icon: 'pixelarticons:puzzle',
        label: 'My Plugin',
        description: 'A complete plugin example',
        order: 150,
        pages: [
            {
                id: 'home',
                title: 'Home',
                icon: 'pixelarticons:home',
                component: async () => await import('./my-plugin/HomePage.vue'),
            },
        ],
    });

    // 2. Message action
    registerMessageAction({
        id: 'my-plugin:analyze',
        icon: 'pixelarticons:chart-bar',
        tooltip: 'Analyze message',
        showOn: 'assistant',
        order: 280,
        async handler({ message }) {
            console.log('Analyzing:', message.content);
        },
    });

    // 3. Sidebar section
    const InfoCard = {
        name: 'MyPluginInfo',
        template: `
            <div class="px-3 py-2 text-xs rounded-md bg-[var(--md-surface-container)]">
                <p class="font-semibold">My Plugin Active</p>
                <p class="opacity-70 mt-1">Ready to use</p>
            </div>
        `,
    };

    registerSidebarSection({
        id: 'my-plugin:info',
        component: InfoCard,
        placement: 'top',
        order: 100,
    });

    // 4. Footer action
    registerSidebarFooterAction({
        id: 'my-plugin:action',
        icon: 'pixelarticons:zap',
        tooltip: 'Quick action',
        order: 200,
        handler() {
            useToast().add({ title: 'Action executed!' });
        },
    });

    // 5. AI Tool
    const registry = useToolRegistry();
    const myTool = defineTool<{ query: string }>({
        name: 'search_plugin_data',
        description: 'Search within plugin data',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Search query' },
            },
            required: ['query'],
        },
        ui: {
            label: 'Plugin Search',
            icon: 'pixelarticons:search',
        },
    });

    cleanups.push(
        registry.register(myTool, async ({ query }) => {
            // Search implementation
            return { results: [], query };
        })
    );

    // HMR cleanup
    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            unregisterDashboardPlugin?.('my-plugin:main');
            unregisterMessageAction?.('my-plugin:analyze');
            unregisterSidebarSection?.('my-plugin:info');
            unregisterSidebarFooterAction?.('my-plugin:action');
            cleanups.forEach((fn) => fn());
        });
    }
});
```

## Tips & Best Practices

### 1. **Use namespaced IDs**

Always prefix your IDs with your plugin name to avoid conflicts:

```typescript
id: 'my-plugin:feature-name';
```

### 2. **Handle errors gracefully**

Wrap plugin code in try-catch blocks:

```typescript
export default defineNuxtPlugin(() => {
    try {
        registerMessageAction({...});
    } catch (e) {
        console.error('[my-plugin] failed to initialize', e);
    }
});
```

### 3. **Clean up on HMR**

Unregister your extensions during hot module replacement:

```typescript
if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        unregisterMessageAction?.('my-plugin:id');
    });
}
```

### 4. **Use async imports for heavy components**

Lazy-load Vue components to keep initial bundle small:

```typescript
component: async () => await import('./MyComponent.vue');
```

### 5. **Respect ordering conventions**

-   Built-in actions use `order < 200`
-   Plugin actions should use `order >= 200`
-   Lower numbers appear first

### 6. **Access OR3 composables**

Use OR3's built-in composables for data access:

```typescript
import { db } from '~/db';
import { useToast } from '#imports';

// Access threads
const { threads } = await db.queries.getThreadsList();

// Show notifications
useToast().add({ title: 'Success!' });
```

### 7. **Leverage the hook system**

Use hooks to react to app events:

```typescript
import { typedOn } from '~/core/hooks';

export default defineNuxtPlugin(() => {
    typedOn('thread:created', async ({ thread }) => {
        console.log('New thread:', thread.id);
    });
});
```

## Available Icon Sets

OR3 uses Iconify. Popular sets include:

-   `pixelarticons:*` - Retro pixel art style (default)
-   `heroicons:*` - Clean modern icons
-   `lucide:*` - Consistent outline icons
-   `carbon:*` - IBM Carbon design

Browse all icons at [iconify.design](https://iconify.design)

## Next Steps

-   Explore example plugins in `app/plugins/examples/`
-   Read composable documentation in `/docs/composables/`
-   Check the hook reference in `/docs/hooks/`
-   Study the database utilities in `/docs/database/`

## Debugging

Enable detailed logging:

```typescript
if (import.meta.dev) {
    console.debug('[my-plugin] registered with:', config);
}
```

Check registered items:

```typescript
console.log(listRegisteredMessageActionIds());
console.log(listRegisteredSidebarSectionIds());
```

## Common Patterns

### Save plugin settings

```typescript
import { setKV, getKV } from '~/db';

// Save
await setKV('my-plugin:settings', { enabled: true });

// Load
const settings = await getKV('my-plugin:settings');
```

### Access current thread

```typescript
import { useMultiPane } from '~/composables';

const { activePane } = useMultiPane();
const threadId = activePane.value?.threadId;
```

### Create a new document

```typescript
import { createDocument } from '~/db';

const doc = await createDocument({
    title: 'New Document',
    content: { type: 'doc', content: [] },
});
```

You're now ready to build powerful OR3 plugins! 🚀
