<script setup lang="ts">
import { computed } from 'vue';
import type { DropdownMenuItem } from '@nuxt/ui';
import { useThemeOverrides } from '~/composables/useThemeResolver';

const props = defineProps<{
    projectName: string;
    documentsEnabled: boolean;
    disabled: boolean;
}>();
const emit = defineEmits<{ create: [kind: 'chat' | 'document'] }>();

const plusIcon = useIcon('ui.plus');
const chatIcon = useIcon('sidebar.new_chat');
const documentIcon = useIcon('sidebar.new_note');
const buttonTheme = useThemeOverrides({
    component: 'button',
    context: 'sidebar',
    isNuxtUI: true,
});
const items = computed<DropdownMenuItem[]>(() => {
    const actions: DropdownMenuItem[] = [
        { label: 'New chat', icon: chatIcon.value, onSelect: () => emit('create', 'chat') },
    ];
    if (props.documentsEnabled) {
        actions.push({
            label: 'New document',
            icon: documentIcon.value,
            onSelect: () => emit('create', 'document'),
        });
    }
    return actions;
});
</script>

<template>
    <UDropdownMenu
        :items="items"
        :disabled="disabled"
        :content="{ align: 'end', sideOffset: 4 }"
    >
        <UButton
            v-bind="buttonTheme"
            :icon="plusIcon"
            :aria-label="`New in ${projectName}`"
            :disabled="disabled"
            label="New"
            size="sm"
            color="primary"
            variant="ghost"
            class="project-create-trigger shrink-0 whitespace-nowrap pointer-coarse:min-h-[44px]!"
        />
    </UDropdownMenu>
</template>

<style scoped>
.project-create-trigger {
    color: color-mix(in srgb, var(--project-accent) 78%, var(--md-on-surface));
}
</style>
