# Mini App Tutorial: Sidebar Page + Multi-Pane (V2)

Build a real mini app using the sidebar page registry, the multi-pane workspace, and the posts helpers that now ship with OR3. By the end you will have:

-   A registered pane app (`example-todo`) that opens inside the workspace.
-   A registered sidebar page (`example-todo-page`) that appears in the collapsed navigation and lists todos.
-   Live post data sourced from Dexie via `usePostsList`, with create/update flows wired through the pane plugin API.

Everything in this tutorial maps directly to the code in the repository—no hypothetical APIs.

---

## Prerequisites

-   OR3 running locally (`bun dev`). The tutorial only touches client code.
-   Familiarity with Vue single-file components and Nuxt plugins.
-   Access to the shared posts table (already provided by the app).

> **Tip:** A complete implementation ships in `app/plugins/custom-pane-todo-example.client.ts`. Use it as a reference while you work through the steps below.

---

## 1. Create a Client Plugin Skeleton

Create `app/plugins/example-todo.client.ts` and start with the imports and plugin wrapper:

```ts
// app/plugins/example-todo.client.ts
import { defineComponent, h, ref, computed, onMounted, watch } from 'vue';
import { usePaneApps } from '~/composables/core/usePaneApps';
import {
    useSidebarMultiPane,
    useSidebarPageControls,
    useSidebarPostsApi,
} from '~/composables/sidebar';
import { usePostsList } from '~/composables/posts/usePostsList';

export default defineNuxtPlugin(async () => {
    if (!process.client) return;

    const { registerPaneApp } = usePaneApps();
    const { registerSidebarPage } = await import(
        '~/composables/sidebar/registerSidebarPage'
    );

    // Components and registrations go here...
});
```

Everything else in the tutorial lives inside this plugin file for clarity, but you can extract components later if you prefer.

---

## 2. Define the Workspace Pane (`example-todo`)

Create a lightweight pane component that edits a single todo record. The pane receives a `postApi` helper (wired automatically by `PageShell`) plus the current record id.

```ts
const TodoPaneComponent = defineComponent({
    name: 'TodoPane',
    props: {
        paneId: { type: String, required: true },
        recordId: { type: String, default: null },
        postType: { type: String, required: true },
        postApi: { type: Object, required: true },
    },
    setup(props) {
        const title = ref('');
        const description = ref('');
        const completed = ref(false);
        const loading = ref(true);
        const saving = ref(false);
        const error = ref<string | null>(null);

        async function loadTodo(recordId: string | null) {
            if (!props.postApi || !props.postApi.listByType) {
                error.value = 'Posts API unavailable';
                loading.value = false;
                return;
            }

            // Blank state when no record id yet
            if (!recordId) {
                title.value = '';
                description.value = '';
                completed.value = false;
                loading.value = false;
                return;
            }

            loading.value = true;
            error.value = null;

            try {
                const result = await props.postApi.listByType({
                    postType: props.postType,
                });

                if (result.ok) {
                    const todo = result.posts.find(
                        (p: any) => p.id === recordId
                    );
                    if (todo) {
                        title.value = todo.title;
                        description.value = todo.content || '';
                        completed.value = todo.meta?.completed || false;
                    } else {
                        error.value = 'Todo not found';
                    }
                } else {
                    error.value = result.message || 'Load failed';
                }
            } catch (err) {
                error.value = 'Failed to load todo';
                console.error('[TodoPane] load failed:', err);
            } finally {
                loading.value = false;
            }
        }

        onMounted(() => {
            loadTodo(props.recordId ?? null);
        });

        watch(
            () => props.recordId,
            (next, prev) => {
                if (next !== prev) loadTodo(next ?? null);
            }
        );

        async function saveTodo() {
            if (!title.value.trim()) {
                error.value = 'Title is required';
                return;
            }

            saving.value = true;
            error.value = null;

            try {
                if (props.recordId) {
                    const result = await props.postApi.update({
                        id: props.recordId,
                        patch: {
                            title: title.value,
                            content: description.value,
                            meta: { completed: completed.value },
                        },
                        source: 'example:todo-pane',
                    });

                    if (!result.ok) error.value = result.message;
                } else {
                    const result = await props.postApi.create({
                        postType: props.postType,
                        title: title.value,
                        content: description.value,
                        meta: { completed: completed.value },
                        source: 'example:todo-pane',
                    });

                    if (!result.ok) error.value = result.message;
                }
            } catch (err) {
                error.value = 'Failed to save todo';
                console.error('[TodoPane] save failed:', err);
            } finally {
                saving.value = false;
            }
        }

        async function toggleCompleted() {
            completed.value = !completed.value;
            await saveTodo();
        }

        return {
            title,
            description,
            completed,
            loading,
            saving,
            error,
            saveTodo,
            toggleCompleted,
        };
    },
    render() {
        if (this.loading) {
            return h(
                'div',
                { class: 'flex items-center justify-center h-full' },
                [h('div', { class: 'text-sm opacity-50' }, 'Loading...')]
            );
        }

        return h('div', { class: 'flex flex-col h-full bg-surface' }, [
            h(
                'div',
                { class: 'flex items-center gap-3 p-4 border-b border-border' },
                [h('span', { class: 'font-medium' }, 'Todo')]
            ),
            h('div', { class: 'flex-1 overflow-auto p-4 space-y-4' }, [
                this.error
                    ? h(
                          'div',
                          {
                              class: 'p-3 bg-red-500/10 border border-red-500/20 rounded text-sm text-red-500',
                          },
                          this.error
                      )
                    : null,
                h('div', { class: 'flex items-center gap-2' }, [
                    h('input', {
                        type: 'checkbox',
                        checked: this.completed,
                        onChange: this.toggleCompleted,
                        class: 'w-4 h-4',
                    }),
                    h('span', { class: 'text-sm' }, 'Completed'),
                ]),
                h('div', { class: 'space-y-2' }, [
                    h('label', { class: 'text-sm font-medium' }, 'Title'),
                    h('input', {
                        class: 'w-full px-2 py-1 border border-border rounded bg-background',
                        value: this.title,
                        placeholder: 'Enter todo title...',
                        onInput: (event: any) =>
                            (this.title = event?.target?.value ?? ''),
                    }),
                ]),
                h('div', { class: 'space-y-2' }, [
                    h('label', { class: 'text-sm font-medium' }, 'Description'),
                    h('textarea', {
                        class: 'w-full px-2 py-1 border border-border rounded bg-background',
                        value: this.description,
                        placeholder: 'Enter description...',
                        rows: 8,
                        onInput: (event: any) =>
                            (this.description = event?.target?.value ?? ''),
                    }),
                ]),
            ]),
            h(
                'div',
                {
                    class: 'flex items-center justify-end gap-2 p-4 border-t border-border',
                },
                [
                    h(
                        'button',
                        {
                            class: 'px-3 py-1 text-sm border border-border rounded bg-[var(--md-surface-variant)] hover:bg-[var(--md-surface-variant)]/80 transition disabled:opacity-60',
                            disabled: this.saving || !this.title.trim(),
                            onClick: this.saveTodo,
                        },
                        this.saving ? 'Saving...' : 'Save'
                    ),
                ]
            ),
        ]);
    },
});
```

