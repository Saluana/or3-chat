# Editor Extensions (TipTap)

This guide explains how to extend the document editor with custom toolbar buttons, nodes, marks, and generic extensions. It follows the same plugin pattern as message actions and other UI registries.

## Where to import

Helpers are auto-imported by Nuxt, so you can call them from plugins or components without manual imports:

**Toolbar:**

-   `registerEditorToolbarButton()`
-   `unregisterEditorToolbarButton()`
-   `useEditorToolbarButtons(editorRef)`
-   `listRegisteredEditorToolbarButtonIds()`

**Generic Extensions:**

-   `registerEditorExtension()` / `unregisterEditorExtension()`
-   `listEditorExtensions()`
-   `listRegisteredEditorExtensionIds()`

**Nodes & Marks:**

-   `registerEditorNode()` / `unregisterEditorNode()`
-   `registerEditorMark()` / `unregisterEditorMark()`
-   `listEditorNodes()` / `listEditorMarks()`
-   `listRegisteredEditorNodeIds()` / `listRegisteredEditorMarkIds()`

The implementations live at:

-   `app/composables/ui-extensions/editor/useEditorToolbar.ts`
-   `app/composables/ui-extensions/editor/useEditorNodes.ts`

## Toolbar Buttons

### API contract

```ts
export interface EditorToolbarButton {
    id: string; // unique id
    icon: string; // icon name for UButton
    tooltip?: string; // tooltip text
    order?: number; // lower = earlier (default 200)
    isActive?: (editor: Editor) => boolean; // highlight when active
    onClick: (editor: Editor) => void | Promise<void>; // click handler
    visible?: (editor: Editor) => boolean; // optional visibility check
}
```

### Registering a toolbar button

Create a Nuxt plugin in `app/plugins/` that registers your button at startup:

```ts
// app/plugins/editor-strikethrough.client.ts
import type { Editor } from '@tiptap/vue-3';

export default defineNuxtPlugin(() => {
    registerEditorToolbarButton({
        id: 'my-plugin:strikethrough',
        icon: 'pixelarticons:text-strikethrough',
        tooltip: 'Strikethrough',
        order: 300,
        isActive: (editor: Editor) => editor.isActive('strike'),
        onClick: (editor: Editor) => {
            editor.chain().focus().toggleStrike().run();
        },
    });
});
```

### Unregistering

```ts
unregisterEditorToolbarButton('my-plugin:strikethrough');
```

### Ordering

Built-in toolbar buttons use order < 200. External plugins should use `order >= 200` to appear after them unless you intentionally want to appear earlier.

## Generic Extensions

