<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { WorkflowEditor } from 'or3-workflow-core';
import { NodePalette, NodeInspector } from 'or3-workflow-vue';
import type { TabsItem } from '#ui/types';
import { useSidebarMultiPane } from '~/composables/sidebar/useSidebarEnvironment';

const emit = defineEmits<{
    (e: 'close-sidebar'): void;
}>();
import {
    getEditorForPane,
    useWorkflowList,
} from '../composables/useWorkflows';
import { useWorkflowSidebarControls } from '../composables/useWorkflowSidebarControls';
import { useToolRegistry } from '~/utils/chat/tool-registry';
import WorkflowsTab from './sidebar/WorkflowsTab.vue';
import { closeSidebarIfMobile } from '~/utils/sidebarLayoutApi';
import { useOr3Config } from '~/composables/useOr3Config';

/** Extended meta type that includes optional description field */
interface WorkflowMetaWithDescription {
    description?: string;
    [key: string]: unknown;
}

const multiPane = useSidebarMultiPane();
const { activePanel, setPanel } = useWorkflowSidebarControls();
const toolRegistry = useToolRegistry();
const or3Config = useOr3Config();
const canEdit = computed(
    () =>
        or3Config.features.workflows.enabled &&
        or3Config.features.workflows.editor
);

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

const {
    workflows: subflowWorkflows,
    loading: subflowLoading,
    error: subflowError,
} = useWorkflowList();

const availableSubflows = computed(() =>
    subflowWorkflows.value.map((workflow) => ({
        id: workflow.id,
        name: workflow.title,
        description:
            (workflow.meta as WorkflowMetaWithDescription | null)
                ?.description || undefined,
    }))
);

watch(
    () => activePanel.value,
    (panel) => {
        if (panel === 'inspector') {
            editorRefresh.value += 1;
        }
    }
);

watch(
    () => activeWorkflowPaneId.value,
    () => {
        editorRefresh.value += 1;
    }
);

const items = computed<TabsItem[]>(() => {
    if (!canEdit.value) return [];
    return [
        { label: 'Workflows', value: 'workflows' },
        { label: 'Node Palette', value: 'palette' },
        { label: 'Node Inspector', value: 'inspector' },
    ];
});

function handlePaletteQuickAdd() {
    closeSidebarIfMobile();
}
</script>

<template>
    <aside
        class="flex flex-col h-full w-full p-3 pr-0.5 justify-between overflow-hidden"
    >
        <div class="flex flex-col h-full gap-4 overflow-y-auto">
            <!-- Tabs -->
            <div v-if="canEdit" class="flex">
                <UTabs
                    size="sm"
                    v-model="activePanel"
                    :content="false"
                    :items="items"
                    class="w-full"
                    :ui="{
                        list: 'bg-[var(--md-surface)]/50 backdrop-blur-sm border border-[color:var(--md-border-color)]/30 rounded-lg p-1 gap-1',
                        trigger: 'rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-200 data-[state=inactive]:text-[color:var(--md-on-surface)]/60 data-[state=inactive]:hover:text-[color:var(--md-on-surface)] data-[state=inactive]:hover:bg-[color:var(--md-surface-hover)]/50',
                    }"
                    @update:model-value="onPanelChange"
                />
            </div>

            <!-- Workflows Panel -->
            <WorkflowsTab
                class="ml-0.5 mr-2"
                v-if="!canEdit || activePanel === 'workflows'"
                @workflow-selected="emit('close-sidebar')"
            />

            <!-- Node Palette Panel -->
            <div
                v-else-if="canEdit && activePanel === 'palette'"
                class="flex-1 overflow-y-auto px-0.5"
            >
                <NodePalette
                    :canvas-id="activeWorkflowPaneId"
                    @quick-add="handlePaletteQuickAdd"
                />
            </div>

            <!-- Node Inspector Panel -->
            <div
                v-else-if="canEdit && activePanel === 'inspector'"
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
