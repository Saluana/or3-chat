# Hook/Action System for Nuxt

A lightweight, type-safe hook engine for the Nuxt frontend. It lets components, composables, and plugins subscribe to events (actions) or transform data (filters) with predictable ordering and SSR/HMR safety.

-   Actions: fire-and-forget side effects (logging, analytics, UI updates)
-   Filters: transform values in a pipeline (value-in → value-out)
-   Priorities: lower runs earlier (default 10)
-   Wildcards: use `*` to match patterns, e.g. `ui.*:action:after`

## Installation & Access

The engine is provided globally by Nuxt plugins:

-   Client: singleton instance across HMR
-   Server (SSR): fresh instance per request

Access anywhere:

```ts
import { useNuxtApp } from '#app';

const hooks = useNuxtApp().$hooks;
// or
import { useHooks } from '~/app/composables/useHooks';
const hooks2 = useHooks();
```

In components, prefer the lifecycle-safe composable:

```ts
import { useHookEffect } from '~/app/composables/useHookEffect';

useHookEffect('route.change:action:after', (_ctx, to, from) => {
    console.log('navigated from', from, 'to', to);
});
```

## API Overview

Engine methods:

-   Filters
    -   addFilter(name, fn, priority?, acceptedArgs?)
    -   removeFilter(name, fn, priority?)
    -   applyFilters(name, value, ...args) => Promise<Return>
    -   applyFiltersSync(name, value, ...args)
-   Actions
    -   addAction(name, fn, priority?, acceptedArgs?)
    -   removeAction(name, fn, priority?)
    -   doAction(name, ...args) => Promise<void>
    -   doActionSync(name, ...args)
-   Utils
    -   hasFilter(name?, fn?) => boolean|priority
    -   hasAction(name?, fn?) => boolean|priority
    -   removeAllCallbacks(priority?)
    -   currentPriority() => number|false
-   Ergonomics
    -   onceAction(name, fn, priority?)
    -   on(name, fn, { kind: 'action'|'filter', priority }) → disposer
    -   off(disposer)

Types are exported from `app/utils/hooks`.

## Hook Naming

Use hierarchical strings with dots/colons to keep hooks descriptive:

-   `app.init:action:after`
-   `ui.form.submit:filter:input`
-   `route.change:action:before`

Wildcards are supported with `*`, e.g. `ui.*:action:after`.

## Examples

### Subscribe to an action (component-safe)

```ts
// Track route changes
useHookEffect('route.change:action:after', (_ctx, to, from) => {
    console.log('navigated from', from, 'to', to);
});
```

### Fire an action

```ts
const hooks = useHooks();
await hooks.doAction('app.init:action:after', nuxtApp);
```

### Filter pipeline (async)

```ts
const hooks = useHooks();
const sanitized = await hooks.applyFilters(
    'ui.chat.message:filter:outgoing',
    rawPayload,
    { roomId }
);
```

### Filter pipeline (sync)

```ts
const result = hooks.applyFiltersSync(
    'ui.form.submit:filter:input',
    initialValues
);
```

### Wildcard subscription

```ts
const offAnyUiAfter = hooks.on(
    'ui.*:action:after',
    () => {
        console.log('some UI after-action fired');
    },
    { kind: 'action', priority: 5 }
);

// Later
hooks.off(offAnyUiAfter);
```

### Once-only action handler

```ts
hooks.onceAction('app.init:action:after', () => {
    console.log('init completed');
});
```

## Priorities

Callbacks execute in ascending priority. For equal priorities, insertion order is preserved. Default priority is 10.

```ts
hooks.on('ui.form.submit:action:before', fnA, { kind: 'action', priority: 5 });
hooks.on('ui.form.submit:action:before', fnB); // runs after fnA (priority 10)
```

## SSR and HMR Safety

-   Server: a new engine instance is created per request to avoid state leakage.
-   Client: a singleton engine is reused across HMR; component-level disposers prevent duplicate handlers.
-   `useHookEffect` automatically unregisters on component unmount and on module dispose during HMR.

