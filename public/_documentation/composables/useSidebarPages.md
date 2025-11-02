# useSidebarPages

Registry and discovery system for sidebar pages. Manages page registration, provides listing functionality, and handles HMR cleanup for dynamic page management.

Think of `useSidebarPages` as the sidebar's page directory — it tracks all available pages, handles registration, and provides the tools to discover and manage sidebar pages.

---

## Purpose

`useSidebarPages` is the central registry for sidebar pages. When you need to:

-   Register new sidebar pages with proper lifecycle management
-   Get a list of all available sidebar pages
-   Find specific pages by ID or criteria
-   Handle HMR cleanup for dynamic page updates
-   Manage page metadata and capabilities

...this composable provides the registry and discovery tools.

---

## Basic Example

Here's the simplest way to use it:

```vue
<script setup>
import { useSidebarPages } from '~/composables/sidebar';

// Get page registry functions
const { listSidebarPages, getSidebarPage } = useSidebarPages();

// List all pages
const allPages = listSidebarPages.value;

// Check if a page exists
const hasTodos = !!getSidebarPage('example-todo-page');

// Get a specific page
const todosPage = getSidebarPage('example-todo-page');
</script>

<template>
    <div>
        <!-- Show all available pages -->
        <div v-for="page in listSidebarPages.value" :key="page.id">
            {{ page.label }} ({{ page.id }})
        </div>
        
        <!-- Conditional rendering -->
        <div v-if="hasTodos">
            Todo page is available!
        </div>
    </div>
</template>
```

---

## How to use it

### 1. Get registry functions

```ts
const {
    listSidebarPages,    // ComputedRef<RegisteredSidebarPage[]> - All pages
    getSidebarPage,      // (id: string) => RegisteredSidebarPage | undefined
    registerSidebarPage, // (page: SidebarPageDef) => () => void - Returns cleanup function
    unregisterSidebarPage, // (id: string) => void
} = useSidebarPages();
```

### 2. List all pages

```ts
// Get reactive list of all pages
const pages = listSidebarPages.value;

// Filter pages by criteria
const pagesWithIcons = pages.filter(page => page.icon);
const pagesInOrder = pages.sort((a, b) => (a.order || 0) - (b.order || 0));

// Group pages by order ranges
const pagesByOrderRange = pages.reduce((groups, page) => {
    const range = page.order < 100 ? 'early' : page.order < 200 ? 'middle' : 'late';
    groups[range] = groups[range] || [];
    groups[range].push(page);
    return groups;
}, {});
```

### 3. Find specific pages

```ts
// Check if page exists
const page = getSidebarPage('my-page');
if (page) {
    console.log('Page label:', page.label);
    console.log('Page component:', page.component);
}
```

### 4. Register pages (usually done via helper)

```ts
// Direct registration (not recommended - use registerSidebarPage helper)
const cleanup = registerSidebarPage({
    id: 'my-page',
    label: 'My Page',
    icon: 'my-icon', // Required field
    component: MyPageComponent,
    order: 100,
});

// Later cleanup if needed
cleanup();
```

---

## What you get back

When you call `useSidebarPages()`, you get an object with:

| Property | Type | Description |
| --- | --- | --- |
| `listSidebarPages` | `ComputedRef<RegisteredSidebarPage[]>` | Reactive list of all registered pages |
| `getSidebarPage` | `(id: string) => RegisteredSidebarPage \| undefined` | Get a specific page by ID |
| `registerSidebarPage` | `(page: SidebarPageDef) => () => void` | Register a new page, returns cleanup function |
| `unregisterSidebarPage` | `(id: string) => void` | Remove a page from registry |

---

## Page Definition

### SidebarPageDef (Input for registration)

```ts
interface SidebarPageDef {
    id: string;                           // Unique page identifier
    label: string;                        // Display label for UI
    icon: string;                         // Required icon name
    order?: number;                       // Sort order (default: 200)
    component: Component | (() => Promise<any>); // Vue component or async loader
    keepAlive?: boolean;                  // Opt-in caching for the component
    usesDefaultHeader?: boolean;          // Whether to show default header
    provideContext?: (ctx: SidebarPageContext) => void; // Context provider
    canActivate?: (ctx: SidebarActivateContext) => boolean | Promise<boolean>; // Guard
    onActivate?: (ctx: SidebarActivateContext) => void | Promise<void>;     // Lifecycle hook
    onDeactivate?: (ctx: SidebarActivateContext) => void | Promise<void>;   // Lifecycle hook
}
```

