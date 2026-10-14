<template>
    <div
        class="project-root-container cursor-pointer group/project-root h-10 mx-1 mb-0.5"
        :data-project-id="project.id"
    >
        <div
            class="project-root-toggle relative group w-full flex items-center hover:bg-[var(--md-surface-hover)] px-3 gap-2 h-10 rounded-[var(--md-border-radius-small,var(--md-border-radius))] transition-colors duration-[var(--app-motion-duration-medium,200ms)] ease-[var(--app-motion-easing-standard,ease)] focus-visible:outline-[length:var(--app-focus-ring-width,2px)] focus-visible:outline-[color:var(--md-focus-ring,var(--md-primary))] focus-visible:outline-offset-[var(--app-focus-ring-offset,2px)]"
        >
            <button type="button" class="inline-flex items-center justify-center shrink-0 size-[18px] focus-visible:outline-2 focus-visible:outline-(--md-focus-ring)" :aria-label="`${expanded ? 'Collapse' : 'Expand'} ${project.name} shortcuts`" :aria-expanded="expanded" @click.stop="emit('toggle-expand')"><UIcon
                :name="expanded ? iconExpand : iconCollapse"
                class="project-icon shrink-0 w-[18px] h-[18px] text-[color:var(--md-on-surface-variant)]/70 group-hover:text-[color:var(--md-on-surface)]/80 transition-colors"
                active-class="text-[color:var(--md-primary)]"
            /></button>
            <button type="button" @click="openHome" :aria-label="`Open project ${project.name}`" class="project-label h-full focus-visible:outline-2 focus-visible:outline-(--md-focus-ring) truncate text-start flex-1 min-w-0 text-sm font-normal text-[color:var(--md-on-surface)] group-hover:text-[color:var(--md-on-surface)]">{{
                project.name
            }}</button>
            <span
                class="project-actions-container ms-auto inline-flex gap-1 items-center"
            >
                <div class="project-quick-actions flex items-center gap-1">
                    <!-- Quick add buttons (appear on hover) -->
                    <button
                        class="project-add-btn cursor-pointer sm:hidden sm:group-hover/project-root:inline-flex sm:group-focus-within/project-root:inline-flex inline-flex items-center justify-center w-6 h-6 rounded-[var(--md-border-radius-small,var(--md-border-radius))] text-[color:var(--md-on-surface-variant)] hover:text-[color:var(--md-primary)] hover:bg-[color:var(--md-primary)]/10 active:bg-[color:var(--md-primary)]/20"
                        @click.stop="emit('add-chat')"
                        :aria-label="`New chat in ${project.name}`"
                    >
                        <UIcon
                            :name="iconNewChat"
                            class="project-add-icon w-4 h-4"
                        />
                    </button>
                    <button
                        class="project-add-btn cursor-pointer sm:hidden sm:group-hover/project-root:inline-flex sm:group-focus-within/project-root:inline-flex inline-flex items-center justify-center w-6 h-6 rounded-[var(--md-border-radius-small,var(--md-border-radius))] text-[color:var(--md-on-surface-variant)] hover:text-[color:var(--md-primary)] hover:bg-[color:var(--md-primary)]/10 active:bg-[color:var(--md-primary)]/20"
                        @click.stop="emit('add-document')"
                        :aria-label="`New document in ${project.name}`"
                    >
                        <UIcon
                            :name="iconNewNote"
                            class="project-add-icon w-4 h-4"
                        />
                    </button>
                    <UPopover
                        v-model:open="menuOpen"
                        :content="{
                            side: 'right',
                            align: 'start',
                            sideOffset: 6,
                        }"
                    >
                        <button
                            class="project-actions-menu inline-flex items-center justify-center w-6 h-6 rounded-[var(--md-border-radius-small,var(--md-border-radius))] cursor-pointer text-[color:var(--md-on-surface-variant)] hover:text-[color:var(--md-primary)] hover:bg-[color:var(--md-primary)]/10 active:bg-[color:var(--md-primary)]/20"
                            @click.stop
                            :aria-label="`Actions for project ${project.name}`"
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
                                    @click.stop.prevent="menuOpen = false; emit('rename')"
                                    >Rename project</UButton
                                >
                                <UButton
                                    v-bind="deleteButtonProps"
                                    class="w-full justify-start cursor-pointer text-[var(--md-error)] hover:bg-[var(--md-error)]/10 active:bg-[var(--md-error)]/15"
                                    @click.stop.prevent="menuOpen = false; emit('delete')"
                                    >Delete project</UButton
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
import { ref } from 'vue';
import { useProjectSidebar } from '~/composables/sidebar/useProjectSidebar';
import type { ProjectEntry } from '~/utils/projects/normalizeProjectData';
import { useIcon } from '~/composables/useIcon';
import { useSidebarProjectActionButtonProps } from '~/composables/sidebar/useSidebarProjectActionButtonProps';
const { openProjectSidebar } = useProjectSidebar();
const toast = useToast();
const menuOpen = ref(false);
async function openHome() {
    try {
        await openProjectSidebar(props.project.id);
    } catch (error) {
        toast.add({
            title: 'Project unavailable',
            description: error instanceof Error ? error.message : 'Could not open project.',
            color: 'error',
        });
    }
}

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

const props = defineProps<{
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

const renameButtonProps = useSidebarProjectActionButtonProps({
    identifier: 'sidebar.project-rename',
    icon: iconEdit.value,
});

const deleteButtonProps = useSidebarProjectActionButtonProps({
    identifier: 'sidebar.project-delete',
    icon: iconTrash.value,
});
</script>
