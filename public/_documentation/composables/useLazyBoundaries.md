# useLazyBoundaries

Singleton lazy boundary manager for code-splitting heavy features in OR3. Handles dynamic imports, loading state, module caching, and telemetry for performance-critical boundaries.

Think of `useLazyBoundaries` as your code-splitting coordinator — it ensures heavy modules (TipTap editor, Orama search, workspace export) load on-demand, only once, with proper error handling and visibility.

---

## Purpose

`useLazyBoundaries` is the foundation for lazy-loading expensive features. When you want to:

-   Load the TipTap editor only when a document is opened
-   Dynamically import search workers without blocking initial page load
-   Track loading state across multiple components
-   Cache resolved modules to avoid re-fetching
-   Monitor performance with telemetry
-   Handle import errors gracefully with retry support

...this composable handles all of that for you.

---

## Basic Example

Here's the simplest way to use it:

```vue
<script setup>
import { useLazyBoundaries } from '~/composables/core/useLazyBoundaries';

const boundaries = useLazyBoundaries();

// Load the editor when user clicks "New Document"
async function openEditor() {
    try {
        const editorModule = await boundaries.load({
            key: 'editor-host',
            loader: () => import('~/components/editor/EditorHost.vue'),
        });
        console.log('Editor loaded!', editorModule);
    } catch (error) {
        console.error('Failed to load editor:', error);
    }
}

// Check loading state
const isEditorLoading = computed(() => 
    boundaries.getState('editor-host') === 'loading'
);
</script>

<template>
    <div>
        <button @click="openEditor" :disabled="isEditorLoading">
            {{ isEditorLoading ? 'Loading...' : 'Open Editor' }}
        </button>
    </div>
</template>
```

---

## How to use it

### 1. Get the boundary controller

```ts
import { useLazyBoundaries } from '~/composables/core/useLazyBoundaries';

const boundaries = useLazyBoundaries();
```

This returns a singleton instance — the same controller across your entire app.

### 2. Load a lazy boundary

```ts
// Load the editor
const editorModule = await boundaries.load({
    key: 'editor-host',
    loader: () => import('~/components/editor/EditorHost.vue'),
});

// Load with callback
await boundaries.load({
    key: 'docs-search-worker',
    loader: () => import('~/workers/search.worker'),
    onResolve: (worker) => {
        console.log('Search worker ready:', worker);
        worker.postMessage({ type: 'init' });
    },
});

// Load and cache
const oramaModule = await boundaries.load({
    key: 'docs-search-panel',
    loader: () => import('@orama/orama'),
});
```

### 3. Check loading state

```ts
// Get state for a specific boundary
const editorState = boundaries.getState('editor-host');
// Returns: 'idle' | 'loading' | 'ready' | 'error'

// Or watch reactive state
const state = boundaries.state;
console.log(state['editor-host']); // reactive
```

### 4. Reset a boundary

```ts
// Clear cache and reset state to 'idle'
boundaries.reset('editor-host');

// Next load will re-fetch
await boundaries.load({
    key: 'editor-host',
    loader: () => import('~/components/editor/EditorHost.vue'),
});
```

### 5. Monitor telemetry

```ts
import { onLazyBoundaryTelemetry } from '~/composables/core/useLazyBoundaries';

// Subscribe to load events
const unsubscribe = onLazyBoundaryTelemetry((payload) => {
    console.log(`${payload.key} loaded in ${payload.ms}ms`);
    if (payload.outcome === 'failure') {
        console.error('Load failed:', payload.error);
    }
});

// Clean up when done
onUnmounted(() => unsubscribe());
```

---

## What you get back

When you call `useLazyBoundaries()`, you get a controller object with:

| Property   | Type                                                          | Description                                   |
| ---------- | ------------------------------------------------------------- | --------------------------------------------- |
| `state`    | `Readonly<Record<LazyBoundaryKey, LazyBoundaryState>>`       | Reactive state for all boundaries             |
| `load`     | `<T>(descriptor: LazyBoundaryDescriptor<T>) => Promise<T>`   | Load a boundary and return the module         |
| `reset`    | `(key: LazyBoundaryKey) => void`                              | Clear cache and reset state to 'idle'         |
| `getState` | `(key: LazyBoundaryKey) => LazyBoundaryState`                 | Get current state for a specific boundary     |

---

## Available Boundaries

OR3 defines the following lazy boundary keys:

| Key                    | Purpose                                  | Typical Module                       |
| ---------------------- | ---------------------------------------- | ------------------------------------ |
| `editor-host`          | TipTap editor component                  | `EditorHost.vue`                     |
| `editor-extensions`    | TipTap extensions bundle                 | `@tiptap/*` packages                 |
| `docs-search-panel`    | Orama search UI                          | Search panel component               |
| `docs-search-worker`   | Search indexing worker                   | Web Worker or Orama module           |
| `workspace-export`     | Workspace backup/export logic            | StreamSaver, ZIP generation          |
| `workspace-import`     | Workspace restore/import logic           | File parsing, DB population          |

---

## Type Definitions

