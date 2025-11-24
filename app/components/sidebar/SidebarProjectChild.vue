<template>
    <div
        class="project-child-container border-l-[3px]! my-0.5 border-primary-500 h-[40px] transition-all duration-150 ease-out"
    >
        <button
            type="button"
            class="project-child-toggle relative group w-full flex items-center h-full bg-[var(--md-inverse-surface)]/5 hover:bg-primary/10 backdrop-blur-md px-2.5 gap-1.5 rounded-r-[4px] py-1 transition-colors duration-150"
            :class="{ 'bg-primary/25 hover:bg-primary/25': active }"
            @click="emit('select')"
        >
            <UIcon
                :name="child.kind === 'doc' ? iconNote : iconChat"
                class="project-child-icon shrink-0 size-4"
            />
            <span
                class="project-child-label truncate text-start flex-1 min-w-0"
                >{{ child.name || '(untitled)' }}</span
            >
            <span
                class="project-child-actions-container ms-auto inline-flex gap-1.5 items-center"
            >
                <UPopover
                    :content="{
                        side: 'right',
                        align: 'start',
                        sideOffset: 6,
                    }"
                >
                    <span
                        class="project-child-actions-menu inline-flex items-center justify-center w-5 h-5 rounded-[var(--md-border-radius)] hover:bg-black/10 active:bg-black/20"
                        role="button"
                        tabindex="0"
                        @click.stop
                        @keydown="handlePopoverTriggerKey"
                        aria-label="Entry actions"
                    >
                        <UIcon
                            :name="iconMore"
                            class="project-child-menu-icon w-4 h-4 opacity-70"
                        />
                    </span>
                    <template #content>
                        <div
                            class="project-child-menu-content p-1 w-48 space-y-1"
                        >
                            <UButton
                                v-bind="renameButtonProps"
                                class="w-full justify-start"
                                @click.stop.prevent="emit('rename')"
                                >Rename</UButton
                            >
                            <UButton
                                v-bind="removeButtonProps"
                                class="w-full justify-start text-error-500"
                                @click.stop.prevent="emit('remove')"
                                >Remove from Project</UButton
                            >
                        </div>
                    </template>
                </UPopover>
            </span>
        </button>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ProjectEntry } from '~/utils/projects/normalizeProjectData';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { useIcon } from '~/composables/useIcon';
import { usePopoverKeyboard } from '~/composables/usePopoverKeyboard';

const { handlePopoverTriggerKey } = usePopoverKeyboard();

const iconNote = useIcon('sidebar.note');
const iconChat = useIcon('sidebar.chat');
const iconMore = useIcon('ui.more');
const iconEdit = useIcon('ui.edit');
const iconTrash = useIcon('ui.trash');

defineProps<{
    child: ProjectEntry;
    parentId: string;
    active?: boolean;
}>();

const emit = defineEmits<{
    (e: 'select'): void;
    (e: 'rename'): void;
    (e: 'remove'): void;
}>();

// Theme overrides for project child action buttons
const renameButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'sidebar',
        identifier: 'sidebar.project-entry-rename',
        isNuxtUI: true,
    });
    return {
        color: 'neutral' as const,
        variant: 'popover' as const,
        size: 'sm' as const,
        icon: iconEdit.value,
        ...(overrides.value as any),
    };
});

const removeButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'sidebar',
        identifier: 'sidebar.project-entry-remove',
        isNuxtUI: true,
    });
    return {
        color: 'error' as const,
        variant: 'popover' as const,
        size: 'sm' as const,
        icon: iconTrash.value,
        ...(overrides.value as any),
    };
});
</script>
