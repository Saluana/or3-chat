// app/plugins/workflows.client.ts
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { useHooks, useRuntimeConfig } from '#imports';
import { createManagedWorkspacePluginRuntime } from '~/composables/plugins/workspace-runtime';
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
    // Check runtime config feature flags (reads from admin settings)
    const runtimeConfig = useRuntimeConfig();
    const features = runtimeConfig.public.features;
    
    if (!features?.workflows?.enabled) {
        console.log('[workflows] Plugin disabled via runtime config');
        return;
    }
    
    // Check if editor is enabled
    const editorEnabled = features.workflows.editor !== false;
    const pluginRuntime = createManagedWorkspacePluginRuntime({
        pluginId: 'or3-workflows',
    });
    const api = pluginRuntime.api;

    const hooks = useHooks();

    // Register the pane app with post type for score tracking (if execution enabled)
    const executionEnabled = features.workflows.execution !== false;
    let disposePaneCloseHook: (() => void) | undefined;
    
    if (executionEnabled) {
        try {
            api.registerPaneApp({
                id: 'or3-workflows',
                label: 'Workflows',
                component: WorkflowPane,
                icon: 'tabler:binary-tree-2',
                postType: 'workflow-entry',
            });
        } catch (e) {
            console.error('[workflows] Failed to register pane app:', e);
        }

        // Public command-palette post-source API (no core Dexie workflow query).
        try {
            const definition = {
                id: 'workflow-source',
                label: 'Workflows',
                postType: 'workflow-entry',
                categoryId: 'workflow',
                filterAliases: ['workflow'] as const,
                icon: 'tabler:binary-tree-2',
                order: 50,
                openTarget: {
                    kind: 'pane-app' as const,
                    appId: 'or3-workflows',
                },
            };
            api.registerCommandPalettePostSource(definition);
        } catch (e) {
            console.error(
                '[workflows] Failed to register command palette source:',
                e
            );
        }

        disposePaneCloseHook = hooks.on(
            'ui.pane.close:action:before',
            ({ pane }) => {
                if (pane.mode === 'or3-workflows') {
                    destroyEditorForPane(pane.id);
                }
            }
        );
    }

    // Register the sidebar page (if editor enabled)
    if (editorEnabled) {
        try {
            api.registerSidebarPage({
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
    }

    // HMR cleanup
    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            disposePaneCloseHook?.();
            void pluginRuntime.dispose('workflow plugin HMR');
        });
    }
});