When the pane is opened without an existing record, the component renders an empty form and creates a record on save. The `createInitialRecord` hook (added in the registration step) can pre-populate the record id.

---

## 3. Define the Sidebar Page (`example-todo-page`)

The sidebar page lists todos using Dexie’s live data and opens panes through the multi-pane adapter. It also exposes a quick link back to the default sidebar page via `useSidebarPageControls`.

```ts
const TodoSidebarPage = defineComponent({
    name: 'TodoSidebarPage',
    setup() {
        const { items, loading, error, refresh } = usePostsList('example-todo');
        const multiPane = useSidebarMultiPane();
        const { resetToDefault } = useSidebarPageControls();
        const postsApi = useSidebarPostsApi();
        const query = ref('');

        const filtered = computed(() =>
            items.value.filter((post) =>
                (post.title || '')
                    .toLowerCase()
                    .includes(query.value.toLowerCase())
            )
        );

        async function openTodo(id: string) {
            await multiPane.openApp('example-todo', { initialRecordId: id });
        }

        async function createTodo() {
            if (!postsApi?.posts) return;
            const result = await postsApi.posts.create({
                postType: 'example-todo',
                title: 'New Todo',
                content: '',
                meta: { completed: false },
                source: 'example:todo-sidebar',
            });
            if (result.ok) {
                await openTodo(result.id);
                await refresh();
            }
        }

        return {
            items,
            filtered,
            loading,
            error,
            refresh,
            query,
            openTodo,
            resetToDefault,
            createTodo,
        };
    },
    render() {
        return h('div', { class: 'flex flex-col h-full gap-3 p-3' }, [
            h('header', { class: 'flex items-center gap-2' }, [
                h('span', { class: 'font-medium' }, 'Todos'),
                h('div', { class: 'flex-1' }),
                h(
                    'button',
                    {
                        class: 'px-2 py-1 text-xs border border-border rounded hover:bg-[var(--md-inverse-surface)]/10 transition',
                        onClick: this.resetToDefault,
                    },
                    'Home'
                ),
                h(
                    'button',
                    {
                        class: 'px-2 py-1 text-xs border border-border rounded hover:bg-[var(--md-inverse-surface)]/10 transition',
                        onClick: this.refresh,
                    },
                    'Refresh'
                ),
                h(
                    'button',
                    {
                        class: 'px-2 py-1 text-xs border border-border rounded bg-[var(--md-surface-variant)] hover:bg-[var(--md-surface-variant)]/80 transition',
                        onClick: this.createTodo,
                    },
                    'New'
                ),
            ]),
            h('input', {
                class: 'px-2 py-1 text-sm border border-border rounded bg-background',
                modelValue: this.query,
                'onUpdate:modelValue': (val: string) => (this.query = val),
                placeholder: 'Filter todos...',
                onInput: (event: any) =>
                    (this.query = event?.target?.value ?? ''),
            }),
            this.error
                ? h(
                      'div',
                      { class: 'p-2 text-sm text-red-500/80' },
                      String(this.error)
                  )
                : null,
            this.loading
                ? h(
                      'div',
                      {
                          class: 'flex-1 flex items-center justify-center text-sm opacity-70',
                      },
                      'Loading...'
                  )
                : this.filtered.length
                ? h(
                      'div',
                      { class: 'flex-1 overflow-auto flex flex-col gap-2' },
                      this.filtered.map((post: any) =>
                          h(
                              'button',
                              {
                                  key: post.id,
                                  class: 'text-left p-2 border border-border rounded hover:bg-[var(--md-inverse-surface)]/10 transition',
                                  onClick: () => this.openTodo(post.id),
                              },
                              [
                                  h(
                                      'div',
                                      { class: 'font-medium' },
                                      post.title || '(Untitled)'
                                  ),
                                  h(
                                      'div',
                                      { class: 'text-xs opacity-70' },
                                      (post.meta as any)?.completed
                                          ? 'Completed'
                                          : 'Pending'
                                  ),
                              ]
                          )
                      )
                  )
                : h(
                      'div',
                      {
                          class: 'flex-1 flex items-center justify-center text-sm opacity-70',
                      },
                      'No todos yet'
                  ),
        ]);
    },
});
```

The page uses the sidebar environment helpers exclusively—no prop drilling from `SideNavContent.vue` is required.

---

## 4. Register the Pane App and Sidebar Page

Add the registrations at the bottom of the plugin. The helper handles HMR cleanup automatically.

```ts
registerPaneApp({
    id: 'example-todo',
    label: 'Todo',
    icon: 'pixelarticons:checkbox',
    component: TodoPaneComponent,
    postType: 'example-todo',
    async createInitialRecord() {
        const api = (globalThis as any).__or3PanePluginApi;
        if (!api?.posts) throw new Error('Pane plugin API not available');

        const result = await api.posts.create({
            postType: 'example-todo',
            title: 'New Todo',
            content: '',
            meta: { completed: false },
            source: 'example:todo-app',
        });

        if (!result.ok) throw new Error(result.message);
        return { id: result.id };
    },
});

registerSidebarPage({
    id: 'example-todo-page',
    label: 'Todos',
    icon: 'pixelarticons:list',
    order: 210,
    keepAlive: true,
    usesDefaultHeader: false,
    component: () => Promise.resolve(TodoSidebarPage),
});
```

