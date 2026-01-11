<template>
    <div v-if="projects.length" class="space-y-1">
        <h1 class="sidebar-section-heading px-1 py-3 select-none">Projects</h1>
        <UTree
            v-model:expanded="internalExpanded"
            :items="treeItems"
            color="neutral"
            size="sm"
            :ui="ui"
        >
            <template #item-trailing="{ item, level }">
                <div class="flex items-center gap-1">
                    <!-- Root-level quick add buttons (appear on hover) -->
                    <template v-if="level === 0">
                        <button
                            class="cursor-pointer sm:opacity-0 sm:group-hover/addchat:opacity-100 transition-opacity inline-flex items-center justify-center w-5 h-5 rounded-[var(--md-border-radius)] hover:bg-black/10 active:bg-black/20"
                            @click.stop="emit('addChat', item.value)"
                            aria-label="Add chat to project"
                        >
                            <UIcon
                                :name="useIcon('sidebar.new_chat').value"
                                class="w-4 h-4 opacity-70"
                            />
                        </button>
                        <button
                            class="cursor-pointer sm:opacity-0 sm:group-hover/addchat:opacity-100 transition-opacity inline-flex items-center justify-center w-5 h-5 rounded-[var(--md-border-radius)] hover:bg-black/10 active:bg-black/20"
                            @click.stop="emit('addDocument', item.value)"
                            aria-label="Add document to project"
                        >
                            <UIcon
                                :name="useIcon('sidebar.new_note').value"
                                class="w-4 h-4 opacity-70"
                            />
                        </button>
                    </template>
                    <UPopover
                        :content="{
                            side: 'right',
                            align: 'start',
                            sideOffset: 6,
                        }"
                    >
                        <span
                            class="inline-flex items-center justify-center w-5 h-5 rounded-[var(--md-border-radius)] hover:bg-black/10 active:bg-black/20"
                            role="button"
                            tabindex="0"
                            @click.stop
                            @keydown="handlePopoverTriggerKey"
                            :aria-label="
                                level === 0
                                    ? 'Project actions'
                                    : 'Entry actions'
                            "
                        >
                            <UIcon
                                :name="useIcon('ui.more').value"
                                class="w-4 h-4 opacity-70"
                            />
                        </span>
                        <template #content>
                            <div class="p-1 w-48 space-y-1">
                                <template v-if="level === 0">
                                    <UButton
                                        v-bind="renameProjectButtonProps"
                                        @click.stop.prevent="
                                            emit('renameProject', item.value)
                                        "
                                        >Rename Project</UButton
                                    >
                                    <UButton
                                        v-bind="deleteProjectButtonProps"
                                        @click.stop.prevent="
                                            emit('deleteProject', item.value)
                                        "
                                        >Delete Project</UButton
                                    >
                                    <template
                                        v-for="action in extraActions"
                                        :key="action.id"
                                    >
                                        <UButton
                                            v-if="
                                                !action.showOn ||
                                                action.showOn.includes('root')
                                            "
                                            v-bind="extraActionButtonProps"
                                            :icon="action.icon"
                                            @click="
                                                () =>
                                                    runExtraAction(action, {
                                                        root: item,
                                                    })
                                            "
                                            >{{ action.label || '' }}</UButton
                                        >
                                    </template>
                                </template>
                                <template v-else>
                                    <UButton
                                        v-bind="renameEntryButtonProps"
                                        @click.stop.prevent="
                                            emit('renameEntry', {
                                                projectId: item.parentId!,
                                                entryId: item.value,
                                                kind: item.kind as ProjectEntryKind,
                                            })
                                        "
                                        >Rename</UButton
                                    >
                                    <UButton
                                        v-bind="removeEntryButtonProps"
                                        class="whitespace-nowrap"
                                        @click.stop.prevent="
                                            emit('removeFromProject', {
                                                projectId: item.parentId!,
                                                entryId: item.value,
                                                kind: item.kind as ProjectEntryKind,
                                            })
                                        "
                                        >Remove from Project</UButton
                                    >
                                    <template
                                        v-for="action in extraActions"
                                        :key="action.id"
                                    >
                                        <UButton
                                            v-if="!action.showOn || action.showOn.includes(item.kind as ProjectTreeKind)"
                                            v-bind="extraActionButtonProps"
                                            :icon="action.icon"
                                            @click="
                                                () =>
                                                    runExtraAction(action, {
                                                        child: item,
                                                    })
                                            "
                                            >{{ action.label || '' }}</UButton
                                        >
                                    </template>
                                </template>
                            </div>
                        </template>
                    </UPopover>
                </div>
            </template>
        </UTree>
    </div>
</template>

<script setup lang="ts">
import { computed, watch, ref } from 'vue';
import {
    normalizeProjectData,
    type ProjectEntry,
    type ProjectEntryKind,
} from '~/utils/projects/normalizeProjectData';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { useIcon } from '~/composables/useIcon';
import { usePopoverKeyboard } from '~/composables/usePopoverKeyboard';

const { handlePopoverTriggerKey } = usePopoverKeyboard();

interface ProjectRow {
    id: string;
    name: string;
    // The backing data that encodes the project entries. Can be
    //  - an already parsed array of ProjectEntry objects
    //  - a JSON string representing that array
    //  - anything else (ignored)
    data?: unknown;
}

// Shape consumed by UTree. (We only type the properties we actually use.)
interface TreeItem {
    label: string;
    value: string;
    icon?: string;
    kind?: ProjectEntryKind; // Only for non-root items
    parentId?: string; // Only set for child entries
    defaultExpanded?: boolean;
    children?: TreeItem[];
    onSelect?: (e: Event) => void;
}

