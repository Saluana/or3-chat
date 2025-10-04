<template>
    <div v-if="projects.length" class="space-y-1">
        <h1 class="text-xs uppercase opacity-70 px-1 py-3 select-none">
            Projects
        </h1>
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
                    <template v-if="level === 0 && !isMobile">
                        <button
                            class="cursor-pointer opacity-0 group-hover/addchat:opacity-100 transition-opacity inline-flex items-center justify-center w-5 h-5 rounded-[3px] hover:bg-black/10 active:bg-black/20"
                            @click.stop="emit('addChat', item.value)"
                            aria-label="Add chat to project"
                        >
                            <UIcon
                                name="pixelarticons:message-plus"
                                class="w-4 h-4 opacity-70"
                            />
                        </button>
                        <button
                            class="cursor-pointer opacity-0 group-hover/addchat:opacity-100 transition-opacity inline-flex items-center justify-center w-5 h-5 rounded-[3px] hover:bg-black/10 active:bg-black/20"
                            @click.stop="emit('addDocument', item.value)"
                            aria-label="Add document to project"
                        >
                            <UIcon
                                name="pixelarticons:note-plus"
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
                            class="inline-flex items-center justify-center w-5 h-5 rounded-[3px] hover:bg-black/10 active:bg-black/20"
                            @click.stop
                            :aria-label="
                                level === 0
                                    ? 'Project actions'
                                    : 'Entry actions'
                            "
                        >
                            <UIcon
                                name="pixelarticons:more-vertical"
                                class="w-4 h-4 opacity-70"
                            />
                        </span>
                        <template #content>
                            <div class="p-1 w-48 space-y-1">
                                <template v-if="level === 0">
                                    <UButton
                                        color="neutral"
                                        variant="popover"
                                        size="sm"
                                        class="w-full justify-start cursor-pointer"
                                        icon="pixelarticons:edit"
                                        @click.stop.prevent="
                                            emit('renameProject', item.value)
                                        "
                                        >Rename Project</UButton
                                    >
                                    <UButton
                                        color="error"
                                        variant="popover"
                                        size="sm"
                                        class="w-full justify-start cursor-pointer text-error-500"
                                        icon="pixelarticons:trash"
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
                                            :icon="action.icon"
                                            color="neutral"
                                            variant="popover"
                                            size="sm"
                                            class="w-full justify-start"
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
                                        color="neutral"
                                        variant="popover"
                                        size="sm"
                                        class="w-full justify-start"
                                        icon="pixelarticons:edit"
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
                                        color="error"
                                        variant="popover"
                                        size="sm"
                                        class="w-full justify-start text-error-500"
                                        icon="pixelarticons:trash"
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
                                            :icon="action.icon"
                                            color="neutral"
                                            variant="popover"
                                            size="sm"
                                            class="w-full justify-start"
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
import { isMobile, state } from '~/state/global';
import {
    normalizeProjectData,
    type ProjectEntry,
    type ProjectEntryKind,
} from '~/utils/projects/normalizeProjectData';

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
                            ? 'pixelarticons:note'
                            : 'pixelarticons:chat',
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
    root: 'max-h-52 overflow-auto pr-1 scrollbar-hidden ',
    link: 'group/addchat text-[13px] rounded-[4px] py-1',
    item: 'cursor-pointer ',
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

<style scoped></style>