### RegisteredSidebarPage (Internal representation)

```ts
interface RegisteredSidebarPage extends SidebarPageDef {
    // All SidebarPageDef fields, with component already wrapped/normalized
}
```

### SidebarPageContext

```ts
interface SidebarPageContext {
    page: SidebarPageDef;           // The page being registered
    expose: (api: any) => void;     // Function to expose page API
}
```

### SidebarActivateContext

```ts
interface SidebarActivateContext {
    page: SidebarPageDef;           // The page being activated
    previousPage: SidebarPageDef | null; // Previous page
    isCollapsed: boolean;          // Current sidebar state
    multiPane: any;                // Multi-pane API (untyped)
    panePluginApi: any;            // Pane plugin API (untyped)
}
```

---

## Registration Process

### Global Registry

Pages are stored in a global registry on `globalThis.__or3SidebarPagesRegistry`:

```ts
// Registry structure
const registry: Map<string, RegisteredSidebarPage> = new Map();

// Reactive version tracking for Vue reactivity
const reactiveRegistry = reactive<{ version: number }>({ version: 0 });
```

### Reactivity System

The registry uses a version-based reactivity system:

1. **Version tracking**: A reactive version number triggers Vue updates
2. **Automatic sorting**: Pages are automatically sorted by order when listed
3. **Component normalization**: Async components are wrapped with `defineAsyncComponent`

---

## Common Patterns

### Page discovery and rendering

```vue
<script setup>
import { useSidebarPages } from '~/composables/sidebar';

const { listSidebarPages } = useSidebarPages();

// Group pages by order ranges
const pagesByOrderRange = computed(() => {
    const pages = listSidebarPages.value;
    return pages.reduce((groups, page) => {
        const range = page.order < 100 ? 'early' : page.order < 200 ? 'middle' : 'late';
        groups[range] = groups[range] || [];
        groups[range].push(page);
        return groups;
    }, {});
});

// Sort pages within each range
const sortedPagesByOrderRange = computed(() => {
    const groups = pagesByOrderRange.value;
    Object.keys(groups).forEach(range => {
        groups[range].sort((a, b) => (a.order || 0) - (b.order || 0));
    });
    return groups;
});
</script>

<template>
    <div class="page-directory">
        <div v-for="(pages, range) in sortedPagesByOrderRange" :key="range">
            <h3>{{ range }} pages</h3>
            <div class="page-list">
                <div v-for="page in pages" :key="page.id" class="page-item">
                    <UIcon v-if="page.icon" :name="page.icon" />
                    <span>{{ page.label }}</span>
                    <small>({{ page.id }})</small>
                </div>
            </div>
        </div>
    </div>
</template>
```

### Page availability checking

```vue
<script setup>
import { useSidebarPages, useSidebarPageControls } from '~/composables/sidebar';

const { getSidebarPage } = useSidebarPages();
const { setActivePage } = useSidebarPageControls();

// Conditional navigation
function navigateIfAvailable(pageId: string, fallbackId: string) {
    const page = getSidebarPage(pageId);
    if (page) {
        setActivePage(pageId);
    } else {
        console.warn(`Page ${pageId} not available, using fallback`);
        setActivePage(fallbackId);
    }
}

// Feature availability
const advancedFeaturesAvailable = computed(() => {
    return !!getSidebarPage('advanced-settings') && 
           !!getSidebarPage('analytics-dashboard');
});
</script>

<template>
    <div class="navigation">
        <button @click="() => navigateIfAvailable('todos', 'home')">
            Todos
        </button>
        
        <div v-if="advancedFeaturesAvailable" class="advanced-section">
            <button @click="() => setActivePage('advanced-settings')">
                Advanced Settings
            </button>
            <button @click="() => setActivePage('analytics-dashboard')">
                Analytics
            </button>
        </div>
    </div>
</template>
```

### Dynamic page registration

```ts
// Plugin that registers pages conditionally
export function registerFeaturePages() {
    const { registerSidebarPage } = useSidebarPages();
    
    const cleanups: (() => void)[] = [];
    
    // Only register if user has permission
    if (userHasFeature('advanced-mode')) {
        const cleanup = registerSidebarPage({
            id: 'advanced-mode',
            label: 'Advanced Mode',
            icon: 'settings',
            component: AdvancedModePage,
            order: 200,
            
            canActivate(ctx) {
                return userHasFeature('advanced-mode');
            },
        });
        cleanups.push(cleanup);
    }
    
    // Register analytics page
    if (userHasFeature('analytics')) {
        const cleanup = registerSidebarPage({
            id: 'analytics',
            label: 'Analytics',
            icon: 'chart',
            component: AnalyticsPage,
            order: 150,
        });
        cleanups.push(cleanup);
    }
    
    // Return cleanup function
    return () => cleanups.forEach(cleanup => cleanup());
}

// Cleanup function for HMR
export const unregisterFeaturePages = registerFeaturePages(); // Immediately register and get cleanup
```

