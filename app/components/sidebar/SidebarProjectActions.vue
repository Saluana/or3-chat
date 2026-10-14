<script setup lang="ts">
import { useIcon } from '~/composables/useIcon';
import { useSidebarProjectActionButtonProps } from '~/composables/sidebar/useSidebarProjectActionButtonProps';
defineProps<{ name: string; disabled?: boolean }>();
const emit = defineEmits<{ rename: []; delete: [] }>();
const moreIcon = useIcon('ui.more');
const editIcon = useIcon('ui.edit');
const trashIcon = useIcon('ui.trash');
const renameButtonProps = useSidebarProjectActionButtonProps({
    identifier: 'sidebar.project-rename',
    icon: editIcon.value,
});
const deleteButtonProps = useSidebarProjectActionButtonProps({
    identifier: 'sidebar.project-delete',
    icon: trashIcon.value,
});
</script>

<template>
    <UPopover :content="{ side: 'right', align: 'start', sideOffset: 6 }">
        <UButton
            :icon="moreIcon"
            :aria-label="`Project actions for ${name}`"
            :disabled="disabled"
            color="neutral"
            variant="ghost"
            size="xs"
            square
            @click.stop
        />
        <template #content>
            <div class="project-menu-content p-1 w-48 space-y-1">
                <UButton
                    v-bind="renameButtonProps"
                    class="w-full justify-start"
                    @click.stop.prevent="emit('rename')"
                >Rename Project</UButton>
                <UButton
                    v-bind="deleteButtonProps"
                    class="w-full justify-start text-[var(--md-error)]"
                    @click.stop.prevent="emit('delete')"
                >Delete Project</UButton>
            </div>
        </template>
    </UPopover>
</template>
