# useHooks

Nuxt composable that returns the app-wide typed hook engine, creating a fallback instance when none is provided.

---

## What does it do?

-   Reads the injected `$hooks` instance from `useNuxtApp()`.
-   Wraps it with `createTypedHookEngine` to provide full TypeScript inference.
-   Caches the typed engine per provider to avoid rebuilding wrappers.
-   Creates a dev-only fallback hook engine when `$hooks` is missing (e.g., during unit tests).

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

## Fallback behavior

-   When `$hooks` is absent (tests, SSR stubs), the composable instantiates a local engine and logs a warning in dev mode.
-   The fallback stays cached across calls so listeners persist for the session.

---

## Caching strategy

-   Stores `{ engine, typed }` in a module-level `cached` object keyed by the current `$hooks` reference.
-   When the provider changes (e.g., HMR re-injection), the typed wrapper is rebuilt to keep methods in sync.

---

## Usage tips

-   Call `useHooks()` inside Vue `setup()` or other composables; it relies on Nuxt’s app context.
-   Pair with `useHookEffect` when you want automatic lifecycle cleanup around `hooks.on`.
-   In tests, stub `$hooks` on the Nuxt app to assert listener registration without touching the fallback.
