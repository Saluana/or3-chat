<script setup lang="ts">
import type { WorkflowEditor } from '@or3/workflow-core';
import { NodePalette, NodeInspector } from '@or3/workflow-vue';
import type { TabsItem } from '#ui/types';
import { useSidebarMultiPane } from '~/composables/sidebar/useSidebarEnvironment';
import { getEditorForPane } from '../composables/useWorkflows';
import { useWorkflowSidebarControls } from '../composables/useWorkflowSidebarControls';
import WorkflowsTab from './sidebar/WorkflowsTab.vue';

const multiPane = useSidebarMultiPane();
const { activePanel, setPanel } = useWorkflowSidebarControls();

function onPanelChange(value: TabsItem['value']) {
    if (value === 'workflows' || value === 'palette' || value === 'inspector') {
        void setPanel(value);
    }
}

// Get the active workflow pane's editor (if any)
const activeWorkflowEditor = computed<WorkflowEditor | null>(() => {
    const panes = multiPane.panes.value;
    const activePaneId = multiPane.activePaneId.value;

    // Find the active pane
    const activePane = panes.find((p) => p.id === activePaneId);

    // Check if it's a workflow pane
    if (activePane?.mode === 'or3-workflows') {
        return getEditorForPane(activePane.id);
    }

    // Otherwise find any workflow pane
    const workflowPane = panes.find((p) => p.mode === 'or3-workflows');
    if (workflowPane) {
        return getEditorForPane(workflowPane.id);
    }

    return null;
});

const items: TabsItem[] = [
    { label: 'Workflows', value: 'workflows' },
    { label: 'Node Palette', value: 'palette' },
    { label: 'Node Inspector', value: 'inspector' },
];
</script>

<template>
    <aside
        class="flex flex-col h-full w-full p-3 pr-0.5 justify-between overflow-hidden"
    >
        <div class="flex flex-col h-full gap-4 overfloy-y-auto">
            <!-- Tabs -->
            <div class="flex">
                <UTabs
                    size="sm"
                    v-model="activePanel"
                    :content="false"
                    :items="items"
                    class="w-full"
                    @update:model-value="onPanelChange"
                />
            </div>

            <!-- Workflows Panel -->
            <WorkflowsTab v-if="activePanel === 'workflows'" />

            <!-- Node Palette Panel -->
            <div
                v-else-if="activePanel === 'palette'"
                class="flex-1 overflow-y-auto px-0.5"
            >
                <NodePalette />
            </div>

            <!-- Node Inspector Panel -->
            <div
                v-else-if="activePanel === 'inspector'"
                class="flex-1 overflow-y-auto"
            >
                <NodeInspector
                    v-if="activeWorkflowEditor"
                    :editor="activeWorkflowEditor"
                    @close="
                        () =>
                            setPanel('workflows', {
                                activateSidebarPage: false,
                            })
                    "
                />
                <div
                    v-else
                    class="flex flex-col items-center justify-center py-8 text-center"
                >
                    <p class="text-sm opacity-70">
                        Open a workflow to inspect nodes
                    </p>
                </div>
            </div>
        </div>
    </aside>
</template>

<style scoped></style>
