# Tasks 1, 2 & 3: Implementation Summary

**Status**: ✅ Complete

## What Was Built

### Task 1: Tool Registry Core ✅

**File**: `app/utils/chat/tool-registry.ts`

A lightweight, singleton-backed registry that manages LLM tools with the following features:

-   **HMR-Safe Singleton**: Uses `globalThis.__or3ToolRegistry` with proper hydration guards
-   **Registration API**: `registerTool(definition, handler, opts)` with duplicate checking and override support
-   **Lifecycle Management**: `unregisterTool(name)`, `listTools()` (reactive computed), `getTool(name)` for lookups
-   **State Management**: `setEnabled(name, enabled)`, `hydrate(states)` for persisted preferences
-   **Argument Validation**: `safeParse()` validates JSON arguments against the schema with detailed error messages
-   **Timeout Protection**: `withTimeout()` wraps handler execution with configurable timeout (10s default)
-   **Tool Execution**: `executeTool(toolName, argumentsJson)` orchestrates validation, execution, and error handling
-   **Persistence**: Debounced (300ms) writes to `localStorage` under `or3.tools.enabled` key
-   **Error Tracking**: Each tool maintains a `lastError` ref for diagnostics

**Key Design Decisions**:

-   Handlers are `markRaw()` to prevent unnecessary Vue proxying overhead
-   Enabled refs are initialized via: explicit opt.enabled → persisted state → defaultEnabled → true
-   Validation is shallow (required fields + type checking) to keep it fast
-   Timeouts are applied per execution, not cumulative across multiple calls

### Task 2: Shared Types & Developer API ✅

**Files**:

-   `app/utils/chat/types.ts` (extended)
-   `app/utils/chat/tools-public.ts` (new public API)

#### Type Extensions

Extended `ToolDefinition` with optional UI metadata:

```typescript
ui?: {
    label?: string;
    icon?: string;
    descriptionHint?: string;
    defaultEnabled?: boolean;
    category?: string;
};
```

#### Public API Module

Created `tools-public.ts` as the single entry point for plugin developers:

-   Exports `useToolRegistry()` composable
-   Exports types: `ToolHandler`, `ExtendedToolDefinition`, `RegisteredTool`, `ToolDefinition`, `ToolCall`
-   Provides `defineTool()` helper for better TypeScript inference

**Import pattern for plugins**:

```typescript
import {
    useToolRegistry,
    defineTool,
    type ExtendedToolDefinition,
    type ToolHandler,
} from '~/utils/chat/tools-public';
```

### Task 3: Chat Engine Integration ✅

**File**: `app/composables/chat/useAi.ts` (modified)

Integrated tool calling into the existing streaming chat engine with seamless execution loop:

#### Tool Injection

-   **Enabled Tool Collection**: Before calling `openRouterStream`, the chat engine now calls `toolRegistry.getEnabledDefinitions()` to gather all active tools
-   **Conditional Passing**: Tools are only passed to the API when at least one tool is enabled, avoiding unnecessary overhead
-   **Model Context**: OpenRouter receives the full tool schema, enabling the LLM to understand what functions it can request

#### Streaming Loop Refactor

Wrapped the existing streaming section in a `while (continueLoop)` loop (max 10 iterations) that:

1. **Detects Tool Calls**: Monitors stream for `tool_call` events from the LLM
2. **Executes Handlers**: When detected:
    - Pauses text streaming
    - Calls `toolRegistry.executeTool(name, arguments)` with full validation and timeout protection
    - Catches errors gracefully and continues conversation even on tool failure
3. **Updates History**: Appends both:
    - Assistant's function call request (with `tool_calls` metadata)
    - Tool result message (role: `tool`, linked via `tool_call_id`)
4. **Restarts Stream**: Sets `continueLoop = true` and breaks to restart streaming with updated history
5. **Finalizes**: When LLM sends no more tool calls, completes the response normally

#### Tool Output Caching

-   **In-Memory Cache**: `toolOutputCache` Map stores full tool results keyed by `tool_call_id`
-   **UI Summaries**: For results > 500 characters, displays truncated preview with size indicator
-   **Model Feed**: Full untruncated output sent to LLM in follow-up requests for accurate context
-   **Session Scoped**: Cache cleared automatically when conversation completes

#### Error Handling

-   **Unknown Tools**: Returns error message to LLM explaining tool is unavailable
-   **Validation Failures**: Sends detailed error about missing/invalid parameters
-   **Timeouts**: 10-second handler timeout with clear error messaging
-   **Loop Safety**: Max 10 iterations prevents infinite tool-calling loops

#### Backward Compatibility

-   **Zero Breaking Changes**: Existing chats without tools work identically
-   **Graceful Degradation**: If registry has no enabled tools, behaves exactly like previous code
-   **DB Schema**: Tool messages stored as regular messages with metadata in `data` field

## Files Modified/Created

