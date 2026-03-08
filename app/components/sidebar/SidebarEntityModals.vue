<template>
    <SidebarRenameEntityModal
        :modal-props="renameModalProps"
        :open="showRenameModal"
        :title="isRenamingDoc ? 'Rename document' : 'Rename thread'"
        :placeholder="isRenamingDoc ? 'Document title' : 'Thread title'"
        :icon="iconEdit"
        :value="renameTitle"
        @update:open="emit('update:showRenameModal', $event)"
        @update:value="emit('update:renameTitle', $event)"
        @submit="emit('saveRename')"
    />

    <SidebarRenameProjectModal
        :modal-props="renameProjectModalProps"
        :open="showRenameProjectModal"
        :value="renameProjectName"
        :icon-folder="iconFolder"
        @update:open="emit('update:showRenameProjectModal', $event)"
        @update:value="emit('update:renameProjectName', $event)"
        @submit="emit('saveRenameProject')"
    />

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
import SidebarRenameEntityModal from './SidebarRenameEntityModal.vue';
import SidebarRenameProjectModal from './SidebarRenameProjectModal.vue';

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
