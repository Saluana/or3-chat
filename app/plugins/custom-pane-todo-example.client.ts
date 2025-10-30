/**
 * Example: Custom Pane App - Simple Todo Manager
 * 
 * Demonstrates the complete workflow for creating a custom pane app:
 * 1. Register a pane app with usePaneApps
 * 2. Register a sidebar list with registerSidebarPostList
 * 3. Create/update posts via panePluginApi.posts
 * 
 * This example creates a simple todo manager that:
 * - Displays todos in the sidebar
 * - Opens todo panes when clicked
 * - Allows marking todos as complete
 * - Persists all data in the posts table with postType='example-todo'
 */

import { defineComponent, h, ref, computed, onMounted } from 'vue';

export default defineNuxtPlugin(async () => {
    if (!process.client) return;

    try {
        const { registerPaneApp } = usePaneApps();
        const { registerSidebarPostList } = await import('~/composables/sidebar/registerSidebarPostList');

        // Define the Todo pane component
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

                // Load existing todo
                onMounted(async () => {
                    if (!props.recordId) {
                        loading.value = false;
                        return;
                    }

                    try {
                        const result = await props.postApi.listByType({
                            postType: props.postType,
                        });

                        if (result.ok) {
                            const todo = result.posts.find((p: any) => p.id === props.recordId);
                            if (todo) {
                                title.value = todo.title;
                                description.value = todo.content || '';
                                completed.value = todo.meta?.completed || false;
                            }
                        }
                    } catch (err) {
                        error.value = 'Failed to load todo';
                        console.error('[TodoPane] Load failed:', err);
                    } finally {
                        loading.value = false;
                    }
                });

                // Save todo
                const handleSave = async () => {
                    if (!title.value.trim()) {
                        error.value = 'Title is required';
                        return;
                    }

                    saving.value = true;
                    error.value = null;

                    try {
                        if (props.recordId) {
                            // Update existing
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
                            // Create new
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
                        console.error('[TodoPane] Save failed:', err);
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
                const UIcon = resolveComponent('UIcon');
                const UButton = resolveComponent('UButton');
                const UInput = resolveComponent('UInput');
                const UTextarea = resolveComponent('UTextarea');

                if (this.loading) {
                    return h('div', { class: 'flex items-center justify-center h-full' }, [
                        h('div', { class: 'text-sm opacity-50' }, 'Loading...'),
                    ]);
                }

                return h('div', { class: 'flex flex-col h-full bg-surface' }, [
                    // Header
                    h(
                        'div',
                        { class: 'flex items-center gap-3 p-4 border-b border-border' },
                        [
                            h(UIcon, {
                                name: 'pixelarticons:checkbox',
                                class: 'w-5 h-5',
                            }),
                            h('span', { class: 'font-medium' }, 'Todo'),
                        ]
                    ),

                    // Content
                    h('div', { class: 'flex-1 overflow-auto p-4 space-y-4' }, [
                        // Error message
                        this.error
                            ? h(
                                  'div',
                                  {
                                      class: 'p-3 bg-red-500/10 border border-red-500/20 rounded text-sm text-red-500',
                                  },
                                  this.error
                              )
                            : null,

                        // Completed checkbox
                        h('div', { class: 'flex items-center gap-2' }, [
                            h('input', {
                                type: 'checkbox',
                                checked: this.completed,
                                onChange: this.toggleCompleted,
                                class: 'w-4 h-4',
                            }),
                            h('span', { class: 'text-sm' }, 'Completed'),
                        ]),

                        // Title input
                        h('div', { class: 'space-y-2' }, [
                            h('label', { class: 'text-sm font-medium' }, 'Title'),
                            h(UInput, {
                                modelValue: this.title,
                                'onUpdate:modelValue': (val: string) => (this.title = val),
                                placeholder: 'Enter todo title...',
                            }),
                        ]),

                        // Description textarea
                        h('div', { class: 'space-y-2' }, [
                            h('label', { class: 'text-sm font-medium' }, 'Description'),
                            h(UTextarea, {
                                modelValue: this.description,
                                'onUpdate:modelValue': (val: string) =>
                                    (this.description = val),
                                placeholder: 'Enter description...',
                                rows: 8,
                            }),
                        ]),
                    ]),

                    // Footer with save button
                    h(
                        'div',
                        { class: 'flex items-center justify-end gap-2 p-4 border-t border-border' },
                        [
                            h(
                                UButton,
                                {
                                    color: 'primary',
                                    disabled: this.saving || !this.title.trim(),
                                    loading: this.saving,
                                    onClick: this.handleSave,
                                },
                                () => 'Save'
                            ),
                        ]
                    ),
                ]);
            },
        });

        // 1. Register the pane app
        registerPaneApp({
            id: 'example-todo',
            label: 'Todo',
            icon: 'pixelarticons:checkbox',
            component: TodoPaneComponent,
            postType: 'example-todo',
            // Optional: Create initial record when opening new pane
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

        // 2. Register sidebar list
        registerSidebarPostList({
            id: 'example:todo-list',
            label: 'Example Todos',
            appId: 'example-todo',
            postType: 'example-todo',
            icon: 'pixelarticons:checkbox',
            placement: 'bottom',
            order: 999, // Show at bottom
            limit: 20,
            emptyMessage: 'No todos yet',
            renderItem: (post: any) => ({
                title: post.title,
                subtitle: (post.meta as any)?.completed ? 'Completed' : 'Pending',
                icon: (post.meta as any)?.completed
                    ? 'pixelarticons:check'
                    : 'pixelarticons:checkbox',
            }),
        });

        if (import.meta.dev) {
            console.log('[custom-pane-todo-example] Registered todo pane app');
        }
    } catch (e) {
        console.error('[custom-pane-todo-example] Failed to register:', e);
    }
});
