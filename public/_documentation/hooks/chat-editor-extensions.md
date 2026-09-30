# Extend the chat editor

Source extensions can add TipTap functionality to `ChatInputDropper.vue` before each chat composer is initialized. This guide uses application hooks in an editable checkout; these private imports are not a portable plugin API.

## Initialization contract

The composer awaits `editor:request-extensions`, then awaits `ui.chat.editor:filter:extensions` with its base extension array. The action may lazy-load code; its return value is ignored but async completion is awaited. The filter must return the full extension array.

The composer already includes Placeholder. Adding another Placeholder extension is not a way to configure the existing one and can create duplicate-name conflicts. Give your extension a distinct name. The base composer also disables the Link mark so pasted URLs stay editable text; if you add links, prevent editor clicks from navigating away.

## Add a keyboard shortcut

Create `app/editor/ExampleComposerShortcut.ts`:

```ts
import { Extension } from '@tiptap/core';

export default Extension.create({
    name: 'exampleComposerShortcut',
    addKeyboardShortcuts() {
        return {
            'Mod-Shift-l': () => this.editor.commands.insertContent('Hello'),
        };
    },
});
```

Create `app/plugins/example-editor.client.ts`:

```ts
import { defineNuxtPlugin } from '#app';
import { useHooks } from '#imports';

export default defineNuxtPlugin(() => {
    const hooks = useHooks();
    let extension: typeof import('../editor/ExampleComposerShortcut').default | undefined;

    const offLoad = hooks.on('editor:request-extensions', async () => {
        extension ??= (await import('../editor/ExampleComposerShortcut')).default;
    });
    const offExtensions = hooks.on('ui.chat.editor:filter:extensions', (extensions) => {
        const loaded = extension;
        if (!loaded || extensions.some(item => item.name === loaded.name)) {
            return extensions;
        }
        return [...extensions, loaded];
    });

    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            offLoad();
            offExtensions();
        });
    }
});
```

The first hook finishes the import before the second adds the extension. If loading fails, the default engine logs the action error; the filter leaves the base array intact. Returning a new array avoids mutating shared configuration, and the name check prevents duplicate insertion.

## Verify and iterate

Run `bun run dev`, open a chat, focus the composer, and press Cmd+Shift+L on macOS or Ctrl+Shift+L elsewhere. It should insert `Hello` once. Check a second pane too, then confirm ordinary typing, attachments, and sending still work.

Extension lists apply when an editor is created. Recreate the composer or reload after changing the extension; an existing editor is not reconfigured by registering another filter. HMR disposal removes listeners, and each editor owns its own TipTap instance.

See the [API reference](/documentation/hooks/reference) for priorities and cleanup, and the [catalog](/documentation/hooks/hook-catalog) for other composer hooks.
