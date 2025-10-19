# useHookEffect

Typed helper for subscribing to the internal hook bus. It registers a callback, cleans up automatically on component unmount and during hot-module reload, and returns a disposer if you need manual control.

---

## What does it do?

`useHookEffect` wraps the hook engine (`useHooks()`) with lifecycle-aware registration. Whenever a component mounts, it attaches your callback to a named hook and guarantees cleanup so you never leak listeners.

-   Supports every hook name with full TypeScript inference
-   Lets you override hook kind (`action` / `filter`) and priority
-   Auto-detaches on `onBeforeUnmount`
-   Handles Vite/Nuxt HMR disposal for local development

---

## Basic Example

```ts
import { useHookEffect } from '~/composables/core/useHookEffect';

useHookEffect('ui.chat.message:filter:outgoing', async (message) => {
    if (message.content.includes('restricted')) {
        return false; // veto send
    }
    return message;
});
```

---

## How to use it

### 1. Import and register

Call `useHookEffect(name, callback)` in `setup()`. The callback signature is inferred from the hook name, so TypeScript will keep you honest.

### 2. Optionally tweak behavior

Pass an `opts` object to set a specific hook kind or priority:

```ts
useHookEffect('ui.pane.switch:action', handler, {
    kind: 'action',
    priority: 50,
});
```

### 3. Manually dispose if needed

The function returns a disposer. You rarely need it, but it can be helpful when toggling listeners in response to reactive state.

```ts
const dispose = useHookEffect('ai.chat.send:action:after', onComplete);

watch(enabled, (next) => {
    if (!next) dispose();
});
```

---

## API

```ts
function useHookEffect<K extends HookName>(
    name: K,
    fn: InferHookCallback<K>,
    opts?: {
        kind?: HookKind;
        priority?: number;
    }
): () => void;
```

| Parameter       | Type                               | Description                                                                 |
| --------------- | ---------------------------------- | --------------------------------------------------------------------------- |
| `name`          | `HookName`                         | The hook identifier (strongly typed to known strings).                      |
| `fn`            | `InferHookCallback<K>`             | Listener invoked when the hook fires.                                       |
| `opts.kind`     | `'action' \| 'filter' \| HookKind` | Override the resolved kind when the name is ambiguous.                      |
| `opts.priority` | `number`                           | Smaller numbers run first; defaults to the hook engine’s standard priority. |

Returns the disposer you can call to unregister immediately.

---

## Under the hood

1. Fetches the shared hook engine with `useHooks()`.
2. Registers the callback with `hooks.on`, capturing the disposer.
3. Subscribes to `onBeforeUnmount` to `hooks.off(disposer)`.
4. During HMR, listens for `import.meta.hot.dispose` and calls the disposer.

Because of that lifecycle tie-in, you can safely register listeners in any component without worrying about stale callbacks.

---

## Edge cases & tips

-   **SSR**: Safe to import; hooks execute client-side where the engine lives.
-   **Multiple registrations**: Each call returns its own disposer—store them if you plan to toggle listeners dynamically.
-   **Kind inference**: If a hook name ends with `:filter:*`, the kind defaults to `filter`; same for `:action:*`. Override `opts.kind` only when absolutely necessary.
-   **Priorities**: Use lower numbers to ensure your filter runs before default ones (e.g., set to `25` to beat default `50`).

---

## Related

-   `useHooks()` — exposes the raw hook API if you need advanced control.
-   `docs/core-hook-map.md` — catalog of built-in hook names.
-   `useChat` / `useMultiPane` — major composables that emit the hooks you’ll most often tap into.
