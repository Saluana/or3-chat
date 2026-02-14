# Tool Registry

Lightweight singleton registry for managing LLM function-calling tools in OR3 Chat. Lets plugins register OpenRouter-compatible tools with handlers, metadata, and toggle persistence.

Think of the tool registry as your plugin's control panel for extending the AI's capabilities — register a tool once, toggle it on/off in the UI, and the system handles execution, timeouts, and error recovery automatically.

---

## Purpose

The tool registry provides:

- **Centralized tool management** — Single source of truth for all available tools
- **Reactive state** — Vue-powered reactivity for UI toggles and enabled states
- **Persistent preferences** — User choices saved to localStorage
- **Type safety** — Full TypeScript support with schema validation
- **Lifecycle management** — Automatic cleanup on HMR and unmount
- **Error handling** — Built-in timeout and error tracking per tool

---

## Basic Example

```ts
import { useToolRegistry } from '~/utils/chat/tool-registry';

const registry = useToolRegistry();

// Register a simple calculator tool
registry.registerTool(
    {
        type: 'function',
        function: {
            name: 'calculate',
            description: 'Perform basic arithmetic operations',
            parameters: {
                type: 'object',
                properties: {
                    operation: {
                        type: 'string',
                        enum: ['add', 'subtract', 'multiply', 'divide']
                    },
                    a: { type: 'number' },
                    b: { type: 'number' }
                },
                required: ['operation', 'a', 'b']
            }
        },
        ui: {
            label: 'Calculator',
            icon: 'pixelarticons:calculator',
            descriptionHint: 'Basic math operations',
            defaultEnabled: true
        }
    },
    async (args) => {
        const { operation, a, b } = args;
        switch (operation) {
            case 'add': return `${a + b}`;
            case 'subtract': return `${a - b}`;
            case 'multiply': return `${a * b}`;
            case 'divide': return b !== 0 ? `${a / b}` : 'Error: Division by zero';
        }
    }
);

// Later, clean up
registry.unregisterTool('calculate');
```

---

## How to use it

### 1. Get the registry instance

```ts
import { useToolRegistry } from '~/utils/chat/tool-registry';

const registry = useToolRegistry();
```

The registry is a singleton — all calls return the same instance, so state is shared across your entire app.

### 2. Register a tool

```ts
registry.registerTool(definition, handler, options?);
```

**Parameters:**

- `definition` — OpenRouter-compatible tool definition with optional UI metadata
- `handler` — Async function that executes when the tool is called
- `options` — Optional configuration:
  - `override?: boolean` — Allow replacing existing tools (default: false)
  - `enabled?: boolean` — Initial enabled state (default: from UI metadata or true)
  - `timeout?: number` — Execution timeout in ms (default: 10000)

### 3. Use in a plugin

```ts
// app/plugins/my-tool.client.ts
export default defineNuxtPlugin(() => {
    const registry = useToolRegistry();
    
    registry.registerTool(
        {
            type: 'function',
            function: {
                name: 'my_tool',
                description: 'Does something useful',
                parameters: {
                    type: 'object',
                    properties: {
                        input: { type: 'string' }
                    },
                    required: ['input']
                }
            }
        },
        async ({ input }) => {
            // Your implementation
            return `Result: ${input}`;
        }
    );
    
    // Clean up on plugin unload
    onScopeDispose(() => {
        registry.unregisterTool('my_tool');
    });
});
```

---

## API Reference

### `registerTool(definition, handler, options?)`

Register a new tool or update an existing one.

```ts
function registerTool(
    definition: ExtendedToolDefinition,
    handler: ToolHandler,
    options?: RegisterOptions
): void
```

**Throws:** Error if tool name already exists and `options.override` is false.

### `unregisterTool(name)`

Remove a tool from the registry.

```ts
function unregisterTool(name: string): void
```

### `getTool(name)`

Get a registered tool by name.

```ts
function getTool(name: string): RegisteredTool | undefined
```

Returns undefined if tool doesn't exist.

### `listTools()`

Get all registered tools as a computed array.

```ts
function listTools(): ComputedRef<RegisteredTool[]>
```

Reactive — automatically updates when tools are added/removed.

### `getEnabledDefinitions()`

Get OpenRouter-compatible definitions for enabled tools only.

```ts
function getEnabledDefinitions(): ToolDefinition[]
```

Use this when building the request to the AI model.

### `executeTool(name, argsJson)`

Execute a tool by name with JSON-stringified arguments.

```ts
function executeTool(
    name: string,
    argsJson: string
): Promise<{ result?: string; error?: string; timedOut?: boolean }>
```

Handles parsing, validation, timeout, and error tracking automatically.

### `setEnabled(name, enabled)`

Toggle a tool's enabled state.

```ts
function setEnabled(name: string, enabled: boolean): void
```

Changes are automatically persisted to localStorage.

### `clearStorage()`

Remove all persisted tool preferences.

```ts
function clearStorage(): void
```

---

## Type Definitions

### `ExtendedToolDefinition`

```ts
interface ExtendedToolDefinition {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: {
            type: 'object';
            properties: Record<string, any>;
            required?: string[];
        };
    };
    ui?: {
        label?: string;              // Display name in UI
        icon?: string;               // Icon name for UIcon
        descriptionHint?: string;    // Longer description for tooltips
        defaultEnabled?: boolean;    // Initial enabled state
        category?: string;           // Group tools by category
    };
}
```

### `ToolHandler`

```ts
type ToolHandler<TArgs = any> = (args: TArgs) => Promise<string> | string;
```

Must return a string (or promise resolving to string) that will be passed back to the AI.

### `RegisteredTool`

