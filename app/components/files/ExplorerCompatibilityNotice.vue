<script setup lang="ts">
import AppModal from '~/components/ui/AppModal.vue';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [accepted: boolean] }>();
</script>

<template>
    <AppModal :open="props.open" title="Update your devices before using folders"
        close-label="Cancel folder changes" @update:open="open => { if (!open) emit('close', false); }">
        <p>Folders require a compatible OR3 version on every device. Older devices may stop syncing this workspace.
            Removing folders will not reverse this requirement while sync history remains.</p>
        <template #footer>
            <UButton size="workspace" label="Cancel" color="neutral" variant="outline" @click="emit('close', false)" />
            <UButton size="workspace" label="Continue" @click="emit('close', true)" />
        </template>
    </AppModal>
</template>
