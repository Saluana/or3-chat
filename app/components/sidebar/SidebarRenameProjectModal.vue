<template>
    <SidebarRenameEntityModal
        :modal-props="modalProps"
        :open="open"
        title="Rename project"
        placeholder="Project name"
        :icon="iconFolder"
        :value="value"
        @update:open="emit('update:open', $event)"
        @update:value="emit('update:value', $event)"
        @submit="emit('submit')"
    />
</template>

<script setup lang="ts">
import SidebarRenameEntityModal from './SidebarRenameEntityModal.vue';

defineProps<{
    modalProps: Record<string, unknown>;
    open: boolean;
    value: string;
    iconFolder: string;
}>();

const emit = defineEmits<{
    (e: 'update:open', value: boolean): void;
    (e: 'update:value', value: string): void;
    (e: 'submit'): void;
}>();
</script>
