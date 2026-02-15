# tools-public

Simplified plugin API for tool registration. Re-exports registry functions and provides a helper for better TypeScript inference when defining tools.

This is the **recommended import path** for plugins registering tools — it keeps your plugin code clean and isolated from internal implementation details.

---

## Purpose

`tools-public` provides:

- **Clean imports** — Single import path for all tool registration needs
- **Type helper** — `defineTool` for better TypeScript inference
- **Stable API** — Future-proof against internal refactoring
- **Plugin-friendly** — Designed specifically for plugin authors

---

## Basic Example

```ts
// plugins/my-weather-tool.client.ts
import { useToolRegistry, defineTool } from '~/utils/chat/tools-public';

export default defineNuxtPlugin(() => {
    const registry = useToolRegistry();

    const weatherTool = defineTool({
        name: 'get_weather',
        description: 'Get current weather for a city',
        parameters: {
            type: 'object',
            properties: {
                city: { type: 'string', description: 'City name' }
            },
            required: ['city']
        },
        ui: {
            label: 'Weather Lookup',
            icon: 'i-heroicons-cloud'
        }
    });

    const unregister = registry.register(weatherTool, async ({ city }) => {
        const data = await fetch(`/api/weather?city=${city}`);
        return data.json();
    });

    // Cleanup on plugin unmount
    return { provide: { unregisterWeatherTool: unregister } };
});
```

---

## Exports

### `useToolRegistry`

Access the global tool registry composable. See [`tool-registry.md`](../utils/tool-registry.md) for full API.

```ts
import { useToolRegistry } from '~/utils/chat/tools-public';

const registry = useToolRegistry();
registry.register(definition, handler);
```

### `defineTool<T>()`

Helper function for defining tools with proper TypeScript inference for argument types.

```ts
import { defineTool } from '~/utils/chat/tools-public';

const tool = defineTool<{ city: string }>({
    name: 'get_weather',
    description: 'Get weather data',
    parameters: {
        type: 'object',
        properties: {
            city: { type: 'string' }
        },
        required: ['city']
    }
});

// Now TypeScript knows handler args are { city: string }
registry.register(tool, async (args) => {
    args.city; // ✅ TypeScript knows this is a string
});
```

**Returns**: The same tool definition object passed in (identity function for type inference only).

### Type Re-exports

All type definitions are re-exported for convenience:

```ts
import type { 
    ToolDefinition,
    ExtendedToolDefinition,
    ToolHandler,
    RegisteredTool,
    ToolCall 
} from '~/utils/chat/tools-public';
```

See [`chat-types.md`](../types/chat-types.md) for full type documentation.

---

## Why use this instead of direct imports?

### ❌ Don't do this:

```ts
// Brittle - ties plugin to internal structure
import { useToolRegistry } from '~/utils/chat/tool-registry';
```

### ✅ Do this:

```ts
// Stable - uses public plugin API
import { useToolRegistry } from '~/utils/chat/tools-public';
```

**Benefits**:
- **Semantic clarity** — Signals this is a public plugin API
- **Future-proof** — Internal paths may change, this won't
- **Less imports** — Everything you need in one place
- **Better IDE support** — Optimized for plugin development

---

## Common patterns

### Complete plugin with tool

```ts
// plugins/calculator.client.ts
import { useToolRegistry, defineTool } from '~/utils/chat/tools-public';

export default defineNuxtPlugin(() => {
    const registry = useToolRegistry();

    const calcTool = defineTool<{
        operation: 'add' | 'subtract';
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
                    enum: ['add', 'subtract']
                },
                a: { type: 'number' },
                b: { type: 'number' }
            },
            required: ['operation', 'a', 'b']
        },
        ui: {
            label: 'Calculator',
            icon: 'i-heroicons-calculator'
        }
    });

    const unregister = registry.register(calcTool, async ({ operation, a, b }) => {
        switch (operation) {
            case 'add': return a + b;
            case 'subtract': return a - b;
            default: throw new Error(`Unknown operation: ${operation}`);
        }
    });

    // Auto-cleanup on HMR or unmount
    onScopeDispose(() => {
        console.log('[Calculator] Cleaning up tool registration');
        unregister();
    });
});
```

### Multiple tools in one plugin

```ts
import { useToolRegistry, defineTool } from '~/utils/chat/tools-public';

export default defineNuxtPlugin(() => {
    const registry = useToolRegistry();
    const unregisterFns: Array<() => void> = [];

    // Tool 1
    const searchTool = defineTool({ /* ... */ });
    unregisterFns.push(registry.register(searchTool, searchHandler));

    // Tool 2
    const summaryTool = defineTool({ /* ... */ });
    unregisterFns.push(registry.register(summaryTool, summaryHandler));

    // Cleanup all
    onScopeDispose(() => {
        unregisterFns.forEach(fn => fn());
    });
});
```

### Using types in plugin

```ts
import type { 
    ToolDefinition, 
    ToolCall 
} from '~/utils/chat/tools-public';

function createToolDefinition(name: string): ToolDefinition {
    return {
        name,
        description: `Dynamic tool: ${name}`,
        parameters: { type: 'object', properties: {} }
    };
}

function handleToolCall(call: ToolCall): void {
    console.log(`Tool ${call.name} called with:`, call.args);
}
```

---

## Best practices

### Always use `defineTool` for type safety

```ts
// Good - TypeScript knows arg types
const tool = defineTool<{ city: string }>({ /* ... */ });
registry.register(tool, async (args) => {
    args.city.toUpperCase(); // ✅ Type-safe
});

// Bad - no type checking
const tool = { /* ... */ };
registry.register(tool, async (args) => {
    args.city.toUpperCase(); // ⚠️ TypeScript can't verify
});
```

### Store unregister functions

```ts
// Good - can cleanup later
const unregister = registry.register(tool, handler);
onScopeDispose(unregister);

// Bad - no way to cleanup
registry.register(tool, handler);
```

### Import only what you need

```ts
// Good - minimal imports
import { useToolRegistry, defineTool } from '~/utils/chat/tools-public';

// Avoid - importing internal utilities
import { useToolRegistry } from '~/utils/chat/tool-registry';
import { parseToolArgs } from '~/utils/chat/internal-helpers';
```

---

## Limitations

- **Client registry only** — This API registers browser handlers. Background SSR execution uses the server registry.
- **Runtime only** — Tools registered in plugins only, not at build time
- **No validation** — Helper doesn't validate tool definitions (validation happens at registration)

---

## Related

- [`tool-registry.md`](../utils/tool-registry.md) — Full registry API and internals
- [`tool-runtime.md`](../utils/tool-runtime.md) — Runtime model for client/server tool execution
- [`server-tool-registry.md`](../utils/server-tool-registry.md) — Server registry API for background execution
- [`chat-types.md`](../types/chat-types.md) — Type definitions and schemas
- [`plugin-quickstart.md`](../start/plugin-quickstart.md) — Plugin development guide
- [`demo-calculator-tool.client.ts`](../../app/plugins/demo-calculator-tool.client.ts) — Reference implementation

---

## TypeScript

```ts
// Main exports
export { useToolRegistry } from '~/utils/chat/tool-registry';
export function defineTool<T = any>(def: ToolDefinition): ToolDefinition;

// Type exports
export type {
    ToolDefinition,
    ExtendedToolDefinition,
    ToolHandler,
    RegisteredTool,
    ToolCall
};
```

Import path:

```ts
import { useToolRegistry, defineTool } from '~/utils/chat/tools-public';
import type { ToolDefinition } from '~/utils/chat/tools-public';
```

---

Document generated from `app/utils/chat/tools-public.ts` implementation.
