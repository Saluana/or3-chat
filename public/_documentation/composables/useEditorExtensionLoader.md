# useEditorExtensionLoader

Factory and loader for lazy-loading TipTap editor extensions (nodes, marks, extensions). Resolves factories to actual extension instances while gracefully handling failures and skipping unavailable extensions.

Think of `useEditorExtensionLoader` as your extension resolver — it turns a registry of eager and lazy TipTap extensions into a unified list of loaded extensions, with automatic error recovery and optional callback hooks.

---

## Purpose

`useEditorExtensionLoader` is the bridge between extension registration and editor initialization. When you want to:

-   Load TipTap nodes, marks, and extensions on-demand
-   Mix eager (already-imported) and lazy (dynamic import) extensions
-   Handle extension failures without crashing the editor
-   Track which extensions loaded successfully
-   Support plugins that provide lazy extension factories
-   Keep the editor responsive during extension initialization

...this function handles all of that for you.

---

## Basic Example

Here's the simplest way to use it:

```vue
<script setup>
import { loadEditorExtensions } from '~/composables/editor/useEditorExtensionLoader';
import { useEditorNodes } from '~/composables/editor/useEditorNodes';

const nodeRegistry = useEditorNodes();

// Load all registered extensions
const { nodes, marks, extensions } = await loadEditorExtensions(
    nodeRegistry.listEditorNodes(),
    nodeRegistry.listEditorMarks(),
    nodeRegistry.listEditorExtensions()
);

// Use in TipTap editor
const editor = useEditor({
    extensions: [
        ...nodes,
        ...marks,
        ...extensions,
    ],
});
</script>
```

---

## How to use it

### 1. Create extension descriptors

Extensions can be either eager (already loaded) or lazy (factory):

```ts
import type { EditorNodeDescriptor, EditorMarkDescriptor, EditorExtensionDescriptor } from '~/composables/editor/useEditorExtensionLoader';

// Eager node (already imported)
const eagerNode: EditorNodeDescriptor = {
    id: 'paragraph',
    extension: Paragraph.create(),
};

// Lazy node (dynamic import)
const lazyNode: EditorNodeDescriptor = {
    id: 'custom-block',
    factory: () => import('~/extensions/CustomBlock').then(m => m.default),
};

// Lazy with helper factory
const helperNode: EditorNodeDescriptor = {
    id: 'another-block',
    factory: createLazyNodeFactory(
        () => import('~/extensions/AnotherBlock')
    ),
};
```

### 2. Load all extensions

```ts
import { loadEditorExtensions } from '~/composables/editor/useEditorExtensionLoader';

const nodeDescriptors = [eagerNode, lazyNode];
const markDescriptors = [];
const extensionDescriptors = [];

const { nodes, marks, extensions } = await loadEditorExtensions(
    nodeDescriptors,
    markDescriptors,
    extensionDescriptors
);

console.log(`Loaded ${nodes.length} nodes, ${marks.length} marks, ${extensions.length} extensions`);
```

### 3. Use lazy factory helpers

Three helper functions make it easier to create factories from dynamic imports:

```ts
import {
    createLazyNodeFactory,
    createLazyMarkFactory,
    createLazyExtensionFactory,
} from '~/composables/editor/useEditorExtensionLoader';

// For nodes
const nodeFactory = createLazyNodeFactory(
    () => import('~/tiptap/CustomNode')
);

// For marks
const markFactory = createLazyMarkFactory(
    () => import('~/tiptap/CustomMark')
);

// For extensions
const extFactory = createLazyExtensionFactory(
    () => import('~/tiptap/CustomExtension')
);

// Register descriptors
const descriptor: EditorNodeDescriptor = {
    id: 'custom-node',
    factory: nodeFactory,
    order: 100,
};
```

### 4. Handle loading results

```ts
const { nodes, marks, extensions } = await loadEditorExtensions(...);

// All three arrays are ready to use
const allExtensions = [
    ...nodes,
    ...marks,
    ...extensions,
];

// Safe to pass to TipTap editor config
const editor = useEditor({
    extensions: allExtensions,
});
```

---

## Type Definitions

### Extension Descriptor Types