Place the snippet before the closing `try/catch` (or wrap the whole plugin body with `try` if you want error logging like the shipped example).

> **HMR note:** `registerSidebarPage` unregisters itself on module dispose by default. If you capture the return value (`const cleanup = registerSidebarPage(...)`) you can perform additional cleanup, but it is not required.

---

## 5. Verify the Mini App

1. Restart (or hot reload) your dev server if needed: `bun dev`.
2. Click the sidebar toggle to open the collapsed navigation—`Todos` appears with the icon you provided.
3. Selecting the button activates `example-todo-page`. The default sidebar header hides because `usesDefaultHeader` is `false`.
4. Click **New** to create a todo. A workspace pane opens (`example-todo`), the record is persisted, and the list updates in place thanks to `usePostsList`.
5. Switch back to the default sidebar view with the **Home** action, or select another todo to open it in the multi-pane workspace.

If you need to reuse an existing pane instead of opening a new one each time, call `multiPane.updatePane(index, updates)`—the adapter exposes it via `useSidebarMultiPane()`.

---

## Optional Enhancements

-   **Reuse panes:** Search `custom-pane-todo-example.client.ts` for `updatePane` to see how to replace the active pane when it is blank.
-   **Additional lifecycle hooks:** Pass `canActivate`, `onActivate`, or `onDeactivate` to `registerSidebarPage` to gate navigation or run setup/cleanup logic.
-   **Posts helper shorthand:** `registerSidebarPage.withPosts` wraps the context exposure with post helpers if you need a structured integration.
-   **Analytics:** Activation automatically fires the `ui.sidebar.page:action:open` hook; register a listener via `$hooks` to record usage.

---

## Key APIs Recap

| API                      | Location                                    | Purpose                                                                  |
| ------------------------ | ------------------------------------------- | ------------------------------------------------------------------------ |
| `usePaneApps`            | `~/composables/core/usePaneApps`            | Register workspace pane apps (`registerPaneApp`).                        |
| `registerSidebarPage`    | `~/composables/sidebar/registerSidebarPage` | Register/deregister sidebar pages with HMR guardrails.                   |
| `useSidebarMultiPane`    | `~/composables/sidebar`                     | Trimmed multi-pane adapter (`openApp`, `updatePane`, `setActive`, etc.). |
| `useSidebarPageControls` | `~/composables/sidebar`                     | Access the current page id and navigate back to the default page.        |
| `useSidebarPostsApi`     | `~/composables/sidebar`                     | Provides the pane plugin API (posts CRUD).                               |
| `usePostsList`           | `~/composables/posts/usePostsList`          | Reactive Dexie query for posts of a given type.                          |

You now have a fully functioning mini app that exercises every part of the V2 sidebar page stack using code that ships in the repository today.# Building a Mini App: Multi-Pane + Sidebar + Custom Posts

Learn how to create a complete mini application in OR3 that integrates with the multi-pane workspace, adds sidebar pages, and uses custom post types for data storage.

We'll build a **Task Manager** mini app that demonstrates:

-   Creating custom post types for tasks
-   Registering sidebar pages for task management
-   Opening tasks in multi-pane panes
-   Integrating with the existing OR3 ecosystem

---

## Tutorial Overview

**What we'll build:**

-   Task Manager mini app with create, edit, and delete functionality
-   Custom post type for storing tasks
-   Sidebar page for browsing all tasks
-   Multi-pane integration for editing individual tasks
-   Proper HMR cleanup and error handling

**Prerequisites:**

-   Basic understanding of Vue.js and TypeScript
-   Familiarity with OR3's composables (helpful but not required)
-   Development environment set up

**Time to complete:** ~30 minutes

---

## Step 1: Define the Task Post Type

First, let's create a custom post type for our tasks. This will use OR3's existing posts system.

### Create the task type definition

```ts
// app/types/task.ts
export interface TaskPost {
    id: string;
    postType: 'task';
    title: string;
    content: string; // Task description
    meta: {
        status: 'todo' | 'in-progress' | 'done';
        priority: 'low' | 'medium' | 'high';
        dueDate?: string; // ISO date string
        tags: string[];
        createdAt: string;
        updatedAt: string;
    };
}
```

### Create task utilities

```ts
// app/utils/task-utils.ts
import type { TaskPost } from '~/types/task';
import { z } from 'zod';

// Validation schema
export const TaskSchema = z.object({
    postType: z.literal('task'),
    title: z.string().min(1).max(100),
    content: z.string().max(1000),
    meta: z.object({
        status: z.enum(['todo', 'in-progress', 'done']),
        priority: z.enum(['low', 'medium', 'high']),
        dueDate: z.string().optional(),
        tags: z.array(z.string()).default([]),
        createdAt: z.string(),
        updatedAt: z.string(),
    }),
});

// Helper functions
export function createTask(data: Partial<TaskPost>): TaskPost {
    const now = new Date().toISOString();

    return {
        id: '', // Will be set by database
        postType: 'task',
        title: data.title || '',
        content: data.content || '',
        meta: {
            status: 'todo',
            priority: 'medium',
            dueDate: data.dueDate,
            tags: data.tags || [],
            createdAt: now,
            updatedAt: now,
        },
    };
}

export function updateTask(
    task: TaskPost,
    updates: Partial<TaskPost>
): TaskPost {
    return {
        ...task,
        ...updates,
        meta: {
            ...task.meta,
            ...updates.meta,
            updatedAt: new Date().toISOString(),
        },
    };
}
```

---

## Step 2: Create Task Composables

Now let's create composables to manage our tasks.

### Task CRUD composable