### Page metadata extraction

```ts
// Utility to extract page information
export function getPageMetadata() {
    const { listSidebarPages } = useSidebarPages();
    
    const pages = listSidebarPages.value;
    
    return {
        total: pages.length,
        orderRanges: [...new Set(pages.map(p => 
            p.order < 100 ? 'early' : p.order < 200 ? 'middle' : 'late'
        ))],
        pagesWithIcons: pages.filter(p => p.icon).length,
        pagesWithGuards: pages.filter(p => p.canActivate).length,
        pagesWithLifecycle: pages.filter(p => p.onActivate || p.onDeactivate).length,
        
        // Page summary
        summary: pages.map(page => ({
            id: page.id,
            label: page.label,
            order: page.order,
            hasIcon: !!page.icon,
            hasGuard: !!page.canActivate,
            hasLifecycle: !!(page.onActivate || page.onDeactivate),
        })),
    };
}
```

---

## Integration with Other Composables

### With useActiveSidebarPage

```ts
const { listSidebarPages } = useSidebarPages();
const { activePageId } = useActiveSidebarPage();

// Get current active page definition
const currentPage = computed(() => {
    const pages = listSidebarPages.value;
    return pages.find(p => p.id === activePageId.value) || null;
});

// Get next/previous pages for navigation
const navigationPages = computed(() => {
    const pages = listSidebarPages.value.sort((a, b) => (a.order || 0) - (b.order || 0));
    const currentIndex = pages.findIndex(p => p.id === activePageId.value);
    
    return {
        previous: pages[currentIndex - 1] || null,
        next: pages[currentIndex + 1] || null,
    };
});
```

### With useSidebarEnvironment

```ts
const { listSidebarPages } = useSidebarPages();
const { getMultiPane } = useSidebarEnvironment();

// Open page in pane if supported
async function openPageInPane(pageId: string) {
    const page = getSidebarPage(pageId);
    if (!page) return false;
    
    const multiPane = getMultiPane();
    if (multiPane) {
        await multiPane.openApp(pageId);
        return true;
    }
    
    return false;
}

// Get pages that support pane integration
const paneCompatiblePages = computed(() => {
    return listSidebarPages.value.filter(page => 
        page.id.startsWith('app-') || page.order >= 300
    );
});
```

---

## Error Handling

The registry handles errors gracefully:

```ts
const { getSidebarPage } = useSidebarPages();

// Safe page lookup
function safeGetPage(pageId: string) {
    const page = getSidebarPage(pageId);
    if (!page) {
        console.warn(`Page ${pageId} not found`);
        return null;
    }
    return page;
}

// Defensive programming
function navigateToPage(pageId: string) {
    if (!getSidebarPage(pageId)) {
        console.error(`Cannot navigate: page ${pageId} not registered`);
        return false;
    }
    
    // Proceed with navigation
    return true;
}
```

---

## Important Notes

### Global State

The registry uses global state, so all components see the same list of pages. This is intentional for consistency across the sidebar.

### HMR Safety

The registry automatically handles HMR cleanup. Pages registered during development are properly cleaned up when modules reload.

### ID Uniqueness

Page IDs must be unique. Registering a page with an existing ID will replace the previous registration.

### Component Handling

The registry automatically handles component wrapping:
- Async component loaders are wrapped with `defineAsyncComponent`
- Components are marked with `markRaw` to prevent unnecessary reactivity
- Timeout is set to 15 seconds with retry logic

### Default Values

- `order`: Defaults to 200 (not 0 as documented)
- `usesDefaultHeader`: Defaults to `true` for 'sidebar-home', `false` for others
- `icon`: Required field (not optional as documented)

---

## Troubleshooting

### Page not showing up in list

Check that:
1. The page was registered successfully
2. The page ID is unique
3. The registration happened before the list is accessed
4. No errors occurred during registration

### HMR cleanup not working

Ensure:
1. The registration is happening in a client-side plugin or component
2. The registration order is being tracked properly
3. The cleanup function is called during HMR

