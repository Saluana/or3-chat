<template>
    <SidebarRenameEntityModal
        :modal-props="renameModalProps"
        :open="showRenameModal"
        :title="isRenamingDoc ? 'Rename document' : 'Rename chat'"
        :placeholder="isRenamingDoc ? 'Document title' : 'Chat title'"
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

    <AppModal
        v-bind="deleteThreadModalProps"
        :open="showDeleteModal"
        title="Delete chat"
        @update:open="emit('update:showDeleteModal', $event)"
    >
        <template #default>
            <p class="text-sm opacity-70">
                <template v-if="threadHasDescendants">
                    {{ targetLabel('This chat') }} has branches. Move it to Trash to preserve their original links.
                </template>
                <template v-else>
                    {{ targetLabel('This chat') }} and its messages will be permanently deleted.
                </template>
            </p>
        </template>
        <template #footer>
            <UButton
                variant="ghost"
                size="modal"
                @click="emit('update:showDeleteModal', false)"
            >
                Cancel
            </UButton>
            <UButton v-if="threadHasDescendants" color="error" size="modal" @click="emit('softDeleteThread')">
                Move to Trash
            </UButton>
            <UButton v-else color="error" size="modal" @click="emit('deleteThread')">
                Delete
            </UButton>
        </template>
    </AppModal>

    <AppModal
        v-bind="deleteDocumentModalProps"
        :open="showDeleteDocumentModal"
        :title="documentTrashEnabled ? 'Trash document' : 'Delete document'"
        @update:open="emit('update:showDeleteDocumentModal', $event)"
    >
        <template #default>
            <p class="text-sm opacity-70">
                <template v-if="documentTrashEnabled">
                    {{ targetLabel('This document') }} will move to Files Trash, where you can restore it. Its history and shared files are kept.
                </template>
                <template v-else>
                    {{ targetLabel('This document') }} will be permanently deleted.
                </template>
            </p>
        </template>
        <template #footer>
            <UButton
                variant="ghost"
                size="modal"
                @click="emit('update:showDeleteDocumentModal', false)"
            >
                Cancel
            </UButton>
            <UButton color="error" size="modal" @click="emit('deleteDocument')">
                {{ documentTrashEnabled ? 'Trash' : 'Delete' }}
            </UButton>
        </template>
    </AppModal>

    <AppModal
        v-bind="deleteProjectModalProps"
        :open="showDeleteProjectModal"
        title="Delete project"
        @update:open="emit('update:showDeleteProjectModal', $event)"
    >
        <template #default>
            <p class="text-sm opacity-70">
                {{ targetLabel('This project') }} and its settings, memories and knowledge sources will be deleted.
                Its chats, documents and files stay in your workspace.
            </p>
        </template>
        <template #footer>
            <UButton
                variant="ghost"
                size="modal"
                @click="emit('update:showDeleteProjectModal', false)"
            >
                Cancel
            </UButton>
            <UButton color="error" size="modal" @click="emit('deleteProject')">
                Delete
            </UButton>
        </template>
    </AppModal>
</template>

<script setup lang="ts">
import AppModal from '~/components/ui/AppModal.vue';
import SidebarRenameEntityModal from './SidebarRenameEntityModal.vue';
import SidebarRenameProjectModal from './SidebarRenameProjectModal.vue';

const props = defineProps<{
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
    threadHasDescendants?: boolean;

    deleteDocumentModalProps: Record<string, unknown>;
    showDeleteDocumentModal: boolean;
    documentTrashEnabled?: boolean;

    deleteProjectModalProps: Record<string, unknown>;
    showDeleteProjectModal: boolean;

    deleteTargetTitle?: string;
}>();

/** Quote the item's name when known, e.g. “Weekly notes”; otherwise use the fallback. */
function targetLabel(fallback: string): string {
    const title = props.deleteTargetTitle?.trim();
    return title ? `“${title}”` : fallback;
}

const emit = defineEmits<{
    (e: 'update:showRenameModal', value: boolean): void;
    (e: 'update:renameTitle', value: string): void;
    (e: 'saveRename'): void;

    (e: 'update:showRenameProjectModal', value: boolean): void;
    (e: 'update:renameProjectName', value: string): void;
    (e: 'saveRenameProject'): void;

    (e: 'update:showDeleteModal', value: boolean): void;
    (e: 'deleteThread'): void;
    (e: 'softDeleteThread'): void;

    (e: 'update:showDeleteDocumentModal', value: boolean): void;
    (e: 'deleteDocument'): void;

    (e: 'update:showDeleteProjectModal', value: boolean): void;
    (e: 'deleteProject'): void;
}>();
</script>
