<template>
    <div
        class="project-child-container h-10 mx-1 mb-0.5"
    >
        <div
            role="button"
            tabindex="0"
            class="project-child-toggle relative group w-full flex items-center h-full px-3 gap-2 rounded-[var(--md-border-radius)] transition-colors duration-200 cursor-pointer"
            :class="{ 
                'bg-[color:var(--md-primary)]/12 text-[color:var(--md-primary)]': active,
                'hover:bg-[var(--md-surface-hover)] text-[color:var(--md-on-surface-variant)] hover:text-[color:var(--md-on-surface)]': !active
            }"
            @click="emit('select')"
            @keydown.enter="emit('select')"
            @keydown.space="emit('select')"
        >
            <UIcon
                :name="child.kind === 'doc' ? iconNote : iconChat"
                class="project-child-icon shrink-0 w-[18px] h-[18px]"
                :class="{
                    'text-[color:var(--md-primary)] opacity-100': active,
                    'text-[color:var(--md-on-surface-variant)] opacity-70 group-hover:opacity-80': !active
                }"
            />
            <span
                class="project-child-label truncate text-start flex-1 min-w-0 text-sm font-normal"
                >{{ child.name || '(untitled)' }}</span
            >
            <span
                class="project-child-actions-container ms-auto inline-flex gap-1 items-center opacity-0 group-hover:opacity-100 transition-opacity"
            >
                <UPopover
                    :content="{
                        side: 'right',
                        align: 'start',
                        sideOffset: 6,
                    }"
                >
                    <button
                        class="project-child-actions-menu inline-flex items-center justify-center w-6 h-6 rounded-[var(--md-border-radius)] cursor-pointer text-[color:var(--md-on-surface-variant)] hover:text-[color:var(--md-primary)] hover:bg-[color:var(--md-primary)]/10 active:bg-[color:var(--md-primary)]/20"
                        @click.stop
                        @keydown="handlePopoverTriggerKey"
                        aria-label="Entry actions"
                    >
                        <UIcon
                            :name="iconMore"
                            class="project-child-menu-icon w-4 h-4"
                        />
                    </button>
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
                                class="w-full justify-start whitespace-nowrap text-[var(--md-error)] hover:bg-[var(--md-error)]/10 active:bg-[var(--md-error)]/15"
                                @click.stop.prevent="emit('remove')"
                                >Remove from Project</UButton
                            >
                        </div>
                    </template>
                </UPopover>
            </span>
        </div>
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
    active?: boolean;
}>();

const emit = defineEmits<{
    (e: 'select'): void;
    (e: 'rename'): void;
    (e: 'remove'): void;
}>();

// Theme overrides for project child action buttons
const renameOverrides = useThemeOverrides({
    component: 'button',
    context: 'sidebar',
    identifier: 'sidebar.project-entry-rename',
    isNuxtUI: true,
});

const renameButtonProps = computed(() => ({
    color: 'neutral' as const,
    variant: 'popover' as const,
    size: 'sm' as const,
    icon: iconEdit.value,
    ...(renameOverrides.value as any),
}));

const removeOverrides = useThemeOverrides({
    component: 'button',
    context: 'sidebar',
    identifier: 'sidebar.project-entry-remove',
    isNuxtUI: true,
});

const removeButtonProps = computed(() => ({
    color: 'neutral' as const,
    variant: 'popover' as const,
    size: 'sm' as const,
    icon: iconTrash.value,
    ...(removeOverrides.value as any),
}));
</script>
