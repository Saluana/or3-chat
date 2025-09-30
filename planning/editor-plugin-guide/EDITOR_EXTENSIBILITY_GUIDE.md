# OR3 Editor Plugin Developer Guide

## Overview

The OR3 document editor (based on TipTap/ProseMirror) provides a comprehensive plugin system that allows developers to extend the editor without modifying core files. This guide explains how to add custom extensions, toolbar buttons, nodes, and marks through the OR3 plugin architecture.

## Core Concepts

### 1. Plugin Architecture

OR3 uses Nuxt plugins to register editor extensions. All editor extension APIs are:
- **HMR-safe**: Registries survive hot module reloads during development
- **Reactive**: Changes to registries automatically update the UI
- **Ordered**: Use `order` property to control placement (default: 200, built-ins use <200)
- **Global**: Registries are stored on `globalThis` to persist across reloads

### 2. Available Extension Points

| Extension Type | Purpose | API Functions |
|---------------|---------|---------------|
| **Toolbar Buttons** | Add custom formatting buttons | `registerEditorToolbarButton()` |
| **Nodes** | Add block-level elements (e.g., callouts, embeds) | `registerEditorNode()` |
| **Marks** | Add inline formatting (e.g., highlight, underline) | `registerEditorMark()` |

### 3. How DocumentEditor.vue Integrates Plugins

The `DocumentEditor.vue` component automatically loads all registered extensions:

```typescript
function makeEditor() {
    // Collect plugin-registered extensions
    const pluginNodes = listEditorNodes().map((n) => n.extension);
    const pluginMarks = listEditorMarks().map((m) => m.extension);

    editor.value = new Editor({
        extensions: [
            StarterKit.configure({ heading: { levels: [1, 2] } }),
            Placeholder.configure({
                placeholder: 'Type your text here...',
            }),
            ...pluginNodes,
            ...pluginMarks,
        ],
        content: state.value.record?.content || { type: 'doc', content: [] },
        autofocus: false,
        onUpdate: () => emitContent(),
    });
}
```

## Implementation Guide

### Creating an Editor Plugin

**Step 1: Create a Nuxt Plugin File**

Create a file in `app/plugins/` or `app/plugins/examples/` with the `.client.ts` suffix:

```
app/plugins/my-editor-plugin.client.ts
```

**Step 2: Basic Plugin Structure**

```typescript
export default defineNuxtPlugin(() => {
    // Your registration code here
});
```

## Adding Toolbar Buttons

### API Contract

```typescript
interface EditorToolbarButton {
    id: string;                                      // Unique identifier
    icon: string;                                    // Icon name (for UButton)
    tooltip?: string;                                // Hover tooltip
    order?: number;                                  // Display order (default: 200)
    isActive?: (editor: Editor) => boolean;          // Highlight state
    onClick: (editor: Editor) => void | Promise<void>; // Click handler
    visible?: (editor: Editor) => boolean;           // Visibility check
}
```

### Example: Strikethrough Button

```typescript
// app/plugins/my-editor-toolbar.client.ts
import { registerEditorToolbarButton } from '~/composables';
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

### Available Functions

```typescript
// Register a button
registerEditorToolbarButton(button: EditorToolbarButton): void

// Unregister a button
unregisterEditorToolbarButton(id: string): void

// Get all registered button IDs (for debugging)
listRegisteredEditorToolbarButtonIds(): string[]

// Used by DocumentEditor to get reactive button list
useEditorToolbarButtons(editorRef: Ref<Editor | null>): ComputedRef<EditorToolbarButton[]>
```

## Adding Custom Nodes

Nodes are block-level elements like paragraphs, headings, or custom blocks.

### API Contract

```typescript
interface EditorNode {
    id: string;           // Unique identifier
    extension: Extension; // TipTap extension instance
    order?: number;       // Load order (default: 200)
}
```

### Example: Custom Callout Node

```typescript
// app/plugins/my-editor-callout.client.ts
import { Node } from '@tiptap/core';
import { registerEditorNode } from '~/composables';

// Define the TipTap node
const CalloutNode = Node.create({
    name: 'callout',
    
    group: 'block',
    
    content: 'inline*',
    
    parseHTML() {
        return [{ tag: 'div[data-type="callout"]' }];
    },
    
    renderHTML({ HTMLAttributes }) {
        return ['div', { 
            ...HTMLAttributes, 
            'data-type': 'callout',
            class: 'callout-box'
        }, 0];
    },
    
    addCommands() {
        return {
            setCallout: () => ({ commands }) => {
                return commands.setNode(this.name);
            },
        };
    },
});

export default defineNuxtPlugin(() => {
    registerEditorNode({
        id: 'my-plugin:callout',
        extension: CalloutNode,
        order: 300,
    });
});
```

### Available Functions

```typescript
// Register a node
registerEditorNode(node: EditorNode): void