```ts
// app/composables/tasks/useTasksCrud.ts
import { computed, ref } from 'vue';
import { db } from '~/db';
import type { TaskPost } from '~/types/task';
import { createTask, updateTask, TaskSchema } from '~/utils/task-utils';
import { reportError } from '~/utils/errors';

export function useTasksCrud() {
    const loading = ref(false);
    const error = ref<Error | null>(null);

    // Load all tasks
    async function loadTasks(): Promise<TaskPost[]> {
        loading.value = true;
        error.value = null;

        try {
            const tasks = await db.posts
                .where('postType')
                .equals('task')
                .toArray();

            return tasks as TaskPost[];
        } catch (err) {
            error.value = err as Error;
            reportError(err('ERR_DB_READ_FAILED', 'Failed to load tasks'), {
                toast: true,
            });
            return [];
        } finally {
            loading.value = false;
        }
    }

    // Create a new task
    async function createTask(
        taskData: Partial<TaskPost>
    ): Promise<TaskPost | null> {
        loading.value = true;
        error.value = null;

        try {
            const newTask = createTask(taskData);
            const validated = TaskSchema.parse(newTask);

            const id = await db.posts.add(validated);
            const created = await db.posts.get(id);

            return created as TaskPost;
        } catch (err) {
            error.value = err as Error;
            reportError(err('ERR_DB_WRITE_FAILED', 'Failed to create task'), {
                toast: true,
            });
            return null;
        } finally {
            loading.value = false;
        }
    }

    // Update an existing task
    async function updateTask(
        id: string,
        updates: Partial<TaskPost>
    ): Promise<TaskPost | null> {
        loading.value = true;
        error.value = null;

        try {
            const existing = (await db.posts.get(id)) as TaskPost;
            if (!existing) {
                throw new Error('Task not found');
            }

            const updated = updateTask(existing, updates);
            const validated = TaskSchema.parse(updated);

            await db.posts.update(id, validated);
            const result = await db.posts.get(id);

            return result as TaskPost;
        } catch (err) {
            error.value = err as Error;
            reportError(err('ERR_DB_WRITE_FAILED', 'Failed to update task'), {
                toast: true,
            });
            return null;
        } finally {
            loading.value = false;
        }
    }

    // Delete a task
    async function deleteTask(id: string): Promise<boolean> {
        loading.value = true;
        error.value = null;

        try {
            await db.posts.delete(id);
            return true;
        } catch (err) {
            error.value = err as Error;
            reportError(err('ERR_DB_WRITE_FAILED', 'Failed to delete task'), {
                toast: true,
            });
            return false;
        } finally {
            loading.value = false;
        }
    }

    return {
        loading: computed(() => loading.value),
        error: computed(() => error.value),
        loadTasks,
        createTask,
        updateTask,
        deleteTask,
    };
}
```

### Task list composable with filtering

```ts
// app/composables/tasks/useTaskList.ts
import { computed, ref, watch } from 'vue';
import { useTasksCrud } from './useTasksCrud';
import type { TaskPost } from '~/types/task';

export function useTaskList() {
    const tasks = ref<TaskPost[]>([]);
    const filter = ref<{
        status?: TaskPost['meta']['status'];
        priority?: TaskPost['meta']['priority'];
        search?: string;
    }>({});

    const { loadTasks, loading, error } = useTasksCrud();

    // Load tasks
    async function refreshTasks() {
        const loadedTasks = await loadTasks();
        tasks.value = loadedTasks;
    }

    // Filtered tasks
    const filteredTasks = computed(() => {
        let filtered = tasks.value;

        // Status filter
        if (filter.value.status) {
            filtered = filtered.filter(
                (task) => task.meta.status === filter.value.status
            );
        }

        // Priority filter
        if (filter.value.priority) {
            filtered = filtered.filter(
                (task) => task.meta.priority === filter.value.priority
            );
        }

        // Search filter
        if (filter.value.search) {
            const search = filter.value.search.toLowerCase();
            filtered = filtered.filter(
                (task) =>
                    task.title.toLowerCase().includes(search) ||
                    task.content.toLowerCase().includes(search) ||
                    task.meta.tags.some((tag) =>
                        tag.toLowerCase().includes(search)
                    )
            );
        }

        // Sort by priority and due date
        return filtered.sort((a, b) => {
            // Priority order: high > medium > low
            const priorityOrder = { high: 3, medium: 2, low: 1 };
            const priorityDiff =
                priorityOrder[b.meta.priority] - priorityOrder[a.meta.priority];

            if (priorityDiff !== 0) return priorityDiff;

            // Due date (earliest first)
            if (a.meta.dueDate && b.meta.dueDate) {
                return (
                    new Date(a.meta.dueDate).getTime() -
                    new Date(b.meta.dueDate).getTime()
                );
            }

            return 0;
        });
    });

    // Statistics
    const stats = computed(() => ({
        total: tasks.value.length,
        todo: tasks.value.filter((t) => t.meta.status === 'todo').length,
        inProgress: tasks.value.filter((t) => t.meta.status === 'in-progress')
            .length,
        done: tasks.value.filter((t) => t.meta.status === 'done').length,
        highPriority: tasks.value.filter((t) => t.meta.priority === 'high')
            .length,
    }));

    // Auto-refresh when filter changes
    watch(filter, refreshTasks, { deep: true });

    // Initial load
    refreshTasks();

    return {
        tasks: computed(() => tasks.value),
        filteredTasks,
        filter,
        stats,
        loading,
        error,
        refreshTasks,
    };
}
```

---

## Step 3: Create Task Components

Let's create the Vue components for our task manager.

### Task card component

