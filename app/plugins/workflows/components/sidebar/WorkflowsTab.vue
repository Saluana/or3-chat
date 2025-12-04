<script setup lang="ts">
import {
    useSidebarMultiPane,
    useSidebarPostsApi,
} from '~/composables/sidebar/useSidebarEnvironment';
import {
    useWorkflowsCrud,
    type WorkflowPost,
} from '../../composables/useWorkflows';

const multiPane = useSidebarMultiPane();
const panePluginApi = useSidebarPostsApi();
const postApi = panePluginApi?.posts ?? null;

// Initialize CRUD operations with the posts API (captured at setup time)
const { createWorkflow, deleteWorkflow, listWorkflows, updateWorkflow } =
    useWorkflowsCrud(postApi);

// Local state
const workflows = ref<WorkflowPost[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const isCreating = ref(false);

// Modal state
const showDeleteModal = ref(false);
const workflowToDelete = ref<WorkflowPost | null>(null);

const showRenameModal = ref(false);
const workflowToRename = ref<WorkflowPost | null>(null);
const renameValue = ref('');

const showCreateModal = ref(false);
const createName = ref('');

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
function openCreateModal() {
    createName.value = '';
    showCreateModal.value = true;
}

async function handleCreateWorkflow() {
    const title = createName.value.trim() || 'Untitled Workflow';
    isCreating.value = true;
    showCreateModal.value = false;

    const result = await createWorkflow(title);
    if (result.ok) {
        createName.value = '';
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
function confirmDeleteWorkflow(workflow: WorkflowPost, event: Event) {
    event.stopPropagation();
    workflowToDelete.value = workflow;
    showDeleteModal.value = true;
}

async function handleDeleteWorkflow() {
    if (!workflowToDelete.value) return;

    const result = await deleteWorkflow(workflowToDelete.value.id);
    if (result.ok) {
        await loadWorkflows();
    } else {
        error.value = result.error;
    }

    showDeleteModal.value = false;
    workflowToDelete.value = null;
}

// Rename workflow
function openRenameModal(workflow: WorkflowPost, event: Event) {
    event.stopPropagation();
    workflowToRename.value = workflow;
    renameValue.value = workflow.title;
    showRenameModal.value = true;
}

async function handleRenameWorkflow() {
    if (!workflowToRename.value) return;

    const title = renameValue.value.trim();
    if (!title) {
        error.value = 'Title cannot be empty';
        return;
    }

    const result = await updateWorkflow(workflowToRename.value.id, { title });
    if (result.ok) {
        await loadWorkflows();
    } else {
        error.value = result.error;
    }

    showRenameModal.value = false;
    workflowToRename.value = null;
    renameValue.value = '';
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
    <div class="flex flex-col flex-1 gap-4">
        <!-- Header with create -->
        <div class="flex justify-between items-center">
            <h1 class="font-medium text-lg">Workflows</h1>
            <UButton
                size="sm"
                variant="ghost"
                icon="tabler:plus"
                class="center-it"
                @click="openCreateModal"
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
        <div v-if="loading" class="flex items-center justify-center py-8">
            <UIcon name="tabler:loader-2" class="animate-spin text-xl" />
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
        <div v-else class="flex flex-col gap-2 overflow-y-auto px-0.5 flex-1">
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
                        class="center-it"
                        icon="tabler:pencil"
                        @click="openRenameModal(workflow, $event)"
                        title="Rename workflow"
                    />
                    <UButton
                        size="xs"
                        variant="ghost"
                        color="error"
                        class="center-it"
                        icon="tabler:trash"
                        @click="confirmDeleteWorkflow(workflow, $event)"
                        title="Delete workflow"
                    />
                </div>
            </div>
        </div>

        <!-- Create Modal -->
        <UModal v-model:open="showCreateModal">
            <template #content>
                <div class="p-6 flex flex-col gap-4">
                    <h2 class="font-medium text-lg">New Workflow</h2>
                    <UInput
                        v-model="createName"
                        placeholder="Workflow name"
                        autofocus
                        @keydown.enter="handleCreateWorkflow"
                    />
                    <div class="flex justify-end gap-2 mt-2">
                        <UButton
                            variant="ghost"
                            @click="showCreateModal = false"
                        >
                            Cancel
                        </UButton>
                        <UButton @click="handleCreateWorkflow">
                            Create
                        </UButton>
                    </div>
                </div>
            </template>
        </UModal>

        <!-- Delete Confirmation Modal -->
        <UModal v-model:open="showDeleteModal">
            <template #content>
                <div class="p-6 flex flex-col gap-4">
                    <div class="flex items-center gap-3">
                        <UIcon
                            name="tabler:alert-triangle"
                            class="text-2xl text-(--md-error)"
                        />
                        <h2 class="font-medium text-lg">Delete Workflow</h2>
                    </div>
                    <p class="text-sm opacity-80">
                        Are you sure you want to delete "{{
                            workflowToDelete?.title
                        }}"? This action cannot be undone.
                    </p>
                    <div class="flex justify-end gap-2 mt-2">
                        <UButton
                            variant="ghost"
                            @click="showDeleteModal = false"
                        >
                            Cancel
                        </UButton>
                        <UButton color="error" @click="handleDeleteWorkflow">
                            Delete
                        </UButton>
                    </div>
                </div>
            </template>
        </UModal>

        <!-- Rename Modal -->
        <UModal v-model:open="showRenameModal">
            <template #content>
                <div class="p-6 flex flex-col gap-4">
                    <h2 class="font-medium text-lg">Rename Workflow</h2>
                    <UInput
                        v-model="renameValue"
                        placeholder="Workflow name"
                        autofocus
                        @keydown.enter="handleRenameWorkflow"
                    />
                    <div class="flex justify-end gap-2 mt-2">
                        <UButton
                            variant="ghost"
                            @click="showRenameModal = false"
                        >
                            Cancel
                        </UButton>
                        <UButton @click="handleRenameWorkflow"> Save </UButton>
                    </div>
                </div>
            </template>
        </UModal>
    </div>
</template>
