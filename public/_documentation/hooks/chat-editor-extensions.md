# Register chat editor extensions (ChatInputDropper)

Enable plugins to add TipTap extensions to the chat composer without touching the component. `ChatInputDropper.vue` exposes two hook points so plugins can lazy‑load heavy code and inject their extensions at initialization time.

## TL;DR

-   Fire your lazy imports when the editor is about to initialize: `editor:request-extensions` (action)
-   Append your TipTap extensions using: `ui.chat.editor:filter:extensions` (filter)
-   Return the full array from the filter; the component will pass it to TipTap

The component: `app/components/chat/ChatInputDropper.vue`

```ts
// Inside ChatInputDropper.vue (simplified)
await hooks.doAction('editor:request-extensions');
const extensions = await hooks.applyFilters(
    'ui.chat.editor:filter:extensions',
    baseExtensions
);
new Editor({ extensions });
```

## Contract

-   Action: `editor:request-extensions`

    -   When: right before the editor is created
    -   Use it to: kick off dynamic imports, initialize registries/state, prefetch assets
    -   Return value: ignored (fire‑and‑forget)

-   Filter: `ui.chat.editor:filter:extensions`
    -   Input: `Extension[]` (the current list)
    -   Output: `Extension[]` (your modified list)
    -   Use it to: push/unshift your TipTap extension(s), or adjust ordering
    -   Notes: ordering matters in TipTap; append for default order or unshift to run earlier

See the Hook Engine docs for priorities if you need to ensure your filter runs before/after others.

## Minimal plugin example

Create a client‑only plugin file, e.g. `app/plugins/my-editor-extension.client.ts`:

```ts
import { defineNuxtPlugin } from '#app';
import { useHooks } from '#imports';

export default defineNuxtPlugin(() => {
    if (!process.client) return; // SSR-safe

    const hooks = useHooks();

    // 1) Preload heavy code when the editor asks for extensions
    hooks.on('editor:request-extensions', async () => {
        // Optional: warm up dynamic imports so the first keypress feels fast
        await import('@tiptap/extension-placeholder').catch(() => null);
    });

    // 2) Provide your TipTap extension(s) via filter
    hooks.on('ui.chat.editor:filter:extensions', async (extensions) => {
        try {
            const { default: Placeholder } = await import(
                '@tiptap/extension-placeholder'
            );
            extensions.push(
                Placeholder.configure({
                    placeholder: 'Write something …',
                })
            );
        } catch (e) {
            console.error('[my-editor-extension] failed to add Placeholder', e);
        }
        return extensions; // important: always return the array
    });
});
```

That’s it—no edits to `ChatInputDropper.vue` are required. When the chat composer mounts, it triggers the action, gathers extensions from every registered filter, and builds the TipTap editor with the combined list.

## Tips

-   Guard with `process.client` to avoid SSR import errors.
-   Prefer dynamic imports for heavy extensions to keep initial bundle small.
-   If your extension opens popovers or overlays, make sure it doesn’t steal focus from the editor.
-   Handle failures gracefully—log and keep returning the input array so other plugins aren’t affected.

## Related

-   `ChatInputDropper.vue` (loads TipTap and applies the hooks)
-   Hooks: `hooks/hooks`, `hooks/hook-catalog`, `hooks/typed-hooks`
-   Editor registries: `composables/useEditorNodes`, `composables/useEditorExtensionLoader`
