## Hooks: zero-bloat autocomplete and plugin augmentation

Our hook engine stays runtime-light. Autocomplete is driven by TypeScript types so suggested hook names always exist.

What's new:

-   The Nuxt plugin now provides the typed wrapper by default, so `const { $hooks } = useNuxtApp()` or `useHooks()` both yield strong types.
-   Hook name unions are derived from the payload map keys. No phantom suggestions.
-   Plugins can extend autocomplete via a tiny .d.ts augmentation without touching core.

### Use in app code

```ts
const hooks = useHooks();
hooks.addAction('ai.chat.send:action:before', (ctx) => {
    // ctx is fully typed
});

const text = await hooks.applyFilters('ui.chat.message:filter:outgoing', input);
```

### Plugin: add your own hook names (types only)

Create a file in your plugin package (or app) like `types/hooks-augmentation.d.ts`:

```ts
// types/hooks-augmentation.d.ts
declare global {
    interface Or3ActionHooks {
        'my.plugin.ready:action:after': [{ plugin: string; version: string }];
    }
    interface Or3FilterHooks {
        'my.plugin.value:filter:transform': [
            // value in + optional extra args
            string,
            { locale?: string }
        ];
    }
}
export {};
```

Now in your plugin code:

```ts
export default defineNuxtPlugin(() => {
    const { $hooks } = useNuxtApp();

    $hooks.addAction('my.plugin.ready:action:after', (payload) => {
        // payload.plugin, payload.version typed
    });

    $hooks.addFilter('my.plugin.value:filter:transform', (value, opts) => {
        return value.toUpperCase();
    });
});
```

No runtime changes are required—this is purely types. If your plugin ships its own types, ensure the .d.ts is included in its `types` or published in the package root so consumers get autocomplete automatically.

### Notes

-   Keep to the naming convention: `:action` for fire-and-forget; `:filter:<name>` for value transforms.
-   DB hooks are already covered via template literal types and stay typed.
-   Avoid hard-coded colors or styling here; this is types only.