const props = defineProps<{
    projects: ProjectRow[];
    expanded?: string[];
}>();

const emit = defineEmits<{
    (e: 'update:expanded', value: string[]): void;
    (e: 'chatSelected', id: string): void;
    (e: 'documentSelected', id: string): void;
    (e: 'addChat', projectId: string): void;
    (e: 'addDocument', projectId: string): void;
    (e: 'deleteProject', projectId: string): void;
    (e: 'renameProject', projectId: string): void;
    (
        e: 'renameEntry',
        payload: { projectId: string; entryId: string; kind: ProjectEntryKind }
    ): void;
    (
        e: 'removeFromProject',
        payload: { projectId: string; entryId: string; kind: ProjectEntryKind }
    ): void;
}>();

// Local mirror for v-model:expanded
const internalExpanded = ref<string[]>(
    props.expanded ? [...props.expanded] : []
);
watch(
    () => props.expanded,
    (val) => {
        if (val && val !== internalExpanded.value)
            internalExpanded.value = [...val];
    }
);
watch(internalExpanded, (val) => emit('update:expanded', val));

// Theme overrides for project action buttons
const renameProjectButtonProps = computed(() => {
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
        icon: useIcon('ui.edit').value,
        class: 'w-full justify-start cursor-pointer',
        ...(overrides.value as any),
    };
});

const deleteProjectButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'sidebar',
        identifier: 'sidebar.project-delete',
        isNuxtUI: true,
    });
    return {
        color: 'neutral' as const,
        variant: 'popover' as const,
        size: 'sm' as const,
        icon: useIcon('ui.trash').value,
        class: 'w-full justify-start cursor-pointer text-[var(--md-error)] hover:bg-[var(--md-error)]/10 active:bg-[var(--md-error)]/15',
        ...(overrides.value as any),
    };
});

const renameEntryButtonProps = computed(() => {
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
        icon: useIcon('ui.edit').value,
        class: 'w-full justify-start',
        ...(overrides.value as any),
    };
});

const removeEntryButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'sidebar',
        identifier: 'sidebar.project-entry-remove',
        isNuxtUI: true,
    });
    return {
        color: 'neutral' as const,
        variant: 'popover' as const,
        size: 'sm' as const,
        icon: useIcon('ui.trash').value,
        class: 'w-full justify-start text-[var(--md-error)] hover:bg-[var(--md-error)]/10 active:bg-[var(--md-error)]/15',
        ...(overrides.value as any),
    };
});

const extraActionButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'sidebar',
        identifier: 'sidebar.project-extra-action',
        isNuxtUI: true,
    });
    return {
        color: 'neutral' as const,
        variant: 'popover' as const,
        size: 'sm' as const,
        class: 'w-full justify-start',
        ...(overrides.value as any),
    };
});

const treeItems = computed<TreeItem[]>(() =>
    props.projects.map<TreeItem>((p) => {
        const children: TreeItem[] = normalizeProjectData(p.data).map<TreeItem>(
            (entry) => {
                // Coerce to the allowed union; fallback to 'chat' for unknown/legacy values.
                const kind: ProjectEntryKind = entry.kind;
                return {
                    label: entry.name || '(untitled)',
                    value: entry.id,
                    icon:
                        kind === 'doc'
                            ? useIcon('sidebar.note').value
                            : useIcon('sidebar.chat').value,
                    kind,
                    parentId: p.id,
                    onSelect: (e: Event) => {
                        if (kind === 'chat') emit('chatSelected', entry.id);
                        else emit('documentSelected', entry.id);
                        // Prevent default selection behavior if needed by UTree (not sure), otherwise leave.
                    },
                };
            }
        );
        return {
            label: p.name,
            value: p.id,
            defaultExpanded: false,
            children,
            onSelect: (e: Event) => e.preventDefault(), // Root projects themselves aren't selectable
        };
    })
);

const ui = {
    // Remove internal scrolling; let the parent sidebar container handle overflow
    root: 'pr-1',
    link: 'group/addchat text-[13px] rounded-[var(--md-border-radius)] py-1 transition-colors',
    item: 'cursor-pointer',
    // Add smooth transitions for expand/collapse
    children: 'transition-all duration-200 ease-out overflow-hidden',
};

// Plugin project tree actions
const extraActions = useProjectTreeActions();
async function runExtraAction(action: any, data: { root?: any; child?: any }) {
    try {
        await action.handler(data);
    } catch (e: any) {
        try {
            useToast().add({
                title: 'Action failed',
                description: e?.message || 'Error running action',
                color: 'error',
                duration: 3000,
            });
        } catch {}
        console.error('Project tree action error', action.id, e);
    }
}
</script>

<style scoped>
/* Ensure the tree does not introduce its own scroll area */
:deep(ul[role='tree']) {
    max-height: none !important;
    overflow: visible !important;
}

/* Smooth expand/collapse animation for tree children using grid-template-rows */
:deep(li[role='treeitem']) {
    display: grid;
    grid-template-rows: auto 1fr;
}

:deep(ul[role='group']) {
    display: grid;
    grid-template-rows: 1fr;
    transition: grid-template-rows 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

/* When parent is collapsed, hide children */
:deep(
        li[role='treeitem']:not(:has(button[aria-expanded='true']))
            > ul[role='group']
    ) {
    grid-template-rows: 0fr;
}

/* Inner wrapper for overflow */
:deep(ul[role='group'] > li) {
    overflow: hidden;
}

/* Enhanced chevron rotation */
:deep([data-slot='link-trailing-icon']) {
    transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

/* Smooth hover transitions */
:deep([data-slot='link']) {
    transition: background-color 0.15s ease-out;
}
</style>
