# useHooks

Nuxt composable that returns the app-wide typed hook engine, injected as `$hooks` by the `00-hooks` plugin.

---

## What does it do?

-   Prefers a client-side engine cache (`setHookEngine`), which the `00-hooks` client plugin installs so async utilities can resolve hooks outside Vue setup.
-   Falls back to `$hooks` from `useNuxtApp()` when the cache is empty (Vue setup, tests, SSR).
-   Caches the resolved engine on the client so later calls skip `useNuxtApp()`.
-   Throws if `$hooks` is missing.

`useHooks()` does **not** create a fallback engine. The hook engine must already be injected by the `00-hooks` plugin. For async / non-setup paths that must not throw, use `tryGetHooks()` instead — it returns `null` when the engine is not installed yet.

---

## API

```ts
function useHooks(): TypedHookEngine;
function tryGetHooks(): TypedHookEngine | null;
```

Example usage:

```ts
const hooks = useHooks();

hooks.doAction('ui.pane.active:action', {
    pane,
    index: 0,
});

const sanitized = await hooks.applyFilters(
    'ui.chat.message:filter:outgoing',
    draft
);
```

-   The returned object includes every typed method described in `typed-hooks.md`.
-   Consumers do not need to import `hook-types` directly; inference is automatic.

---

## Usage tips

-   Call `useHooks()` inside Vue `setup()` or other composables; it relies on Nuxt's app context.
-   Use `tryGetHooks()` from event handlers, storage queues, or error reporting where throwing is not safe.
-   Pair with `useHookEffect` when you want automatic lifecycle cleanup around `hooks.on`.
-   In tests, inject/mock `$hooks` on the Nuxt app before calling this composable.