### LazyBoundaryDescriptor

Describes how to load a boundary:

```ts
interface LazyBoundaryDescriptor<T> {
    key: LazyBoundaryKey;                  // Unique boundary identifier
    loader: () => Promise<T>;               // Dynamic import function
    onResolve?: (payload: T) => void;       // Optional callback after load
}
```

### LazyBoundaryState

Possible states for a boundary:

```ts
type LazyBoundaryState = 'idle' | 'loading' | 'ready' | 'error';
```

-   **`idle`**: Not yet loaded
-   **`loading`**: Currently fetching
-   **`ready`**: Successfully loaded and cached
-   **`error`**: Failed to load (cache cleared, retry possible)

### LazyTelemetryPayload

Telemetry event data:

```ts
interface LazyTelemetryPayload {
    key: LazyBoundaryKey;
    ms: number;                             // Load duration
    outcome: 'success' | 'failure';
    error?: unknown;                        // Error object if failed
}
```

---

## How it works (under the hood)

Here's what happens when you call `boundaries.load()`:

1. **Check module cache**: If already loaded, return cached promise immediately
2. **Mark as loading**: Update state to `'loading'`
3. **Start timer**: Record start time for telemetry
4. **Execute loader**: Call the dynamic import function
5. **Cache promise**: Store promise in module cache (prevents duplicate fetches)
6. **Await resolution**: Wait for import to complete
7. **Mark as ready**: Update state to `'ready'`
8. **Invoke callback**: If `onResolve` provided, call it with the module
9. **Emit telemetry**: Log success/failure with duration
10. **Return module**: Give caller the resolved module

If anything fails:
-   State becomes `'error'`
-   Cache is cleared (allows retry)
-   Telemetry emits failure event
-   Error is re-thrown to caller

---

## Common patterns

### Conditional loading

```vue
<script setup>
const boundaries = useLazyBoundaries();
const showEditor = ref(false);

async function toggleEditor() {
    if (!showEditor.value) {
        await boundaries.load({
            key: 'editor-host',
            loader: () => import('~/components/editor/EditorHost.vue'),
        });
    }
    showEditor.value = !showEditor.value;
}
</script>
```

### Loading indicators

```vue
<script setup>
const boundaries = useLazyBoundaries();

const isLoading = computed(() => 
    boundaries.getState('editor-host') === 'loading'
);

const hasError = computed(() => 
    boundaries.getState('editor-host') === 'error'
);
</script>

<template>
    <div>
        <div v-if="isLoading" class="spinner">Loading editor...</div>
        <div v-else-if="hasError" class="error">
            Failed to load. 
            <button @click="retry">Retry</button>
        </div>
        <EditorHost v-else />
    </div>
</template>
```

### Preloading on idle

```ts
// Preload search worker during browser idle time
if ('requestIdleCallback' in window) {
    requestIdleCallback(async () => {
        await boundaries.load({
            key: 'docs-search-worker',
            loader: () => import('~/workers/search.worker'),
        });
    });
}
```

### Multiple boundaries

```ts
// Load multiple boundaries in parallel
const [editor, search] = await Promise.all([
    boundaries.load({
        key: 'editor-host',
        loader: () => import('~/components/editor/EditorHost.vue'),
    }),
    boundaries.load({
        key: 'docs-search-panel',
        loader: () => import('@orama/orama'),
    }),
]);
```

### Retry with exponential backoff

```ts
async function loadWithRetry(key: LazyBoundaryKey, maxAttempts = 3) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await boundaries.load({
                key,
                loader: () => import('~/components/editor/EditorHost.vue'),
            });
        } catch (error) {
            if (attempt === maxAttempts) throw error;
            
            const delay = Math.pow(2, attempt) * 100; // 200ms, 400ms, 800ms
            await new Promise((resolve) => setTimeout(resolve, delay));
            
            boundaries.reset(key); // Clear error state
        }
    }
}
```

---

## Important notes

### Singleton behavior

-   `useLazyBoundaries()` always returns the **same instance**
-   Module cache is shared globally
-   State is reactive and shared across components
-   Safe to call from multiple components simultaneously

### Module caching

-   Once loaded, modules are **cached forever** (until reset)
-   Subsequent calls return the **same promise** (no duplicate fetches)
-   Cache survives component unmount (intentional for performance)
-   Call `reset()` to clear cache and allow re-import

### Error handling

When a load fails:
-   State becomes `'error'`
-   Cache is **automatically cleared**
-   Next `load()` call will retry the import
-   Error is thrown to caller (wrap in try/catch)

### Telemetry

-   In development: Logs to console with ✓/✗ icons
-   In production: Silent unless you subscribe
-   Use `onLazyBoundaryTelemetry()` to monitor performance
-   Returns unsubscribe function for cleanup

### SSR safety

