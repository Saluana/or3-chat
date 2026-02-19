import { registerSidebarPage } from '~/composables/sidebar/registerSidebarPage';
import { usePaneApps } from '~/composables/core/usePaneApps';
import { TASK_LIST_POST_TYPE } from './tasks/types';
import TaskPane from './tasks/components/TaskPane.vue';
import TaskSidebarPage from './tasks/components/TaskSidebarPage.vue';
import { registerTaskTools } from './tasks/tooling/registerTaskTools';
import type { PanePluginApi } from '~/plugins/pane-plugin-api.client';

export default defineNuxtPlugin(() => {
    if (!process.client) return;

    const { registerPaneApp } = usePaneApps();

    registerPaneApp({
        id: 'or3-tasks',
        label: 'Tasks',
        component: TaskPane,
        icon: 'pixelarticons:checklist',
        postType: TASK_LIST_POST_TYPE,
        createInitialRecord: async () => {
            const api = (globalThis as { __or3PanePluginApi?: PanePluginApi }).__or3PanePluginApi;
            if (!api?.posts) return null;
            const existing = await api.posts.listByType({ postType: TASK_LIST_POST_TYPE, limit: 1 });
            if (existing.ok && existing.posts[0]) return { id: existing.posts[0].id };
            const created = await api.posts.create({
                postType: TASK_LIST_POST_TYPE,
                title: 'My Tasks',
                meta: {
                    schema_version: 1,
                    sort_mode: 'manual',
                    tasks: [],
                    last_ai_analysis_at: null,
                    ai_fallback_notice: null,
                },
                source: 'tasks-pane:init',
            });
            return created.ok ? { id: created.id } : null;
        },
    });

    const unregisterSidebar = registerSidebarPage({
        id: 'or3-tasks-page',
        label: 'Tasks',
        component: TaskSidebarPage,
        icon: 'pixelarticons:checklist',
        order: 340,
        usesDefaultHeader: false,
    });

    const unregisterTools = registerTaskTools();

    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            unregisterSidebar();
            unregisterTools();
        });
    }
});