// Unregister a node
unregisterEditorNode(id: string): void

// Get all registered nodes (ordered)
listEditorNodes(): EditorNode[]

// Get all registered node IDs (for debugging)
listRegisteredEditorNodeIds(): string[]
```

## Adding Custom Marks

Marks are inline formatting like bold, italic, or custom inline styles.

### API Contract

```typescript
interface EditorMark {
    id: string;           // Unique identifier
    extension: Extension; // TipTap extension instance
    order?: number;       // Load order (default: 200)
}
```

### Example: Highlight Mark

```typescript
// app/plugins/my-editor-highlight.client.ts
import { Mark } from '@tiptap/core';
import { registerEditorMark, registerEditorToolbarButton } from '~/composables';
import type { Editor } from '@tiptap/vue-3';

// Define the TipTap mark
const HighlightMark = Mark.create({
    name: 'highlight',
    
    parseHTML() {
        return [{ tag: 'mark' }];
    },
    
    renderHTML({ HTMLAttributes }) {
        return ['mark', HTMLAttributes, 0];
    },
    
    addCommands() {
        return {
            toggleHighlight: () => ({ commands }) => {
                return commands.toggleMark(this.name);
            },
        };
    },
});

export default defineNuxtPlugin(() => {
    // Register the mark extension
    registerEditorMark({
        id: 'my-plugin:highlight',
        extension: HighlightMark,
        order: 300,
    });
    
    // Register a toolbar button for it
    registerEditorToolbarButton({
        id: 'my-plugin:highlight-button',
        icon: 'pixelarticons:text-highlight',
        tooltip: 'Highlight',
        order: 350,
        isActive: (editor: Editor) => editor.isActive('highlight'),
        onClick: (editor: Editor) => {
            editor.chain().focus().toggleHighlight().run();
        },
    });
});
```

### Available Functions

```typescript
// Register a mark
registerEditorMark(mark: EditorMark): void

// Unregister a mark
unregisterEditorMark(id: string): void

// Get all registered marks (ordered)
listEditorMarks(): EditorMark[]

// Get all registered mark IDs (for debugging)
listRegisteredEditorMarkIds(): string[]
```

## Advanced: Direct Editor Access

While the registry system covers most use cases, you can access the editor instance directly through the hooks system:

```typescript
import { useHooks } from '~/composables';

export default defineNuxtPlugin(() => {
    const hooks = useHooks();
    
    // Hook into editor lifecycle (if such hooks exist)
    // Note: Check docs/hooks.md for available editor hooks
    hooks.addAction('editor.created:action:after', (editor) => {
        // Direct editor manipulation
        console.log('Editor created:', editor);
    });
});
```

## Best Practices

### 1. Naming Conventions

Use namespaced IDs to avoid collisions:
```typescript
id: 'my-plugin:feature-name'  // ✅ Good
id: 'strikethrough'           // ❌ Could conflict
```

### 2. Ordering

- Built-in buttons/extensions use `order < 200`
- Your plugins should use `order >= 200` to appear after built-ins
- Lower numbers appear first/earlier
- Use gaps (e.g., 300, 350, 400) to allow future insertions

### 3. Performance

- Keep `onClick` handlers fast and non-blocking
- Use `visible` function sparingly (runs on every editor state change)
- Avoid heavy computations in `isActive` checks

### 4. HMR Safety

The registry system handles HMR automatically:
- Duplicate registrations in dev will show a console warning
- Old registrations are replaced, not duplicated
- No manual cleanup needed

### 5. TypeScript

Import types for better IDE support:
```typescript
import type { Editor } from '@tiptap/vue-3';
import type { EditorToolbarButton, EditorNode, EditorMark } from '~/composables';
```

### 6. Testing

Check your registrations programmatically:
```typescript
export default defineNuxtPlugin(() => {
    registerEditorToolbarButton({
        id: 'my-plugin:test',
        // ...
    });
    
    // Verify registration
    const ids = listRegisteredEditorToolbarButtonIds();
    console.log('Registered buttons:', ids);
    // Should include 'my-plugin:test'
});
```

## Complete Example: Rich Text Enhancement Plugin

Here's a complete plugin that adds multiple features:

```typescript
// app/plugins/rich-text-enhancements.client.ts
import { Mark, Node } from '@tiptap/core';
import { 
    registerEditorMark, 
    registerEditorNode, 
    registerEditorToolbarButton 
} from '~/composables';
import type { Editor } from '@tiptap/vue-3';

// 1. Underline Mark
const UnderlineMark = Mark.create({
    name: 'underline',
    parseHTML() {
        return [{ tag: 'u' }];
    },
    renderHTML() {
        return ['u', 0];
    },
    addCommands() {
        return {
            toggleUnderline: () => ({ commands }) => {
                return commands.toggleMark(this.name);
            },
        };
    },
});