```vue
<!-- app/components/tasks/TaskCard.vue -->
<template>
    <div
        class="task-card"
        :class="[
            `priority-${task.meta.priority}`,
            `status-${task.meta.status}`,
        ]"
    >
        <div class="task-header">
            <h3 class="task-title">{{ task.title }}</h3>
            <div class="task-badges">
                <span class="badge priority" :class="task.meta.priority">
                    {{ task.meta.priority }}
                </span>
                <span class="badge status" :class="task.meta.status">
                    {{ task.meta.status }}
                </span>
            </div>
        </div>

        <p class="task-description">{{ task.content }}</p>

        <div v-if="task.meta.tags.length" class="task-tags">
            <span v-for="tag in task.meta.tags" :key="tag" class="tag">
                {{ tag }}
            </span>
        </div>

        <div v-if="task.meta.dueDate" class="task-due-date">
            <UIcon name="calendar" />
            Due: {{ formatDate(task.meta.dueDate) }}
        </div>

        <div class="task-actions">
            <button @click="editTask" class="btn btn-primary">
                <UIcon name="edit" /> Edit
            </button>
            <button @click="deleteTask" class="btn btn-danger">
                <UIcon name="trash" /> Delete
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
import type { TaskPost } from '~/types/task';

interface Props {
    task: TaskPost;
}

interface Emits {
    edit: [task: TaskPost];
    delete: [taskId: string];
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

function editTask() {
    emit('edit', props.task);
}

function deleteTask() {
    emit('delete', props.task.id);
}

function formatDate(dateString: string) {
    return new Date(dateString).toLocaleDateString();
}
</script>

<style scoped>
.task-card {
    border: 2px solid var(--border);
    border-radius: 8px;
    padding: 1rem;
    margin-bottom: 1rem;
    background: var(--surface);
    transition: all 0.2s;
}

.task-card:hover {
    border-color: var(--primary);
    transform: translateY(-1px);
}

.task-card.priority-high {
    border-left: 4px solid var(--error);
}

.task-card.priority-medium {
    border-left: 4px solid var(--warning);
}

.task-card.priority-low {
    border-left: 4px solid var(--success);
}

.task-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 0.5rem;
}

.task-title {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 600;
}

.task-badges {
    display: flex;
    gap: 0.5rem;
}

.badge {
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
}

.badge.priority.high {
    background: var(--error);
    color: white;
}

.badge.priority.medium {
    background: var(--warning);
    color: white;
}

.badge.priority.low {
    background: var(--success);
    color: white;
}

.badge.status.todo {
    background: var(--surface-hover);
}

.badge.status.in-progress {
    background: var(--primary);
    color: white;
}

.badge.status.done {
    background: var(--success);
    color: white;
}

.task-description {
    margin: 0.5rem 0;
    color: var(--text-secondary);
    line-height: 1.5;
}

.task-tags {
    display: flex;
    gap: 0.5rem;
    margin: 0.5rem 0;
}

.tag {
    padding: 0.25rem 0.5rem;
    background: var(--surface-hover);
    border-radius: 4px;
    font-size: 0.875rem;
}

.task-due-date {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0.5rem 0;
    font-size: 0.875rem;
    color: var(--text-secondary);
}

.task-actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 1rem;
}

.btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--surface);
    cursor: pointer;
    font-size: 0.875rem;
    transition: all 0.2s;
}

.btn:hover {
    background: var(--surface-hover);
}

.btn-primary {
    background: var(--primary);
    color: white;
    border-color: var(--primary);
}

.btn-primary:hover {
    background: var(--primary-hover);
}

.btn-danger {
    background: var(--error);
    color: white;
    border-color: var(--error);
}

.btn-danger:hover {
    background: var(--error-hover);
}
</style>
```

### Task form component

```vue
<!-- app/components/tasks/TaskForm.vue -->
<template>
    <form @submit.prevent="handleSubmit" class="task-form">
        <div class="form-group">
            <label for="title">Title *</label>
            <input
                id="title"
                v-model="formData.title"
                type="text"
                required
                maxlength="100"
                placeholder="Enter task title..."
            />
        </div>

        <div class="form-group">
            <label for="description">Description</label>
            <textarea
                id="description"
                v-model="formData.content"
                maxlength="1000"
                rows="4"
                placeholder="Enter task description..."
            />
        </div>

        <div class="form-row">
            <div class="form-group">
                <label for="status">Status</label>
                <select id="status" v-model="formData.meta.status">
                    <option value="todo">To Do</option>
                    <option value="in-progress">In Progress</option>
                    <option value="done">Done</option>
                </select>
            </div>

            <div class="form-group">
                <label for="priority">Priority</label>
                <select id="priority" v-model="formData.meta.priority">
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                </select>
            </div>
        </div>

        <div class="form-group">
            <label for="dueDate">Due Date</label>
            <input id="dueDate" v-model="formData.meta.dueDate" type="date" />
        </div>

        <div class="form-group">
            <label for="tags">Tags (comma separated)</label>
            <input
                id="tags"
                v-model="tagsInput"
                type="text"
                placeholder="work, urgent, project-x"
            />
        </div>

        <div class="form-actions">
            <button type="submit" :disabled="loading" class="btn btn-primary">
                <UIcon v-if="loading" name="spinner" class="animate-spin" />
                {{ isEditing ? 'Update Task' : 'Create Task' }}
            </button>
            <button type="button" @click="resetForm" class="btn btn-secondary">
                Cancel
            </button>
        </div>
    </form>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { TaskPost } from '~/types/task';
import { createTask } from '~/utils/task-utils';

interface Props {
    task?: TaskPost | null;
    loading?: boolean;
}

interface Emits {
    submit: [task: Partial<TaskPost>];
    cancel: [];
}

const props = withDefaults(defineProps<Props>(), {
    loading: false,
});

const emit = defineEmits<Emits>();

// Form data
const formData = ref({
    title: '',
    content: '',
    meta: {
        status: 'todo' as TaskPost['meta']['status'],
        priority: 'medium' as TaskPost['meta']['priority'],
        dueDate: '',
        tags: [] as string[],
    },
});

const tagsInput = ref('');

// Computed
const isEditing = computed(() => !!props.task);

// Watch for task changes (when editing)
watch(
    () => props.task,
    (task) => {
        if (task) {
            formData.value = {
                title: task.title,
                content: task.content,
                meta: { ...task.meta },
            };
            tagsInput.value = task.meta.tags.join(', ');
        } else {
            resetForm();
        }
    },
    { immediate: true }
);

// Watch tags input to update array
watch(tagsInput, (input) => {
    formData.value.meta.tags = input
        .split(',')
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0);
});

// Methods
function handleSubmit() {
    const taskData = isEditing.value
        ? { ...props.task, ...formData.value }
        : createTask(formData.value);

    emit('submit', taskData);
}

function resetForm() {
    formData.value = {
        title: '',
        content: '',
        meta: {
            status: 'todo',
            priority: 'medium',
            dueDate: '',
            tags: [],
        },
    };
    tagsInput.value = '';
    emit('cancel');
}
</script>

<style scoped>
.task-form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
}

.form-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.form-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
}

.form-group label {
    font-weight: 600;
    color: var(--text);
}

.form-group input,
.form-group textarea,
.form-group select {
    padding: 0.75rem;
    border: 2px solid var(--border);
    border-radius: 4px;
    background: var(--surface);
    font-family: inherit;
    font-size: 1rem;
}

.form-group input:focus,
.form-group textarea:focus,
.form-group select:focus {
    outline: none;
    border-color: var(--primary);
}

.form-actions {
    display: flex;
    gap: 1rem;
    justify-content: flex-end;
    margin-top: 1rem;
}

.btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1.5rem;
    border: 2px solid var(--border);
    border-radius: 4px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
}

.btn-primary {
    background: var(--primary);
    color: white;
    border-color: var(--primary);
}

.btn-primary:hover:not(:disabled) {
    background: var(--primary-hover);
}

.btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.btn-secondary {
    background: var(--surface);
    color: var(--text);
}

.btn-secondary:hover {
    background: var(--surface-hover);
}

.animate-spin {
    animation: spin 1s linear infinite;
}

@keyframes spin {
    from {
        transform: rotate(0deg);
    }
    to {
        transform: rotate(360deg);
    }
}
</style>
```

