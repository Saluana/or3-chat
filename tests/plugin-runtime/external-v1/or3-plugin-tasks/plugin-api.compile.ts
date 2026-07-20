/**
 * Immutable host-API fixture derived from or3-plugin-tasks at the commit in
 * SOURCE.json. It intentionally retains that plugin's explicit import paths and
 * representative calls while replacing application-specific UI/service code.
 */
import type { Component } from 'vue';
import { useRuntimeConfig } from '#imports';
import { usePaneApps } from '~/composables/core/usePaneApps';
import type { Or3WorkspacePlugin } from '~/composables/plugins/workspace-runtime';
import {
    registerWorkspacePluginInstance,
    unregisterWorkspacePluginInstance,
    type WorkspacePluginSource,
} from '~/composables/plugins/workspace-runtime';
import { registerSidebarPage } from '~/composables/sidebar/registerSidebarPage';
import { useHooks } from '~/core/hooks/useHooks';
import type { PanePluginApi } from '~/plugins/pane-plugin-api.client';
import { defineTool, useToolRegistry } from '~/utils/chat/tools-public';
import { getGlobalMultiPaneApi } from '~/utils/multiPaneApi';

declare const TaskPane: Component;
declare const TaskSidebarPage: Component;

const TASKS_PLUGIN_ID = 'or3-tasks';

export function mountTasksRuntime(): () => void {
    const runtimeConfig = useRuntimeConfig();
    const hooks = useHooks();
    const { registerPaneApp, unregisterPaneApp } = usePaneApps();
    const paneApi = (globalThis as { __or3PanePluginApi?: PanePluginApi }).__or3PanePluginApi;
    const multiPaneApi = getGlobalMultiPaneApi();

    registerPaneApp({
        id: TASKS_PLUGIN_ID,
        label: 'Tasks',
        component: TaskPane,
        postType: 'task-list',
    });
    const unregisterSidebar = registerSidebarPage({
        id: 'or3-tasks-page',
        label: 'Tasks',
        component: TaskSidebarPage,
        icon: 'pixelarticons:checklist',
    });

    const tool = defineTool({
        type: 'function',
        function: {
            name: 'or3_tasks_search_lists',
            description: 'Search task lists',
            parameters: {
                type: 'object',
                properties: { query: { type: 'string' } },
                required: ['query'],
            },
        },
    });
    const toolRegistration = useToolRegistry().registerTool(tool, async () => '{}');
    const onSyncPullApplied = () => undefined;
    hooks.addAction('sync.pull:action:after', onSyncPullApplied);

    void runtimeConfig.public;
    void paneApi?.posts;
    void multiPaneApi?.activePaneIndex.value;

    return () => {
        unregisterPaneApp(TASKS_PLUGIN_ID);
        unregisterSidebar();
        toolRegistration.dispose();
        hooks.removeAction('sync.pull:action:after', onSyncPullApplied);
    };
}

export function registerTasksRuntime(source: WorkspacePluginSource = 'builtin'): () => void {
    const dispose = mountTasksRuntime();
    const registration = registerWorkspacePluginInstance(TASKS_PLUGIN_ID, source, dispose);
    if (!registration.accepted) {
        dispose();
        return () => undefined;
    }
    return () => unregisterWorkspacePluginInstance(TASKS_PLUGIN_ID);
}

const tasksPlugin: Or3WorkspacePlugin = {
    id: TASKS_PLUGIN_ID,
    register(api) {
        api.onCleanup(mountTasksRuntime());
    },
};

export default tasksPlugin;
