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

Use the local reference bundle in this skill folder.

Workflow:
1. Start with `references/docmap.json` to discover relevant docs.
2. Open only the relevant docs listed in `references/INDEX.md`.
3. Prefer curated references below before going to upstream paths.

### Curated Reference Set

| Topic | Path |
|-------|------|
| Discovery Index | `references/INDEX.md` |
| Doc Map | `references/docmap.json` |
| Plugin/Pane Quickstart | `references/start/plugin-quickstart.md` |
| Mini App Tutorial | `references/start/mini-app-tutorial.md` |
| Dashboard + Sidebar Registries | `references/composables/useDashboardPlugins.md` |
| Sidebar Page Registration | `references/composables/registerSidebarPage.md` |
| Multi Pane API | `references/composables/useMultiPane.md` |
| Hook System | `references/hooks/hook-catalog.md` |
| Tool Registry | `references/utils/tool-registry.md` |
| Tool Runtime + Server Registry | `references/utils/tool-runtime.md` |
| Persistence for plugins | `references/database/posts.md` |
| Theme Quick Start | `references/themes/quick-start.md` |
| Theme API + Selectors | `references/themes/api-reference.md` |

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

---

## 13. Known Roadblocks

### 1. Vue `defineEmits` — use call-signature style, not tuple style

When a component has many events, the tuple-style `defineEmits` overload breaks type inference and produces confusing errors.

**Wrong:**
```typescript
const emit = defineEmits(['toggle-subtask', 'remove-subtask', 'update-title']);
// All args are `any`, no IDE help
```

**Right:**
```typescript
const emit = defineEmits<{
  (e: 'toggle-subtask', subtaskId: string): void;
  (e: 'remove-subtask', subtaskId: string): void;
  (e: 'update-title', title: string): void;
}>();
```

Call-signature style gives full type inference for every argument and surfaces mismatches at compile time.

---

### 2. `toISOString()` breaks `<input type="date">` values near timezone boundaries

`toISOString()` always returns UTC. If the user is west of UTC, a timestamp like midnight local time becomes the previous day in UTC — the date input shows the wrong date.

**Wrong:**
```typescript
const value = new Date(ts).toISOString().slice(0, 10); // UTC — wrong for local dates
```

**Right:**
```typescript
function formatDateForInput(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
```

Always use local getters (`getFullYear`, `getMonth`, `getDate`) when formatting dates for form inputs.

---

### 3. Querying the notifications table for dedupe is fragile — use a marker on the source record

Checking whether a notification already exists by querying the notifications table (e.g. Dexie `notifications.where(...)`) is unreliable in cloud/sync contexts: the table may not be replicated, may be pruned, or may reflect a different device's state.

**Wrong pattern:**
```typescript
const existing = await db.notifications.where('meta.taskId').equals(taskId).first();
if (existing) return; // Fragile — table state varies per device/session
```

**Right pattern:**
Store a sticky marker directly on the source record (`due_notified_at: number | null`). Gate the notification on that marker and never auto-clear it on updates.

```typescript
// In scanner:
if (task.due_notified_at !== null) continue; // Already notified — skip

// In updateTask service:
// Preserve due_notified_at — never auto-clear it during updates
due_notified_at: existing.due_notified_at ?? null,
```

The marker travels with the data, is LWW-safe, and works identically offline or online.

---

### 4. Tool runtime boundaries must match execution path (`client` / `server` / `hybrid`)

Tool definitions can execute in different paths (foreground client stream, SSR background stream, server workflows). If runtime is not explicit and aligned with where handlers exist, tools will silently fail as “not registered” in one path.

**Best practice:**
- Set runtime explicitly during registration.
- If a tool is `client` only, ensure background/server execution paths do not attempt to run it.
- If a tool must run in background/SSR, provide a server handler and mark runtime accordingly.

```typescript
registry.registerTool(def, handler, { runtime: 'client' }); // explicit intent
```

Treat runtime as part of API contract, not optional metadata.

---

### 5. Persisting stream metadata is not enough — update in-memory UI state in real time

A common failure mode is writing streamed metadata (tool calls, status, reasoning) to storage but not applying it to active in-memory message state. Users then only see updates after reload.

**Best practice:**
- Apply every stream update to live message refs first.
- Persist in parallel for recovery.
- Ensure `onUpdate`, `onComplete`, `onError`, and `onAbort` all update the same UI fields.

```typescript
subscriber.onUpdate = ({ status }) => {
  message.toolCalls = normalizeToolCalls(status.tool_calls);
  // persist asynchronously as needed
};
```

Real-time UX must be driven by live state, not reload-time hydration.

---

### 6. Orama search integration needs strict guardrails (fallback + caps + rebuild strategy)

Orama result shapes can vary, indexing can fail in edge runtimes, and rebuilding too often causes unnecessary cost.

**Best practice:**
- Use dynamic client-side import only.
- Debounce query execution (~120ms).
- Cap search limits (100–200 typical).
- Rebuild index only when data signature changes (count + latest updated timestamp).
- Always provide substring fallback when Orama throws or returns no hits.
- Normalize hit id extraction defensively (`hit.document.id` and `hit.id`).

