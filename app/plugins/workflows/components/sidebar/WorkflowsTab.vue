<script setup lang="ts">
import {
    useSidebarMultiPane,
    useSidebarPostsApi,
} from '~/composables/sidebar/useSidebarEnvironment';
import {
    useWorkflowsCrud,
    useWorkflowList,
    type WorkflowPost,
} from '../../composables/useWorkflows';
import { useWorkflowStorage } from '../../composables/useWorkflowStorage';
import { closeSidebarIfMobile } from '~/utils/sidebarLayoutApi';
import { useOr3Config } from '~/composables/useOr3Config';

const multiPane = useSidebarMultiPane();
const panePluginApi = useSidebarPostsApi();
const postApi = panePluginApi?.posts ?? null;

// Initialize CRUD operations with the posts API (captured at setup time)
const { createWorkflow, deleteWorkflow, updateWorkflow } = useWorkflowsCrud(postApi);
const { importWorkflow } = useWorkflowStorage();

const { workflows, loading, error: listError } = useWorkflowList();
const actionError = ref<string | null>(null);
const isCreating = ref(false);
const or3Config = useOr3Config();
const canEdit = computed(
    () =>
        or3Config.features.workflows.enabled &&
        or3Config.features.workflows.editor
);
const error = computed(() => actionError.value ?? listError.value);

// Modal state
const showDeleteModal = ref(false);
const workflowToDelete = ref<WorkflowPost | null>(null);

const showRenameModal = ref(false);
const workflowToRename = ref<WorkflowPost | null>(null);
const renameValue = ref('');

const showCreateModal = ref(false);
const createName = ref('');
const fileInputRef = ref<HTMLInputElement | null>(null);

// Create new workflow
function openCreateModal() {
    createName.value = '';
    showCreateModal.value = true;
}

async function handleCreateWorkflow() {
    const title = createName.value.trim() || 'Untitled Workflow';
    isCreating.value = true;
    showCreateModal.value = false;
    actionError.value = null;

    const result = await createWorkflow(title);
    if (result.ok) {
        createName.value = '';
        // Open the new workflow in a pane
        openWorkflow(result.id);
    } else {
        actionError.value = result.error;
    }

    isCreating.value = false;
}

async function handleWorkflowImport(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    try {
        actionError.value = null;
        const data = await importWorkflow(file);
        const fileName = file.name.replace(/\.[^/.]+$/, '').trim();
        const title =
            data.meta?.name?.trim() ||
            (data as { name?: string }).name?.trim() ||
            fileName ||
            'Imported Workflow';
        const payload = {
            ...data,
            meta: {
                ...data.meta,
                name: title,
            },
        };
        const result = await createWorkflow(title, payload);
        if (result.ok) {
            openWorkflow(result.id);
        } else {
            actionError.value = result.error;
        }
    } catch (e) {
        actionError.value =
            e instanceof Error ? e.message : 'Failed to import workflow';
    } finally {
        input.value = '';
    }
}

function openImportDialog() {
    fileInputRef.value?.click();
}

// Open workflow in pane
function openWorkflow(id: string) {
    multiPane.switchToApp('or3-workflows', { recordId: id });
    closeSidebarIfMobile();
}

// Delete workflow
function confirmDeleteWorkflow(workflow: WorkflowPost, event: Event) {
    event.stopPropagation();
    workflowToDelete.value = workflow;
    showDeleteModal.value = true;
}