---

## Step 4: Create Sidebar Pages

Now let's create the sidebar pages for our task manager.

### Task list sidebar page

```vue
<!-- app/components/tasks/TaskListPage.vue -->
<template>
    <div class="task-list-page">
        <!-- Page header -->
        <div class="page-header">
            <h2>Task Manager</h2>
            <button @click="createNewTask" class="btn btn-primary">
                <UIcon name="plus" /> New Task
            </button>
        </div>

        <!-- Statistics -->
        <div class="task-stats">
            <div class="stat">
                <span class="value">{{ stats.total }}</span>
                <span class="label">Total</span>
            </div>
            <div class="stat">
                <span class="value">{{ stats.todo }}</span>
                <span class="label">To Do</span>
            </div>
            <div class="stat">
                <span class="value">{{ stats.inProgress }}</span>
                <span class="label">In Progress</span>
            </div>
            <div class="stat">
                <span class="value">{{ stats.done }}</span>
                <span class="label">Done</span>
            </div>
        </div>

        <!-- Filters -->
        <div class="task-filters">
            <div class="filter-group">
                <label>Status:</label>
                <select v-model="filter.status">
                    <option value="">All</option>
                    <option value="todo">To Do</option>
                    <option value="in-progress">In Progress</option>
                    <option value="done">Done</option>
                </select>
            </div>
            <div class="filter-group">
                <label>Priority:</label>
                <select v-model="filter.priority">
                    <option value="">All</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                </select>
            </div>
            <div class="filter-group search">
                <label>Search:</label>
                <input
                    v-model="filter.search"
                    type="text"
                    placeholder="Search tasks..."
                />
            </div>
        </div>

        <!-- Task list -->
        <div class="task-list">
            <!-- Loading state -->
            <div v-if="loading" class="loading">
                <UIcon name="spinner" class="animate-spin" />
                Loading tasks...
            </div>

            <!-- Error state -->
            <div v-else-if="error" class="error">
                <p>Failed to load tasks: {{ error.message }}</p>
                <button @click="refreshTasks" class="btn btn-secondary">
                    Retry
                </button>
            </div>

            <!-- Empty state -->
            <div v-else-if="filteredTasks.length === 0" class="empty">
                <UIcon name="inbox" size="large" />
                <p>No tasks found</p>
                <button @click="createNewTask" class="btn btn-primary">
                    Create your first task
                </button>
            </div>

            <!-- Task cards -->
            <div v-else class="tasks">
                <TaskCard
                    v-for="task in filteredTasks"
                    :key="task.id"
                    :task="task"
                    @edit="editTask"
                    @delete="deleteTask"
                />
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { useTaskList } from '~/composables/tasks/useTaskList';
import { useTasksCrud } from '~/composables/tasks/useTasksCrud';
import { useSidebarEnvironment } from '~/composables/sidebar';
import type { TaskPost } from '~/types/task';

// Get task list functionality
const { filteredTasks, stats, filter, loading, error, refreshTasks } =
    useTaskList();

const { deleteTask: deleteTaskById } = useTasksCrud();

// Get sidebar environment for multi-pane integration
const { getMultiPane } = useSidebarEnvironment();

// Methods
async function createNewTask() {
    const multiPane = getMultiPane();
    if (multiPane) {
        await multiPane.openApp('task-editor');
    }
}

async function editTask(task: TaskPost) {
    const multiPane = getMultiPane();
    if (multiPane) {
        await multiPane.openApp('task-editor', {
            initialRecordId: task.id,
        });
    }
}

async function deleteTask(taskId: string) {
    if (confirm('Are you sure you want to delete this task?')) {
        const success = await deleteTaskById(taskId);
        if (success) {
            await refreshTasks();
        }
    }
}
</script>

<style scoped>
.task-list-page {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 1rem;
    gap: 1rem;
}

.page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-bottom: 1rem;
    border-bottom: 2px solid var(--border);
}

.page-header h2 {
    margin: 0;
    color: var(--text);
}

.task-stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1rem;
    padding: 1rem;
    background: var(--surface);
    border-radius: 8px;
    border: 2px solid var(--border);
}

.stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
}

.stat .value {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--primary);
}

.stat .label {
    font-size: 0.875rem;
    color: var(--text-secondary);
    text-transform: uppercase;
}

.task-filters {
    display: grid;
    grid-template-columns: 1fr 1fr 2fr;
    gap: 1rem;
    padding: 1rem;
    background: var(--surface);
    border-radius: 8px;
    border: 2px solid var(--border);
}

.filter-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.filter-group label {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text);
}

.filter-group select,
.filter-group input {
    padding: 0.5rem;
    border: 2px solid var(--border);
    border-radius: 4px;
    background: var(--surface);
    font-family: inherit;
}

.task-list {
    flex: 1;
    overflow-y: auto;
}

.loading,
.error,
.empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 200px;
    gap: 1rem;
    color: var(--text-secondary);
}

.error {
    color: var(--error);
}

.btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1.5rem;
    border: 2px solid var(--border);
    border-radius: 4px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
}

.btn-primary {
    background: var(--primary);
    color: white;
    border-color: var(--primary);
}

.btn-primary:hover {
    background: var(--primary-hover);
}

.btn-secondary {
    background: var(--surface);
    color: var(--text);
}

.btn-secondary:hover {
    background: var(--surface-hover);
}

.animate-spin {
    animation: spin 1s linear infinite;
}

@keyframes spin {
    from {
        transform: rotate(0deg);
    }
    to {
        transform: rotate(360deg);
    }
}
</style>
```