```ts
interface RegisteredTool {
    definition: ExtendedToolDefinition;
    handler: ToolHandler;           // The actual function
    enabled: Ref<boolean>;          // Reactive toggle state
    lastError: Ref<string | null>;  // Most recent error
}
```

---

## How it works

### Registration flow

1. Tool is registered with definition + handler
2. Registry checks for duplicates (throws unless `override: true`)
3. Enabled state loaded from localStorage or defaults
4. Handler wrapped with timeout and error handling
5. Tool added to reactive map

### Execution flow

1. AI model calls tool with JSON arguments
2. `executeTool` parses and validates arguments against schema
3. Handler invoked with timeout wrapper (default 10s)
4. Result/error returned to AI model
5. `lastError` updated for diagnostics

### Persistence

- User's toggle states saved to `localStorage` under `or3.tools.enabled`
- Debounced writes (500ms) to avoid excessive storage operations
- Hydrated on first registry access
- No-op on server (SSR-safe)

---

## Common patterns

### Tool with validation

```ts
registry.registerTool(
    {
        type: 'function',
        function: {
            name: 'search_docs',
            description: 'Search documentation',
            parameters: {
                type: 'object',
                properties: {
                    query: { 
                        type: 'string',
                        minLength: 1,
                        maxLength: 200
                    }
                },
                required: ['query']
            }
        }
    },
    async ({ query }) => {
        if (!query.trim()) {
            throw new Error('Query cannot be empty');
        }
        const results = await searchDocs(query);
        return JSON.stringify(results);
    }
);
```

### Tool with category grouping

```ts
registry.registerTool(definition, handler, {
    category: 'Web Search',
    defaultEnabled: false
});
```

### Checking tool status

```ts
const tool = registry.getTool('my_tool');
if (tool) {
    console.log('Enabled:', tool.enabled.value);
    console.log('Last error:', tool.lastError.value);
}
```

### Listing enabled tools

```ts
const enabled = registry.listTools().value
    .filter(t => t.enabled.value)
    .map(t => t.definition.function.name);
```

---

## Error handling

### Timeout protection

All handlers are automatically wrapped with a timeout (default 10 seconds):

```ts
registry.registerTool(definition, handler, {
    timeout: 5000  // 5 second timeout
});
```

If timeout occurs:
- Execution stops
- Error message returned to AI
- `lastError` ref updated
- `timedOut: true` in execution result

### Validation errors

Invalid arguments return structured error:

```
Error: Invalid arguments for tool 'my_tool':
- Missing required field: input
- Field 'count' must be a number
```

### Handler errors

Uncaught errors are captured and formatted:

```
Error executing tool 'my_tool': Network request failed
```

---

## Best practices

### Always clean up

```ts
onScopeDispose(() => {
    registry.unregisterTool('my_tool');
});
```

### Use descriptive names

```ts
// Good
name: 'search_documentation'

// Bad
name: 'search'
```

### Provide helpful metadata

```ts
ui: {
    label: 'Search Docs',
    icon: 'pixelarticons:search',
    descriptionHint: 'Search through project documentation and guides',
    category: 'Documentation'
}
```

### Return structured data

```ts
async ({ query }) => {
    const results = await search(query);
    return JSON.stringify({
        count: results.length,
        items: results.slice(0, 5)
    });
}
```

### Handle edge cases

```ts
async ({ url }) => {
    if (!isValidUrl(url)) {
        return 'Error: Invalid URL format';
    }
    
    try {
        const data = await fetch(url);
        return data;
    } catch (error) {
        return `Error: Failed to fetch - ${error.message}`;
    }
}
```

---

## Limitations

- This registry executes handlers client-side; SSR background execution uses the separate server registry
- 10 second default timeout (configurable per tool)
- String return type only (serialize complex data as JSON)
- No streaming within tool execution
- Single handler per tool name

---

## Troubleshooting

### "Tool already registered"

You're trying to register a tool that already exists. Either:
- Use `unregisterTool` first
- Pass `override: true` option
- Check for duplicate plugin loads

### Tools not appearing in UI

- Check if `import.meta.client` guard is present
- Verify plugin is client-side only (`.client.ts`)
- Ensure registration happens in mounted/setup lifecycle

### Handler not executing

- Check tool is enabled in UI toggles
- Verify tool name matches exactly
- Look for errors in `tool.lastError.value`

### Timeout errors

- Increase timeout: `registerTool(def, handler, { timeout: 20000 })`
- Make handler faster (cache, optimize queries)
- Split into multiple smaller tools

---

## Related

- `openRouterStream` — Streaming parser that emits tool_call events
- `useChat` — Chat composable that executes tools during streaming
- `ChatInputDropper` — UI component with tool toggle controls
- `tool-runtime.md` — Runtime semantics across foreground/background paths
- `server-tool-registry.md` — SSR registry used for background tool execution

---

## TypeScript

Full type signature:

```ts
function useToolRegistry(): {
    registerTool: (
        definition: ExtendedToolDefinition,
        handler: ToolHandler,
        options?: RegisterOptions
    ) => void;
    unregisterTool: (name: string) => void;
    getTool: (name: string) => RegisteredTool | undefined;
    listTools: () => ComputedRef<RegisteredTool[]>;
    getEnabledDefinitions: () => ToolDefinition[];
    executeTool: (
        name: string,
        argsJson: string
    ) => Promise<{
        result?: string;
        error?: string;
        timedOut?: boolean;
    }>;
    setEnabled: (name: string, enabled: boolean) => void;
    clearStorage: () => void;
};
```

---

Document generated from `app/utils/chat/tool-registry.ts` implementation.