```ts
interface EditorNodeDescriptor {
    id: string;                           // Unique identifier
    extension?: Node;                     // Eager: already-loaded TipTap Node
    factory?: LazyEditorNodeFactory;      // Lazy: factory function
    order?: number;                       // Sort order (default 200)
}

interface EditorMarkDescriptor {
    id: string;                           // Unique identifier
    extension?: Mark;                     // Eager: already-loaded TipTap Mark
    factory?: LazyEditorMarkFactory;      // Lazy: factory function
    order?: number;                       // Sort order (default 200)
}

interface EditorExtensionDescriptor {
    id: string;                           // Unique identifier
    extension?: Extension;                // Eager: already-loaded TipTap Extension
    factory?: LazyEditorExtensionFactory; // Lazy: factory function
    order?: number;                       // Sort order (default 200)
}
```

### Factory Types

```ts
type LazyEditorNodeFactory = () => Promise<Node>;
type LazyEditorMarkFactory = () => Promise<Mark>;
type LazyEditorExtensionFactory = () => Promise<Extension>;
```

### Result Type

```ts
interface LoadedExtensions {
    nodes: Node[];
    marks: Mark[];
    extensions: Extension[];
}
```

### Helper Function Factories

```ts
function createLazyNodeFactory(
    importFn: () => Promise<{ default: Node } | Node>
): LazyEditorNodeFactory;

function createLazyMarkFactory(
    importFn: () => Promise<{ default: Mark } | Mark>
): LazyEditorMarkFactory;

function createLazyExtensionFactory(
    importFn: () => Promise<{ default: Extension } | Extension>
): LazyEditorExtensionFactory;
```

---

## How it works (under the hood)

Here's what happens when you call `loadEditorExtensions()`:

1. **For each node descriptor**:
   - If has `extension` property: push to results immediately
   - If has `factory` property: call `useLazyBoundaries().load()` with unique key
   - Catch errors: log warning and skip extension
   - Continue with next descriptor

2. **For each mark descriptor**: Same as nodes

3. **For each extension descriptor**: Same as nodes

4. **Return combined results**: All three arrays of successfully-loaded extensions

### Error handling

- **Extension errors**: Logged to console, extension skipped
- **Factory errors**: Treated same as extension errors
- **Worker errors**: Falls back to factory execution
- **No crash**: Loader continues even if individual extensions fail

### Unique boundary keys

Each lazy extension gets a unique lazy boundary key:
- Nodes: `editor-extensions:node:{id}`
- Marks: `editor-extensions:mark:{id}`
- Extensions: `editor-extensions:ext:{id}`

This ensures each extension is loaded separately and can be cached individually.

---

## Common patterns

### Mix eager and lazy extensions

```ts
import Paragraph from '@tiptap/extension-paragraph';
import { createLazyNodeFactory } from '~/composables/editor/useEditorExtensionLoader';

const descriptors = [
    {
        id: 'paragraph',
        extension: Paragraph.create(),
    },
    {
        id: 'custom-node',
        factory: createLazyNodeFactory(
            () => import('~/extensions/CustomNode')
        ),
    },
];

const { nodes } = await loadEditorExtensions(descriptors, [], []);
```

### Load extensions from plugin registry

```ts
import { useEditorNodes } from '~/composables/editor/useEditorNodes';
import { loadEditorExtensions } from '~/composables/editor/useEditorExtensionLoader';

const registry = useEditorNodes();

// Plugins have already registered extensions here
const loaded = await loadEditorExtensions(
    registry.listEditorNodes(),
    registry.listEditorMarks(),
    registry.listEditorExtensions()
);
```

### Handle partial failures gracefully

```ts
const { nodes, marks, extensions } = await loadEditorExtensions(
    descriptors, // Some may fail to load
    [],
    []
);

if (nodes.length < descriptors.length) {
    console.warn('Some nodes failed to load, continuing with available ones');
}

// Editor still initializes with successfully-loaded nodes
```

### With TipTap editor initialization

