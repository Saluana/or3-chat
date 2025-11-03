# useSidebarEnvironment

Provides dependency injection and context access for sidebar components. Creates a reactive environment with access to multi-pane API, data sources, and UI controls.

Think of `useSidebarEnvironment` as the sidebar's service locator — it gives child components access to everything they need without prop drilling or global dependencies.

---

## Purpose

`useSidebarEnvironment` is the context provider for the sidebar ecosystem. When you need to:

-   Access the multi-pane workspace API from sidebar pages
-   Read or modify sidebar data (projects, threads, documents)
-   Control sidebar UI state (sections, search query, etc.)
-   Provide a clean API to child components without prop drilling
-   Ensure consistent data access across the sidebar

...this composable provides the context and helpers.

---

## Basic Example

Here's the simplest way to use it:

```vue
<script setup>
import { useSidebarEnvironment } from '~/composables/sidebar';

// Get access to sidebar context
const env = useSidebarEnvironment();

// Access data and controls
const projects = env.getProjects();
const threads = env.getThreads();
const multiPane = env.getMultiPane();

// Modify state
env.setSidebarQuery('search term');
env.setActiveSections({ projects: true, chats: false, docs: true });
</script>

<template>
    <div>
        <!-- Use data from environment -->
        <div>Found {{ projects.length }} projects</div>
        <div>Search: {{ env.getSidebarQuery() }}</div>

        <!-- Use multi-pane API -->
        <button @click="() => multiPane.openApp('example-todo')">
            Open Todo App
        </button>
    </div>
</template>
```

---

## How to use it

### 1. Access the environment

```ts
const env = useSidebarEnvironment();
```

### 2. Get data sources

```ts
// Reactive data collections
const projects = env.getProjects(); // Ref<Project[]>
const threads = env.getThreads(); // Ref<Thread[]>
const documents = env.getDocuments(); // Ref<Document[]>
const sections = env.getSections(); // Ref<SidebarSections>
const footerActions = env.getSidebarFooterActions(); // Ref<FooterAction[]>

// UI state
const query = env.getSidebarQuery(); // Ref<string>
const activeSections = env.getActiveSections(); // Ref<{projects, chats, docs}>
const expandedProjects = env.getExpandedProjects(); // Ref<string[]>
const activeThreadIds = env.getActiveThreadIds(); // Ref<string[]>
const activeDocumentIds = env.getActiveDocumentIds(); // Ref<string[]>
```

### 3. Modify state

```ts
// Update search query
env.setSidebarQuery('new search term');

// Toggle section visibility
env.setActiveSections({
    projects: true,
    chats: false,
    docs: true,
});

// Update expanded projects
env.setExpandedProjects(['project-1', 'project-2']);

// Set active selections
env.setActiveThreadIds(['thread-123']);
env.setActiveDocumentIds(['doc-456']);
```

### 4. Access multi-pane API

```ts
const multiPane = env.getMultiPane();

// Open new panes
await multiPane.openApp('example-todo', { initialRecordId: 'todo-123' });
await multiPane.openChat('thread-456');
await multiPane.openDoc('document-789');

// Control existing panes
multiPane.setActive(0); // Focus first pane
multiPane.closePane(1); // Close second pane

// Update pane properties
multiPane.updatePane(0, { mode: 'chat', threadId: 'new-thread' });
```

### 5. Access pane plugin API

```ts
const pluginApi = env.getPanePluginApi();

if (pluginApi?.posts) {
    // Create posts via plugin API
    const result = await pluginApi.posts.create({
        postType: 'example-todo',
        title: 'New Todo',
        content: 'Description here',
    });
}
```

### 6. Access page controls

```ts
const { pageId, isActive, setActivePage, resetToDefault } =
    useSidebarPageControls();

// Check if current page is active
if (isActive) {
    console.log('Current page:', pageId);
}

// Switch to a different page
await setActivePage('settings');

// Reset to default page
await resetToDefault();
```

---

## What you get back

When you call `useSidebarEnvironment()`, you get an object with:

| Property                        | Type                               | Description                    |
| ------------------------------- | ---------------------------------- | ------------------------------ |
| **Data Accessors**              |                                    |                                |
| `getProjects()`                 | `() => Ref<Project[]>`             | Reactive projects list         |
| `getThreads()`                  | `() => Ref<Thread[]>`              | Reactive threads list          |
| `getDocuments()`                | `() => Ref<Post[]>`                | Reactive documents list        |
| `getSections()`                 | `() => ComputedRef<SidebarSectionGroups>` | Sidebar section components     |
| `getSidebarFooterActions()`     | `() => ComputedRef<SidebarFooterActionEntry[]>` | Footer action buttons          |
| **State Control**               |                                    |                                |
| `getSidebarQuery()`             | `() => Ref<string>`                | Current search query           |
| `setSidebarQuery(value)`        | `(value: string) => void`          | Update search query            |
| `getActiveSections()`           | `() => Ref<{projects: boolean, chats: boolean, docs: boolean}>` | Visible sections               |
| `setActiveSections(sections)`   | `(sections: {projects: boolean, chats: boolean, docs: boolean}) => void` | Update visible sections        |
| `getExpandedProjects()`         | `() => Ref<string[]>`              | Expanded project IDs           |
| `setExpandedProjects(projects)` | `(projects: string[]) => void`     | Update expanded projects       |
| `getActiveThreadIds()`          | `() => Ref<string[]>`              | Active thread selections       |
| `setActiveThreadIds(ids)`       | `(ids: string[]) => void`          | Update active threads          |
| `getActiveDocumentIds()`        | `() => Ref<string[]>`              | Active document selections     |
| `setActiveDocumentIds(ids)`     | `(ids: string[]) => void`          | Update active documents        |
| **API Access**                  |                                    |                                |
| `getMultiPane()`                | `() => SidebarMultiPaneApi`        | Multi-pane workspace API       |
| `getPanePluginApi()`            | `() => PanePluginApi | null`       | Pane plugin API                |
| **Page Controls**               |                                    |                                |
| `pageId`                        | `string | null`                     | Current page identifier        |
| `isActive`                      | `boolean`                          | Whether current page is active |
| `setActivePage(id)`             | `(id: string) => Promise<boolean>` | Switch to different page       |
| `resetToDefault()`              | `() => Promise<boolean>`           | Reset to default page          |

---

## Environment Interface

### SidebarEnvironment

```ts
interface SidebarEnvironment {
    // Data accessors (return reactive refs)
    getProjects(): Ref<Project[]>;
    getThreads(): Ref<Thread[]>;
    getDocuments(): Ref<Post[]>;
    getSections(): ComputedRef<SidebarSectionGroups>;
    getSidebarFooterActions(): ComputedRef<SidebarFooterActionEntry[]>;

    // UI state control
    getSidebarQuery(): Ref<string>;
    setSidebarQuery(value: string): void;
    getActiveSections(): Ref<{
        projects: boolean;
        chats: boolean;
        docs: boolean;
    }>;
    setActiveSections(sections: {
        projects: boolean;
        chats: boolean;
        docs: boolean;
    }): void;
    getExpandedProjects(): Ref<string[]>;
    setExpandedProjects(projects: string[]): void;
    getActiveThreadIds(): Ref<string[]>;
    setActiveThreadIds(ids: string[]): void;
    getActiveDocumentIds(): Ref<string[]>;
    setActiveDocumentIds(ids: string[]): void;

    // API access
    getMultiPane(): SidebarMultiPaneApi;
    getPanePluginApi(): PanePluginApi | null;
}

interface SidebarPageControls {
    pageId: string | null;
    isActive: boolean;
    setActivePage: (id: string) => Promise<boolean>;
    resetToDefault: () => Promise<boolean>;
}
```

### SidebarMultiPaneApi