// 2. Spoiler Mark (hidden until hovered)
const SpoilerMark = Mark.create({
    name: 'spoiler',
    parseHTML() {
        return [{ tag: 'span.spoiler' }];
    },
    renderHTML() {
        return ['span', { class: 'spoiler' }, 0];
    },
    addCommands() {
        return {
            toggleSpoiler: () => ({ commands }) => {
                return commands.toggleMark(this.name);
            },
        };
    },
});

// 3. Info Box Node
const InfoBoxNode = Node.create({
    name: 'infoBox',
    group: 'block',
    content: 'inline*',
    parseHTML() {
        return [{ tag: 'div.info-box' }];
    },
    renderHTML() {
        return ['div', { class: 'info-box' }, 0];
    },
    addCommands() {
        return {
            setInfoBox: () => ({ commands }) => {
                return commands.setNode(this.name);
            },
        };
    },
});

export default defineNuxtPlugin(() => {
    // Register marks
    registerEditorMark({
        id: 'rich-text:underline',
        extension: UnderlineMark,
        order: 300,
    });
    
    registerEditorMark({
        id: 'rich-text:spoiler',
        extension: SpoilerMark,
        order: 310,
    });
    
    // Register node
    registerEditorNode({
        id: 'rich-text:info-box',
        extension: InfoBoxNode,
        order: 300,
    });
    
    // Register toolbar buttons
    registerEditorToolbarButton({
        id: 'rich-text:underline-btn',
        icon: 'pixelarticons:text-underline',
        tooltip: 'Underline',
        order: 300,
        isActive: (editor: Editor) => editor.isActive('underline'),
        onClick: (editor: Editor) => {
            editor.chain().focus().toggleUnderline().run();
        },
    });
    
    registerEditorToolbarButton({
        id: 'rich-text:spoiler-btn',
        icon: 'pixelarticons:eye-closed',
        tooltip: 'Spoiler',
        order: 310,
        isActive: (editor: Editor) => editor.isActive('spoiler'),
        onClick: (editor: Editor) => {
            editor.chain().focus().toggleSpoiler().run();
        },
    });
    
    registerEditorToolbarButton({
        id: 'rich-text:info-box-btn',
        icon: 'pixelarticons:info-box',
        tooltip: 'Info Box',
        order: 320,
        isActive: (editor: Editor) => editor.isActive('infoBox'),
        onClick: (editor: Editor) => {
            editor.chain().focus().setInfoBox().run();
        },
    });
    
    console.info('[rich-text-enhancements] Registered 3 marks, 1 node, 3 buttons');
});
```

## Troubleshooting

### Plugin Not Loading

1. Ensure file ends with `.client.ts`
2. Check it's in `app/plugins/` directory
3. Look for errors in browser console
4. Verify `defineNuxtPlugin()` is used correctly

### Button Not Appearing

1. Check `listRegisteredEditorToolbarButtonIds()` output
2. Verify `visible` function (if present) returns `true`
3. Check browser console for warnings about duplicate IDs
4. Ensure icon name is valid

### Extension Not Working

1. Verify TipTap extension syntax is correct
2. Check browser console for TipTap errors
3. Test extension in isolation before registering
4. Ensure extension name doesn't conflict with built-ins

### Editor Commands Not Working

1. Use `editor.chain().focus()` before commands
2. Call `.run()` at the end of command chains
3. Check TipTap documentation for correct command names
4. Verify your extension's `addCommands()` returns proper format

## Reference Links

- **TipTap Documentation**: https://tiptap.dev/
- **ProseMirror**: https://prosemirror.net/
- **OR3 Hooks System**: `docs/hooks.md`
- **Pane Plugin API**: `docs/pane-plugin-api.md`
- **Example Plugins**: `app/plugins/examples/`

## API Location Reference

| Function | File Path |
|----------|-----------|
| Toolbar API | `app/composables/ui-extensions/editor/useEditorToolbar.ts` |
| Nodes/Marks API | `app/composables/ui-extensions/editor/useEditorNodes.ts` |
| DocumentEditor Component | `app/components/documents/DocumentEditor.vue` |

## Summary

The OR3 editor plugin system provides a powerful, type-safe way to extend the document editor:

1. **Create a Nuxt plugin** in `app/plugins/*.client.ts`
2. **Use registration functions** to add toolbar buttons, nodes, or marks
3. **Leverage TipTap's extension API** for custom behavior
4. **Follow naming conventions** and ordering best practices
5. **Test thoroughly** using the provided utility functions

With this system, you can add sophisticated editing features without touching core editor files, ensuring maintainability and enabling a rich plugin ecosystem.
