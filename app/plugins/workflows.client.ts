// app/plugins/snake-game.client.ts
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { registerSidebarPage } from '~/composables/sidebar/registerSidebarPage';
import { usePaneApps } from '~/composables/core/usePaneApps';
import WorkflowPane from './workflows/components/WorkflowPane.vue';
import WorkflowSidebar from './workflows/components/WorkflowSidebar.vue';
import type { PanePluginApi } from '~/plugins/pane-plugin-api.client';

export default defineNuxtPlugin(() => {
    // Register Snake Game mini app

    // Register the pane app with post type for score tracking
    const { registerPaneApp } = usePaneApps();

    try {
        registerPaneApp({
            id: 'or3-workflows',
            label: 'Workflows',
            component: WorkflowPane,
            icon: 'tabler:binary-tree-2',
            postType: 'workflow-entry',
        });
    } catch (e) {
        console.error('[snake-game] Failed to register pane app:', e);
    }

    // Register the sidebar page
    let cleanup: (() => void) | undefined;
    try {
        cleanup = registerSidebarPage({
            id: 'or3-workflows-page',
            label: 'Workflows',
            component: WorkflowSidebar,
            icon: 'tabler:binary-tree-2',
            order: 400,
            usesDefaultHeader: false,
        });
    } catch (e) {
        console.error('[snake-game] Failed to register sidebar page:', e);
    }

    // HMR cleanup
    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            cleanup?.();
        });
    }

    // Snake Game mini app registered
});
