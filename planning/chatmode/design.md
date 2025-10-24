artifact_id: 7bbdf38a-8779-49bb-8ec1-32d56b4211c9

# LLM Tools Registry Design

## Overview

The LLM Tools Registry introduces a compact plumbing layer that lets Or3 Chat plugins register OpenRouter-compatible function tools with metadata, expose human-friendly toggles in the composer UI, and execute tool calls during streaming. The solution reuses existing composable patterns, keeps state in a single reactive store, and augments the `useChat` streaming loop without restructuring unrelated chat code.

## Architecture

```mermaid
graph TD
    Plugin[[Plugin Module]] -->|registerTool| Registry((Tool Registry))
    ChatInput[ChatInputDropper UI] -->|toggle| Registry
    Registry -->|enabled tool defs| useAi[useChat.sendMessage]
    useAi -->|tools[]| OpenRouter[(openRouterStream)]
    OpenRouter -->|tool_call events| useAi
    useAi -->|handler lookup + execute| Registry
    Registry -->|handler result| useAi
    useAi -->|tool role message| MessageStore[(Dexie DB + UI)]
```

### Flow Summary

-   Plugins call `registerTool` during setup to add definitions and async handlers.
-   Chat composer reads the registry to render toggles and persists preferences.
-   `useChat.sendMessage` pulls enabled tool definitions when constructing OpenRouter payloads.
-   When `openRouterStream` emits `tool_call`, `useChat` executes the mapped handler, appends a `tool` message, and restarts streaming with updated history until the assistant completes.

## Components & Interfaces

### `app/utils/chat/tool-registry.ts`

-   **Responsibility:** Provide a lightweight singleton registry with reactive state that other modules can import without instantiating duplicates.
-   **Key structures:**

    ```ts
    import { markRaw, reactive, ref, computed } from 'vue';
    import type { ToolDefinition } from '~/utils/chat/types';

    export type ToolHandler<TArgs = any> = (
        args: TArgs
    ) => Promise<string> | string;

    export interface ExtendedToolDefinition extends ToolDefinition {
        description?: string; // human-readable summary for toggles or docs
        icon?: string;
        category?: string;
        defaultEnabled?: boolean;
    }

    export interface RegisteredTool {
        definition: ExtendedToolDefinition;
        handler: ToolHandler;
        enabled: Ref<boolean>;
        lastError: Ref<string | null>;
    }

    interface RegisterOptions {
        override?: boolean; // allow replacing an existing tool when true
    }

    const TOOL_STORAGE_KEY = 'or3.tools.enabled';
    ```

-   **Lifecycle & state:**
    -   A singleton registry object lives on `globalThis.__or3ToolRegistry` with shape `{ tools: reactive(new Map()), storageHydrated: false }`.
    -   `registerTool` lazily hydrates persisted enable states before inserting entries. It rejects duplicate names unless `override`. It wraps the handler in `markRaw` to avoid Vue proxying.
    -   `enabled` is a ref initialised from (in order) `opts.enabled ?? persisted ?? definition.ui?.defaultEnabled ?? true` to minimise developer configuration.
    -   `lastError` stores the most recent execution error string for optional diagnostics in the UI.
    -   `unregisterTool` deletes the entry and removes persisted state.
    -   `listTools` returns a stable array using `computed(() => Array.from(map.values()))` so Vue components automatically update when tools change.
    -   `hydrate(states)` merges persisted booleans into the map without blowing away in-memory state so plugins can pre-seed defaults.
-   **Persistence guardrails:** persistence is no-op on server, debounced client-side via `watch` on the enablement refs to avoid hot writes while toggling.
-   **Memory footprint:** the registry keeps only the handler reference and a few refs per tool—no history or heavy caches—preserving the “lightweight” goal.

### `ToolDefinition` Extension (`app/utils/chat/types.ts`)

-   Add optional metadata fields:
    ```ts
    export interface ToolDefinition {
        type: 'function';
        function: {
            /* existing */
        };
        ui?: {
            label?: string;
            icon?: string;
            descriptionHint?: string;
            defaultEnabled?: boolean;
            category?: string;
        };
    }
    ```
-   Metadata sits on an optional `ui` object so existing code compiles untouched.

### `useChat` Enhancements (`app/composables/chat/useAi.ts`)

-   **Tool Injection:** Before calling `openRouterStream`, fetch `listTools()` and filter on `tool.enabled.value` to build `tools` and `tool_choice` payloads.
-   **Loop Refactor:** Wrap the existing streaming section in a `while (continueLoop)` similar to the HelpChat implementation:
    ```ts
    let continueLoop = true;
    while (continueLoop) {
        continueLoop = false;
        const stream = openRouterStream({ tools: enabledDefs, ... });
        for await (const ev of stream) {
            if (ev.type === 'tool_call') {
                continueLoop = await handleToolCall(ev.tool_call);
                break; // restart loop with updated history
            }
            // existing text/reasoning/image handling
        }
    }
    ```
-   **Tool Execution:**
    ```ts
    async function handleToolCall(call: ToolCall) {
        const entry = registry.get(call.function.name);
        if (!entry) {
            await pushToolMessage(call.id, 'Tool not registered.');
            return true; // allow model to continue without handler result
        }
        const args = safeParse(
            call.function.arguments,
            entry.definition.function.parameters
        );
        const result = await withTimeout(entry.handler(args));
        await pushToolMessage(call.id, result);
        return true;
    }
    ```
