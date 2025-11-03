# useSidebarPageControls

Provides access to sidebar page navigation controls from child components. Allows sidebar pages to programmatically switch pages or check their own active status.

Think of `useSidebarPageControls` as the sidebar's navigation remote — it gives pages the ability to navigate to other pages or check their own state without directly accessing the page manager.

---

## Purpose

`useSidebarPageControls` is the navigation interface for sidebar pages. When you need to:

-   Navigate to a different sidebar page from within a page
-   Check if the current page is active
-   Get the current page ID for conditional logic
-   Reset navigation back to the default page
-   Control sidebar navigation from child components

...this composable provides the navigation controls.

---

## Basic Example

Here's the simplest way to use it:

```vue
<script setup>
import { useSidebarPageControls } from '~/composables/sidebar';

// Get navigation controls
const { pageId, isActive, setActivePage, resetToDefault } = useSidebarPageControls();

// Navigate to different pages
function goToSettings() {
    setActivePage('settings');
}

function goHome() {
    resetToDefault();
}
</script>

<template>
    <div class="my-page">
        <!-- Show current page info -->
        <div>Current page: {{ pageId }}</div>
        <div v-if="isActive">This page is active!</div>
        
        <!-- Navigation buttons -->
        <button @click="goToSettings">Settings</button>
        <button @click="goHome">Home</button>
    </div>
</template>
```

---

## How to use it

### 1. Get page controls

```ts
const {
    pageId,           // string - Current active page ID
    isActive,         // boolean - Is this component's page active?
    setActivePage,    // Function - Navigate to a page
    resetToDefault,   // Function - Go to default page
} = useSidebarPageControls();
```

### 2. Navigate to other pages

```ts
// Navigate to a specific page
await setActivePage('settings');
await setActivePage('example-todo-page');

// Reset to home/default page
await resetToDefault();
```

### 3. Check page status

```vue
<template>
    <!-- Show content only when this page is active -->
    <div v-if="isActive" class="active-content">
        This content only shows when this page is the active sidebar page
    </div>
    
    <!-- Or use the page ID directly -->
    <div v-if="pageId === 'my-page-id'">
        Page-specific content
    </div>
</template>
```

### 4. Conditional navigation

```ts
// Only navigate if not already on that page
function navigateSafely(targetPageId: string) {
    if (pageId !== targetPageId) {
        setActivePage(targetPageId);
    }
}

// Toggle between two pages
function togglePages() {
    const target = pageId === 'page1' ? 'page2' : 'page1';
    setActivePage(target);
}
```

---

## What you get back

When you call `useSidebarPageControls()`, you get an object with:

| Property | Type | Description |
| --- | --- | --- |
| `pageId` | `string` | The ID of the currently active page |
| `isActive` | `boolean` | Whether the current component's page is active |
| `setActivePage` | `(id: string) => Promise<boolean>` | Navigate to a page, returns true if successful |
| `resetToDefault` | `() => Promise<boolean>` | Reset to default page, returns true if successful |

---

## Page ID Detection

The composable receives the page controls via Vue's injection system:

```ts
// The page controls are injected by the parent sidebar component
const controls = inject<SidebarPageControls>(SidebarPageControlsKey);
```

If no page controls are injected, it throws an error: `'useSidebarPageControls must be used within a component that provides SidebarPageControls'`.

---

## Navigation Behavior

### setActivePage(id)

- **Returns**: `Promise<boolean>` - `true` if navigation succeeded, `false` if vetoed
- **Side effects**: 
  - Updates global active page state
  - Triggers page activation hooks
  - Persists selection to localStorage
  - Fires hook events

### resetToDefault()

- **Returns**: `Promise<boolean>` - `true` if reset succeeded
- **Default page**: `'sidebar-home'` (or first registered page)
- **Behavior**: Same as `setActivePage('sidebar-home')`

---

## Common Patterns

### Page-specific initialization

```vue
<script setup>
import { onMounted } from 'vue';
import { useSidebarPageControls } from '~/composables/sidebar';

const { isActive } = useSidebarPageControls();

// Only initialize when page becomes active
onMounted(() => {
    if (isActive) {
        initializePageData();
    }
});

// Watch for activation changes (note: isActive is a boolean, not a ref)
// If you need reactivity, use the useSidebarPageState composable instead
</script>
```

