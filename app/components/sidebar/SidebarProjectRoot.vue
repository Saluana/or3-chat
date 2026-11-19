<template>
    <div
        class="project-root-container cursor-pointer group/project-root h-10 mx-1 mb-px"
        :data-project-id="project.id"
    >
        <div
            data-marquee-host
            class="project-root-toggle relative group w-full flex items-center hover:bg-[var(--md-surface-hover)] px-3 gap-2 h-10 rounded-[var(--md-border-radius-small,var(--md-border-radius))] transition-colors duration-[var(--app-motion-duration-medium,200ms)] ease-[var(--app-motion-easing-standard,ease)] focus-visible:outline-[length:var(--app-focus-ring-width,2px)] focus-visible:outline-[color:var(--md-focus-ring,var(--md-primary))] focus-visible:outline-offset-[var(--app-focus-ring-offset,2px)]"
        >
            <!-- The idle icon gives way to the disclosure chevron on hover or keyboard focus. -->
            <button type="button" class="project-expand-btn grid place-items-center shrink-0 size-6 -mx-[3px] rounded-[var(--md-border-radius-small,var(--md-border-radius))] text-[color:var(--md-on-surface-variant)]/70 group-hover/project-root:text-[color:var(--md-on-surface)]/80 hover:bg-[var(--md-surface-active)] focus-visible:outline-2 focus-visible:outline-(--md-focus-ring)" :aria-label="`${expanded ? 'Collapse' : 'Expand'} ${project.name} shortcuts`" :aria-expanded="expanded" @click.stop="emit('toggle-expand')">
                <UIcon
                    :name="project.pinned ? pinIcon : iconFolder"
                    class="project-icon [grid-area:1/1] size-[18px] transition-opacity duration-150 group-hover/project-root:opacity-0 group-has-[:focus-visible]/project-root:opacity-0"
                    :class="{ '[@media(hover:none)]:opacity-0': !project.pinned }"
                />
                <UIcon
                    :name="iconChevron"
                    class="project-chevron [grid-area:1/1] size-[18px] opacity-0 transition-[opacity,transform] duration-150 group-hover/project-root:opacity-100 group-has-[:focus-visible]/project-root:opacity-100"
                    :class="{ 'rotate-90': expanded, '[@media(hover:none)]:opacity-100': !project.pinned }"
                />
            </button>
            <button type="button" @click="openHome()" :aria-label="`Open project ${project.name}`" :aria-description="project.pinned ? 'Pinned project' : undefined" class="project-label h-full focus-visible:outline-2 focus-visible:outline-(--md-focus-ring) text-start flex-1 min-w-0 text-sm font-medium text-[color:var(--md-on-surface)] group-hover:text-[color:var(--md-on-surface)]"><span v-title-marquee class="block truncate">{{
                project.name
            }}</span></button>
            <span
                class="project-actions-container ms-auto inline-flex shrink-0 gap-1 items-center"
            >
                <!-- Actions appear on hover/focus, and stay while the menu is open. -->
                <div class="project-quick-actions flex items-center gap-1 sm:hidden sm:group-hover/project-root:flex sm:group-focus-within/project-root:flex sm:group-has-[[data-state=open]]/project-root:flex">
                    <button
                        class="project-add-btn cursor-pointer inline-flex items-center justify-center w-6 h-6 rounded-[var(--md-border-radius-small,var(--md-border-radius))] text-[color:var(--md-on-surface-variant)] hover:text-[color:var(--md-primary)] hover:bg-[color:var(--md-primary)]/10 active:bg-[color:var(--md-primary)]/20"
                        @click.stop="emit('add-chat')"
                        :aria-label="`New chat in ${project.name}`"
                    >
                        <UIcon
                            :name="iconNewChat"
                            class="project-add-icon w-4 h-4"
                        />
                    </button>
                    <button
                        class="project-add-btn cursor-pointer inline-flex items-center justify-center w-6 h-6 rounded-[var(--md-border-radius-small,var(--md-border-radius))] text-[color:var(--md-on-surface-variant)] hover:text-[color:var(--md-primary)] hover:bg-[color:var(--md-primary)]/10 active:bg-[color:var(--md-primary)]/20"
                        @click.stop="emit('add-document')"
                        :aria-label="`New document in ${project.name}`"
                    >
                        <UIcon
                            :name="iconNewNote"
                            class="project-add-icon w-4 h-4"
                        />
                    </button>
                    <SidebarProjectActions
                        :name="project.name"
                        @rename="emit('rename')"
                        @delete="emit('delete')"
                    >
                        <template #default="{ close }">
                            <UButton
                                v-if="canCreateFolder"
                                v-bind="newFolderButtonProps"
                                class="w-full justify-start"
                                @click.stop.prevent="close(); emit('new-folder')"
                            >New folder</UButton>
                            <UButton
                                v-if="canPin"
                                v-bind="extraActionButtonProps"
                                :icon="pinIcon"
                                :disabled="pinPending"
                                class="w-full justify-start"
                                @click.stop.prevent="close(); updatePin()"
                            >{{ project.pinned ? 'Unpin project' : 'Pin project' }}</UButton>
                            <UButton
                                v-bind="extraActionButtonProps"
                                :icon="settingsIcon"
                                class="w-full justify-start"
                                @click.stop.prevent="close(); openHome('Settings')"
                            >Project settings</UButton>
                        </template>
                    </SidebarProjectActions>
                </div>
            </span>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useProjectSidebar } from '~/composables/sidebar/useProjectSidebar';
