/**
 * Example: Custom Pane App with Sidebar Page (V2 Flow)
 *
 * Demonstrates the complete workflow for creating a custom pane app plus a
 * sidebar page that leverages the new environment helpers.
 *
 * 1. Register a pane app with usePaneApps
 * 2. Register a sidebar page with registerSidebarPage
 * 3. Use environment-backed helpers (usePostsList, useSidebarMultiPane, etc.)
 *
 * The example exposes a simple todo manager that:
 * - Lists todos inside the sidebar page
 * - Opens the todo pane when an item is clicked
 * - Creates new todos from the sidebar page
 * - Persists data via the shared posts table (postType='example-todo')
 */

import { defineComponent, h, ref, computed, onMounted, watch } from 'vue';
import {
    useSidebarMultiPane,
    useSidebarPostsApi,
} from '~/composables/sidebar/useSidebarEnvironment';
import { useSidebarPageControls } from '~/composables/sidebar/useSidebarPageControls';
import { usePostsList } from '~/composables/posts/usePostsList';
import { getGlobalMultiPaneApi } from '~/utils/multiPaneApi';

export default defineNuxtPlugin(async () => {
    if (!process.client) return;

    try {
        const { registerPaneApp } = usePaneApps();
        const { registerSidebarPage } = await import(
            '~/composables/sidebar/registerSidebarPage'
        );

        // Workspace pane component (existing behaviour)
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

                // Development setup complete

                async function loadTodo(recordId: string | null) {
                    if (!process.client) return;
                    if (!props.postApi || !props.postApi.listByType) {
                        error.value = 'Posts API unavailable';
                        loading.value = false;
                        return;
                    }
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
                    } finally {
                        loading.value = false;
                    }
                }

                onMounted(() => {
                    loadTodo(props.recordId ?? null);
                });

                watch(
                    () => props.recordId,
                    (newId, oldId) => {
                        if (newId === oldId) return;
                        loadTodo(newId ?? null);
                    }
                );

                watch(
                    () => props.postApi,
                    (api) => {
                        if (api) {
                            loadTodo(props.recordId ?? null);
                        }
                    }
                );

                const handleSave = async () => {
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

                            if (!result.ok) {
                                error.value = result.message;
                            }
                        } else {
                            const result = await props.postApi.create({
                                postType: props.postType,
                                title: title.value,
                                content: description.value,
                                meta: { completed: completed.value },
                                source: 'example:todo-pane',
                            });

                            if (!result.ok) {
                                error.value = result.message;
                            }
                        }
                    } catch (err) {
                        error.value = 'Failed to save todo';
                    } finally {
                        saving.value = false;
                    }
                };

                const toggleCompleted = async () => {
                    completed.value = !completed.value;
                    await handleSave();
                };

                return {
                    title,
                    description,
                    completed,
                    loading,
                    saving,
                    error,
                    handleSave,
                    toggleCompleted,
                };
            },
            render() {
                // Render todo pane
                if (this.loading) {
                    return h(
                        'div',
                        { class: 'flex items-center justify-center h-full' },
                        [
                            h(
                                'div',
                                { class: 'text-sm opacity-50' },
                                'Loading...'
                            ),
                        ]
                    );
                }

                return h('div', { class: 'flex flex-col h-full bg-surface' }, [
                    h(
                        'div',
                        {
                            class: 'flex items-center gap-3 p-4 border-b border-border',
                        },
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
                            h(
                                'label',
                                { class: 'text-sm font-medium' },
                                'Title'
                            ),
                            h('input', {
                                class: 'w-full px-2 py-1 border border-border rounded bg-background',
                                value: this.title,
                                placeholder: 'Enter todo title...',
                                onInput: (event: any) =>
                                    (this.title = event?.target?.value ?? ''),
                            }),
                        ]),
                        h('div', { class: 'space-y-2' }, [
                            h(
                                'label',
                                { class: 'text-sm font-medium' },
                                'Description'
                            ),
                            h('textarea', {
                                class: 'w-full px-2 py-1 border border-border rounded bg-background',
                                value: this.description,
                                placeholder: 'Enter description...',
                                rows: 8,
                                onInput: (event: any) =>
                                    (this.description =
                                        event?.target?.value ?? ''),
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
                                    onClick: this.handleSave,
                                },
                                this.saving ? 'Saving...' : 'Save'
                            ),
                        ]
                    ),
                ]);
            },
        });

        // Sidebar page component using the new helpers
        const TodoSidebarPage = defineComponent({
            name: 'TodoSidebarPage',
            setup() {
                const { items, loading, error, refresh } =
                    usePostsList('example-todo');
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
                    // Open todo in pane

                    // Check if this todo is already open in any pane
                    const existingIndex = multiPane.panes.value.findIndex(
                        (pane: any) =>
                            pane.mode === 'example-todo' &&
                            pane.documentId === id
                    );

                    if (existingIndex !== -1) {
                        // Focus the existing pane instead of opening a new one
                        multiPane.setActive(existingIndex);
                        return;
                    }

                    try {
                        // Get the active pane index
                        const activeIndex =
                            getGlobalMultiPaneApi()?.activePaneIndex?.value ??
                            0;
                        const activePane = multiPane.panes.value[activeIndex];

                        // Replace the active pane if it's empty (no thread, no document, or another todo)
                        // This matches the behavior of document/thread selection
                        const shouldReplace =
                            activePane &&
                            ((!activePane.threadId && !activePane.documentId) ||
                                activePane.mode === 'example-todo');

                        if (shouldReplace) {
                            // Reuse the active pane by updating it safely
                            multiPane.updatePane(activeIndex, {
                                mode: 'example-todo',
                                documentId: id,
                                threadId: '',
                                messages: [],
                            });

                            if (import.meta.dev) {
                                // Reused active pane for todo
                            }
                        } else {
                            // Create a new pane only if we can't reuse the active one
                            await multiPane.openApp('example-todo', {
                                initialRecordId: id,
                            });

                            if (import.meta.dev) {
                                // Development debug info
                            }
                        }
                    } catch (error) {
                        // Handle openTodo failure
                    }
                }

                async function createTodo() {
                    if (!postsApi?.posts) return;
                    try {
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
                    } catch (err) {
                        // Handle createTodo failure
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
                        'onUpdate:modelValue': (val: string) =>
                            (this.query = val),
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
                              {
                                  class: 'flex-1 overflow-auto flex flex-col gap-2',
                              },
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
                                              {
                                                  class: 'text-xs opacity-70',
                                              },
                                              (post.meta)?.completed
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

        // 1. Register pane app (workspace content)
        registerPaneApp({
            id: 'example-todo',
            label: 'Todo',
            icon: 'pixelarticons:checkbox',
            component: TodoPaneComponent,
            postType: 'example-todo',
            async createInitialRecord() {
                const api = (globalThis as any).__or3PanePluginApi;
                if (!api?.posts) {
                    throw new Error('Pane plugin API not available');
                }

                const result = await api.posts.create({
                    postType: 'example-todo',
                    title: 'New Todo',
                    content: '',
                    meta: { completed: false },
                    source: 'example:todo-app',
                });

                if (!result.ok) {
                    throw new Error(result.message);
                }

                return { id: result.id };
            },
        });

        // 2. Register sidebar page (navigation surface)
        registerSidebarPage({
            id: 'example-todo-page',
            label: 'Todos',
            icon: 'pixelarticons:list',
            order: 210,
            keepAlive: true,
            usesDefaultHeader: false,
            component: () => Promise.resolve(TodoSidebarPage),
        });

        // Registration complete
    } catch (e) {
        // Handle registration failure
    }
});