### Navigation buttons

```vue
<template>
    <nav class="page-nav">
        <button 
            v-for="page in availablePages"
            :key="page.id"
            :class="{ active: pageId === page.id }"
            @click="() => setActivePage(page.id)"
        >
            {{ page.label }}
        </button>
    </nav>
</template>

<script setup>
const { pageId, setActivePage } = useSidebarPageControls();

const availablePages = [
    { id: 'home', label: 'Home' },
    { id: 'todos', label: 'Todos' },
    { id: 'settings', label: 'Settings' },
];
</script>
```

### Breadcrumb navigation

```vue
<script setup>
import { computed } from 'vue';
import { useSidebarPageControls } from '~/composables/sidebar';

const { pageId, setActivePage } = useSidebarPageControls();

const breadcrumb = computed(() => {
    const path = [];
    const current = pageId;
    
    if (current.startsWith('project-')) {
        path.push({ id: 'projects', label: 'Projects' });
        path.push({ id: current, label: 'Project Details' });
    } else if (current.startsWith('doc-')) {
        path.push({ id: 'docs', label: 'Documents' });
        path.push({ id: current, label: 'Document' });
    } else {
        path.push({ id: current, label: current });
    }
    
    return path;
});

function navigateTo(crumb) {
    setActivePage(crumb.id);
}
</script>

<template>
    <nav class="breadcrumb">
        <span 
            v-for="(crumb, index) in breadcrumb"
            :key="crumb.id"
            class="crumb"
        >
            <button 
                v-if="index < breadcrumb.length - 1"
                @click="navigateTo(crumb)"
            >
                {{ crumb.label }}
            </button>
            <span v-else class="current">{{ crumb.label }}</span>
        </span>
    </nav>
</template>
```

### Conditional rendering based on activation

```vue
<template>
    <div class="page-content">
        <!-- Loading state when not active -->
        <div v-if="!isActive" class="inactive-placeholder">
            <p>Page is not active</p>
        </div>
        
        <!-- Main content when active -->
        <div v-else class="active-content">
            <h1>Page Title</h1>
            <p>This content only renders when the page is active</p>
            
            <!-- Heavy components only load when active -->
            <HeavyChart v-if="isActive" />
            <DataTable v-if="isActive" :data="pageData" />
        </div>
    </div>
</template>

<script setup>
import { ref, watch } from 'vue';
import { useSidebarPageControls } from '~/composables/sidebar';

// Only load data when page is active
// Note: Since composables return static values, you may need to 
// use other reactive patterns or call the composable again if needed
const { isActive } = useSidebarPageControls();

// For reactive patterns, consider using the page activation hooks
// or other state management approaches
</script>
```

### Integration with multi-pane

```vue
<script setup>
import { useSidebarPageControls, useSidebarEnvironment } from '~/composables/sidebar';

const { pageId, setActivePage } = useSidebarPageControls();
const { getMultiPane } = useSidebarEnvironment();

async function openInPane() {
    const multiPane = getMultiPane();
    if (multiPane) {
        // Open current page content in a pane
        await multiPane.openApp(pageId);
    }
}

async function switchAndOpen(targetPageId: string) {
    // First switch sidebar page
    await setActivePage(targetPageId);
    
    // Then open corresponding pane
    const multiPane = getMultiPane();
    if (multiPane) {
        await multiPane.openApp(targetPageId);
    }
}
</script>

<template>
    <div class="page-actions">
        <button @click="openInPane">Open in Pane</button>
        <button @click="() => switchAndOpen('todos')">
            Go to Todos & Open Pane
        </button>
    </div>
</template>
```

---

## Error Handling

The composable handles navigation errors gracefully:

```ts
const { setActivePage } = useSidebarPageControls();

try {
    const success = await setActivePage('target-page');
    if (!success) {
        console.log('Navigation was vetoed by page guard');
        // Show user feedback or fallback behavior
    }
} catch (error) {
    console.error('Navigation failed:', error);
    // Handle unexpected errors
}
```

---

## Integration with Page Lifecycle

The composable works seamlessly with page lifecycle hooks:

```ts
// Page registration with hooks
registerSidebarPage({
    id: 'my-page',
    label: 'My Page',
    component: MyPageComponent,
    
    onActivate(ctx) {
        console.log('Page is activating:', ctx.page.id);
        // Initialize page-specific resources
    },
    
    onDeactivate(ctx) {
        console.log('Page is deactivating:', ctx.page.id);
        // Cleanup page-specific resources
    },
    
    canActivate(ctx) {
        // Guard: only allow if user has permission
        return userHasPermission(ctx.page.id);
    },
});
```

## Additional Helper Functions

The composable also provides several helper functions for common use cases:

### useIsActivePage(pageId: string)

Returns a boolean indicating if the specified page is currently active.

```ts
const isSettingsActive = useIsActivePage('settings');
```

### useActivePageId()

Returns the current active page ID as a string.

```ts
const currentPageId = useActivePageId();
```

### useSwitchToPage(pageId: string)

Switches to a specific page with built-in error handling.

```ts
const success = await useSwitchToPage('settings');
```

### useResetToDefaultPage()

Resets to the default page with built-in error handling.

```ts
const success = await useResetToDefaultPage();
```

### useSidebarPageState()

Provides a comprehensive state object with both current state and helper functions.

```ts
const {
    activePageId,      // string - Current active page ID
    isActive,          // boolean - Static active status
    setActivePage,     // Function - Navigate to a page
    resetToDefault,    // Function - Go to default page
    switchToPage,      // Function - Helper to switch pages
    resetToDefaultPage, // Function - Helper to reset to default
    isActivePage,      // Function - Helper to check if page is active
    getActivePageId,   // Function - Helper to get active page ID
} = useSidebarPageState();
```

---

## Important Notes

### Static Values

Both `useSidebarPageControls()` and `useSidebarPageState()` return static values (`pageId` and `isActive` as primitive types). The values represent the state at the time the composable is called.

### Error Handling

If the composable is used outside of a component that provides `SidebarPageControls`, it will throw an error. Make sure you're using it within the proper sidebar context.

---

## Troubleshooting

### `pageId` is always 'unknown'

This usually means the page ID wasn't injected properly. Check:

1. The page is registered with `registerSidebarPage()`
2. The page component is rendered within the sidebar context
3. The parent component calls `provide('sidebar-page-id', pageId)`

### Navigation always returns false

Check if the target page has a `canActivate` guard that's rejecting the activation:

```ts
registerSidebarPage({
    id: 'my-page',
    canActivate(ctx) {
        console.log('Guard called, returning:', canActivate);
        return canActivate; // Make sure this returns true
    },
});
```

### `isActive` is never true

Ensure the page ID being injected matches the current active page ID. Check the page registration and injection setup.

---

## Related

- `useActiveSidebarPage` - Core page state management
- `registerSidebarPage` - Page registration with HMR cleanup
- `useSidebarEnvironment` - Access to sidebar context and data
- `useSidebarPages` - Page discovery and management
- `useSidebarMultiPane` - Multi-pane workspace integration

---

## TypeScript

Full type signature:

```ts
function useSidebarPageControls(): SidebarPageControls;

interface SidebarPageControls {
    pageId: string;
    isActive: boolean;
    setActivePage: (id: string) => Promise<boolean>;
    resetToDefault: () => Promise<boolean>;
}
```

---

## Example: Complete Page Component