-   **History Management:** Append both the assistant function-call message and the `tool` message to `rawMessages`/`messages`, mirroring the persisted structure already used for user and assistant entries.
-   **Streaming coordination details:**
    1. When `tool_call` arrives, flush the text buffer, finalise the partial assistant DB entry, and push a temporary UI message flagged `pendingTool=true` so users see activity.
    2. Execute the handler under `Promise.race([handler(args), timeout])`. On timeout, mark `lastError` on the registry entry, emit a `tool` message describing the timeout, and continue.
    3. After appending the tool result, set `continueLoop = true` so the next iteration resends history (now including: user -> assistant(function call) -> tool result). Include `tools` again only if additional calls should remain possible.
    4. If the model terminates without requesting another tool, the loop exits and the assistant message is finalised exactly once, preventing double persistence.

### `ChatInputDropper` Updates (`app/components/chat/ChatInputDropper.vue`)

-   List `listTools()` entries in the settings popover under the existing switches section.
-   Bind each Switch to the registry `enabled` ref using `v-model` and display `definition.ui.icon` when present.
-   Persist toggle state via the registry so no extra component-specific storage is needed.
-   **Accessibility considerations:** include the tool `definition.description` underneath the toggle as muted helper text, and ensure each switch is labelled via `aria-describedby` for screen readers.

### Plugin Ergonomics

-   Provide a helper export (e.g., `export const registerTool = useToolRegistry().registerTool;`) in a plugin-facing module to avoid repeated composable boilerplate.
-   Document pattern in `docs` with an example plugin registering and unregistering tools on `onBeforeUnmount` when running client-side.
-   Recommend plugins clean up via `onScopeDispose(() => unregisterTool(name))` to prevent stale entries during HMR or dynamic unloads.
-   Provide a tiny `defineTool` helper that infers argument types from the schema, giving better TypeScript inference for handler arguments.

#### Example plugin usage

```ts
import { onMounted, onScopeDispose } from 'vue';
import { registerTool, unregisterTool, defineTool } from '~/utils/chat/tools';

const weatherTool = defineTool({
    type: 'function',
    function: {
        name: 'get_weather',
        description: 'Fetch the current weather for a city.',
        parameters: {
            type: 'object',
            properties: { city: { type: 'string' } },
            required: ['city'],
        },
    },
    ui: {
        label: 'Weather lookup',
        icon: 'i-mdi:weather-partly-cloudy',
        descriptionHint: 'Let the assistant look up weather data.',
        defaultEnabled: false,
        category: 'Integrations',
    },
});

onMounted(() => {
    registerTool(weatherTool.definition, async ({ city }) => {
        const data = await fetchWeather(city);
        return formatWeather(data);
    });
});

onScopeDispose(() => unregisterTool('get_weather'));
```

## Data Models & Persistence

-   **Toggle Persistence:** Registry writes `Record<string, boolean>` into localStorage under `or3.tools.enabled` when enabled refs change, similar to `useAiSettings`. Hydration occurs lazily when `useToolRegistry` first runs client-side.
-   **Tool Message Storage:** Persist tool-role messages via existing Dexie `tx.appendMessage` to keep history consistent. Only summary text is stored in UI while full handler output is retained in a per-session cache (if large) to keep rendering light.
-   **Tool output caching:** maintain an in-memory map `{ tool_call_id: string => fullPayload }` scoped to the current session. The visible message may display a trimmed preview with a “View details” expansion, while the cache feeds the model on the follow-up request.

## Error Handling & Validation

-   **Argument Parsing:** `safeParse` validates JSON arguments using basic schema checks derived from `definition.function.parameters`. On mismatch, respond with a structured error string and skip handler invocation.
-   **Timeouts:** Wrap handler promises with a configurable timeout (e.g., 10s default) to avoid hanging the stream.
-   **Diagnostics:** Log warnings with tool name and error code using `reportError` for observability and surface a concise message to the user.
-   **Unknown Tools:** If the LLM references an unregistered name (possible during race conditions), respond with a tool message stating the tool is unavailable.
-   **Schema validation detail:** `safeParse` leverages a shallow validator (e.g., zod-lite or manual checks) generated from the JSON schema. Missing required keys or mismatched types produce an error message listing the offending fields to aid prompt debugging.
-   **Security posture:** arguments are sanitised before reaching handlers; handlers run in app context and must handle their own downstream validation (e.g., escaping DB queries). Provide guidance in docs to avoid side effects beyond the user’s intent.

## Testing Strategy

-   **Unit Tests** (`app/composables/chat/__tests__/useToolRegistry.spec.ts`): ensure register/unregister, enable toggles, and persistence.
-   **Integration Tests** (`app/composables/chat/__tests__/useAi.tools.spec.ts`): mock `openRouterStream` to emit `tool_call` events and verify handler execution, message history updates, and loop continuation.
-   **Component Tests** (`app/components/chat/__tests__/ChatInputDropper.tools.spec.ts`): mount the settings popover, assert toggle rendering and state binding.
-   **E2E Smoke**: scripted conversation verifying tool invocation path in a dev environment with the sample plugin enabled.
-   **Performance Checks**: assert registry initialization adds negligible overhead (<1 ms) by profiling during CI smoke tests.
-   **Regression guard:** add a contract test ensuring the registry emits only enabled tool definitions so toggled-off tools never leak into requests.