### Duplicate page registrations

This is expected behavior - the latest registration wins. Use unique IDs for different pages.

---

## Related

- `registerSidebarPage` - Enhanced page registration with HMR cleanup
- `useActiveSidebarPage` - Manage active page state
- `useSidebarPageControls` - Access navigation controls
- `useSidebarEnvironment` - Access sidebar context
- `useSidebarMultiPane` - Multi-pane integration

---

## TypeScript

Full type signature:

```ts
function useSidebarPages(): {
    listSidebarPages: ComputedRef<RegisteredSidebarPage[]>;
    getSidebarPage: (id: string) => RegisteredSidebarPage | undefined;
    registerSidebarPage: (page: SidebarPageDef) => () => void;
    unregisterSidebarPage: (id: string) => void;
};

interface SidebarPageDef {
    id: string;
    label: string;
    icon: string;
    order?: number;
    component: Component | (() => Promise<any>);
    keepAlive?: boolean;
    usesDefaultHeader?: boolean;
    provideContext?: (ctx: SidebarPageContext) => void;
    canActivate?: (ctx: SidebarActivateContext) => boolean | Promise<boolean>;
    onActivate?: (ctx: SidebarActivateContext) => void | Promise<void>;
    onDeactivate?: (ctx: SidebarActivateContext) => void | Promise<void>;
}

interface RegisteredSidebarPage extends SidebarPageDef {
    // Component is already wrapped/normalized
}
```

---

## Example: Complete Page Registry Management