```vue
<template>
    <div class="my-page">
        <!-- Page header -->
        <header class="page-header">
            <h1>{{ pageTitle }}</h1>
            <div class="page-actions">
                <button @click="refreshData" :disabled="loading">
                    Refresh
                </button>
                <button @click="openInPane">
                    Open in Pane
                </button>
                <button @click="goHome">
                    Back to Home
                </button>
            </div>
        </header>

        <!-- Page status -->
        <div v-if="!isActive" class="inactive-notice">
            <p>This page is not currently active</p>
        </div>

        <!-- Main content -->
        <main v-else class="page-content">
            <!-- Loading state -->
            <div v-if="loading" class="loading">
                <p>Loading page data...</p>
            </div>

            <!-- Error state -->
            <div v-else-if="error" class="error">
                <p>Failed to load data: {{ error.message }}</p>
                <button @click="refreshData">Retry</button>
            </div>

            <!-- Content -->
            <div v-else class="content">
                <div class="stats">
                    <div class="stat">
                        <span class="label">Items:</span>
                        <span class="value">{{ data?.items?.length || 0 }}</span>
                    </div>
                    <div class="stat">
                        <span class="label">Last Updated:</span>
                        <span class="value">{{ lastUpdated }}</span>
                    </div>
                </div>

                <div class="data-list">
                    <div 
                        v-for="item in data?.items"
                        :key="item.id"
                        class="item"
                        @click="selectItem(item)"
                    >
                        <h3>{{ item.title }}</h3>
                        <p>{{ item.description }}</p>
                    </div>
                </div>
            </div>
        </main>

        <!-- Navigation -->
        <nav class="page-nav">
            <button 
                v-for="page in relatedPages"
                :key="page.id"
                :class="{ active: pageId === page.id }"
                @click="navigateToPage(page.id)"
            >
                {{ page.label }}
            </button>
        </nav>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { 
    useSidebarPageControls, 
    useSidebarEnvironment 
} from '~/composables/sidebar';

// Get controls and environment
const { pageId, isActive, setActivePage, resetToDefault } = useSidebarPageControls();
const { getMultiPane } = useSidebarEnvironment();

// Page state
const loading = ref(false);
const error = ref(null);
const data = ref(null);
const lastUpdated = ref(null);

// Computed values
const pageTitle = computed(() => {
    return `My Page (${pageId})`;
});

const relatedPages = [
    { id: 'home', label: 'Home' },
    { id: 'settings', label: 'Settings' },
    { id: 'todos', label: 'Todos' },
];

// Methods
async function loadData() {
    if (!isActive.value) return;
    
    loading.value = true;
    error.value = null;
    
    try {
        // Simulate API call
        await new Promise(resolve => setTimeout(resolve, 1000));
        data.value = {
            items: [
                { id: 1, title: 'Item 1', description: 'Description 1' },
                { id: 2, title: 'Item 2', description: 'Description 2' },
                { id: 3, title: 'Item 3', description: 'Description 3' },
            ],
        };
        lastUpdated.value = new Date().toLocaleTimeString();
    } catch (err) {
        error.value = err;
    } finally {
        loading.value = false;
    }
}

async function refreshData() {
    await loadData();
}

async function navigateToPage(targetPageId: string) {
    if (pageId === targetPageId) return;
    
    const success = await setActivePage(targetPageId);
    if (!success) {
        console.warn('Navigation to', targetPageId, 'was vetoed');
    }
}

function selectItem(item: any) {
    console.log('Selected item:', item);
    // Handle item selection
}

async function openInPane() {
    const multiPane = getMultiPane();
    if (multiPane) {
        await multiPane.openApp(pageId);
    }
}

function goHome() {
    resetToDefault();
}

// Lifecycle
// Note: Since composables return static values, use page activation hooks
// for lifecycle management instead of watching isActive
onMounted(() => {
    if (isActive) {
        loadData();
    }
});
</script>

<style scoped>
.my-page {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 1rem;
}

.page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--border);
}

.page-actions {
    display: flex;
    gap: 0.5rem;
}

.page-actions button {
    padding: 0.5rem 1rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--surface);
    cursor: pointer;
}

.page-actions button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.inactive-notice {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 200px;
    opacity: 0.7;
}

.page-content {
    flex: 1;
    overflow-y: auto;
}

.loading, .error {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 200px;
}

.error {
    color: var(--error);
}

.stats {
    display: flex;
    gap: 2rem;
    margin-bottom: 1rem;
    padding: 1rem;
    background: var(--surface);
    border-radius: 4px;
}

.stat {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
}

.stat .label {
    font-size: 0.875rem;
    opacity: 0.7;
}

.stat .value {
    font-weight: 600;
}

.data-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.item {
    padding: 1rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
    transition: background-color 0.2s;
}

.item:hover {
    background: var(--surface-hover);
}

.item h3 {
    margin: 0 0 0.5rem 0;
}

.item p {
    margin: 0;
    opacity: 0.7;
}

.page-nav {
    display: flex;
    gap: 0.5rem;
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border);
}

.page-nav button {
    padding: 0.5rem 1rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--surface);
    cursor: pointer;
}

.page-nav button.active {
    background: var(--primary);
    color: white;
}
</style>
```

---

Document generated from `app/composables/sidebar/useSidebarPageControls.ts` implementation.