## Error Handling & Timing

All callbacks are wrapped in try/catch. Errors are logged to the console and per-hook error counters are incremented. Basic timings are recorded:

```ts
const { timings, errors, callbacks } = hooks._diagnostics;
console.log('timings for hook', timings['ui.form.submit:action:before']);
console.log('error count for hook', errors['ui.form.submit:action:before']);
console.log('total callbacks registered', callbacks());
```

## Recommendations

-   Keep hook names consistent and scoped (e.g., `ui.form.*`, `route.*`).
-   Use filters for transformations and actions for side effects.
-   Prefer `useHookEffect` inside components; use `hooks.on/off` in non-component modules.
-   Consider using wildcards for broad tracing during development.

## UI chrome registries

Three registries let plugins augment the surrounding UI chrome without forking core components. They mirror the existing message/project registries: global singletons, default order `200`, dev warnings on duplicate IDs, and automatic HMR cleanup when you unregister on dispose.

### Sidebar sections & footer actions

-   `registerSidebarSection({ id, component, placement?, order? })` injects Vue components into the expanded sidebar. `placement` can be `top`, `main` (default), or `bottom`.
-   `registerSidebarFooterAction({ id, icon, tooltip?, label?, order?, color?, handler })` renders buttons above the built-in bottom nav in both expanded and collapsed layouts.
-   Context available to footer actions: `{ activeThreadId?, activeDocumentId?, isCollapsed }` plus any future fields. Use it to scope behavior.

```ts
defineNuxtPlugin(() => {
    registerSidebarSection({
        id: 'my-plugin:tips-card',
        component: {
            template: `
                <div class="border px-3 py-2 rounded-md text-xs">
                    <p class="font-semibold mb-1">Daily tip</p>
                    <p class="opacity-70">Shortcuts live here.</p>
                </div>
            `,
        },
        placement: 'top',
        order: 240,
    });

    registerSidebarFooterAction({
        id: 'my-plugin:sidebar-toast',
        icon: 'pixelarticons:rocket',
        tooltip: 'Show toast',
        async handler({ activeThreadId }) {
            useToast().add({
                title: 'Sidebar action',
                description: activeThreadId
                    ? `Active thread: ${activeThreadId}`
                    : 'No active thread',
            });
        },
    });
});
```

### Header actions

-   `registerHeaderAction({ id, icon, tooltip?, label?, order?, color?, handler })` adds icon buttons to the top bar. They render after the built-in controls and collapse automatically on mobile.
-   Context: `{ route, isMobile }` so you can tailor behavior to the active page or device.

```ts
registerHeaderAction({
    id: 'my-plugin:refresh-cache',
    icon: 'pixelarticons:sync',
    tooltip: 'Refresh plugin cache',
    order: 260,
    async handler({ route }) {
        await refreshPluginCache(route?.params?.id);
        useToast().add({ title: 'Cache refreshed' });
    },
});
```

### Composer actions

-   `registerComposerAction({ id, icon, label?, tooltip?, order?, color?, handler, visible?, disabled? })` adds controls next to the chat send button.
-   Context: `{ editor, threadId, paneId, isStreaming }` plus `isMobile`/`isLoading` for convenience.
-   Use `visible` or `disabled` to hide actions while streaming.

```ts
registerComposerAction({
    id: 'my-plugin:insert-template',
    icon: 'pixelarticons:pen',
    label: 'Template',
    tooltip: 'Insert a canned response',
    order: 230,
    disabled: ({ isStreaming }) => !!isStreaming,
    handler({ editor }) {
        if (!editor) return;
        editor.chain().focus().insertContent('Hello from my plugin!').run();
    },
});
```

Remember to call the matching `unregister*` helpers during HMR disposal:

