# useHooks

Nuxt composable that returns the app-wide typed hook engine injected as `$hooks`.

---

## What does it do?

-   Reads `$hooks` from `useNuxtApp()`.
-   Returns the injected typed hook engine directly.
-   Throws if `$hooks` is missing.

`useHooks()` does **not** create a fallback engine and does **not** cache/rebuild wrappers. The hook engine must already be injected by the hooks plugin.

---

## API

```ts
function useHooks(): TypedHookEngine;
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

-   Call `useHooks()` inside Vue `setup()` or other composables; it relies on Nuxt’s app context.
-   Pair with `useHookEffect` when you want automatic lifecycle cleanup around `hooks.on`.
-   In tests, inject/mock `$hooks` on the Nuxt app before calling this composable.
