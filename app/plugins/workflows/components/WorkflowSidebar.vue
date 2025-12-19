<script setup lang="ts">
import { computed } from 'vue';
import type { WorkflowEditor } from '@or3/workflow-core';
import { NodePalette, NodeInspector } from '@or3/workflow-vue';
import type { TabsItem } from '#ui/types';
import { useSidebarMultiPane } from '~/composables/sidebar/useSidebarEnvironment';
import { getEditorForPane } from '../composables/useWorkflows';
import { useWorkflowSidebarControls } from '../composables/useWorkflowSidebarControls';
import { useToolRegistry } from '~/utils/chat/tool-registry';
import WorkflowsTab from './sidebar/WorkflowsTab.vue';

const multiPane = useSidebarMultiPane();
const { activePanel, setPanel } = useWorkflowSidebarControls();
const toolRegistry = useToolRegistry();

function onPanelChange(value: TabsItem['value']) {
    if (value === 'workflows' || value === 'palette' || value === 'inspector') {
        void setPanel(value);
    }
}

// Get the active workflow pane's editor (if any)
const activeWorkflowPane = computed(() => {
    const panes = multiPane.panes.value;
    const activePaneId = multiPane.activePaneId.value;

    // Find the active pane
    const activePane = panes.find((p) => p.id === activePaneId);

    // Check if it's a workflow pane
    if (activePane?.mode === 'or3-workflows') {
        return activePane;
    }

    // Otherwise find any workflow pane
    const workflowPane = panes.find((p) => p.mode === 'or3-workflows');
    return workflowPane ?? null;
});

const activeWorkflowEditor = computed<WorkflowEditor | null>(() => {
    return activeWorkflowPane.value
        ? getEditorForPane(activeWorkflowPane.value.id)
        : null;
});

const activeWorkflowPaneId = computed(() => activeWorkflowPane.value?.id);

const availableTools = computed(() =>
    toolRegistry.listTools.value.map((tool) => ({
        id: tool.definition.function.name,
        name: tool.definition.ui?.label || tool.definition.function.name,
        description:
            tool.definition.function.description ||
            tool.definition.ui?.descriptionHint ||
            '',
    }))
);

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
        <div class="flex flex-col h-full gap-4 overflow-y-auto">
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
                <NodePalette :canvas-id="activeWorkflowPaneId" />
            </div>

            <!-- Node Inspector Panel -->
            <div
                v-else-if="activePanel === 'inspector'"
                class="flex-1 overflow-y-auto"
            >
                <NodeInspector
                    v-if="activeWorkflowEditor"
                    :editor="activeWorkflowEditor"
                    :available-tools="availableTools"
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