```ts
if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        unregisterSidebarSection('my-plugin:tips-card');
        unregisterSidebarFooterAction('my-plugin:sidebar-toast');
        unregisterHeaderAction('my-plugin:refresh-cache');
        unregisterComposerAction('my-plugin:insert-template');
    });
}
```

See `app/plugins/examples/chrome-actions-example.client.ts` for a full example that registers each chrome registry in one place.

## Files

-   Engine: `app/utils/hooks.ts`
-   Plugins: `app/plugins/hooks.client.ts`, `app/plugins/hooks.server.ts`
-   Composables: `app/composables/useHooks.ts`, `app/composables/useHookEffect.ts`
-   Types: `types/nuxt.d.ts` adds `$hooks` to `NuxtApp`

---

Future ideas:

-   Vue DevTools timeline integration
-   Inspector UI listing current callbacks
-   Debounced/throttled variants
-   Unit tests and benchmarks

## DB integration hooks

The app/db modules are instrumented with hooks at important lifecycle points. You can transform inputs with filters and observe mutations with actions.

Entities covered: attachments, kv, projects, threads, messages, posts.
Now also: file storage (files: meta + blobs), message file hash validation, and post content/meta management.
New (branching): fork option filtering & branching cache invalidation.

Common patterns:

-   Create
    -   `db.{entity}.create:filter:input` — transform input prior to validation
    -   `db.{entity}.create:action:before` — before persisting
    -   `db.{entity}.create:action:after` — after persisting
-   Upsert
    -   `db.{entity}.upsert:filter:input`
    -   `db.{entity}.upsert:action:before`
    -   `db.{entity}.upsert:action:after`
-   Delete
    -   Soft: `db.{entity}.delete:action:soft:before|after`
    -   Hard: `db.{entity}.delete:action:hard:before|after`
-   Get/Queries (output filters)
    -   `db.{entity}.get:filter:output`
    -   kv: `db.kv.getByName:filter:output`
    -   threads: `db.threads.byProject:filter:output`, `db.threads.searchByTitle:filter:output`, `db.threads.children:filter:output`
    -   messages: `db.messages.byThread:filter:output`, `db.messages.byStream:filter:output`
    -   posts: `db.posts.get:filter:output`, `db.posts.all:filter:output`, `db.posts.search:filter:output`
-   Advanced operations
    -   messages: `db.messages.append|move|copy|insertAfter|normalize:action:before|after`
        -   threads: `db.threads.fork:action:before|after`, `db.threads.fork:filter:options` (modify branch creation options before execution)
    -   files: `db.files.create:filter:input`, `db.files.create:action:before|after`, `db.files.refchange:action:after`, `db.files.delete:action:soft:before|after`
    -   message file hashes: `db.messages.files.validate:filter:hashes` (array<string> → array<string>) for enforcing limits, dedupe, ordering, warnings
    -   posts: (standard CRUD only) create/upsert/delete hooks plus query output filters
        -   Create: `db.posts.create:filter:input`, `db.posts.create:action:before|after`
        -   Upsert: `db.posts.upsert:filter:input`, `db.posts.upsert:action:before|after`
        -   Delete: `db.posts.delete:action:soft:before|after`, `db.posts.delete:action:hard:before|after`
        -   Queries: `db.posts.get:filter:output`, `db.posts.all:filter:output`, `db.posts.search:filter:output`
        -   branching cache: (internal) cache invalidated on `db.threads.create:action:after`, `db.threads.upsert:action:after`, `db.threads.fork:action:after`, and thread delete actions.

### Branching (Minimal) Hooks

The simplified branching system exposes a small set of hooks so you can still observe or tweak behavior without the previous complexity.

Hook names:

-   `branch.fork:filter:options` (filter) — Adjust `{ sourceThreadId, anchorMessageId, mode, titleOverride }` before a fork is created.
-   `branch.fork:action:before` / `branch.fork:action:after` — Observe fork lifecycle. `before` payload: `{ source, anchor, mode, options }`, `after` payload: `{ thread, anchor, mode, copied }`.
-   `branch.retry:filter:options` (filter) — Adjust `{ assistantMessageId, mode, titleOverride }` before a retry-based branch.
-   `branch.retry:action:before` / `branch.retry:action:after` — Retry lifecycle. `after` payload: `{ assistantMessageId, precedingUserId, newThreadId, mode }`.
-   `branch.context:filter:messages` (filter) — Transform the assembled message array for a branched thread (reference mode) before it is returned.
-   `branch.context:action:after` (action) — Inspect context assembly metrics `{ threadId, mode, ancestorCount, localCount, finalCount }`.

Example: Force all branches to reference mode and tag titles.

```ts
useHookEffect(
    'branch.fork:filter:options',
    (opts) => ({
        ...opts,
        mode: 'reference',
        titleOverride: (opts.titleOverride || 'Alt Path') + ' • ref',
    }),
    { kind: 'filter' }
);
```

Example: Inject a system primer into branched context.

```ts
useHookEffect(
    'branch.context:filter:messages',
    (msgs, threadId, mode) => {
        if (!Array.isArray(msgs) || mode !== 'reference') return msgs;
        return [
            {
                id: 'sys_' + threadId,
                role: 'system',
                index: -1,
                data: { content: 'Alternate branch context.' },
            },
            ...msgs,
        ];
    },
    { kind: 'filter', priority: 15 }
);
```

These replace all prior advanced branching / context hooks from the earlier design.

You can also attach analytics or telemetry here without touching the branching logic.

## Workspace backup hooks

Backup export/import flows emit dedicated actions so extensions can observe progress, log telemetry, or persist copies elsewhere. Payloads are plain objects—mutating them has no side effects.

-   `workspace.backup.peek:action:before (ctx)` — about to inspect a backup file. `ctx` contains `{ fileName: string | null }`.
-   `workspace.backup.peek:action:after (ctx)` — metadata validated successfully. `ctx` extends the base with `{ format: 'stream' | 'dexie', metadata: ImportMetadata, durationMs: number }`.
-   `workspace.backup.peek:action:error (ctx)` — metadata inspection failed. `ctx` extends the base with `{ error: AppError, durationMs: number }`.
-   `workspace.backup.export:action:before (ctx)` — user confirmed an export. `ctx` includes `{ format: 'stream', filenameBase: string, suggestedName: string }`.
-   `workspace.backup.export:action:after (ctx)` — export finished and the file writer closed. `ctx` adds `{ durationMs: number }`.
-   `workspace.backup.export:action:cancelled (ctx)` — export was cancelled (typically via the file picker). `ctx` adds `{ durationMs: number }`.
-   `workspace.backup.export:action:error (ctx)` — export hit an error. `ctx` adds `{ durationMs: number, error: AppError }`.
-   `workspace.backup.import:action:before (ctx)` — ready to import a backup. `ctx` has `{ fileName: string | null, mode: WorkspaceImportMode, overwrite: boolean, format: 'stream' | 'dexie' | 'unknown' }`.
-   `workspace.backup.import:action:after (ctx)` — import finished and Dexie tables were updated. `ctx` adds `{ durationMs: number }`.
-   `workspace.backup.import:action:error (ctx)` — import failed. `ctx` adds `{ durationMs: number, error: AppError }`.

All import paths still fire `workspace:reloaded` afterward to let panes refresh data; listen to either hook depending on the granularity you need.

### Examples

Redact fields from project reads:

```ts
useHookEffect(
    'db.projects.get:filter:output',
    (project) =>
        project ? (({ secret, ...rest }) => rest)(project as any) : project,
    { kind: 'filter' }
);
```

Stamp updated_at on all message upserts:

```ts
useHookEffect(
    'db.messages.upsert:filter:input',
    (value) => ({ ...value, updated_at: Math.floor(Date.now() / 1000) }),
    { kind: 'filter', priority: 5 }
);
```

