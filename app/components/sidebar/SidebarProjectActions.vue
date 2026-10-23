<script setup lang="ts">
import { ref } from 'vue';
import { useIcon } from '~/composables/useIcon';
import { useSidebarProjectActionButtonProps } from '~/composables/sidebar/useSidebarProjectActionButtonProps';
defineProps<{ name: string; disabled?: boolean }>();
const emit = defineEmits<{ rename: []; delete: [] }>();
// Close the menu when an action opens its dialog so it doesn't linger behind it.
const menuOpen = ref(false);
// Recycled project rows should initialize their popover only when first used.
// Keep it afterward so Reka owns closing and focus restoration.
const menuMounted = ref(false);
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
    <UButton
        v-if="!menuMounted"
        :icon="moreIcon"
        class="project-more-btn"
        :aria-label="`Project actions for ${name}`"
        aria-haspopup="dialog"
        :aria-expanded="false"
        :disabled="disabled"
        color="neutral"
        variant="ghost"
        size="xs"
        square
        @click.stop="menuMounted = true; menuOpen = true"
    />
    <UPopover v-else v-model:open="menuOpen" :content="{ side: 'right', align: 'start', sideOffset: 6 }">
        <UButton
            :icon="moreIcon"
            class="project-more-btn"
            :aria-label="`Project actions for ${name}`"
            :disabled="disabled"
            color="neutral"
            variant="ghost"
            size="xs"
            square
            @click.stop
        />
        <template #content>
            <div class="or3-action-menu project-menu-content p-1 w-48">
                <UButton
                    v-bind="renameButtonProps"
                    class="w-full justify-start"
                    @click.stop.prevent="menuOpen = false; emit('rename')"
                >Rename project</UButton>
                <UButton
                    v-bind="deleteButtonProps"
                    class="w-full justify-start text-[var(--md-error)]"
                    @click.stop.prevent="menuOpen = false; emit('delete')"
                >Delete project</UButton>
            </div>
        </template>
    </UPopover>
</template>
