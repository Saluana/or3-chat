<script setup lang="ts">
import {
    useSidebarMultiPane,
    useSidebarPostsApi,
} from '~/composables/sidebar/useSidebarEnvironment';
import {
    getEditorForPane,
    useWorkflowsCrud,
    useWorkflowList,
    type WorkflowPost,
} from '../../composables/useWorkflows';
import { useWorkflowStorage } from '../../composables/useWorkflowStorage';
import { closeSidebarIfMobile } from '~/utils/sidebarLayoutApi';
import { useOr3Config } from '~/composables/useOr3Config';
import type { WorkflowData } from 'or3-workflow-core';
import SidebarEmptyState from '~/components/sidebar/SidebarEmptyState.vue';
import SidebarGroupHeader from '~/components/sidebar/SidebarGroupHeader.vue';
import {
    computeTimeGroup,
    formatTimeDisplay,
    getTimeGroupLabel,
    type TimeGroup,
} from '~/utils/sidebar/sidebarTimeUtils';

const multiPane = useSidebarMultiPane();
const panePluginApi = useSidebarPostsApi();
const postApi = panePluginApi?.posts ?? null;

// Initialize CRUD operations with the posts API (captured at setup time)
const { createWorkflow, deleteWorkflow, updateWorkflow } =
    useWorkflowsCrud(postApi);
const { importWorkflow } = useWorkflowStorage();

const { workflows, loading, error: listError } = useWorkflowList();
const actionError = ref<string | null>(null);
const isCreating = ref(false);
const or3Config = useOr3Config();
const canEdit = computed(
    () =>
        or3Config.features.workflows.enabled &&
        or3Config.features.workflows.editor,
);
const error = computed(() => actionError.value ?? listError.value);

// Modal state
const showDeleteModal = ref(false);
const workflowToDelete = ref<WorkflowPost | null>(null);

const showDetailsModal = ref(false);
const workflowToEdit = ref<WorkflowPost | null>(null);
const detailsName = ref('');
const detailsDescription = ref('');

const showCreateModal = ref(false);
const createName = ref('');
const createDescription = ref('');
const fileInputRef = ref<HTMLInputElement | null>(null);
const collapsedGroups = ref(new Set<TimeGroup>());

const activeWorkflowIds = computed(
    () =>
        new Set(
            multiPane.panes.value
                .filter((pane) => pane.mode === 'or3-workflows')
                .map((pane) => pane.documentId)
                .filter((id): id is string => Boolean(id)),
        ),
);

const workflowGroups = computed(() => {
    const groups = new Map<TimeGroup, WorkflowPost[]>();
    for (const workflow of workflows.value) {
        const group = computeTimeGroup(workflow.updated_at);
        const entries = groups.get(group) ?? [];
        entries.push(workflow);
        groups.set(group, entries);
    }
    return [...groups].map(([key, entries]) => ({
        key,
        label: getTimeGroupLabel(key),
        entries,
    }));
});

function workflowDescription(workflow: WorkflowPost): string {
    return workflow.meta?.meta?.description?.trim() || '';
}

function toggleGroup(group: TimeGroup) {
    const next = new Set(collapsedGroups.value);
    if (next.has(group)) next.delete(group);
    else next.add(group);
    collapsedGroups.value = next;
}

// Create new workflow
function openCreateModal() {
    createName.value = '';
    createDescription.value = '';
    showCreateModal.value = true;
}