Track thread forks and clones:

```ts
useHookEffect('db.threads.fork:action:before', ({ source, fork }) => {
    console.log('Forking thread', source.id, '→', fork.id);
});
useHookEffect('db.threads.fork:action:after', (fork) => {
    console.log('Fork created', fork.id);
});
```

Audit deletes (soft and hard):

```ts
useHookEffect('db.*.delete:action:soft:after', (entity) => {
    console.log('Soft-deleted', entity?.id ?? entity);
});
useHookEffect('db.*.delete:action:hard:after', (id) => {
    console.log('Hard-deleted id', id);
});
```

Normalize and observe message index compaction:

```ts
useHookEffect('db.messages.normalize:action:before', ({ threadId }) => {
    console.log('Normalizing indexes for thread', threadId);
});

// Enforce/inspect message file hash limits
useHookEffect(
    'db.messages.files.validate:filter:hashes',
    (hashes) => {
        // Example: log when truncated or enforce a stricter limit
        const MAX = 6;
        let next = hashes.slice(0, MAX);
        if (hashes.length > MAX)
            console.warn('Truncated file hashes', hashes.length, '→', MAX);
        // Return transformed list
        return next;
    },
    { kind: 'filter', priority: 10 }
);

// Observe file dedupe ref count changes
useHookEffect('db.files.refchange:action:after', ({ before, after, delta }) => {
    console.debug(
        'File ref change',
        before.hash,
        'delta',
        delta,
        'now',
        after.ref_count
    );
});

// Mutate file meta before create (e.g., tag images)
useHookEffect(
    'db.files.create:filter:input',
    (meta) => ({ ...meta, name: meta.name.trim() }),
    { kind: 'filter' }
);

// Normalize or inject default post title / meta prior to creation
useHookEffect(
    'db.posts.create:filter:input',
    (post) => ({
        ...post,
        title: (post.title || 'Untitled Post').trim(),
        // If meta provided as object, ensure a specific key exists
        meta:
            typeof post.meta === 'string'
                ? post.meta
                : JSON.stringify({ ...(post.meta || {}), source: 'hook' }),
    }),
    { kind: 'filter', priority: 8 }
);
```

Note: Query output filters run after the underlying Dexie query resolves, allowing you to reshape or sanitize results before they’re returned to callers.

## AI chat hooks

The `useChat` composable is instrumented so you can shape the chat flow without forking the code.

Hook names:

-   Outgoing user text
    -   `ui.chat.message:filter:outgoing` — sanitize/augment the user input
-   Model & input overrides
    -   `ai.chat.model:filter:select` — select/override model id (default `openai/gpt-4`)
    -   `ai.chat.messages:filter:input` — modify message array sent to the model
-   Send lifecycle
    -   `ai.chat.send:action:before` — before streaming starts
    -   `ai.chat.stream:action:delta` — for each streamed text delta
    -   `ui.chat.message:filter:incoming` — transform the final assistant text
    -   `ai.chat.send:action:after` — after full response is appended
-   Errors
    -   `ai.chat.error:action` — on exceptions during send/stream
    -   Retry
        -   `ai.chat.retry:action:before` — before a retry removes original messages (payload: `{ threadId, originalUserId, originalAssistantId?, triggeredBy: 'user'|'assistant' }`)
        -   `ai.chat.retry:action:after` — after new user + assistant messages are appended (payload: `{ threadId, originalUserId, originalAssistantId?, newUserId?, newAssistantId? }`)

Examples:

Override the model:

```ts
useHookEffect('ai.chat.model:filter:select', () => 'openai/gpt-4o-mini', {
    kind: 'filter',
});
```

Trim outgoing user text and collapse whitespace:

```ts
useHookEffect(
    'ui.chat.message:filter:outgoing',
    (text) => text.trim().replace(/\s+/g, ' '),
    { kind: 'filter' }
);
```