```vue
<script setup>
import { useEditor } from '@tiptap/vue-3';
import { loadEditorExtensions } from '~/composables/editor/useEditorExtensionLoader';
import { useEditorNodes } from '~/composables/editor/useEditorNodes';

const nodeRegistry = useEditorNodes();
const { nodes, marks, extensions } = await loadEditorExtensions(
    nodeRegistry.listEditorNodes(),
    nodeRegistry.listEditorMarks(),
    nodeRegistry.listEditorExtensions()
);

const editor = useEditor({
    extensions: [
        ...nodes,
        ...marks,
        ...extensions,
    ],
    content: '<p>Hello World</p>',
});
</script>

<template>
    <EditorContent :editor="editor" />
</template>
```

### Create custom factory with error handling

```ts
function createCustomLazyNodeFactory(
    importPath: string
): LazyEditorNodeFactory {
    return async () => {
        try {
            const mod = await import(importPath);
            const ext = mod.default || mod;
            
            if (!ext) {
                throw new Error(`No default export in ${importPath}`);
            }
            
            return ext;
        } catch (error) {
            console.error(`Failed to load node from ${importPath}:`, error);
            throw error;
        }
    };
}
```

### Batch register extensions from multiple sources

```ts
const builtInNodes = [
    { id: 'paragraph', extension: Paragraph.create() },
    { id: 'heading', extension: Heading.create() },
];

const pluginNodes = [
    {
        id: 'custom-block',
        factory: createLazyNodeFactory(
            () => import('~/plugins/custom-block')
        ),
    },
];

const allNodes = [...builtInNodes, ...pluginNodes];

const { nodes } = await loadEditorExtensions(allNodes, [], []);
```

---

## Important notes

### Descriptor validation

-   Each descriptor **must have either** `extension` OR `factory` (not both)
-   Descriptors with neither are silently skipped
-   `id` is used for logging and boundary key generation

### Lazy boundary caching

-   Extensions are cached by lazy boundary system
-   Same extension loaded multiple times = one lazy load
-   Use `useLazyBoundaries().reset()` if you need to force re-import

### Error recovery

-   Failed extensions don't crash the loader
-   Errors logged to console with extension ID
-   Remaining extensions continue loading
-   Editor can initialize with partial extension set

### TipTap compatibility

-   Supports all TipTap v2+ extension types
-   Works with Node, Mark, and Extension classes
-   Compatible with both `create()` and imported classes

### Order preservation

-   Descriptors maintain insertion order
-   `order` field exists but used by registry, not loader
-   Order in results matches order in input arrays

### SSR considerations

-   TipTap extensions don't work in SSR
-   Load on client side only
-   Wrap in `<ClientOnly>` or check `import.meta.client`

---

## Performance tips

### Preload critical extensions

```ts
// Load core extensions eagerly for fast editor init
const coreExtensions = [
    Paragraph.create(),
    Heading.create(),
    BulletList.create(),
];

// Load optional extensions lazily
const optionalExtensions = [
    {
        id: 'table',
        factory: createLazyNodeFactory(
            () => import('@tiptap/extension-table')
        ),
    },
];
```

### Batch load all at once

```ts
// Load all in parallel using lazy boundaries
const loaded = await loadEditorExtensions(
    nodeDescriptors,
    markDescriptors,
    extensionDescriptors
);

// All three types load in parallel (not sequentially)
```

### Avoid duplicate descriptors

```ts
// ❌ Inefficient: same extension loaded twice
const descriptors = [
    { id: 'custom', factory: lazyFactory },
    { id: 'custom-2', factory: lazyFactory }, // Same factory!
];

// ✅ Better: reuse loaded instances
const descriptor = { id: 'custom', factory: lazyFactory };
const nodes = [descriptor];
```

---

## Troubleshooting

### "Extensions not loading"

Check that:
-   `extension` and `factory` are correctly provided
-   Factories return valid TipTap extension instances
-   No circular dependencies in extension imports

### "Module not found errors"

Verify:
-   Import paths are correct and resolvable
-   Files export default TipTap extensions
-   No tree-shaking issues with extension exports

### "Type errors with custom extensions"

Ensure:
-   Extensions match TipTap interface (Node, Mark, or Extension)
-   Descriptors have correct type parameter
-   Factories resolve correct extension types

### "Some extensions load, others fail"