```ts
interface SidebarMultiPaneApi {
    openApp: (
        appId: string,
        opts?: { initialRecordId?: string }
    ) => Promise<void>;
    switchToApp: (appId: string, opts?: { recordId?: string }) => Promise<void>;
    openChat: (threadId?: string) => Promise<void>;
    openDoc: (documentId?: string) => Promise<void>;
    closePane: (index: number) => Promise<void> | void;
    setActive: (index: number) => void;
    panes: Ref<PaneState[]>;
    activePaneId: Ref<string | null>;
    updatePane: (index: number, updates: Partial<PaneState>) => void;
}
```

**Key Methods:**

-   **`openApp(appId, opts?)`**: Opens app in a new pane (adds to workspace)
    -   `opts.initialRecordId` - Optional record ID to open with the app
-   **`switchToApp(appId, opts?)`**: Switches the active pane to the app (no new pane created)
    -   `opts.recordId` - Optional record ID to open with the app
-   **`openChat(threadId?)`**: Opens or creates a chat thread
-   **`openDoc(documentId?)`**: Opens a document pane in doc mode with optional document ID
-   **`closePane(index)`**: Closes the pane at the given index
-   **`setActive(index)`**: Makes the pane at the given index active
-   **`updatePane(index, updates)`**: Updates pane properties without replacing it

---

## Providing the Environment

Usually you don't create the environment yourself — `SideNavContent.vue` provides it:

```vue
<!-- In SideNavContent.vue -->
<script setup>
import {
    provideSidebarEnvironment,
    provideSidebarPageControls,
    createSidebarMultiPaneApi,
} from '~/composables/sidebar';

// Create environment
const environment: SidebarEnvironment = {
    getMultiPane: () => sidebarMultiPaneApi,
    getProjects: () => projectsRef,
    getThreads: () => threadsRef,
    // ... other implementations
};

// Create page controls
const pageControls: SidebarPageControls = {
    pageId: 'projects',
    isActive: computed(() => currentPage.value === 'projects'),
    setActivePage: async (id: string) => {
        currentPage.value = id;
        return true;
    },
    resetToDefault: async () => {
        currentPage.value = 'projects';
        return true;
    },
};

// Provide to child components
provideSidebarEnvironment(environment);
provideSidebarPageControls(pageControls);
</script>
```

---

## Helper Composables

`useSidebarEnvironment` also provides specialized helpers for common use cases:

### Individual data helpers

```ts
// Each returns a reactive ref
const projects = useSidebarProjects();
const threads = useSidebarThreads();
const documents = useSidebarDocuments();
const sections = useSidebarSections();
const footerActions = useSidebarFooterActions();
```

### State helpers

```ts
// Return getter + setter pairs
const { query, setQuery } = useSidebarQuery();
const { activeSections, setActiveSections } = useActiveSections();
const { expandedProjects, setExpandedProjects } = useExpandedProjects();
const { activeThreadIds, setActiveThreadIds } = useActiveThreadIds();
const { activeDocumentIds, setActiveDocumentIds } = useActiveDocumentIds();
```

### API helpers

```ts
const multiPane = useSidebarMultiPane();
const postsApi = useSidebarPostsApi();
```

### Page control helpers

```ts
const { pageId, isActive, setActivePage, resetToDefault } =
    useSidebarPageControls();
```

---

## Common Patterns

### Sidebar page component

```vue
<script setup>
import {
    useSidebarEnvironment,
    useSidebarPageControls,
} from '~/composables/sidebar';

// Get environment and controls
const env = useSidebarEnvironment();
const { pageId, isActive, setActivePage, resetToDefault } =
    useSidebarPageControls();

// Access data
const projects = env.getProjects();
const threads = env.getThreads();
const multiPane = env.getMultiPane();

// Handle interactions
async function openProject(projectId: string) {
    await multiPane.openApp('project-viewer', { initialRecordId: projectId });
}

function search(query: string) {
    env.setSidebarQuery(query);
}

// Page navigation
async function goToSettings() {
    await setActivePage('settings');
}
</script>
```

### Custom sidebar section

```vue
<script setup>
import { useSidebarProjects, useSidebarMultiPane } from '~/composables/sidebar';

// Get specific data needed
const projects = useSidebarProjects();
const multiPane = useSidebarMultiPane();

// Filter and display projects
const myProjects = computed(() =>
    projects.value.filter((p) => p.owner === 'me')
);

async function openProject(project) {
    await multiPane.openApp('project-detail', {
        initialRecordId: project.id,
    });
}
</script>
```

