<template>
    <div
        class="project-child-container h-10 mx-1 mb-0.5"
    >
        <div
            role="button"
            tabindex="0"
            class="project-child-toggle relative group w-full flex items-center h-full px-3 gap-2 rounded-[var(--md-border-radius-small,var(--md-border-radius))] transition-colors duration-200 cursor-pointer"
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
                v-title-marquee
                class="project-child-label truncate text-start flex-1 min-w-0 text-sm font-normal"
                >{{ child.name || 'Untitled' }}</span
            >
            <span
                class="project-child-actions-container ms-auto inline-flex gap-1 items-center sm:hidden sm:group-hover:inline-flex sm:group-focus-within:inline-flex"
            >
                <UPopover
                    v-model:open="menuOpen"
                    :content="{
                        side: 'right',
                        align: 'start',
                        sideOffset: 6,
                    }"
                >
                    <button
                        class="project-child-actions-menu inline-flex items-center justify-center w-6 h-6 rounded-[var(--md-border-radius-small,var(--md-border-radius))] cursor-pointer text-[color:var(--md-on-surface-variant)] hover:text-[color:var(--md-primary)] hover:bg-[color:var(--md-primary)]/10 active:bg-[color:var(--md-primary)]/20"
                        @click.stop
                        @keydown="handlePopoverTriggerKey"
                        :aria-label="`Actions for ${child.name || 'Untitled'}`"
                    >
                        <UIcon
                            :name="iconMore"
                            class="project-child-menu-icon w-4 h-4"
                        />
                    </button>
                    <template #content>
                        <div
                            class="or3-action-menu project-child-menu-content p-1 w-48"
                        >
                            <UButton
                                v-if="canOpenInNewTab"
                                v-bind="openTabButtonProps"
                                class="w-full justify-start"
                                @click.stop.prevent="openInNewTab"
                                >Open in new tab</UButton
                            >
                            <UButton
                                v-if="!isMobile"
                                v-bind="openPaneButtonProps"
                                class="w-full justify-start"
                                :disabled="!canOpenInNewPane"
                                :title="
                                    canOpenInNewPane
                                        ? 'Open in new pane'
                                        : 'Maximum pane limit reached'
                                "
                                @click.stop.prevent="openInNewPane"
                                >Open in new pane</UButton
                            >
                            <UButton
                                v-bind="renameButtonProps"
                                class="w-full justify-start"
                                @click.stop.prevent="menuOpen = false; emit('rename')"
                                >Rename</UButton
                            >
                            <UButton
                                v-bind="removeButtonProps"
                                class="w-full justify-start whitespace-nowrap text-[var(--md-error)] hover:bg-[var(--md-error)]/10 active:bg-[var(--md-error)]/15"
                                @click.stop.prevent="menuOpen = false; emit('remove')"
                                >Remove from project</UButton
                            >
                        </div>
                    </template>
                </UPopover>
            </span>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { ProjectEntry } from '~/utils/projects/normalizeProjectData';
import { useIcon } from '~/composables/useIcon';
import { usePopoverKeyboard } from '~/composables/usePopoverKeyboard';
import { useSidebarProjectActionButtonProps } from '~/composables/sidebar/useSidebarProjectActionButtonProps';
import { useWorkspaceResourceActions } from '~/composables/core/useWorkspaceResourceActions';
import { isMobile } from '~/state/global';
import { vTitleMarquee } from '~/utils/title-marquee';

const { handlePopoverTriggerKey } = usePopoverKeyboard();
const menuOpen = ref(false);

const iconNote = useIcon('sidebar.note');
const iconChat = useIcon('sidebar.chat');
const iconMore = useIcon('ui.more');
const iconEdit = useIcon('ui.edit');
const iconTrash = useIcon('ui.trash');

const props = defineProps<{
    child: ProjectEntry;
    active?: boolean;
}>();

const emit = defineEmits<{
    (e: 'select'): void;
    (e: 'rename'): void;
    (e: 'remove'): void;
}>();

const renameButtonProps = useSidebarProjectActionButtonProps({
    identifier: 'sidebar.project-entry-rename',
    icon: iconEdit.value,
});

const removeButtonProps = useSidebarProjectActionButtonProps({
    identifier: 'sidebar.project-entry-remove',
    icon: iconTrash.value,
});

const openTabButtonProps = useSidebarProjectActionButtonProps({
    identifier: 'sidebar.project-entry-open-tab',
    icon: useIcon('ui.open_tab').value,
});

const openPaneButtonProps = useSidebarProjectActionButtonProps({
    identifier: 'sidebar.project-entry-open-pane',
    icon: useIcon('ui.open_pane').value,
});

const workspaceResource = computed(() =>
    props.child.kind === 'chat'
        ? { kind: 'chat' as const, threadId: props.child.id }
        : { kind: 'document' as const, documentId: props.child.id }
);
const {
    canOpenInNewTab,
    canOpenInNewPane,
    openInNewTab,
    openInNewPane,
} = useWorkspaceResourceActions(workspaceResource);
</script>