---

## Step 5: Create Multi-Pane Task Editor

Now let's create the task editor that opens in multi-pane.

### Task editor pane component

```vue
<!-- app/components/tasks/TaskEditorPane.vue -->
<template>
    <div class="task-editor-pane">
        <!-- Loading state -->
        <div v-if="loading" class="loading">
            <UIcon name="spinner" class="animate-spin" />
            Loading task...
        </div>

        <!-- Error state -->
        <div v-else-if="error" class="error">
            <p>Failed to load task: {{ error.message }}</p>
            <button @click="loadTask" class="btn btn-secondary">Retry</button>
        </div>

        <!-- Task form -->
        <div v-else class="editor-content">
            <div class="editor-header">
                <h2>{{ isEditing ? 'Edit Task' : 'Create Task' }}</h2>
                <button @click="closePane" class="btn btn-icon">
                    <UIcon name="x" />
                </button>
            </div>

            <TaskForm
                :task="currentTask"
                :loading="saving"
                @submit="handleSave"
                @cancel="closePane"
            />
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useTasksCrud } from '~/composables/tasks/useTasksCrud';
import { usePanePluginApi } from '~/composables/sidebar';
import type { TaskPost } from '~/types/task';

interface Props {
    recordId?: string; // Task ID for editing
}

const props = defineProps<Props>();

// Get CRUD functions
const { createTask, updateTask } = useTasksCrud();

// Get pane plugin API for pane management
const panePluginApi = usePanePluginApi();

// State
const currentTask = ref<TaskPost | null>(null);
const loading = ref(false);
const saving = ref(false);
const error = ref<Error | null>(null);

// Computed
const isEditing = computed(() => !!props.recordId);

// Methods
async function loadTask() {
    if (!props.recordId) return;

    loading.value = true;
    error.value = null;

    try {
        // Load task from database
        const task = await panePluginApi?.posts?.get(props.recordId);
        if (task && task.postType === 'task') {
            currentTask.value = task as TaskPost;
        } else {
            throw new Error('Task not found');
        }
    } catch (err) {
        error.value = err as Error;
    } finally {
        loading.value = false;
    }
}

async function handleSave(taskData: Partial<TaskPost>) {
    saving.value = true;

    try {
        let savedTask: TaskPost | null = null;

        if (isEditing.value && props.recordId) {
            // Update existing task
            savedTask = await updateTask(props.recordId, taskData);
        } else {
            // Create new task
            savedTask = await createTask(taskData);
        }

        if (savedTask) {
            // Show success message
            showToast(isEditing.value ? 'Task updated!' : 'Task created!', {
                type: 'success',
            });

            // Close the pane
            closePane();
        }
    } catch (err) {
        console.error('Failed to save task:', err);
        showToast('Failed to save task', { type: 'error' });
    } finally {
        saving.value = false;
    }
}

function closePane() {
    // Close the current pane
    if (panePluginApi?.pane) {
        panePluginApi.pane.close();
    }
}

// Lifecycle
onMounted(() => {
    if (isEditing.value) {
        loadTask();
    }
});
</script>

<style scoped>
.task-editor-pane {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--background);
}

.loading,
.error {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 200px;
    gap: 1rem;
    color: var(--text-secondary);
}

.error {
    color: var(--error);
}

.editor-content {
    display: flex;
    flex-direction: column;
    height: 100%;
}

.editor-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem;
    border-bottom: 2px solid var(--border);
}

.editor-header h2 {
    margin: 0;
    color: var(--text);
}

.btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem;
    border: 2px solid var(--border);
    border-radius: 4px;
    background: var(--surface);
    cursor: pointer;
    transition: all 0.2s;
}

.btn:hover {
    background: var(--surface-hover);
}

.btn-icon {
    padding: 0.5rem;
}

.animate-spin {
    animation: spin 1s linear infinite;
}

@keyframes spin {
    from {
        transform: rotate(0deg);
    }
    to {
        transform: rotate(360deg);
    }
}
</style>
```

---

## Step 6: Register the Mini App

Now let's tie everything together by registering our mini app with OR3.

### Create the plugin

```ts
// app/plugins/task-manager.client.ts
import { registerSidebarPage } from '~/composables/sidebar';
import { usePaneApps } from '~/composables/core/usePaneApps';

export default defineNuxtPlugin(() => {
    console.log('Registering Task Manager mini app...');

    // Register the pane app
    const { registerPaneApp } = usePaneApps();

    registerPaneApp({
        id: 'task-editor',
        label: 'Task Editor',
        component: () => import('~/components/tasks/TaskEditorPane.vue'),
        icon: 'edit',
        description: 'Create and edit tasks',

        // Optional: Create initial record
        async createInitialRecord({ app }) {
            // This is called when opening a new task editor without a recordId
            // We don't need to create anything here since the form handles creation
            return null;
        },
    });

    // Register the sidebar page
    const cleanup = registerSidebarPage({
        id: 'task-manager',
        label: 'Task Manager',
        component: () => import('~/components/tasks/TaskListPage.vue'),
        icon: 'tasks',
        order: 50,
        category: 'productivity',
        usesDefaultHeader: true,

        // Optional: Guard for access control
        canActivate(ctx) {
            // Only allow if user has task management permission
            return true; // Always allow for this example
        },

        onActivate(ctx) {
            console.log('Task Manager page activated');
        },

        onDeactivate(ctx) {
            console.log('Task Manager page deactivated');
        },
    });

    // HMR cleanup
    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            console.log('Cleaning up Task Manager plugin...');
            cleanup();
        });
    }

    console.log('Task Manager mini app registered successfully!');
});
```

### Create the barrel export

```ts
// app/composables/tasks/index.ts
export { useTasksCrud } from './useTasksCrud';
export { useTaskList } from './useTaskList';

// Re-export types for convenience
export type { TaskPost } from '~/types/task';
```

---

## Step 7: Test Your Mini App

Now let's test that everything works together.

### Verify registration

1. Start your development server
2. Open the browser console
3. You should see: "Task Manager mini app registered successfully!"
4. Check the sidebar - you should see "Task Manager" in the productivity category

### Test the workflow

