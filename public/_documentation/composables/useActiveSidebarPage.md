# useActiveSidebarPage

Manages the active sidebar page state with persistence, activation hooks, and page transitions. Uses global singleton state to ensure consistency across all components.

Think of `useActiveSidebarPage` as the sidebar's navigation controller — it tracks which page is currently active, handles page switching logic, and maintains the selected page across sessions.

---

## Purpose

`useActiveSidebarPage` is the core state manager for sidebar navigation. When you need to:

-   Track which sidebar page is currently active
-   Switch between sidebar pages with proper lifecycle hooks
-   Persist the selected page across browser sessions
-   Handle page activation guards and veto logic
-   Coordinate page transitions with the multi-pane system

...this composable handles all of that for you.

---

## Basic Example

Here's the simplest way to use it:

```vue
<script setup>
import { useActiveSidebarPage } from '~/composables/sidebar';

// Get the active page state
const { activePageId, activePageDef, setActivePage } = useActiveSidebarPage();

// Switch to a different page
async function switchToTodos() {
    await setActivePage('example-todo-page');
}
</script>

<template>
    <div>
        <!-- Show current page ID -->
        <div>Current page: {{ activePageDef?.label || 'Unknown' }}</div>
        
        <!-- Page switcher buttons -->
        <button @click="switchToTodos">Show Todos</button>
        <button @click="() => setActivePage('sidebar-home')">Home</button>
    </div>
</template>
```

---

## How to use it

### 1. Get the active page state

```ts
const {
    activePageId,      // Ref<string> - Current page ID
    activePageDef,     // Computed<RegisteredSidebarPage | null> - Full page definition
    setActivePage,     // Function to switch pages
    resetToDefault,    // Function to go back to home
} = useActiveSidebarPage();
```

### 2. Switch pages with error handling

```ts
// Basic page switch
const success = await setActivePage('example-todo-page');
if (!success) {
    console.log('Page switch was vetoed');
}

// Reset to home page
await resetToDefault();
```

### 3. Check current page status

```vue
<template>
    <!-- Show page-specific content -->
    <div v-if="activePageId === 'sidebar-home'">
        <HomeContent />
    </div>
    
    <div v-else-if="activePageId === 'example-todo-page'">
        <TodoContent />
    </div>
    
    <!-- Or use the page definition -->
    <component 
        :is="activePageDef?.component" 
        v-if="activePageDef"
    />
</template>
```

---

## What you get back

When you call `useActiveSidebarPage()`, you get an object with:

| Property          | Type                                    | Description                                                    |
| ----------------- | --------------------------------------- | -------------------------------------------------------------- |
| `activePageId`    | `Ref<string>`                           | The ID of the currently active page                            |
| `activePageDef`   | `Computed<RegisteredSidebarPage \| null>` | Full page definition (label, component, etc.) for active page  |
| `setActivePage`   | `(id: string) => Promise<boolean>`      | Switch to a page, returns true if successful                   |
| `resetToDefault`  | `() => Promise<boolean>`                | Reset to the default 'sidebar-home' page                       |

---

## Page Activation Flow

When you call `setActivePage(id)`, here's what happens:

1. **Client check**: Returns false if not running on client-side
2. **Page lookup**: Find the page definition by ID or fall back to default
3. **Guard check**: If the page has `canActivate`, call it and respect veto
4. **Deactivate current**: Call `onDeactivate` on the current page (if defined)
5. **Update state**: Change `activePageId` to the new page and track previous
6. **Activate new**: Call `onActivate` on the new page (if defined)
7. **Persist**: Save the selection to localStorage
8. **Analytics**: Fire `ui.sidebar.page:action:open` hook

If any step fails, the state is reverted and `false` is returned.

---

## Persistence

The active page selection automatically persists to localStorage:

- **Storage key**: `'or3-active-sidebar-page'`
- **Default page**: `'sidebar-home'`
- **Fallback**: If a stored page no longer exists, resets to default

---

## Lifecycle Hooks

Pages can define activation hooks:

```ts
registerSidebarPage({
    id: 'my-page',
    label: 'My Page',
    component: MyPageComponent,
    
    // Called before page becomes active (can veto)
    canActivate(ctx) {
        return canAccessMyPage(); // boolean
    },
    
    // Called when page is deactivated
    onDeactivate(ctx) {
        cleanupMyPage();
    },
    
    // Called when page becomes active
    onActivate(ctx) {
        setupMyPage();
    },
});
```

The context object includes:
```ts
interface SidebarActivateContext {
    page: SidebarPageDef;                    // The page being activated
    previousPage: SidebarPageDef | null;     // The page being deactivated
    isCollapsed: boolean;                    // Current sidebar state
    multiPane: any;                          // Multi-pane API (if available)
    panePluginApi: any;                      // Pane plugin API (if available)
}
```

---

## Global State Management

`useActiveSidebarPage` uses a global singleton pattern:

- **Single source of truth**: All components share the same state
- **HMR resilient**: Survives hot module replacement
- **Cross-component**: Works across sidebar, collapsed nav, and plugins

The global state is stored on `globalThis.__or3ActiveSidebarPageState` and includes:
- `activePageId`: Ref<string> - Current active page ID
- `previousPageId`: Ref<string | null> - Previous page ID for error recovery
- `initialRequestedPageId`: string | null - Page ID from storage to activate after mount
- `isInitialized`: boolean - Tracks if mount logic has run

---

## Error Handling

The composable gracefully handles errors:

- **Page not found**: Falls back to default page and logs warning (in dev mode)
- **Activation failure**: Reverts to previous page and returns `false`
- **Storage errors**: Silently fails but continues operation
- **Hook errors**: Catches and logs, doesn't block navigation
- **Non-client environment**: Returns false if `process.client` is false

---

## Common Patterns

### Page-specific conditional rendering

```vue
<template>
    <SidebarHeader v-if="activePageDef?.usesDefaultHeader" />
    
    <KeepAlive>
        <component 
            :is="activePageDef?.component || SidebarHomePage"
            :key="activePageId"
        />
    </KeepAlive>
</template>
```

### Navigation buttons

```vue
<template>
    <button 
        v-for="page in availablePages"
        :key="page.id"
        :class="{ active: activePageId === page.id }"
        @click="() => setActivePage(page.id)"
    >
        {{ page.label }}
    </button>
</template>
```

### Async page activation

```ts
async function navigateWithLoading(pageId: string) {
    loading.value = true;
    try {
        const success = await setActivePage(pageId);
        if (!success) {
            showToast('Cannot switch to that page');
        }
    } finally {
        loading.value = false;
    }
}
```

### Integration with multi-pane

```ts
const { setActivePage } = useActiveSidebarPage();
const { openApp } = useSidebarMultiPane();

async function openTodoPage() {
    // Switch to todo page in sidebar
    await setActivePage('example-todo-page');
    
    // Optionally open a todo pane
    await openApp('example-todo');
}
```

---

## Important Notes

### Initialization Order

The composable waits for pages to be registered before activating a stored page. If you try to activate a page before it's registered, it will:

1. Set up a watcher to wait for registration
2. Activate the page when it becomes available
3. Clean up the watcher automatically

The initialization logic only runs once globally, tracked by `state.isInitialized`.

### Default Page Behavior

- The default page ID is `'sidebar-home'`
- If no page with that ID exists, it falls back to the first registered page
- The default page cannot be vetoed by `canActivate` (it will be activated even if the guard returns false)

### Storage Limitations

- Uses localStorage, so storage is limited to ~5MB
- Only stores the page ID, not full page state
- Storage errors are non-fatal

---

## Troubleshooting

### "Page not found" warnings

Check that the page is registered before trying to activate it:

```ts
// Ensure registration happens first
registerSidebarPage(myPageDefinition);

// Then activate
await setActivePage('my-page');
```

### Page activation fails

Verify the `canActivate` guard isn't rejecting the activation:

```ts
registerSidebarPage({
    id: 'my-page',
    canActivate(ctx) {
        console.log('Activation check:', ctx);
        return true; // Make sure this returns true (or Promise<true>)
    },
});
```

Note: The guard can return a Promise<boolean> and will be awaited.

### State not syncing between components

Ensure all components are using the same composable instance. The global singleton should handle this automatically.

---

## Related

- `useSidebarPages` - Register and discover sidebar pages
- `registerSidebarPage` - Helper for page registration with HMR cleanup
- `useSidebarPageControls` - Access page controls from child components
- `useSidebarEnvironment` - Access sidebar context and multi-pane API
- `useSidebarMultiPane` - Multi-pane workspace integration

---

## TypeScript

Full type signature:

```ts
function useActiveSidebarPage(): {
    activePageId: Ref<string>;
    activePageDef: Computed<RegisteredSidebarPage | null>;
    setActivePage: (id: string) => Promise<boolean>;
    resetToDefault: () => Promise<boolean>;
};
```

---

## Example: Complete Sidebar Navigation

```vue
<template>
    <div class="sidebar-navigation">
        <!-- Page tabs -->
        <div class="nav-tabs">
            <button
                v-for="page in pages"
                :key="page.id"
                :class="{ active: activePageId === page.id }"
                @click="switchPage(page.id)"
                :disabled="switching"
            >
                <UIcon :name="page.icon" />
                {{ page.label }}
            </button>
        </div>

        <!-- Page content -->
        <div class="page-content">
            <Suspense>
                <template #default>
                    <KeepAlive>
                        <component 
                            :is="activePageDef?.component || DefaultPage"
                            :key="activePageId"
                        />
                    </KeepAlive>
                </template>
                <template #fallback>
                    <div class="loading">Loading page...</div>
                </template>
            </Suspense>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useActiveSidebarPage, useSidebarPages } from '~/composables/sidebar';

const { activePageId, activePageDef, setActivePage } = useActiveSidebarPage();
const { listSidebarPages } = useSidebarPages();

const switching = ref(false);

const pages = computed(() => listSidebarPages.value);

async function switchPage(pageId: string) {
    if (pageId === activePageId.value) return;
    
    switching.value = true;
    try {
        const success = await setActivePage(pageId);
        if (!success) {
            console.warn('Page switch was vetoed:', pageId);
        }
    } finally {
        switching.value = false;
    }
}
</script>

<style scoped>
.sidebar-navigation {
    display: flex;
    flex-direction: column;
    height: 100%;
}

.nav-tabs {
    display: flex;
    gap: 0.5rem;
    padding: 1rem;
    border-bottom: 1px solid var(--border);
}

.nav-tabs button {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--surface);
    cursor: pointer;
    transition: all 0.2s;
}

.nav-tabs button:hover {
    background: var(--surface-hover);
}

.nav-tabs button.active {
    background: var(--primary);
    color: white;
}

.nav-tabs button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.page-content {
    flex: 1;
    overflow: hidden;
}

.loading {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    opacity: 0.7;
}
</style>
```

---

Document generated from `app/composables/sidebar/useActiveSidebarPage.ts` implementation.