Inspect streaming deltas for live UI effects:

```ts
useHookEffect('ai.chat.stream:action:delta', (delta) => {
    // e.g., update a typing indicator or progress UI
    console.debug('delta:', delta);
});
```

Post-process the assistant response:

```ts
useHookEffect(
    'ui.chat.message:filter:incoming',
    (text) => text.replaceAll('\n\n', '\n'),
    { kind: 'filter' }
);
```

Capture errors for telemetry:

```ts
useHookEffect('ai.chat.error:action', (err) => {
    console.error('Chat error', err);
});

// Observe retry lifecycle
useHookEffect('ai.chat.retry:action:before', ({ threadId, triggeredBy }) => {
    console.debug('[retry before]', threadId, 'triggeredBy', triggeredBy);
});
useHookEffect('ai.chat.retry:action:after', (info) => {
    console.debug('[retry after]', info);
});
```

## Pane lifecycle hooks

Multi-pane chat/document UI emits actions so extensions can react to pane changes.

Hook names:

-   `ui.pane.open:action:after` — after a new pane is created and set active. Payload: `{ pane, index, previousIndex? }`
-   `ui.pane.close:action:before` — before a pane is removed (after any pending doc flush attempt). Payload: `{ pane, index, previousIndex? }`
-   `ui.pane.switch:action` — when the active pane index changes. Payload: `{ pane, index, previousIndex? }`

### New minimal pane extension hooks

Added for multi-pane extensibility (see planning/multipane-hooks-minimal/plan.md):

-   `ui.pane.active:action` — pane becomes active; Payload: `{ pane, index, previousIndex? }`
-   `ui.pane.blur:action` — previous active pane loses focus; Payload: `{ pane, previousIndex }`
-   `ui.pane.thread:filter:select` — mutate / veto thread selection; Called with `(requestedThreadId, pane, oldThreadId)` and should return `string | '' | false`
-   `ui.pane.thread:action:changed` — after thread + messages loaded; Payload: `{ pane, oldThreadId, newThreadId, paneIndex, messageCount? }`
-   `ui.pane.doc:filter:select` — mutate / veto doc selection; Called with `(requestedDocId, pane, oldDocId)` and should return `string | '' | false`
-   `ui.pane.doc:action:changed` — after document id bound; Payload: `{ pane, oldDocumentId, newDocumentId, paneIndex, meta? }`
-   `ui.pane.doc:action:saved` — after pending changes flushed; Payload: `{ pane, oldDocumentId, newDocumentId, paneIndex, meta? }`
-   `ui.pane.msg:action:sent` — user message appended (pane context); Payload: `{ pane, paneIndex, message: { id, threadId?, length?, fileHashes? }, meta? }`
-   `ui.pane.msg:action:received` — assistant message finalized; Payload: `{ pane, paneIndex, message: { id, threadId?, length?, fileHashes?, reasoningLength? }, meta? }`

Ordering note: on activation change sequence is `blur(previous) -> ui.pane.switch -> active(new)`.

### New minimal pane/message/document hooks

Added for per-pane extensibility (see planning doc). All are optional to subscribe.

| Hook                            | Kind   | Description                                  | Payload / Return                                                                                 |
| ------------------------------- | ------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------ | --- | ------ |
| `ui.pane.active:action`         | action | Pane became active (after switch)            | `{ pane, index, previousIndex? }`                                                                |
| `ui.pane.blur:action`           | action | Previously active pane lost focus            | `{ pane, previousIndex }`                                                                        |
| `ui.pane.thread:filter:select`  | filter | Transform / veto thread change               | `(requestedThreadId, pane, oldThreadId)` → `string                                               | ''  | false` |
| `ui.pane.thread:action:changed` | action | Thread association updated & messages loaded | `{ pane, oldThreadId, newThreadId, paneIndex, messageCount? }`                                   |
| `ui.pane.doc:filter:select`     | filter | Transform / veto doc change                  | `(requestedDocId, pane, oldDocId)` → `string                                                     | ''  | false` |
| `ui.pane.doc:action:changed`    | action | Document association updated                 | `{ pane, oldDocumentId, newDocumentId, paneIndex, meta? }`                                       |
| `ui.pane.doc:action:saved`      | action | Document changes flushed (pane context)      | `{ pane, oldDocumentId, newDocumentId, paneIndex, meta? }`                                       |
| `ui.pane.msg:action:sent`       | action | User message appended in pane's thread       | `{ pane, paneIndex, message: { id, threadId?, length?, fileHashes? }, meta? }`                   |
| `ui.pane.msg:action:received`   | action | Assistant message finalized                  | `{ pane, paneIndex, message: { id, threadId?, length?, fileHashes?, reasoningLength? }, meta? }` |