async function handleDeleteWorkflow() {
    if (!workflowToDelete.value) return;
    actionError.value = null;

    const result = await deleteWorkflow(workflowToDelete.value.id);
    if (result.ok) {
        const deletedId = workflowToDelete.value.id;
        const panes = multiPane.panes.value;
        for (let i = panes.length - 1; i >= 0; i -= 1) {
            const pane = panes[i];
            if (!pane) continue;
            if (pane.mode !== 'or3-workflows') continue;
            if (pane.documentId !== deletedId) continue;

            if (panes.length > 1) {
                await multiPane.closePane(i);
            } else {
                multiPane.updatePane(i, {
                    mode: 'chat',
                    threadId: '',
                    documentId: undefined,
                    messages: [],
                });
                multiPane.setActive(i);
            }
        }
    } else {
        actionError.value = result.error;
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
    actionError.value = null;

    const title = renameValue.value.trim();
    if (!title) {
        actionError.value = 'Title cannot be empty';
        return;
    }

    const result = await updateWorkflow(workflowToRename.value.id, { title });
    if (!result.ok) {
        actionError.value = result.error;
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
</script>

<template>
    <div class="flex flex-col flex-1 gap-4">
        <!-- Header with create -->
        <div class="flex justify-between items-center">
            <h1 class="font-medium text-lg">Workflows</h1>
            <div v-if="canEdit" class="flex items-center gap-1">
                <UButton
                    size="sm"
                    variant="ghost"
                    icon="tabler:upload"
                    class="center-it theme-btn"
                    @click="openImportDialog"
                    title="Upload workflow"
                />
                <UButton
                    size="sm"
                    variant="ghost"
                    icon="tabler:plus"
                    class="center-it theme-btn"
                    @click="openCreateModal"
                    :loading="isCreating"
                    title="Create workflow"
                />
                <input
                    ref="fileInputRef"
                    type="file"
                    accept=".json"
                    class="sr-only"
                    @change="handleWorkflowImport"
                />
            </div>
        </div>

        <!-- Error state -->
        <div
            v-if="error"
            class="text-sm text-(--md-error) p-2 bg-(--md-error-container) rounded"
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
                class="group flex items-center justify-between p-3 rounded-lg border-[length:var(--md-border-width)] border-[color:var(--md-outline-variant)] hover:border-[color:var(--md-primary)] hover:bg-[color:var(--md-surface-container)] backdrop-blur cursor-pointer transition-colors"
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
                    v-if="canEdit"
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
        <UModal
            v-if="canEdit"
            v-model:open="showCreateModal"
            title="New Workflow"
            description="Give your workflow a name before creating it."
        >
            <template #body>
                <div class="space-y-4">
                    <UInput
                        v-model="createName"
                        placeholder="Workflow name"
                        autofocus
                        @keydown.enter="handleCreateWorkflow"
                    />
                </div>
            </template>
            <template #footer>
                <UButton variant="ghost" @click="showCreateModal = false">
                    Cancel
                </UButton>
                <UButton @click="handleCreateWorkflow">Create</UButton>
            </template>
        </UModal>

        <!-- Delete Confirmation Modal -->
        <UModal
            v-if="canEdit"
            v-model:open="showDeleteModal"
            title="Delete Workflow"
            description="This action cannot be undone."
        >
            <template #body>
                <div class="space-y-3">
                    <div class="flex items-center gap-3 text-(--md-error)">
                        <UIcon name="tabler:alert-triangle" class="text-2xl" />
                        <span class="font-medium">
                            Delete "{{ workflowToDelete?.title }}"?
                        </span>
                    </div>
                    <p class="text-sm opacity-80">
                        Are you sure you want to delete this workflow? This
                        action cannot be undone.
                    </p>
                </div>
            </template>
            <template #footer>
                <UButton variant="ghost" @click="showDeleteModal = false">
                    Cancel
                </UButton>
                <UButton color="error" @click="handleDeleteWorkflow">
                    Delete
                </UButton>
            </template>
        </UModal>

        <!-- Rename Modal -->
        <UModal
            v-if="canEdit"
            v-model:open="showRenameModal"
            title="Rename Workflow"
            description="Choose a new name for this workflow."
        >
            <template #body>
                <div class="space-y-4">
                    <UInput
                        v-model="renameValue"
                        placeholder="Workflow name"
                        autofocus
                        @keydown.enter="handleRenameWorkflow"
                    />
                </div>
            </template>
            <template #footer>
                <UButton variant="ghost" @click="showRenameModal = false">
                    Cancel
                </UButton>
                <UButton @click="handleRenameWorkflow">Save</UButton>
            </template>
        </UModal>
    </div>
</template>