async function handleCreateWorkflow() {
    const title = createName.value.trim() || 'Untitled Workflow';
    isCreating.value = true;
    showCreateModal.value = false;
    actionError.value = null;

    const result = await createWorkflow(
        title,
        undefined,
        createDescription.value,
    );
    if (result.ok) {
        createName.value = '';
        createDescription.value = '';
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

function workflowDataWithDetails(
    workflow: WorkflowPost,
    title: string,
    description: string,
): WorkflowData {
    const base = workflow.meta ?? {
        meta: { version: '2.0.0', name: title },
        nodes: [
            {
                id: 'start',
                type: 'start',
                position: { x: 250, y: 100 },
                data: { label: 'Start' },
            },
        ],
        edges: [],
    };
    return {
        ...base,
        meta: {
            ...base.meta,
            name: title,
            description: description.trim() || undefined,
        },
    };
}

// Edit workflow name and description
function openDetailsModal(workflow: WorkflowPost, event: Event) {
    event.stopPropagation();
    workflowToEdit.value = workflow;
    detailsName.value = workflow.title;
    detailsDescription.value = workflowDescription(workflow);
    showDetailsModal.value = true;
}

async function handleUpdateWorkflowDetails() {
    if (!workflowToEdit.value) return;
    actionError.value = null;

    const title = detailsName.value.trim();
    if (!title) {
        actionError.value = 'Title cannot be empty';
        return;
    }

    const openPane = multiPane.panes.value.find(
        (pane) =>
            pane.mode === 'or3-workflows' &&
            pane.documentId === workflowToEdit.value?.id,
    );
    let data: WorkflowData;
    const openEditor = openPane ? getEditorForPane(openPane.id) : null;
    if (openEditor && !openEditor.isDestroyed()) {
        openEditor.setMeta({
            name: title,
            description: detailsDescription.value.trim() || undefined,
        });
        data = openEditor.getJSON();
    } else {
        data = workflowDataWithDetails(
            workflowToEdit.value,
            title,
            detailsDescription.value,
        );
    }

    const result = await updateWorkflow(workflowToEdit.value.id, {
        title,
        data,
    });
    if (!result.ok) {
        actionError.value = result.error;
        return;
    }

    showDetailsModal.value = false;
    workflowToEdit.value = null;
    detailsName.value = '';
    detailsDescription.value = '';
}
</script>

<template>
    <div class="flex flex-col flex-1 min-h-0">
        <!-- Header with create -->
        <div class="flex justify-between items-center px-2 py-2 shrink-0">
            <div class="min-w-0">
                <h1
                    class="font-semibold text-base text-[color:var(--md-on-surface)]"
                >
                    Workflows
                </h1>
                <p class="text-xs text-[color:var(--md-on-surface-variant)]">
                    Build and reuse automated tasks
                </p>
            </div>
            <div v-if="canEdit" class="flex items-center gap-1">
                <UTooltip :delay-duration="0" text="Import workflow">
                    <UButton
                        size="sm"
                        variant="ghost"
                        color="neutral"
                        icon="tabler:upload"
                        square
                        class="theme-btn"
                        aria-label="Import workflow"
                        @click="openImportDialog"
                    />
                </UTooltip>
                <UTooltip :delay-duration="0" text="New workflow">
                    <UButton
                        size="sm"
                        variant="ghost"
                        color="neutral"
                        icon="tabler:plus"
                        square
                        class="bg-[color:var(--md-primary)]/5 text-[color:var(--md-primary)] hover:bg-[color:var(--md-primary)]/10 theme-btn"
                        :loading="isCreating"
                        aria-label="New workflow"
                        @click="openCreateModal"
                    />
                </UTooltip>
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
            class="mx-2 mb-2 text-sm text-(--md-error) p-2 bg-(--md-error-container) rounded-[var(--md-border-radius)]"
        >
            {{ error }}
        </div>

        <!-- Loading state -->
        <div v-if="loading" class="flex items-center justify-center py-8">
            <UIcon name="tabler:loader-2" class="animate-spin text-xl" />
        </div>

        <!-- Empty state -->
        <SidebarEmptyState
            v-else-if="workflows.length === 0"
            icon="tabler:binary-tree-2"
            title="No workflows yet"
            description="Create a workflow to automate a task you run more than once."
            class="flex-1"
        >
            <template v-if="canEdit" #actions>
                <UButton
                    size="sm"
                    variant="ghost"
                    class="bg-[color:var(--md-primary)]/10 text-[color:var(--md-primary)] hover:bg-[color:var(--md-primary)]/15 theme-btn"
                    @click="openCreateModal"
                >
                    Create workflow
                </UButton>
            </template>
        </SidebarEmptyState>

        <!-- Workflow list -->
        <div v-else class="flex-1 min-h-0 overflow-y-auto px-2 pb-4">
            <section v-for="group in workflowGroups" :key="group.key">
                <SidebarGroupHeader
                    :label="group.label"
                    :collapsed="collapsedGroups.has(group.key)"
                    @toggle="toggleGroup(group.key)"
                />
                <div v-if="!collapsedGroups.has(group.key)" class="space-y-0.5">
                    <div
                        v-for="workflow in group.entries"
                        :key="workflow.id"
                        role="button"
                        tabindex="0"
                        class="workflow-list-item group relative min-w-0 flex items-start gap-2.5 px-2.5 py-2.5 rounded-[var(--md-border-radius)] cursor-pointer transition-colors duration-200 theme-btn retro-press"
                        :class="
                            activeWorkflowIds.has(workflow.id)
                                ? 'bg-[color:var(--md-primary)]/12 dark:bg-[color:var(--md-primary)]/20'
                                : 'hover:bg-[var(--md-surface-hover)]'
                        "
                        @click="openWorkflow(workflow.id)"
                        @keydown.enter="openWorkflow(workflow.id)"
                        @keydown.space.prevent="openWorkflow(workflow.id)"
                    >
                        <UIcon
                            name="tabler:binary-tree-2"
                            class="w-[18px] h-[18px] mt-0.5 shrink-0"
                            :class="
                                activeWorkflowIds.has(workflow.id)
                                    ? 'text-[color:var(--md-primary)]'
                                    : 'text-[color:var(--md-on-surface-variant)]/70 group-hover:text-[color:var(--md-on-surface)]/80'
                            "
                        />
                        <div class="min-w-0 flex-1 pr-7">
                            <div class="flex items-center gap-2 min-w-0">
                                <span
                                    class="flex-1 truncate text-sm leading-tight"
                                    :class="
                                        activeWorkflowIds.has(workflow.id)
                                            ? 'font-medium text-[color:var(--md-primary)]'
                                            : 'font-normal text-[color:var(--md-on-surface)]'
                                    "
                                >
                                    {{ workflow.title || 'Untitled Workflow' }}
                                </span>
                                <span
                                    class="hidden sm:inline-block shrink-0 text-[10px] font-medium text-[color:var(--md-on-surface-variant)] opacity-50 transition-opacity group-hover:opacity-0"
                                >
                                    {{
                                        formatTimeDisplay(
                                            workflow.updated_at,
                                            group.key,
                                        )
                                    }}
                                </span>
                            </div>
                            <p
                                class="mt-1 text-xs leading-snug text-[color:var(--md-on-surface-variant)] line-clamp-2"
                                :class="
                                    workflowDescription(workflow)
                                        ? ''
                                        : 'opacity-55 italic'
                                "
                            >
                                {{
                                    workflowDescription(workflow) ||
                                    'No description yet'
                                }}
                            </p>
                        </div>

                        <div
                            v-if="canEdit"
                            class="absolute right-1 top-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                            @click.stop
                            @keydown.stop
                        >
                            <UPopover
                                :content="{
                                    side: 'right',
                                    align: 'start',
                                    sideOffset: 6,
                                }"
                            >
                                <UButton
                                    size="xs"
                                    variant="ghost"
                                    color="neutral"
                                    icon="tabler:dots-vertical"
                                    square
                                    class="theme-btn"
                                    :aria-label="`Actions for ${workflow.title || 'Untitled Workflow'}`"
                                    @click.stop
                                />
                                <template #content>
                                    <div class="p-1 w-44 space-y-1">
                                        <UButton
                                            size="sm"
                                            variant="popover"
                                            color="neutral"
                                            icon="tabler:pencil"
                                            class="w-full justify-start"
                                            @click="
                                                openDetailsModal(
                                                    workflow,
                                                    $event,
                                                )
                                            "
                                        >
                                            Edit details
                                        </UButton>
                                        <UButton
                                            size="sm"
                                            variant="popover"
                                            color="neutral"
                                            icon="tabler:trash"
                                            class="w-full justify-start text-[var(--md-error)] hover:bg-[var(--md-error)]/10"
                                            @click="
                                                confirmDeleteWorkflow(
                                                    workflow,
                                                    $event,
                                                )
                                            "
                                        >
                                            Delete
                                        </UButton>
                                    </div>
                                </template>
                            </UPopover>
                        </div>
                    </div>
                </div>
            </section>
        </div>

        <!-- Create Modal -->
        <UModal
            v-if="canEdit"
            v-model:open="showCreateModal"
            :close="{
                size: 'sm',
                class: 'theme-btn',
            }"
            title="New Workflow"
            description="Name the workflow and explain what it does."
        >
            <template #body>
                <div class="space-y-4">
                    <label class="block space-y-1.5">
                        <span class="text-sm font-medium">Name</span>
                        <UInput
                            v-model="createName"
                            class="w-full"
                            placeholder="Fact checker"
                            autofocus
                            @keydown.enter="handleCreateWorkflow"
                        />
                    </label>
                    <label class="block space-y-1.5">
                        <span class="text-sm font-medium">Description</span>
                        <UTextarea
                            v-model="createDescription"
                            class="w-full"
                            :rows="3"
                            maxlength="240"
                            placeholder="Checks a claim against current sources and returns a concise verdict."
                        />
                        <span
                            class="block text-xs text-[color:var(--md-on-surface-variant)]"
                        >
                            Shown in the workflow browser.
                        </span>
                    </label>
                </div>
            </template>
            <template #footer>
                <div class="w-full flex justify-end gap-2">
                    <UButton
                        variant="ghost"
                        class="theme-btn cancel-wf"
                        @click="showCreateModal = false"
                    >
                        Cancel
                    </UButton>
                    <UButton
                        class="theme-btn create-wf"
                        @click="handleCreateWorkflow"
                        >Create</UButton
                    >
                </div>
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

        <!-- Workflow details modal -->
        <UModal
            v-if="canEdit"
            v-model:open="showDetailsModal"
            title="Workflow Details"
            description="Help people recognize when to use this workflow."
        >
            <template #body>
                <div class="space-y-4">
                    <label class="block space-y-1.5">
                        <span class="text-sm font-medium">Name</span>
                        <UInput
                            v-model="detailsName"
                            class="w-full"
                            placeholder="Workflow name"
                            autofocus
                            @keydown.enter="handleUpdateWorkflowDetails"
                        />
                    </label>
                    <label class="block space-y-1.5">
                        <span class="text-sm font-medium">Description</span>
                        <UTextarea
                            v-model="detailsDescription"
                            class="w-full"
                            :rows="3"
                            maxlength="240"
                            placeholder="What does this workflow do?"
                        />
                    </label>
                </div>
            </template>
            <template #footer>
                <UButton variant="ghost" @click="showDetailsModal = false">
                    Cancel
                </UButton>
                <UButton @click="handleUpdateWorkflowDetails">Save</UButton>
            </template>
        </UModal>
    </div>
</template>