```vue
<template>
    <div class="page-registry-manager">
        <!-- Registry stats -->
        <div class="registry-stats">
            <h3>Registry Statistics</h3>
            <div class="stats-grid">
                <div class="stat">
                    <span class="label">Total Pages:</span>
                    <span class="value">{{ stats.total }}</span>
                </div>
                <div class="stat">
                    <span class="label">Order Ranges:</span>
                    <span class="value">{{ stats.orderRanges.length }}</span>
                </div>
                <div class="stat">
                    <span class="label">With Icons:</span>
                    <span class="value">{{ stats.pagesWithIcons }}</span>
                </div>
                <div class="stat">
                    <span class="label">With Guards:</span>
                    <span class="value">{{ stats.pagesWithGuards }}</span>
                </div>
            </div>
        </div>

        <!-- Page list by order range -->
        <div class="page-list">
            <h3>Registered Pages</h3>
            <div v-for="(pages, range) in pagesByOrderRange" :key="range" class="order-range">
                <h4>{{ range }} ({{ pages.length }})</h4>
                <div class="pages">
                    <div 
                        v-for="page in pages" 
                        :key="page.id" 
                        class="page-item"
                        :class="{ 
                            'has-icon': page.icon,
                            'has-guard': page.canActivate,
                            'has-lifecycle': page.onActivate || page.onDeactivate
                        }"
                    >
                        <div class="page-info">
                            <UIcon v-if="page.icon" :name="page.icon" class="page-icon" />
                            <span class="page-label">{{ page.label }}</span>
                            <span class="page-id">{{ page.id }}</span>
                        </div>
                        <div class="page-meta">
                            <span v-if="page.order" class="order">Order: {{ page.order }}</span>
                            <span v-if="page.canActivate" class="guard">Guard</span>
                            <span v-if="page.onActivate || page.onDeactivate" class="lifecycle">Lifecycle</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Test controls -->
        <div class="test-controls">
            <h3>Test Controls</h3>
            <div class="controls">
                <input 
                    v-model="testPageId" 
                    placeholder="Page ID to test"
                    @keyup.enter="testPage"
                />
                <button @click="testPage" :disabled="!testPageId.trim()">
                    Test Page
                </button>
                <button @click="registerTestPage">
                    Register Test Page
                </button>
                <button @click="unregisterTestPage">
                    Unregister Test Page
                </button>
            </div>
            <div v-if="testResult" class="test-result">
                {{ testResult }}
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useSidebarPages, useSidebarPageControls } from '~/composables/sidebar';

// Get registry functions
const { 
    listSidebarPages, 
    getSidebarPage, 
    registerSidebarPage,
    unregisterSidebarPage 
} = useSidebarPages();

const { setActivePage } = useSidebarPageControls();

// Test state
const testPageId = ref('');
const testResult = ref('');

// Computed stats
const stats = computed(() => {
    const pages = listSidebarPages.value;
    return {
        total: pages.length,
        orderRanges: [...new Set(pages.map(p => 
            p.order < 100 ? 'early' : p.order < 200 ? 'middle' : 'late'
        ))],
        pagesWithIcons: pages.filter(p => p.icon).length,
        pagesWithGuards: pages.filter(p => p.canActivate).length,
        pagesWithLifecycle: pages.filter(p => p.onActivate || p.onDeactivate).length,
    };
});

// Pages grouped by order range
const pagesByOrderRange = computed(() => {
    const pages = listSidebarPages.value;
    return pages.reduce((groups, page) => {
        const range = page.order < 100 ? 'early' : page.order < 200 ? 'middle' : 'late';
        groups[range] = groups[range] || [];
        groups[range].push(page);
        return groups;
    }, {});
});

// Test functions
async function testPage() {
    const pageId = testPageId.value.trim();
    if (!pageId) return;
    
    const page = getSidebarPage(pageId);
    if (page) {
        testResult.value = `Page found: ${page.label} (${pageId})`;
        
        // Try to navigate to it
        const success = await setActivePage(pageId);
        if (success) {
            testResult.value += ' - Navigation successful';
        } else {
            testResult.value += ' - Navigation vetoed';
        }
    } else {
        testResult.value = `Page not found: ${pageId}`;
    }
}

function registerTestPage() {
    const pageId = 'test-page-' + Date.now();
    
    const cleanup = registerSidebarPage({
        id: pageId,
        label: 'Test Page',
        component: { template: '<div>Test Page Content</div>' },
        icon: 'test',
        order: 999,
        
        onActivate(ctx) {
            console.log('Test page activated:', ctx);
        },
        
        onDeactivate(ctx) {
            console.log('Test page deactivated:', ctx);
        },
    });
    
    testPageId.value = pageId;
    testResult.value = `Registered test page: ${pageId}`;
    
    // Store cleanup for later (in a real app, you'd manage this properly)
    window.testPageCleanup = cleanup;
}

function unregisterTestPage() {
    const pageId = testPageId.value.trim();
    if (pageId && getSidebarPage(pageId)) {
        if (window.testPageCleanup) {
            window.testPageCleanup();
            window.testPageCleanup = undefined;
        } else {
            unregisterSidebarPage(pageId);
        }
        testResult.value = `Unregistered page: ${pageId}`;
        testPageId.value = '';
    } else {
        testResult.value = 'No page to unregister';
    }
}
</script>

<style scoped>
.page-registry-manager {
    display: flex;
    flex-direction: column;
    gap: 2rem;
    padding: 1rem;
}

.registry-stats {
    padding: 1rem;
    background: var(--surface);
    border-radius: 4px;
}

.stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 1rem;
    margin-top: 1rem;
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
    font-size: 1.5rem;
    font-weight: 600;
}

.page-list {
    flex: 1;
}

.order-range {
    margin-bottom: 2rem;
}

.order-range h4 {
    margin: 0 0 1rem 0;
    opacity: 0.8;
}

.pages {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.page-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--surface);
}

.page-item.has-icon {
    border-left: 3px solid var(--primary);
}

.page-item.has-guard {
    border-left: 3px solid var(--warning);
}

.page-item.has-lifecycle {
    border-left: 3px solid var(--success);
}

.page-info {
    display: flex;
    align-items: center;
    gap: 0.5rem;
}

.page-icon {
    opacity: 0.7;
}

.page-label {
    font-weight: 500;
}

.page-id {
    font-family: monospace;
    font-size: 0.875rem;
    opacity: 0.6;
}

.page-meta {
    display: flex;
    gap: 0.5rem;
    font-size: 0.75rem;
}

.order, .guard, .lifecycle {
    padding: 0.25rem 0.5rem;
    border-radius: 3px;
    background: var(--surface-hover);
}

.test-controls {
    padding: 1rem;
    background: var(--surface);
    border-radius: 4px;
}

.controls {
    display: flex;
    gap: 0.5rem;
    margin-top: 1rem;
}

.controls input {
    flex: 1;
    padding: 0.5rem;
    border: 1px solid var(--border);
    border-radius: 4px;
}

.controls button {
    padding: 0.5rem 1rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--surface);
    cursor: pointer;
}

.controls button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.test-result {
    margin-top: 1rem;
    padding: 0.5rem;
    background: var(--surface-hover);
    border-radius: 4px;
    font-family: monospace;
    font-size: 0.875rem;
}
</style>
```

---

Document generated from `app/composables/sidebar/useSidebarPages.ts` implementation.