Ordering notes:

1. Switching panes emits `ui.pane.blur:action` (old) → existing `ui.pane.switch:action` (compat) → `ui.pane.active:action` (new).
2. Thread/doc filters run before state mutation; returning `false` aborts, returning `''` clears association.
3. `ui.pane.doc:action:saved` only fires when pending title/content existed before flush.

These complement existing global chat hooks (`ai.chat.*`, `ui.chat.*`) by adding pane context.

Notes:

-   `PaneState` shape: `{ id, mode: 'chat'|'doc', threadId, documentId?, messages[], validating }`.
-   `ui.pane.close:action:before` will not fire for the very last remaining pane (it refuses to close).
-   Use `useHookEffect` for safe subscription inside components.

Example: track pane usage metrics

```ts
useHookEffect('ui.pane.open:action:after', ({ pane, index, previousIndex }) => {
    console.debug('[pane open]', pane.id, 'at', index, 'prev', previousIndex);
});

useHookEffect('ui.pane.switch:action', ({ pane, index, previousIndex }) => {
    console.debug('[pane switch]', previousIndex, '→', index, pane.id);
});

useHookEffect('ui.pane.close:action:before', ({ pane, index }) => {
    console.debug('[pane close]', pane.id, 'from', index);
});
```

## Sidebar navigation hooks

User navigation in the sidebar (thread/doc selection & new chat creation) exposes hooks for plugins.

Hook names:

-   `ui.sidebar.select:action:before` — before emitting selection. Args: `{ kind: 'chat'|'doc', id: string }`.
-   `ui.sidebar.select:action:after` — after selection event is emitted.
-   `ui.chat.new:action:after` — after a new chat request (pane/thread creation handled by parent component logic).

Notes:

-   `:before` runs even if the same id is re-selected (idempotency left to handlers).
-   Handlers can show confirmations or track analytics. To cancel selection you can still emit a different selection from inside your handler (no native cancel today).

Example: analytics + confirmation

```ts
useHookEffect('ui.sidebar.select:action:before', (_ctx, info) => {
    console.debug('[select before]', info.kind, info.id);
});

useHookEffect('ui.sidebar.select:action:after', (_ctx, info) => {
    console.debug('[select after]', info.kind, info.id);
});

useHookEffect('ui.chat.new:action:after', () => {
    console.debug('[new chat created request]');
});
```

## App init hook

The framework now emits a one-time `app.init:action:after` on the client after the Nuxt app has fully mounted. Use this to run plugin initialization that depends on the DOM being ready (analytics boot, theming adjustments, late dynamic imports, etc.).

Hook name:

-   `app.init:action:after` — Args: `(nuxtApp)`

Example:

```ts
useHookEffect('app.init:action:after', (_ctx, nuxtApp) => {
    console.debug(
        '[app init]',
        nuxtApp.payload.serverRendered ? 'SSR+Hydrate' : 'Client only'
    );
});
```

Guarantees:

-   Fired exactly once per full page load (guarded against HMR duplicates).
-   Only on the client (not during SSR render phase).
-   Runs after `app:mounted`, so component tree is mounted.
