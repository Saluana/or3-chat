# Hook API and types

This reference covers the host application engine. `useHooks()` returns a `TypedHookEngine`; you normally do not create another engine. Installable packages use the [SDK](/documentation/plugins/plugin-sdk), whose permissions and runtime limits are separate.

## Resolve the engine

```ts
import { useHooks, tryGetHooks } from '~/core/hooks/useHooks';

const hooks = useHooks(); // installed engine; throws if unavailable
const available = tryGetHooks(); // cached client engine, or null
```

The client plugin installs a cache for utilities outside setup. `useHooks` prefers that cache, then falls back to Nuxt's injected `$hooks`. It never creates a fallback engine. `tryGetHooks` only checks the client cache: null can mean startup is incomplete, and it does not resolve SSR injection. SSR engines are request-scoped; do not share a client cache across server requests.

## Registration and dispatch

| Method | Purpose |
|---|---|
| `on(name, fn, { kind?, priority?, acceptedArgs? })` | Register and return a disposer |
| `off(disposer)` | Invoke a disposer with error reporting |
| `addAction / addFilter(name, fn, priority?, acceptedArgs?)` | Register directly; retain the original callback for removal. Fourth `acceptedArgs` argument is raw-engine only |
| `removeAction / removeFilter(name, fn, priority?)` | Remove matching registration |
| `onceAction(name, fn, priority?)` | Remove the action listener after its first invocation |
| `doAction(name, ...args)` | Sequential async action dispatch; returns `Promise<void>` |
| `applyFilters(name, value, ...args)` | Sequential async transforms; returns the final value |
| `doActionSync / applyFiltersSync` | Synchronous dispatch; callbacks must be synchronous |
| `hasAction / hasFilter(name?, fn?)` | Inspect registrations |
| `currentPriority()` | Current callback priority, or false |
| `removeAllCallbacks(priority?)` | Broad teardown; avoid removing other extensions' listeners |

The typed wrapper infers filter kind when the name contains `:filter:`. The **raw** engine's `on` defaults to action; pass `{ kind: 'filter' }` for raw filter registration. This distinction also applies to `typedOn(rawEngine)`.

Priorities default to 10, lower numbers run first, and ties preserve registration order. Runtime wildcard subscriptions such as `hooks.addAction('ui.pane.*', handler)` observe a family, but the callback must accommodate that family's different payloads. Remove with the same pattern, callback, and priority.

## Execution and errors

Async dispatch awaits each callback before running the next. Action return values are ignored; filter return values replace the current value. Await the dispatcher when completion matters. Deliberately detached dispatch with `void` does not provide completion ordering.

In the default engine, a thrown callback error is logged and counted, then subsequent listeners continue. A failing filter leaves the previous value intact. An ordinary return of `undefined` is different: it propagates as the next value. Do not rely on this engine for fail-closed authorization.

Sync dispatch does not await promises. Async action failures are reported later; async filter results are ignored and the previous value is retained with diagnostics. Use synchronous callbacks for synchronous emitters.

## Lifecycle

```ts
// Component setup: removed on unmount and HMR disposal.
useHookEffect('ui.pane.msg:action:sent', ({ message }) => {
    console.info(message.id);
});
```

`useHookEffect` must run during component setup and does not deduplicate registrations. A source Nuxt plugin keeps the disposer from `hooks.on` and registers it with `import.meta.hot.dispose`. An SDK extension uses its registration handle's `dispose` method and `context.onCleanup`.

## Types and custom names

The payload map in `app/core/hooks/hook-types.ts` supplies tuples of callback arguments. Known names infer payloads and return types; the open string fallback also allows custom names, so successful type checking alone does not detect a misspelled hook.

| Type | Meaning |
|---|---|
| `HookName`, `ActionHookName`, `FilterHookName` | Known, DB, augmented, and open string names |
| `InferHookParams<K>` | Callback argument tuple |
| `InferHookReturn<K>` | Action void or filter value type |
| `InferHookCallback<K>` | Complete callback signature |
| `ExtractHookPayload<K>` | First argument |
| `IsAction<K> / IsFilter<K>` | Name classification at the type level |
| `MatchingHooks<Pattern>` | TypeScript `Extract` using a template literal pattern |
| `InferDbEntity<K>` | Entity inferred from a DB hook name |

`MatchingHooks` does not parse glob strings. Write ``MatchingHooks<`db.files.${string}`>``, not `MatchingHooks<'db.files.*'>`. Runtime wildcard registration is a different feature.

For a source extension, add a declaration file included by TypeScript:

```ts
export {};
declare global {
    interface Or3ActionHooks {
        'example.ready:action': [payload: { id: string }];
    }
    interface Or3FilterHooks {
        'example.label:filter:format': [label: string];
    }
}
```

Register and emit these names yourself; declaration merging does not cause core to emit them. Filter return inference uses the first tuple member. Keep the map and actual emitter contract aligned.

### typedOn helper

```ts
import { typedOn } from '~/core/hooks/hook-keys';

const { on } = typedOn(useHooks()._engine);
const off = on('ui.pane.msg:action:sent', ({ message }) => {
    console.info(message.id);
});
const offFilter = on('ui.chat.message:filter:outgoing', (text) => text.trimEnd(), {
    kind: 'filter',
});
```

`typedOn` returns an **object with an on method**, restricts names to its curated known-key subset, and forwards to the raw engine. Prefer `useHooks().on` for normal use and return-type checking.

### Outgoing chat cancellation boundary

The outgoing chat type map currently infers a string return, although `ChatOutgoingFilterReturn` also declares `false` and the chat caller recognizes false at runtime. Those types are not interchangeable. Use a string transformer in typed examples. The caller also suppresses empty plain-text sends, but attached/generated content can change that decision; this is not a general cancellation API.

## Construct an engine and inspect diagnostics

For a standalone source utility or isolated verification:

```ts
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';

const hooks = createTypedHookEngine(createHookEngine());
const off = hooks.on('ui.chat.message:filter:outgoing', text => text.trimEnd());
const result = await hooks.applyFilters('ui.chat.message:filter:outgoing', 'Hello   ');
off();
```

`_engine` exposes the underlying raw engine. `_diagnostics.timings` retains the latest 128 callback timing samples per hook, and timing/error maps are bounded to 2,048 distinct names. Inspect errors and slow callbacks during development. In browsers without async context isolation, `currentPriority()` returns false after an await.

The optional alternate hook engine is selected at process start by `OR3_HOOK_ENGINE_V2_ENABLED`; the public compatibility API stays the same. Advanced engine policies are implementation details, not a separate plugin development path.

See the [catalog](/documentation/hooks/hook-catalog) for payloads and the [overview](/documentation/hooks/overview) for engine boundaries.
