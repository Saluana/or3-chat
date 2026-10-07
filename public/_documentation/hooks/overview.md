# Hooks overview

Hooks let features cooperate without importing each other's implementation. An **action** announces an event; a **filter** transforms a value before the caller uses it. Start with [your first hook](/documentation/hooks/first-hook), then use the [catalog](/documentation/hooks/hook-catalog) to choose a hook that the application actually emits.

## Choose the right integration

These pages describe the application hook engine for contributors and trusted source extensions. Source examples use Nuxt auto-imports and application-private modules.

Installable plugins use [the Plugin SDK](/documentation/plugins/plugin-sdk). Its hook registration requires the `hooks.register` permission and is available to trusted-host packages; portable plugins cannot subscribe to arbitrary application hooks. Register through `context.hooks.onAction` / `onFilter`, and dispose the returned registration handle through `context.onCleanup`. Do not copy private `~/core` imports into a portable package.

The trusted host approves specific chat, workflow, and [workspace Files hooks](/documentation/plugins/plugin-sdk#saved-files). File subscriptions also require a catalog read or write grant; other database/storage hooks remain source-extension surfaces.

## Actions and filters

| | Action | Filter |
|---|---|---|
| Purpose | Perform a side effect | Return a replacement value |
| Register | `hooks.on('…:action:…', callback)` | `hooks.on('…:filter:…', callback)` |
| Dispatch | `await hooks.doAction(name, ...args)` | `await hooks.applyFilters(name, value, ...args)` |
| Callback result | Ignored | Passed to the next filter |

Async dispatch awaits callbacks sequentially. An action's ignored return value does **not** make it fire-and-forget: the emitter decides whether to await completion. Lower priorities run first (default 10), and equal priorities run in registration order.

Always return a value from a filter, including when leaving it unchanged. Returning `undefined` passes `undefined` onward. Cancellation is a contract of the specific caller, not a universal hook behavior; only use `false` when that hook explicitly accepts it.

Synchronous dispatch cannot wait for async callbacks. Keep callbacks synchronous when the catalog identifies a synchronous emitter. See [execution and errors](/documentation/hooks/reference#execution-and-errors) for the exact behavior.

## Lifetime and engine boundaries

Use `useHooks()` after the app's hook plugin has installed the engine. In component setup, `useHookEffect` cleans up on unmount. In a Nuxt source plugin, retain each disposer and remove it on HMR disposal. Re-registering without cleanup produces duplicate listeners.

Browser hooks, request-scoped SSR hooks, the server admin engine, and Nitro webhook events are different surfaces. A browser listener does not observe all server events. Cloud authorization also has its own server constraints; an application filter is not a replacement for `can()`.

The catalog distinguishes emitted hooks from **typed-only** names. A name appearing in TypeScript does not guarantee a runtime event.

## Next steps

- [Build your first hook](/documentation/hooks/first-hook): register a filter, test its result, and clean it up.
- [Extend the chat editor](/documentation/hooks/chat-editor-extensions): lazy-load a TipTap extension before initialization.
- [API and types](/documentation/hooks/reference): registration, dispatch, lifecycle, custom types, and diagnostics.
- [Hook catalog](/documentation/hooks/hook-catalog): names, payloads, return values, and emitter boundaries.
