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

Entities covered: attachments, kv, projects, threads, messages.
Now also: file storage (files: meta + blobs) and message file hash validation.

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
-   Advanced operations
    -   messages: `db.messages.append|move|copy|insertAfter|normalize:action:before|after`
    -   threads: `db.threads.fork:action:before|after`
    -   files: `db.files.create:filter:input`, `db.files.create:action:before|after`, `db.files.refchange:action:after`, `db.files.delete:action:soft:before|after`
    -   message file hashes: `db.messages.files.validate:filter:hashes` (array<string> → array<string>) for enforcing limits, dedupe, ordering, warnings

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
