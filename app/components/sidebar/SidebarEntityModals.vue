<template>
    <UModal
        v-bind="renameModalProps"
        :open="showRenameModal"
        :title="isRenamingDoc ? 'Rename document' : 'Rename thread'"
        @update:open="emit('update:showRenameModal', $event)"
    >
        <template #body>
            <div class="space-y-4">
                <UInput
                    :model-value="renameTitle"
                    class="w-full"
                    :placeholder="isRenamingDoc ? 'Document title' : 'Thread title'"
                    :icon="iconEdit"
                    @update:model-value="emit('update:renameTitle', String($event ?? ''))"
                    @keyup.enter="emit('saveRename')"
                />
            </div>
        </template>
        <template #footer>
            <UButton
                variant="ghost"
                class="theme-btn"
                @click="emit('update:showRenameModal', false)"
            >
                Cancel
            </UButton>
            <UButton color="primary" class="theme-btn" @click="emit('saveRename')">
                Save
            </UButton>
        </template>
    </UModal>

    <UModal
        v-bind="renameProjectModalProps"
        :open="showRenameProjectModal"
        title="Rename project"
        @update:open="emit('update:showRenameProjectModal', $event)"
    >
        <template #header><h3>Rename project?</h3></template>
        <template #body>
            <div class="space-y-4">
                <UInput
                    :model-value="renameProjectName"
                    placeholder="Project name"
                    :icon="iconFolder"
                    @update:model-value="emit('update:renameProjectName', String($event ?? ''))"
                    @keyup.enter="emit('saveRenameProject')"
                />
            </div>
        </template>
        <template #footer>
            <UButton
                variant="ghost"
                class="theme-btn"
                @click="emit('update:showRenameProjectModal', false)"
            >
                Cancel
            </UButton>
            <UButton
                color="primary"
                class="theme-btn"
                :disabled="!renameProjectName.trim()"
                @click="emit('saveRenameProject')"
            >
                Save
            </UButton>
        </template>
    </UModal>

    <UModal
        v-bind="deleteThreadModalProps"
        :open="showDeleteModal"
        title="Delete thread"
        @update:open="emit('update:showDeleteModal', $event)"
    >
        <template #body>
            <p class="text-sm opacity-70">
                This will permanently remove the thread and its messages.
            </p>
        </template>
        <template #footer>
            <UButton
                variant="ghost"
                class="theme-btn"
                @click="emit('update:showDeleteModal', false)"
            >
                Cancel
            </UButton>
            <UButton color="error" class="theme-btn" @click="emit('deleteThread')">
                Delete
            </UButton>
        </template>
    </UModal>

    <UModal
        v-bind="deleteDocumentModalProps"
        :open="showDeleteDocumentModal"
        title="Delete document"
        @update:open="emit('update:showDeleteDocumentModal', $event)"
    >
        <template #body>
            <p class="text-sm opacity-70">
                This will permanently remove the document.
            </p>
        </template>
        <template #footer>
            <UButton
                variant="ghost"
                class="theme-btn"
                @click="emit('update:showDeleteDocumentModal', false)"
            >
                Cancel
            </UButton>
            <UButton color="error" class="theme-btn" @click="emit('deleteDocument')">
                Delete
            </UButton>
        </template>
    </UModal>

    <UModal
        v-bind="deleteProjectModalProps"
        :open="showDeleteProjectModal"
        title="Delete project"
        @update:open="emit('update:showDeleteProjectModal', $event)"
    >
        <template #body>
            <p class="text-sm opacity-70">
                This will remove the project from the sidebar. Project data will
                be soft-deleted and can be recovered.
            </p>
        </template>
        <template #footer>
            <UButton
                variant="ghost"
                class="theme-btn"
                @click="emit('update:showDeleteProjectModal', false)"
            >
                Cancel
            </UButton>
            <UButton color="error" class="theme-btn" @click="emit('deleteProject')">
                Delete
            </UButton>
        </template>
    </UModal>
</template>

<script setup lang="ts">
defineProps<{
    renameModalProps: Record<string, unknown>;
    showRenameModal: boolean;
    renameTitle: string;
    isRenamingDoc: boolean;
    iconEdit: string;

    renameProjectModalProps: Record<string, unknown>;
    showRenameProjectModal: boolean;
    renameProjectName: string;
    iconFolder: string;

    deleteThreadModalProps: Record<string, unknown>;
    showDeleteModal: boolean;

    deleteDocumentModalProps: Record<string, unknown>;
    showDeleteDocumentModal: boolean;

    deleteProjectModalProps: Record<string, unknown>;
    showDeleteProjectModal: boolean;
}>();

const emit = defineEmits<{
    (e: 'update:showRenameModal', value: boolean): void;
    (e: 'update:renameTitle', value: string): void;
    (e: 'saveRename'): void;

    (e: 'update:showRenameProjectModal', value: boolean): void;
    (e: 'update:renameProjectName', value: string): void;
    (e: 'saveRenameProject'): void;

    (e: 'update:showDeleteModal', value: boolean): void;
    (e: 'deleteThread'): void;

    (e: 'update:showDeleteDocumentModal', value: boolean): void;
    (e: 'deleteDocument'): void;

    (e: 'update:showDeleteProjectModal', value: boolean): void;
    (e: 'deleteProject'): void;
}>();
</script>