### Responsive sidebar controls

```vue
<script setup>
import { useSidebarEnvironment } from '~/composables/sidebar';

const env = useSidebarEnvironment();
const isMobile = useResponsiveState().isMobile;

// Auto-collapse sections on mobile
watch(
    isMobile,
    (mobile) => {
        if (mobile) {
            env.setActiveSections({
                projects: false,
                chats: true,
                docs: false,
            });
        }
    },
    { immediate: true }
);
</script>
```

---

## Integration with Multi-Pane

The environment provides a simplified multi-pane API tailored for sidebar use:

```ts
const multiPane = env.getMultiPane();

// Open apps in new panes (adds to workspace)
await multiPane.openApp('todo-app');
await multiPane.openApp('note-editor', { initialRecordId: 'note-123' });

// Switch active pane to an app (no new pane created)
await multiPane.switchToApp('snake-game');
await multiPane.switchToApp('todo-app', { recordId: 'todo-456' });

// Quick pane control
multiPane.setActive(0); // Focus first pane
multiPane.closePane(2); // Close third pane

// Check pane state
console.log(multiPane.panes.value); // All panes
console.log(multiPane.activePaneId.value); // Currently active pane
```

**When to use each:**

-   **`openApp()`**: When you want to add a new pane to the workspace (e.g., "open in new tab" behavior)
-   **`switchToApp()`**: When you want to replace the current pane's content (e.g., navigation within current context)

---

## Error Handling

The environment handles missing dependencies gracefully:

```ts
const env = useSidebarEnvironment();

// Multi-pane API might not be available during initialization
const multiPane = env.getMultiPane();
if (!multiPane) {
    console.warn('Multi-pane API not available yet');
}

// Plugin API is optional
const pluginApi = env.getPanePluginApi();
if (pluginApi?.posts) {
    // Use plugin API
} else {
    // Fallback behavior
}
```

---

## Important Notes

### Injection Requirements

`useSidebarEnvironment` must be used within a component that provides the environment. Typically this means using it inside sidebar components or pages.

### Reactive Data

All data accessors return reactive refs, so your components will automatically update when the underlying data changes.

### State Synchronization

The environment ensures all sidebar components see the same state. When one component modifies the state, all others immediately reflect the change.

### Multi-Pane Integration

The multi-pane API provided by the environment is a simplified version of the full API, optimized for common sidebar operations.

---

## Troubleshooting

### "useSidebarEnvironment must be used within a component that provides SidebarEnvironment"

This error means you're trying to use the composable outside of the sidebar context. Make sure:

1. You're using it within a sidebar component or page
2. The parent component has called `provideSidebarEnvironment()`
3. You're not using it during SSR/server-side rendering

### Multi-pane API is null

The multi-pane API might not be available during initial setup. Check for null before using:

```ts
const multiPane = env.getMultiPane();
if (multiPane) {
    await multiPane.openApp('my-app');
}
```

### Data not updating

Ensure you're accessing the reactive refs, not the values directly:

```ts
// Correct - reactive
const projects = env.getProjects();

// Incorrect - not reactive
const projects = env.getProjects().value;
```

---

## Related

-   `provideSidebarEnvironment` - Create and provide the environment
-   `provideSidebarPageControls` - Create and provide page controls
-   `useSidebarPageControls` - Access page navigation controls
-   `useSidebarMultiPane` - Direct access to multi-pane API
-   `useActiveSidebarPage` - Manage active page state
-   `createSidebarMultiPaneApi` - Create the multi-pane adapter

---

## TypeScript

Full type signature:

```ts
function useSidebarEnvironment(): SidebarEnvironment;

interface SidebarEnvironment {
    getMultiPane(): SidebarMultiPaneApi;
    getPanePluginApi(): PanePluginApi | null;
    getProjects(): Ref<Project[]>;
    getThreads(): Ref<Thread[]>;
    getDocuments(): Ref<Post[]>;
    getSections(): ComputedRef<SidebarSectionGroups>;
    getSidebarQuery(): Ref<string>;
    setSidebarQuery(value: string): void;
    getActiveSections(): Ref<{
        projects: boolean;
        chats: boolean;
        docs: boolean;
    }>;
    setActiveSections(sections: {
        projects: boolean;
        chats: boolean;
        docs: boolean;
    }): void;
    getExpandedProjects(): Ref<string[]>;
    setExpandedProjects(projects: string[]): void;
    getActiveThreadIds(): Ref<string[]>;
    setActiveThreadIds(ids: string[]): void;
    getActiveDocumentIds(): Ref<string[]>;
    setActiveDocumentIds(ids: string[]): void;
    getSidebarFooterActions(): ComputedRef<SidebarFooterActionEntry[]>;
}

function useSidebarPageControls(): SidebarPageControls;

interface SidebarPageControls {
    pageId: string | null;
    isActive: boolean;
    setActivePage: (id: string) => Promise<boolean>;
    resetToDefault: () => Promise<boolean>;
}

function provideSidebarEnvironment(environment: SidebarEnvironment): void;
function provideSidebarPageControls(controls: SidebarPageControls): void;
```

---

## Example: Custom Sidebar Page

```vue
<template>
    <div class="my-sidebar-page">
        <!-- Search control -->
        <div class="search-bar">
            <input
                v-model="searchQuery"
                placeholder="Search projects..."
                @input="updateSearch"
            />
        </div>

        <!-- Project list -->
        <div class="project-list">
            <div
                v-for="project in filteredProjects"
                :key="project.id"
                class="project-item"
                @click="openProject(project)"
            >
                <h3>{{ project.title }}</h3>
                <p>{{ project.description }}</p>
            </div>
        </div>

        <!-- Actions -->
        <div class="actions">
            <button @click="createNewProject">New Project</button>
            <button @click="toggleSection">Toggle Sections</button>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import {
    useSidebarEnvironment,
    useSidebarPageControls,
    useSidebarProjects,
} from '~/composables/sidebar';

// Get environment and page controls
const env = useSidebarEnvironment();
const { pageId, isActive, setActivePage } = useSidebarPageControls();
const projects = useSidebarProjects();

// Local state
const searchQuery = ref('');

// Computed filtered list
const filteredProjects = computed(() => {
    const query = searchQuery.value.toLowerCase();
    return projects.value.filter(
        (project) =>
            project.title.toLowerCase().includes(query) ||
            project.description?.toLowerCase().includes(query)
    );
});

// Actions
function updateSearch() {
    env.setSidebarQuery(searchQuery.value);
}

async function openProject(project: any) {
    const multiPane = env.getMultiPane();
    if (multiPane) {
        await multiPane.openApp('project-detail', {
            initialRecordId: project.id,
        });
    }
}

async function createNewProject() {
    const pluginApi = env.getPanePluginApi();
    if (pluginApi?.posts) {
        const result = await pluginApi.posts.create({
            postType: 'project',
            title: 'New Project',
            content: '',
        });

        if (result.ok) {
            await openProject({ id: result.id });
        }
    }
}

function toggleSection() {
    const current = env.getActiveSections().value;
    env.setActiveSections({
        ...current,
        projects: !current.projects,
    });
}

async function goToSettings() {
    await setActivePage('settings');
}
</script>

<style scoped>
.my-sidebar-page {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 1rem;
    gap: 1rem;
}

.search-bar input {
    width: 100%;
    padding: 0.5rem;
    border: 1px solid var(--border);
    border-radius: 4px;
}

.project-list {
    flex: 1;
    overflow-y: auto;
}

.project-item {
    padding: 0.75rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
    margin-bottom: 0.5rem;
}

.project-item:hover {
    background: var(--surface-hover);
}

.actions {
    display: flex;
    gap: 0.5rem;
}

.actions button {
    padding: 0.5rem 1rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--surface);
    cursor: pointer;
}
</style>
```

---

Document generated from `app/composables/sidebar/useSidebarEnvironment.ts` implementation.
