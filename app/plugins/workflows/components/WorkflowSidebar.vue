<script setup lang="ts">
import type { WorkflowEditor } from '@or3/workflow-core';
import { NodePalette, NodeInspector } from '@or3/workflow-vue';
import { type TabsItem } from '@nuxt/ui';
import {
    useSidebarMultiPane,
    useSidebarPostsApi,
} from '~/composables/sidebar/useSidebarEnvironment';
import {
    getEditorForPane,
    useWorkflowsCrud,
    type WorkflowPost,
} from '../composables/useWorkflows';

const multiPane = useSidebarMultiPane();
const panePluginApi = useSidebarPostsApi();
const postApi = panePluginApi?.posts ?? null;

// Initialize CRUD operations with the posts API (captured at setup time)
const { createWorkflow, deleteWorkflow, listWorkflows } =
    useWorkflowsCrud(postApi);

// Local state
const activePanel = ref<'palette' | 'inspector' | 'workflows'>('workflows');
const workflows = ref<WorkflowPost[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const newWorkflowName = ref('');
const isCreating = ref(false);
const isDev = import.meta.dev;

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

// Load workflows on mount
async function loadWorkflows() {
    loading.value = true;
    error.value = null;

    const result = await listWorkflows();
    if (result.ok) {
        workflows.value = result.workflows;
    } else {
        error.value = result.error;
    }

    loading.value = false;
}

// Create new workflow
async function handleCreateWorkflow() {
    const title = newWorkflowName.value.trim() || 'Untitled Workflow';
    isCreating.value = true;

    const result = await createWorkflow(title);
    if (result.ok) {
        newWorkflowName.value = '';
        await loadWorkflows();
        // Open the new workflow in a pane
        openWorkflow(result.id);
    } else {
        error.value = result.error;
    }

    isCreating.value = false;
}

// Open workflow in pane
function openWorkflow(id: string) {
    multiPane.switchToApp('or3-workflows', { recordId: id });
}

// Delete workflow
async function handleDeleteWorkflow(id: string, event: Event) {
    event.stopPropagation();

    if (!confirm('Delete this workflow? This cannot be undone.')) {
        return;
    }

    const result = await deleteWorkflow(id);
    if (result.ok) {
        await loadWorkflows();
    } else {
        error.value = result.error;
    }
}

// Format relative time
function formatTime(timestamp: number) {
    const now = Date.now();
    const diff = now - timestamp * 1000; // timestamps are in seconds
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
}

onMounted(() => {
    loadWorkflows();
});
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
                />
            </div>

            <!-- Workflows Panel -->
            <div
                v-if="activePanel === 'workflows'"
                class="flex flex-col flex-1 gap-4"
            >
                <!-- Header with create -->
                <div class="flex justify-between items-center">
                    <h1 class="font-medium text-lg">Workflows</h1>
                    <UButton
                        size="sm"
                        variant="ghost"
                        icon="tabler:plus"
                        class="center-it"
                        @click="handleCreateWorkflow"
                        :loading="isCreating"
                        title="Create workflow"
                    />
                </div>

                <!-- Error state -->
                <div
                    v-if="error"
                    class="text-sm text-red-500 p-2 bg-red-50 dark:bg-red-900/20 rounded"
                >
                    {{ error }}
                </div>

                <!-- Loading state -->
                <div
                    v-if="loading"
                    class="flex items-center justify-center py-8"
                >
                    <UIcon
                        name="tabler:loader-2"
                        class="animate-spin text-xl"
                    />
                </div>

                <!-- Empty state -->
                <div
                    v-else-if="workflows.length === 0"
                    class="flex flex-col items-center justify-center py-8 text-center"
                >
                    <UIcon
                        name="tabler:binary-tree-2"
                        class="text-4xl mb-2 opacity-50"
                    />
                    <p class="text-sm opacity-70">No workflows yet</p>
                    <p class="text-xs opacity-50">Create one to get started</p>
                </div>

                <!-- Workflow list -->
                <div
                    v-else
                    class="flex flex-col gap-2 overflow-y-auto px-0.5 flex-1"
                >
                    <div
                        v-for="workflow in workflows"
                        :key="workflow.id"
                        class="group flex items-center justify-between p-3 rounded-lg border border-(--md-outline-variant) hover:border-(--md-primary) hover:bg-(--md-surface-container) cursor-pointer transition-colors"
                        @click="openWorkflow(workflow.id)"
                    >
                        <div class="flex flex-col gap-0.5 min-w-0 flex-1">
                            <span class="font-medium text-sm truncate">{{
                                workflow.title
                            }}</span>
                            <span class="text-xs opacity-60">{{
                                formatTime(workflow.updated_at)
                            }}</span>
                        </div>
                        <div
                            class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                            <UButton
                                size="xs"
                                variant="ghost"
                                color="error"
                                class="center-it"
                                icon="tabler:trash"
                                @click="
                                    handleDeleteWorkflow(workflow.id, $event)
                                "
                                title="Delete workflow"
                            />
                        </div>
                    </div>
                </div>
            </div>

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
                    @close="activePanel = 'workflows'"
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
