<template>
    <div
        class="project-root-container cursor-pointer group/project-root h-10 mx-1 mb-0.5"
    >
        <div
            role="button"
            tabindex="0"
            class="project-root-toggle relative group w-full flex items-center hover:bg-[var(--md-surface-hover)] px-3 gap-2 h-10 rounded-[var(--md-border-radius)] transition-colors duration-200"
            @click="emit('toggle-expand')"
            @keydown.enter="emit('toggle-expand')"
            @keydown.space="emit('toggle-expand')"
        >
            <UIcon
                :name="expanded ? iconExpand : iconCollapse"
                class="project-icon shrink-0 w-[18px] h-[18px] text-[color:var(--md-on-surface-variant)]/70 group-hover:text-[color:var(--md-on-surface)]/80 transition-colors"
                active-class="text-[color:var(--md-primary)]"
            />
            <span class="project-label truncate text-start flex-1 min-w-0 text-sm font-normal text-[color:var(--md-on-surface)] group-hover:text-[color:var(--md-on-surface)]">{{
                project.name
            }}</span>
            <span
                class="project-actions-container ms-auto inline-flex gap-1 items-center"
            >
                <div class="project-quick-actions flex items-center gap-1">
                    <!-- Quick add buttons (appear on hover) -->
                    <button
                        class="project-add-btn cursor-pointer sm:opacity-0 sm:group-hover/project-root:opacity-100 transition-opacity inline-flex items-center justify-center w-6 h-6 rounded-[var(--md-border-radius)] text-[color:var(--md-on-surface-variant)] hover:text-[color:var(--md-primary)] hover:bg-[color:var(--md-primary)]/10 active:bg-[color:var(--md-primary)]/20"
                        @click.stop="emit('add-chat')"
                        aria-label="Add chat to project"
                    >
                        <UIcon
                            :name="iconNewChat"
                            class="project-add-icon w-4 h-4"
                        />
                    </button>
                    <button
                        class="project-add-btn cursor-pointer sm:opacity-0 sm:group-hover/project-root:opacity-100 transition-opacity inline-flex items-center justify-center w-6 h-6 rounded-[var(--md-border-radius)] text-[color:var(--md-on-surface-variant)] hover:text-[color:var(--md-primary)] hover:bg-[color:var(--md-primary)]/10 active:bg-[color:var(--md-primary)]/20"
                        @click.stop="emit('add-document')"
                        aria-label="Add document to project"
                    >
                        <UIcon
                            :name="iconNewNote"
                            class="project-add-icon w-4 h-4"
                        />
                    </button>
                    <UPopover
                        :content="{
                            side: 'right',
                            align: 'start',
                            sideOffset: 6,
                        }"
                    >
                        <button
                            class="project-actions-menu inline-flex items-center justify-center w-6 h-6 rounded-[var(--md-border-radius)] cursor-pointer text-[color:var(--md-on-surface-variant)] hover:text-[color:var(--md-primary)] hover:bg-[color:var(--md-primary)]/10 active:bg-[color:var(--md-primary)]/20"
                            @click.stop
                            aria-label="Project actions"
                        >
                            <UIcon
                                :name="iconMore"
                                class="project-menu-icon w-4 h-4"
                            />
                        </button>
                        <template #content>
                            <div
                                class="project-menu-content p-1 w-48 space-y-1"
                            >
                                <UButton
                                    v-bind="renameButtonProps"
                                    class="w-full justify-start cursor-pointer"
                                    @click.stop.prevent="emit('rename')"
                                    >Rename Project</UButton
                                >
                                <UButton
                                    v-bind="deleteButtonProps"
                                    class="w-full justify-start cursor-pointer text-[var(--md-error)] hover:bg-[var(--md-error)]/10 active:bg-[var(--md-error)]/15"
                                    @click.stop.prevent="emit('delete')"
                                    >Delete Project</UButton
                                >
                            </div>
                        </template>
                    </UPopover>
                </div>
            </span>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ProjectEntry } from '~/utils/projects/normalizeProjectData';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { useIcon } from '~/composables/useIcon';

const iconExpand = useIcon('shell.expand');
const iconCollapse = useIcon('shell.collapse');
const iconNewChat = useIcon('sidebar.new_chat');
const iconNewNote = useIcon('sidebar.new_note');
const iconMore = useIcon('ui.more');
const iconEdit = useIcon('ui.edit');
const iconTrash = useIcon('ui.trash');

interface Project {
    id: string;
    name: string;
    data?: ProjectEntry[];
}

defineProps<{
    project: Project;
    expanded: boolean;
}>();

const emit = defineEmits<{
    (e: 'toggle-expand'): void;
    (e: 'add-chat'): void;
    (e: 'add-document'): void;
    (e: 'rename'): void;
    (e: 'delete'): void;
}>();

// Theme overrides for project action buttons
const renameOverrides = useThemeOverrides({
    component: 'button',
    context: 'sidebar',
    identifier: 'sidebar.project-rename',
    isNuxtUI: true,
});

const renameButtonProps = computed(() => ({
    color: 'neutral' as const,
    variant: 'popover' as const,
    size: 'sm' as const,
    icon: iconEdit.value,
    ...(renameOverrides.value as any),
}));

const deleteOverrides = useThemeOverrides({
    component: 'button',
    context: 'sidebar',
    identifier: 'sidebar.project-delete',
    isNuxtUI: true,
});

const deleteButtonProps = computed(() => ({
    color: 'neutral' as const,
    variant: 'popover' as const,
    size: 'sm' as const,
    icon: iconTrash.value,
    ...(deleteOverrides.value as any),
}));
</script>