1. **Open Task Manager**: Click "Task Manager" in the sidebar
2. **View Statistics**: See the task counts at the top
3. **Create Task**: Click "New Task" button - this should open a new pane
4. **Fill Form**: Enter task details and save
5. **Edit Task**: Click "Edit" on any task - opens in pane with data loaded
6. **Delete Task**: Click "Delete" and confirm
7. **Filter Tasks**: Use the status, priority, and search filters

### Test HMR

1. Make changes to any component
2. Save the file
3. The UI should update without losing state
4. Check console for proper cleanup messages

---

## Advanced Features

Let's add some advanced features to make our mini app more powerful.

### Add task templates

```ts
// app/utils/task-templates.ts
import type { TaskPost } from '~/types/task';
import { createTask } from './task-utils';

export const taskTemplates = {
    bugReport: {
        title: 'Bug Report: ',
        content: 'Describe the bug and steps to reproduce...',
        meta: {
            status: 'todo' as const,
            priority: 'high' as const,
            tags: ['bug', 'urgent'],
        },
    },
    featureRequest: {
        title: 'Feature Request: ',
        content: 'Describe the desired feature and use case...',
        meta: {
            status: 'todo' as const,
            priority: 'medium' as const,
            tags: ['feature', 'enhancement'],
        },
    },
    meeting: {
        title: 'Meeting: ',
        content: 'Meeting agenda and notes...',
        meta: {
            status: 'in-progress' as const,
            priority: 'medium' as const,
            tags: ['meeting'],
        },
    },
};

export function createTaskFromTemplate(
    templateName: keyof typeof taskTemplates,
    customData?: Partial<TaskPost>
): TaskPost {
    const template = taskTemplates[templateName];
    return createTask({ ...template, ...customData });
}
```

### Add keyboard shortcuts

```vue
<!-- Add to TaskListPage.vue -->
<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';

// Keyboard shortcuts
function handleKeydown(event: KeyboardEvent) {
    // Ctrl/Cmd + N: New task
    if ((event.ctrlKey || event.metaKey) && event.key === 'n') {
        event.preventDefault();
        createNewTask();
    }

    // Ctrl/Cmd + R: Refresh
    if ((event.ctrlKey || event.metaKey) && event.key === 'r') {
        event.preventDefault();
        refreshTasks();
    }
}

onMounted(() => {
    document.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
    document.removeEventListener('keydown', handleKeydown);
});
</script>
```

### Add export/import functionality

```ts
// app/utils/task-export.ts
import type { TaskPost } from '~/types/task';

export function exportTasksToJSON(tasks: TaskPost[]): string {
    return JSON.stringify(tasks, null, 2);
}

export function importTasksFromJSON(jsonString: string): TaskPost[] {
    try {
        const tasks = JSON.parse(jsonString);
        // Validate tasks here
        return tasks;
    } catch (error) {
        throw new Error('Invalid JSON format');
    }
}

export function downloadTasksAsFile(
    tasks: TaskPost[],
    filename = 'tasks.json'
) {
    const json = exportTasksToJSON(tasks);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
```

---

## Best Practices

### 1. Error Handling

Always use proper error handling with `reportError`:

```ts
import { reportError } from '~/utils/errors';

try {
    await riskyOperation();
} catch (err) {
    reportError(err('ERR_CUSTOM', 'Descriptive error message'), {
        toast: true, // Show user notification
        retry: true, // Show retry option
    });
}
```

### 2. Loading States

Provide clear loading states for async operations:

```vue
<template>
    <div>
        <div v-if="loading" class="loading">
            <UIcon name="spinner" class="animate-spin" />
            Processing...
        </div>
        <div v-else>
            <!-- Content -->
        </div>
    </div>
</template>
```

### 3. HMR Safety

Always use the `registerSidebarPage` helper for proper cleanup:

```ts
const cleanup = registerSidebarPage(pageDefinition);

if (import.meta.hot) {
    import.meta.hot.dispose(cleanup);
}
```

### 4. TypeScript Types

Create proper types for your data structures:

```ts
export interface TaskPost {
    id: string;
    postType: 'task';
    title: string;
    content: string;
    meta: {
        status: 'todo' | 'in-progress' | 'done';
        priority: 'low' | 'medium' | 'high';
        dueDate?: string;
        tags: string[];
        createdAt: string;
        updatedAt: string;
    };
}
```

### 5. Validation

Use Zod for runtime validation:

```ts
import { z } from 'zod';

export const TaskSchema = z.object({
    postType: z.literal('task'),
    title: z.string().min(1).max(100),
    // ... other fields
});
```

---

## Troubleshooting

### Common Issues

1. **Page not showing in sidebar**

    - Check that the plugin is client-side (`.client.ts`)
    - Verify no errors in console during registration
    - Ensure proper HMR cleanup

2. **Multi-pane not opening**

    - Verify `usePaneApps` registration
    - Check that the component imports correctly
    - Ensure the multi-pane API is available

3. **Data not persisting**

    - Check database schema compatibility
    - Verify Zod validation
    - Ensure proper error handling

4. **HMR not working**
    - Use the `registerSidebarPage` helper
    - Implement proper cleanup functions
    - Check for memory leaks

### Debug Tips

1. Use console.log to track registration flow
2. Check the Vue devtools for component state
3. Use the browser devtools to inspect IndexedDB
4. Test error scenarios deliberately

---

## Next Steps

Now that you have a working mini app, consider extending it:

1. **Add real-time collaboration** with WebSockets
2. **Implement task dependencies** and relationships
3. **Add file attachments** to tasks
4. **Create dashboard widgets** for task overview
5. **Add notifications** for due dates and assignments
6. **Implement task templates** and workflows
7. **Add analytics and reporting** features

---

## Summary

You've successfully built a complete mini app that integrates with OR3's core systems:

✅ **Custom Post Types** - Using the posts system for task storage  
✅ **Sidebar Integration** - Registered page with proper lifecycle  
✅ **Multi-Pane Support** - Tasks open in dedicated panes  
✅ **HMR Safety** - Proper cleanup and development experience  
✅ **Type Safety** - Full TypeScript support  
✅ **Error Handling** - Robust error management  
✅ **Responsive Design** - Works on all screen sizes

This pattern can be extended to build any type of mini app in OR3, from project management tools to content management systems and beyond.

---

Document generated from the Task Manager mini app implementation.