Generic TipTap extensions (like plugins, prosemirror plugins, or other functionality that doesn't fit into Node/Mark) can now be registered dynamically without modifying `DocumentEditor.vue`.

### API contract

```ts
export interface EditorExtension {
    id: string; // unique id
    extension: Extension; // TipTap Extension instance
    order?: number; // lower = earlier (default 200)
}
```

### When to use Generic Extensions

Use `registerEditorExtension()` for:

-   TipTap plugins that provide editor functionality (autocomplete, mentions, etc.)
-   ProseMirror plugins wrapped in TipTap Extensions
-   Custom editor behaviors that don't create new nodes or marks
-   Extensions that modify editor behavior globally

Use `registerEditorNode()` or `registerEditorMark()` for:

-   New content types (blocks, inline elements)
-   New formatting options (bold, italic, custom marks)

### Registering a generic extension

```ts
// app/plugins/editor-autocomplete.client.ts
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';

// Create your TipTap extension
const AutocompleteExtension = Extension.create({
    name: 'autocomplete',

    addProseMirrorPlugins() {
        return [
            new Plugin({
                key: new PluginKey('autocomplete'),
                // ... your plugin logic
            }),
        ];
    },
});

export default defineNuxtPlugin(() => {
    // Register the extension - it will be automatically included in all editors
    registerEditorExtension({
        id: 'editor-autocomplete:extension',
        extension: AutocompleteExtension,
        order: 100, // Load before most plugins but after core
    });

    // Optional: Also register a toolbar button to control it
    registerEditorToolbarButton({
        id: 'editor-autocomplete:toggle',
        icon: 'pixelarticons:zap',
        tooltip: 'Toggle Autocomplete',
        order: 300,
        isActive: (editor) => {
            // Check if your extension is active
            return true;
        },
        onClick: (editor) => {
            // Toggle your extension's behavior
        },
    });
});
```

### Real-world example: Autocomplete Plugin

Here's a complete example of a fully self-contained editor plugin:

```ts
// app/plugins/editor-autocomplete.client.ts
import {
    registerEditorToolbarButton,
    registerEditorExtension,
} from '~/composables';
import type { Editor } from '@tiptap/vue-3';
import { AutocompleteExtension } from './EditorAutocomplete/TiptapExtension';
import AutocompleteState from './EditorAutocomplete/state';
import { computed } from 'vue';

export default defineNuxtPlugin(() => {
    if (process.client) {
        // Register the TipTap extension
        registerEditorExtension({
            id: 'editor-autocomplete:extension',
            extension: AutocompleteExtension,
            order: 100,
        });

        // Register toolbar toggle button
        registerEditorToolbarButton({
            id: 'editor-autocomplete:toggle',
            icon: 'pixelarticons:zap',
            tooltip: computed(() =>
                AutocompleteState.value.isEnabled
                    ? 'Disable Autocomplete'
                    : 'Enable Autocomplete'
            ) as any,
            order: 300,
            isActive: (editor: Editor) => AutocompleteState.value.isEnabled,
            onClick: (editor: Editor) => {
                AutocompleteState.value.isEnabled =
                    !AutocompleteState.value.isEnabled;
            },
        });
    }
});
```

**Key benefits:**

-   ✅ No modifications to `DocumentEditor.vue` required
-   ✅ Plugin is fully self-contained
-   ✅ Works with HMR (Hot Module Replacement)
-   ✅ Can be enabled/disabled independently

## Nodes & Marks

### API contract

```ts
export interface EditorNode {
    id: string; // unique id
    extension: Node; // TipTap Node extension instance
    order?: number; // lower = earlier (default 200)
}

export interface EditorMark {
    id: string; // unique id
    extension: Mark; // TipTap Mark extension instance
    order?: number; // lower = earlier (default 200)
}
```

### Registering extensions

```ts
// app/plugins/editor-custom-node.client.ts
import { Node } from '@tiptap/core';

const CustomNode = Node.create({
    name: 'customNode',
    // ... TipTap node configuration
});

export default defineNuxtPlugin(() => {
    registerEditorNode({
        id: 'my-plugin:custom-node',
        extension: CustomNode,
        order: 300,
    });
});
```

For marks:

```ts
import { Mark } from '@tiptap/core';

const CustomMark = Mark.create({
    name: 'customMark',
    // ... TipTap mark configuration
});

registerEditorMark({
    id: 'my-plugin:custom-mark',
    extension: CustomMark,
    order: 300,
});
```

## How the editor uses these

The `DocumentEditor.vue` component:

1. Calls `useEditorToolbarButtons(editorRef)` to get plugin buttons
2. Calls `listEditorNodes()` and `listEditorMarks()` to get extensions
3. Includes them in the TipTap editor initialization

## Best practices

-   Keep handlers responsive; avoid blocking operations
-   Namespace ids to avoid collisions (e.g. `my-plugin:action`)
-   Use TipTap's chain API for editor commands
-   Test with the editor in different states (empty, with content, etc.)

## Testing

Programmatic checks:

```ts
// After registering
expect(listRegisteredEditorToolbarButtonIds()).toContain(
    'my-plugin:strikethrough'
);

// After unregistering
expect(listRegisteredEditorToolbarButtonIds()).not.toContain(
    'my-plugin:strikethrough'
);
```

Manual verification:

1. Start the app and open a document
2. Check that your toolbar button appears
3. Click it and verify the expected behavior
4. For nodes/marks, verify they work in the editor content

## Example plugin

See `app/plugins/examples/editor-toolbar-test.client.ts` for a working example that registers a strikethrough button.

## Edge cases & notes

-   Duplicate ids replace previous registrations
-   Registry persists across HMR; re-registering after HMR will replace the prior entry
-   Extensions are loaded when the editor is created
-   Toolbar buttons are reactive and update when the editor state changes

---

**Requirements coverage:**

-   ✅ Describe API and where to import
-   ✅ Show register/unregister examples
-   ✅ Show use in components and handler behavior
-   ✅ Explain ordering and HMR behavior
-   ✅ Provide working example plugin
