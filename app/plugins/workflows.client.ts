// app/plugins/workflows.client.ts
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { useHooks } from '#imports';
import { useOr3Config } from '~/composables/useOr3Config';
import { registerSidebarPage } from '~/composables/sidebar/registerSidebarPage';
import { usePaneApps } from '~/composables/core/usePaneApps';
import WorkflowPane from './workflows/components/WorkflowPane.vue';
import WorkflowSidebar from './workflows/components/WorkflowSidebar.vue';
import { destroyEditorForPane } from './workflows/composables/useWorkflows';
import type { PanePluginApi } from '~/plugins/pane-plugin-api.client';

// Vue Flow styles (required)
import '@vue-flow/core/dist/style.css';
import '@vue-flow/core/dist/theme-default.css';

// Workflow component styles
import 'or3-workflow-vue/style.css';

// Theme bridge - maps or3-chat theme variables to workflow-vue variables
import './workflows/styles/workflow-theme-bridge.css';

export default defineNuxtPlugin(() => {
    // Check OR3 config feature flag (master toggle)
    const or3Config = useOr3Config();
    if (!or3Config.features.workflows.enabled) {
        console.log('[workflows] Plugin disabled via OR3 config');
        return;
    }

    const hooks = useHooks();

    // Register Workflow mini app

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
        console.error('[workflows] Failed to register pane app:', e);
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
        console.error('[workflows] Failed to register sidebar page:', e);
    }

    const disposePaneCloseHook = hooks.on(
        'ui.pane.close:action:before',
        ({ pane }) => {
            if (pane.mode === 'or3-workflows') {
                destroyEditorForPane(pane.id);
            }
        }
    );

    // HMR cleanup
    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            cleanup?.();
            disposePaneCloseHook();
        });
    }

    // Snake Game mini app registered
});