This is normal — loader skips failed extensions:
-   Check console warnings for which failed
-   Verify factory functions individually
-   Consider adding error boundaries in factories

### "Editor initializes without expected extensions"

Debug by:
-   Check loaded counts: `console.log(loaded)`
-   Inspect console warnings for failures
-   Verify registry contents before loading

---

## Related

-   `useEditorNodes` — Extension registry
-   `useLazyBoundaries` — Underlying lazy loading system
-   `@tiptap/core` — TipTap extension types
-   `EditorHost.vue` — Main editor component

---

## Example: Full editor with mixed extensions

```vue
<template>
    <div class="editor-wrapper">
        <div v-if="loading" class="loading">
            <span class="spinner" />
            Loading editor extensions...
        </div>

        <div v-else-if="error" class="error">
            <p>Failed to initialize editor</p>
            <pre>{{ error }}</pre>
        </div>

        <EditorContent v-else :editor="editor" class="editor" />
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useEditor, EditorContent } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';

import {
    loadEditorExtensions,
    createLazyNodeFactory,
    createLazyExtensionFactory,
} from '~/composables/editor/useEditorExtensionLoader';
import { useEditorNodes } from '~/composables/editor/useEditorNodes';

const loading = ref(true);
const error = ref<string | null>(null);
const editor = ref(null);

const nodeRegistry = useEditorNodes();

onMounted(async () => {
    try {
        // Core eager extensions
        const coreExtensions = [
            {
                id: 'starter-kit',
                extension: StarterKit.configure({
                    codeBlock: false,
                }),
            },
            {
                id: 'table',
                extension: Table.configure(),
            },
            {
                id: 'table-row',
                extension: TableRow.configure(),
            },
            {
                id: 'table-header',
                extension: TableHeader.configure(),
            },
            {
                id: 'table-cell',
                extension: TableCell.configure(),
            },
        ];

        // Plugin-registered lazy extensions
        const pluginExtensions = nodeRegistry.listEditorNodes();

        // Load all extensions
        const { nodes, extensions } = await loadEditorExtensions(
            [
                ...coreExtensions,
                ...pluginExtensions,
            ],
            nodeRegistry.listEditorMarks(),
            nodeRegistry.listEditorExtensions()
        );

        // Initialize editor
        editor.value = useEditor({
            extensions: [
                ...nodes,
                ...extensions,
            ],
            content: `
                <h1>Welcome to the Editor</h1>
                <p>This editor includes mixed eager and lazy extensions.</p>
                <table>
                    <tr>
                        <th>Column 1</th>
                        <th>Column 2</th>
                    </tr>
                    <tr>
                        <td>Data 1</td>
                        <td>Data 2</td>
                    </tr>
                </table>
            `,
        });

        console.log(`Loaded ${nodes.length} nodes and ${extensions.length} extensions`);
        loading.value = false;
    } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
        loading.value = false;
    }
});
</script>

<style scoped>
.editor-wrapper {
    display: flex;
    flex-direction: column;
    height: 100%;
    border: 2px solid var(--md-primary);
    background: var(--md-surface);
}

.loading,
.error {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 400px;
    color: var(--md-on-surface-variant);
}

.spinner {
    display: inline-block;
    width: 24px;
    height: 24px;
    border: 3px solid var(--md-outline);
    border-top-color: var(--md-primary);
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-right: 0.5rem;
}

@keyframes spin {
    to {
        transform: rotate(360deg);
    }
}

.error {
    flex-direction: column;
    color: var(--md-error);
}

.editor {
    flex: 1;
    overflow-y: auto;
    padding: 1rem;
}

:deep(.ProseMirror) {
    outline: none;
    min-height: 300px;
}

:deep(.ProseMirror table) {
    border-collapse: collapse;
    margin: 1rem 0;
}

:deep(.ProseMirror td,
.ProseMirror th) {
    border: 1px solid var(--md-outline);
    padding: 0.5rem;
}

:deep(.ProseMirror th) {
    background: var(--md-surface-variant);
    font-weight: bold;
}
</style>
```

---

Document generated from `app/composables/editor/useEditorExtensionLoader.ts` implementation.
