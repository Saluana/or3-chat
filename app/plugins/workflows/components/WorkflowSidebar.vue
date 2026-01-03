<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { WorkflowEditor } from '@or3/workflow-core';
import { NodePalette, NodeInspector } from '@or3/workflow-vue';
import type { TabsItem } from '#ui/types';
import {
    useSidebarMultiPane,
    useSidebarPostsApi,
} from '~/composables/sidebar/useSidebarEnvironment';
import {
    getEditorForPane,
    type WorkflowPost,
    useWorkflowsCrud,
} from '../composables/useWorkflows';
import { useWorkflowSidebarControls } from '../composables/useWorkflowSidebarControls';
import { useToolRegistry } from '~/utils/chat/tool-registry';
import WorkflowsTab from './sidebar/WorkflowsTab.vue';

/** Extended meta type that includes optional description field */
interface WorkflowMetaWithDescription {
    description?: string;
    [key: string]: unknown;
}

const multiPane = useSidebarMultiPane();
const { activePanel, setPanel } = useWorkflowSidebarControls();
const toolRegistry = useToolRegistry();
const panePluginApi = useSidebarPostsApi();
const postApi = panePluginApi?.posts ?? null;
const { listWorkflows } = useWorkflowsCrud(postApi);

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

const editorRefresh = ref(0);

const activeWorkflowEditor = computed<WorkflowEditor | null>(() => {
    // Force refresh when inspector opens or pane changes
    editorRefresh.value;

    if (!activeWorkflowPane.value) return null;
    const editor = getEditorForPane(activeWorkflowPane.value.id);
    return editor.isDestroyed() ? null : editor;
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

const subflowWorkflows = ref<WorkflowPost[]>([]);
const subflowLoading = ref(false);
const subflowError = ref<string | null>(null);

const loadSubflowWorkflows = async () => {
    if (subflowLoading.value) return;
    subflowLoading.value = true;
    subflowError.value = null;

    const result = await listWorkflows();
    if (result.ok) {
        subflowWorkflows.value = result.workflows;
    } else {
        subflowError.value = result.error;
    }

    subflowLoading.value = false;
};

const availableSubflows = computed(() =>
    subflowWorkflows.value.map((workflow) => ({
        id: workflow.id,
        name: workflow.title,
        description: (workflow.meta as WorkflowMetaWithDescription | null)?.description || undefined,
    }))
);

onMounted(() => {
    void loadSubflowWorkflows();
});

watch(
    () => activePanel.value,
    (panel) => {
        if (panel === 'inspector') {
            editorRefresh.value += 1;
            void loadSubflowWorkflows();
        }
    }
);

watch(
    () => activeWorkflowPaneId.value,
    () => {
        editorRefresh.value += 1;
    }
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
            <WorkflowsTab
                v-if="activePanel === 'workflows'"
                @workflow-selected="emit('close-sidebar')"
            />

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
                    :available-subflows="availableSubflows"
                    :subflow-list-loading="subflowLoading"
                    :subflow-list-error="subflowError"
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