import { useSidebarProjectActionButtonProps } from '~/composables/sidebar/useSidebarProjectActionButtonProps';
import type { SidebarProject } from '~/composables/sidebar/useSidebarProjectDisplay';
import { useIcon } from '~/composables/useIcon';
import { setProjectPinned } from '~/db/project-workspace';
import { captureProjectOperation } from '~/utils/projects/operation';
import SidebarProjectActions from './SidebarProjectActions.vue';
import { vTitleMarquee } from '~/utils/title-marquee';
const { openProjectSidebar } = useProjectSidebar();
const toast = useToast();
async function openHome(section?: 'Settings') {
    try {
        await openProjectSidebar(props.project.id, 'home', section);
    } catch (error) {
        toast.add({
            title: 'Project unavailable',
            description: error instanceof Error ? error.message : 'Could not open project.',
            color: 'error',
        });
    }
}
const pinPending = ref(false);
async function updatePin() {
    if (!props.canPin || pinPending.value) return;
    pinPending.value = true;
    try {
        await setProjectPinned(captureProjectOperation(), props.project.id, !props.project.pinned);
    } catch (error) {
        toast.add({
            title: 'Could not update project pin',
            description: error instanceof Error ? error.message : undefined,
            color: 'error',
        });
    } finally {
        pinPending.value = false;
    }
}

const iconFolder = useIcon('shell.collapse');
const pinIcon = useIcon('ui.pin');
const iconChevron = useIcon('ui.chevron.right');
const iconNewChat = useIcon('sidebar.new_chat');
const iconNewNote = useIcon('sidebar.new_note');
const newFolderIcon = useIcon('sidebar.new_folder');
const settingsIcon = useIcon('ui.settings');
const extraActionButtonProps = useSidebarProjectActionButtonProps({ identifier: 'sidebar.project-extra-action' });
const newFolderButtonProps = useSidebarProjectActionButtonProps({
    identifier: 'sidebar.project-extra-action',
    icon: newFolderIcon,
});

const props = defineProps<{
    project: SidebarProject;
    expanded: boolean;
    canCreateFolder: boolean;
    canPin: boolean;
}>();

const emit = defineEmits<{
    (e: 'toggle-expand'): void;
    (e: 'add-chat'): void;
    (e: 'add-document'): void;
    (e: 'new-folder'): void;
    (e: 'rename'): void;
    (e: 'delete'): void;
}>();
</script>
