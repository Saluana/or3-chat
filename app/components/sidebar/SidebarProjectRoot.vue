<template>
    <div
        class="project-root-container cursor-pointer group/project-root h-[40px]!"
    >
        <button
            type="button"
            class="project-root-toggle relative group w-full flex items-center hover:bg-primary/10 px-2.5 gap-1.5 h-[40px]"
            @click="emit('toggle-expand')"
        >
            <UIcon
                :name="expanded ? iconExpand : iconCollapse"
                class="project-icon shrink-0 size-4 transition-transform duration-200"
            />
            <span class="project-label truncate text-start flex-1 min-w-0">{{
                project.name
            }}</span>
            <span
                class="project-actions-container ms-auto inline-flex gap-1.5 items-center"
            >
                <div class="project-quick-actions flex items-center gap-1">
                    <!-- Quick add buttons (appear on hover) -->
                    <button
                        class="project-add-btn cursor-pointer sm:opacity-0 sm:group-hover/project-root:opacity-100 transition-opacity inline-flex items-center justify-center w-5 h-5 rounded-[var(--md-border-radius)] hover:bg-black/10 active:bg-black/20"
                        @click.stop="emit('add-chat')"
                        aria-label="Add chat to project"
                    >
                        <UIcon
                            :name="iconNewChat"
                            class="project-add-icon w-4 h-4 opacity-70"
                        />
                    </button>
                    <button
                        class="project-add-btn cursor-pointer sm:opacity-0 sm:group-hover/project-root:opacity-100 transition-opacity inline-flex items-center justify-center w-5 h-5 rounded-[var(--md-border-radius)] hover:bg-black/10 active:bg-black/20"
                        @click.stop="emit('add-document')"
                        aria-label="Add document to project"
                    >
                        <UIcon
                            :name="iconNewNote"
                            class="project-add-icon w-4 h-4 opacity-70"
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
                            class="project-actions-menu inline-flex items-center justify-center w-5 h-5 rounded-[var(--md-border-radius)] hover:bg-black/10 active:bg-/20 cursor-pointer"
                            @click.stop
                            aria-label="Project actions"
                        >
                            <UIcon
                                :name="iconMore"
                                class="project-menu-icon w-4 h-4 opacity-70"
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
                                    class="w-full justify-start cursor-pointer text-error-500"
                                    @click.stop.prevent="emit('delete')"
                                    >Delete Project</UButton
                                >
                            </div>
                        </template>
                    </UPopover>
                </div>
            </span>
        </button>
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
const renameButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'sidebar',
        identifier: 'sidebar.project-rename',
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

const deleteButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'sidebar',
        identifier: 'sidebar.project-delete',
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