```typescript
if (oramaFailsOrNoHits) {
  return substringFallback(query);
}
```

Search should degrade gracefully, never to “no results because index failed.”


---

### 7. Tools registered in `.client.ts` plugins are invisible to server-side background streaming

Background streaming jobs execute entirely server-side. A Nuxt plugin with `.client.ts` suffix (or `if (!process.client) return`) never runs during SSR — so any `useToolRegistry().register()` call inside it is never executed on the server. When the background stream handler tries `executeTool(name)`, the registry is empty and the tool is reported as "not registered on server."

**Symptoms:**
- `Tool "or3_tasks_*" is not registered on server.` error after page refresh
- Tool calls work fine in foreground mode, fail silently or error in background mode

**Best practice:**
- If a tool only has a client-side handler (reads/writes Dexie, manipulates local state), mark it `runtime: 'client'` during registration.
- Ensure the background job scheduler checks tool runtime flags and forces foreground streaming for any request containing `client`-only tools.
- Never assume a foreground-working tool works in background/SSR mode — they have completely separate registries.

```typescript
// BAD: registerTaskTools() inside tasks-pane.client.ts — invisible to SSR
export default defineNuxtPlugin(() => {
    if (!process.client) return; // background jobs never reach this
    registerTaskTools();
});

// GOOD: flag tools so the scheduler knows they require client execution
registry.registerTool(def, handler, { runtime: 'client' });
// scheduler then forces foreground mode for requests containing client-only tools
```

---

### 8. OpenRouter SSE tool-call arguments can be cumulative snapshots, not incremental deltas

Different providers stream tool-call `arguments` differently:
- **Delta mode** (most providers): each chunk is an incremental fragment, must be concatenated.
- **Cumulative snapshot mode** (e.g. MiniMax M2.5): each chunk is the full accumulated JSON string so far.

Naively concatenating all chunks in cumulative mode produces doubled/corrupted JSON, breaking `JSON.parse()` and causing tool execution to fail silently.

**Detection heuristic:** if `nextChunk.startsWith(previous)`, the provider is sending cumulative snapshots — replace rather than append.

```typescript
function mergeStreamedField(previous: string, nextChunk: string): string {
    if (!nextChunk) return previous;
    if (!previous) return nextChunk;
    if (nextChunk.startsWith(previous)) return nextChunk; // cumulative snapshot
    if (nextChunk === previous) return previous;          // exact duplicate
    return previous + nextChunk;                          // standard delta
}
```

Apply this to both `name` and `arguments` fields on every tool-call chunk. Without it, any cumulative provider produces silently corrupt tool call payloads that fail at execution time.

---

### 9. `reasoning_details` is an array — parsers that only read `[0]` silently drop reasoning

OpenRouter's streaming format for chain-of-thought reasoning uses `choices[].delta.reasoning_details: Array<{ type, text?, summary? }>`. Some models (Kimi-k2.5, MiniMax M2.5) emit **multiple entries in a single chunk** — e.g. one `reasoning.text` entry and one `reasoning.summary` entry in the same delta.

A parser that only processes `reasoning_details[0]` silently discards all subsequent entries, producing:
- Missing or truncated thinking blocks in the UI
- `[stream] empty delta append ignored` console warnings from downstream consumers receiving empty strings

**Best practice:** always iterate the full array:

```typescript
const reasoningDetails = choice.delta.reasoning_details;
if (Array.isArray(reasoningDetails)) {
    for (const entry of reasoningDetails) {
        const text = entry.text ?? entry.summary ?? '';
        if (text) emit({ type: 'reasoning', content: text });
    }
}
```

This is in addition to `choice.delta.reasoning` (used by older/other providers). Both paths must be handled independently — they are not redundant.


---

### 7. Tools registered in `.client.ts` plugins are invisible to server-side background streaming

Background streaming jobs execute entirely server-side. A Nuxt plugin with `.client.ts` suffix (or `if (!process.client) return`) never runs during SSR — so any `useToolRegistry().register()` call inside it is never executed on the server. When the background stream handler tries `executeTool(name)`, the registry is empty and the tool is reported as "not registered on server."

**Symptoms:**
- `Tool "or3_tasks_*" is not registered on server.` error after page refresh
- Tool calls work fine in foreground mode, fail silently or error in background mode

**Best practice:**
- If a tool only has a client-side handler (reads/writes Dexie, manipulates local state), mark it `runtime: 'client'` during registration.
- Ensure the background job scheduler checks tool runtime flags and forces foreground streaming for any request containing `client`-only tools.
- Never assume a foreground-working tool works in background/SSR mode — they have completely separate registries.

```typescript
// BAD: registerTaskTools() inside tasks-pane.client.ts — invisible to SSR
export default defineNuxtPlugin(() => {
    if (!process.client) return; // background jobs never reach this
    registerTaskTools();
});

// GOOD: flag tools so the scheduler knows they require client execution
registry.registerTool(def, handler, { runtime: 'client' });
// scheduler then forces foreground mode for requests containing client-only tools
```

---

### 8. OpenRouter SSE tool-call arguments can be cumulative snapshots, not incremental deltas