| File                                       | Type     | Changes                                                       |
| ------------------------------------------ | -------- | ------------------------------------------------------------- |
| `app/utils/chat/tool-registry.ts`          | Created  | 400+ lines of registry logic                                  |
| `app/utils/chat/tools-public.ts`           | Created  | 30 lines of public API                                        |
| `app/utils/chat/types.ts`                  | Modified | Added `ui` metadata + `ToolCall` import                       |
| `app/composables/chat/useAi.ts`            | Modified | ~200 lines added for tool loop integration                    |
| `app/components/chat/ChatInputDropper.vue` | Modified | Added tool registry import and UI toggles section (~50 lines) |

## Verification

✅ All files compile without TypeScript errors  
✅ Full Nuxt build succeeds (32s client + 18s server)  
✅ No runtime import conflicts  
✅ Streaming loop maintains existing behavior when no tools enabled

## Architecture Highlights

### Tool Execution Flow

```
User sends message
  ↓
Registry provides enabled tool definitions
  ↓
Stream starts with tools[] in API request
  ↓
LLM requests tool → Execute handler → Append result
  ↓
Restart stream with updated history
  ↓
LLM uses result to complete response
  ↓
Finalize and persist
```

### Key Patterns

-   **Separation of Concerns**: Registry handles tool mgmt, useAi handles execution flow
-   **Defensive Coding**: Extensive error handling, timeouts, validation at every step
-   **Performance**: Debounced persistence, message caching, minimal overhead when disabled
-   **Observability**: Debug logging for tool calls, executions, and loop iterations

## Ready for Next Phase

Tasks 1-4 complete! The system now has a complete tool calling infrastructure with UI. Next steps:

-   **Task 5**: Documentation & sample plugin
-   **Task 6**: Unit/integration/component tests

## Task 4: UI Controls ✅

**File**: `app/components/chat/ChatInputDropper.vue` (modified)

### What Was Added

Integrated tool toggles into the existing settings popover in `ChatInputDropper`:

#### UI Integration

-   **Tool List Rendering**: Added dynamic section that displays all registered tools from `toolRegistry.listTools`
-   **Conditional Display**: Tool section only renders when `registeredTools.length > 0` to avoid empty UI
-   **Positioned After Switches**: Tool toggles appear after "Enable thinking" and before "System prompts" button

#### Toggle Features

-   **Two-Way Binding**: Each toggle uses `v-model="tool.enabled.value"` for reactive sync with registry state
-   **Custom Labels**: Displays `tool.definition.ui?.label` with fallback to `tool.definition.function.name`
-   **Icon Support**: Shows custom icon from `tool.definition.ui?.icon` or defaults to `pixelarticons:wrench`
-   **Description Text**: Renders `ui.descriptionHint` or `function.description` as muted helper text below toggle

#### Accessibility

-   **ARIA Labeling**: Each switch is linked to its description via `aria-describedby` attribute
-   **Keyboard Navigation**: Inherits USwitch accessibility for keyboard users
-   **Screen Reader Support**: Description text provides context for assistive technology

#### Streaming Safety

-   **Disabled During Operations**: Toggles are disabled when `loading || props.streaming` is true
-   **State Preservation**: Registry maintains toggle state even when disabled, preventing accidental changes mid-conversation

#### Visual Design

-   **Retro Consistency**: Follows existing popover styling with border-b separators
-   **Compact Layout**: Uses py-1 px-2 spacing matching other settings items
-   **Flex Layout**: Icon and toggle align properly with justify-between

### Code Changes

-   **Import Added**: `import { useToolRegistry } from '~/utils/chat/tools-public'`
-   **Composable Init**: `const toolRegistry = useToolRegistry(); const registeredTools = computed(() => toolRegistry.listTools.value);`
-   **Template Section**: ~50 lines of new template code for tool toggles with v-for loop

### Behavior

-   When plugins register tools, they **automatically appear** in the settings popover
-   Toggle changes **immediately persist** to localStorage via registry's debounced watcher
-   UI state **stays in sync** with registry because we bind directly to `tool.enabled.value` refs
-   No additional component state needed—registry is single source of truth

## Developer Experience

### Tool Registration (from Task 1-2)

```typescript
import { onScopeDispose } from 'vue';
import { useToolRegistry, defineTool } from '~/utils/chat/tools-public';

const { registerTool } = useToolRegistry();

const myTool = defineTool({
    type: 'function',
    function: {
        name: 'my_action',
        description: 'Do something',
        parameters: { type: 'object', properties: {}, required: [] },
    },
    ui: { label: 'My Action', defaultEnabled: false },
});

registerTool(myTool, async (args) => {
    return 'done';
});

onScopeDispose(() => unregisterTool('my_action'));
```

### Automatic Integration

Once registered, tools are:

-   ✅ Automatically available to all chats
-   ✅ Called seamlessly during streaming
-   ✅ Executed with validation and timeout protection
-   ✅ Results fed back to LLM for final answer

No additional configuration needed!
