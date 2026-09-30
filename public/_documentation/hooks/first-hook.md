# Build your first hook

This tutorial adds a source extension that removes trailing spaces from outgoing chat text. It runs in an editable OR3 checkout, using the application engine. For installable packages, start with [Build your first plugin](/documentation/plugins/first-plugin) and check SDK runtime support before adding hook registration.

## Register a filter

Create `app/plugins/trim-chat.client.ts`:

```ts
import { defineNuxtPlugin } from '#app';
import { useHooks } from '#imports';

export default defineNuxtPlugin(() => {
    const hooks = useHooks();
    const off = hooks.on(
        'ui.chat.message:filter:outgoing',
        (text) => text.trimEnd(),
        { priority: 20 },
    );

    if (import.meta.hot) import.meta.hot.dispose(off);
});
```

The `.client.ts` suffix keeps this extension in the browser. `useHooks()` returns the installed typed engine, so TypeScript knows that `text` and the return value are strings. The name includes `:filter:`, allowing this wrapper to infer the kind. Priority 20 runs after default-priority listeners.

Return a new value instead of modifying unrelated state inside a filter. The disposer removes exactly this registration; use it when your extension shuts down. A component should instead call `useHookEffect` during setup, which also removes its subscription on unmount.

## Verify the result

Run `bun run dev`, open a chat, and send `Hello   `. The persisted outgoing message should end with `Hello`, without trailing spaces. Send another message and confirm it is still sent normally.

For an isolated check of the same engine contract, temporarily add this inside the plugin after registration:

```ts
const result = await hooks.applyFilters(
    'ui.chat.message:filter:outgoing',
    'Hello   ',
);
console.assert(result === 'Hello', 'Trailing spaces should be removed');
```

Make the plugin callback `async` for this awaited check, then remove the check after verification. Editing the plugin should replace the old registration through HMR; it should not accumulate callbacks. Do not dispatch unrelated application actions just to test a listener, because their other listeners may perform real work.

## Observe an action

To observe a sent message in the same plugin, add:

```ts
const offSent = hooks.on('ui.pane.msg:action:sent', ({ message }) => {
    console.info('Sent message:', message.id);
});
if (import.meta.hot) import.meta.hot.dispose(offSent);
```

Actions do not transform their payload or cancel the operation. Awaited action callbacks can delay the caller, so keep observation lightweight. For payloads and emission timing, consult the [catalog](/documentation/hooks/hook-catalog).