Different providers stream tool-call `arguments` differently:
- **Delta mode** (most providers): each chunk is an incremental fragment, must be concatenated.
- **Cumulative snapshot mode** (e.g. MiniMax M2.5): each chunk is the full accumulated JSON string so far.

Naively concatenating all chunks in cumulative mode produces doubled/corrupted JSON, breaking `JSON.parse()` and causing tool execution to fail silently.

**Detection heuristic:** if `nextChunk.startsWith(previous)`, the provider is sending cumulative snapshots — replace rather than append.

```typescript
function mergeStreamedField(previous: string, nextChunk: string): string {
    if (!nextChunk) return previous;
    if (!previous) return nextChunk;
    if (nextChunk.startsWith(previous)) return nextChunk; // cumulative snapshot
    if (nextChunk === previous) return previous;          // exact duplicate
    return previous + nextChunk;                          // standard delta
}
```

Apply this to both `name` and `arguments` fields on every tool-call chunk. Without it, any cumulative provider produces silently corrupt tool call payloads that fail at execution time.

---

### 9. `reasoning_details` is an array — parsers that only read `[0]` silently drop reasoning

OpenRouter's streaming format for chain-of-thought reasoning uses `choices[].delta.reasoning_details: Array<{ type, text?, summary? }>`. Some models (Kimi-k2.5, MiniMax M2.5) emit **multiple entries in a single chunk** — e.g. one `reasoning.text` entry and one `reasoning.summary` entry in the same delta.

A parser that only processes `reasoning_details[0]` silently discards all subsequent entries, producing:
- Missing or truncated thinking blocks in the UI
- `[stream] empty delta append ignored` console warnings from downstream consumers receiving empty strings

**Best practice:** always iterate the full array:

```typescript
const reasoningDetails = choice.delta.reasoning_details;
if (Array.isArray(reasoningDetails)) {
    for (const entry of reasoningDetails) {
        const text = entry.text ?? entry.summary ?? '';
        if (text) emit({ type: 'reasoning', content: text });
    }
}
```

This is in addition to `choice.delta.reasoning` (used by older/other providers). Both paths must be handled independently — they are not redundant.


---

### 10. Custom pane apps must implement pane-aware border logic themselves

When a custom pane app (registered via `multiPaneApi.registerAppType()`) is rendered in split/multi-pane mode, the host layout does NOT automatically apply frame borders. Each pane component is responsible for adding its own top/right border based on its position in the pane layout.

Without this, panes in split mode look frameless/floating — no visible separation from adjacent panes.

**Root cause pattern:**
- Single pane: no borders needed.
- Last pane in a multi-pane layout: no right border (nothing to the right).
- Non-last pane in a multi-pane layout: needs `border-t` + `border-r` to form the frame.

**Fix — use `getGlobalMultiPaneApi()` to detect position:**

```typescript
// In your pane component
const props = defineProps<{ paneId?: string }>();

const multiPaneApi = getGlobalMultiPaneApi();
const isSinglePane = computed(() => multiPaneApi.panes.value.length <= 1);
const isLastPane = computed(() => {
    const panes = multiPaneApi.panes.value;
    return panes[panes.length - 1]?.id === props.paneId;
});

const paneFrameClass = computed(() => {
    if (isSinglePane.value || isLastPane.value) return '';
    return 'border-t border-r border-[var(--md-outline-variant)]';
});
```

```html
<template>
    <div :class="['flex flex-col h-full', paneFrameClass]">
        <!-- pane content -->
    </div>
</template>
```

Always accept `paneId` as a prop in custom pane components — the multi-pane host passes it down and it is needed for position detection.


---

### 10. Custom pane apps must implement pane-aware border logic themselves

When a custom pane app (registered via `multiPaneApi.registerAppType()`) is rendered in split/multi-pane mode, the host layout does NOT automatically apply frame borders. Each pane component is responsible for adding its own top/right border based on its position in the pane layout.

Without this, panes in split mode look frameless/floating — no visible separation from adjacent panes.

**Root cause pattern:**
- Single pane: no borders needed.
- Last pane in a multi-pane layout: no right border (nothing to the right).
- Non-last pane in a multi-pane layout: needs `border-t` + `border-r` to form the frame.

**Fix — use `getGlobalMultiPaneApi()` to detect position:**

```typescript
// In your pane component
const props = defineProps<{ paneId?: string }>();

const multiPaneApi = getGlobalMultiPaneApi();
const isSinglePane = computed(() => multiPaneApi.panes.value.length <= 1);
const isLastPane = computed(() => {
    const panes = multiPaneApi.panes.value;
    return panes[panes.length - 1]?.id === props.paneId;
});

const paneFrameClass = computed(() => {
    if (isSinglePane.value || isLastPane.value) return '';
    return 'border-t border-r border-[var(--md-outline-variant)]';
});
```

```html
<template>
    <div :class="['flex flex-col h-full', paneFrameClass]">
        <!-- pane content -->
    </div>
</template>
```

Always accept `paneId` as a prop in custom pane components — the multi-pane host passes it down and it is needed for position detection.