-   Safe to call during SSR (imports won't execute)
-   State initialization happens client-side only
-   Always check `import.meta.client` if needed

### HMR compatibility

-   State survives hot module replacement
-   Cache persists across HMR updates
-   Call `reset()` in dev tools if you need fresh import

---

## Performance tips

### Preload critical boundaries

```ts
// In app.vue or plugin
const boundaries = useLazyBoundaries();

onMounted(() => {
    // Preload likely-needed modules
    boundaries.load({
        key: 'editor-host',
        loader: () => import('~/components/editor/EditorHost.vue'),
    });
});
```

### Monitor load times

```ts
onLazyBoundaryTelemetry((payload) => {
    if (payload.ms > 1000) {
        console.warn(`Slow load: ${payload.key} took ${payload.ms}ms`);
    }
});
```

### Avoid unnecessary resets

Only call `reset()` when you need to:
-   Force a re-import (rare)
-   Clear memory after error
-   Testing/debugging

Normal usage doesn't need `reset()` — caching is the point.

---

## Troubleshooting

### "Module not loading"

Check your loader function:

```ts
// ❌ Wrong: returns module directly
loader: import('~/components/Foo.vue')

// ✅ Correct: returns a function
loader: () => import('~/components/Foo.vue')
```

### "State stuck in 'loading'"

The loader promise may have stalled. Check:
-   Network issues
-   Invalid import path
-   Circular dependencies

Reset and retry:

```ts
boundaries.reset('editor-host');
await boundaries.load({ ... });
```

### "onResolve callback not firing"

-   Callback only fires on **first successful load**
-   Cached loads skip the callback (already resolved)
-   Check for errors in callback (logged to console)

### "Module loaded multiple times"

This shouldn't happen if using the same `key`. Verify:
-   You're using the correct `LazyBoundaryKey`
-   Not calling from multiple controller instances (use singleton)
-   Not bypassing the controller with raw `import()`

---

## Related

-   `~/types/lazy-boundaries.d.ts` — Type definitions
-   `createLoadTimer()` — Utility for custom timing
-   `useHookEffect()` — Hook integration for lazy features
-   `defineAsyncComponent()` — Vue's built-in async components (complementary)

---

## Example: Full lazy editor component

```vue
<template>
    <div class="editor-container">
        <div v-if="state === 'idle'" class="placeholder">
            <button @click="loadEditor" class="retro-btn">
                Open Editor
            </button>
        </div>

        <div v-else-if="state === 'loading'" class="loading">
            <div class="spinner" />
            <p>Loading editor...</p>
        </div>

        <div v-else-if="state === 'error'" class="error">
            <p>Failed to load editor</p>
            <button @click="retry" class="retro-btn">Retry</button>
        </div>

        <component 
            v-else-if="state === 'ready' && editorComponent" 
            :is="editorComponent"
            :content="content"
            @update="handleUpdate"
        />
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useLazyBoundaries, onLazyBoundaryTelemetry } from '~/composables/core/useLazyBoundaries';
import type { Component } from 'vue';

const boundaries = useLazyBoundaries();
const editorComponent = ref<Component | null>(null);

const props = defineProps<{
    content: string;
    autoLoad?: boolean;
}>();

const emit = defineEmits<{
    (e: 'update', content: string): void;
}>();

const state = computed(() => boundaries.getState('editor-host'));

async function loadEditor() {
    try {
        const module = await boundaries.load({
            key: 'editor-host',
            loader: () => import('~/components/editor/EditorHost.vue'),
            onResolve: (mod) => {
                console.log('Editor loaded successfully');
                editorComponent.value = mod.default || mod;
            },
        });
        
        if (!editorComponent.value) {
            editorComponent.value = module.default || module;
        }
    } catch (error) {
        console.error('Failed to load editor:', error);
    }
}

async function retry() {
    boundaries.reset('editor-host');
    await loadEditor();
}

function handleUpdate(newContent: string) {
    emit('update', newContent);
}

// Auto-load if requested
onMounted(() => {
    if (props.autoLoad) {
        loadEditor();
    }
});

// Monitor performance
const unsubscribe = onLazyBoundaryTelemetry((payload) => {
    if (payload.key === 'editor-host') {
        console.log(`Editor loaded in ${payload.ms}ms`);
    }
});

onUnmounted(() => {
    unsubscribe();
});
</script>

<style scoped>
.editor-container {
    min-height: 400px;
    display: flex;
    align-items: center;
    justify-content: center;
}

.placeholder, .loading, .error {
    text-align: center;
}

.spinner {
    width: 40px;
    height: 40px;
    border: 4px solid var(--md-surface-variant);
    border-top-color: var(--md-primary);
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin: 0 auto 1rem;
}

@keyframes spin {
    to { transform: rotate(360deg); }
}

.retro-btn {
    padding: 0.5rem 1rem;
    border: 2px solid var(--md-primary);
    background: var(--md-surface);
    color: var(--md-on-surface);
    cursor: pointer;
    font-family: 'Press Start 2P', monospace;
    font-size: 0.875rem;
}

.retro-btn:hover {
    background: var(--md-primary);
    color: var(--md-on-primary);
}

.error {
    color: var(--md-error);
}
</style>
```

---

Document generated from `app/composables/core/useLazyBoundaries.ts` implementation.
