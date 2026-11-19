<template>
    <div class="mt-4 space-y-2">
        <SidebarGroupHeader
            label="Recent projects"
            :collapsed="collapsed"
            action-label="+ New"
            action-aria-label="New project"
            @toggle="emit('toggle-collapse')"
            @action="emit('new-project')"
        />

        <!-- Grid-based height animation for smooth collapse/expand -->
        <div
            class="grid grid-cols-1 transition-[grid-template-rows,opacity] duration-300 ease-out"
            :class="
                collapsed
                    ? 'grid-rows-[0fr] opacity-0'
                    : 'grid-rows-[1fr] opacity-100'
            "
        >
            <div class="overflow-clip min-h-0">
                <div v-if="projects.length > 0" class="space-y-0.5">
                    <div
                        v-for="project in projects"
                        :key="project.id"
                        data-project-shortcut
                        class="project-group-container mb-0.5 rounded-[var(--md-border-radius)] overflow-clip"
                    >
                        <SidebarProjectRoot
                            :project="project"
                            :expanded="expandedProjectsSet.has(project.id)"
                            :can-create-folder="explorerEnabled && !viewOnly"
                            :can-pin="!viewOnly"
                            @toggle-expand="toggleProjectExpand(project.id)"
                            @add-chat="emit('add-chat-to-project', project.id)"
                            @add-document="
                                emit('add-document-to-project-root', project.id)
                            "
                            @rename="emit('rename-project', project.id)"
                            @delete="emit('delete-project', project.id)"
                            @new-folder="createRootFolder(project.id)"
                        />

                        <SidebarProjectExplorer v-if="explorerEnabled && !collapsed && expandedProjectsSet.has(project.id)"
                            :key="project.id" ref="projectExplorers" :project-id="project.id" :project-name="project.name"
                            :documents-enabled="or3Config.features.documents.enabled" compact class="px-1 pb-1"
                            @create="(kind, folder) => emit('create-in-project-folder', { kind, projectId: project.id, folder })" />
                        <div
                            v-else-if="
                                !collapsed &&
                                expandedProjectsSet.has(project.id) &&
                                children[project.id]
                            "
                        >
                            <div class="overflow-hidden min-h-0">
                                <p
                                    v-if="!children[project.id]!.length"
                                    class="project-children-empty h-8 flex items-center ps-[42px] mx-1 mb-1 text-[13px] text-[color:var(--md-on-surface-variant)]"
                                >
                                    No chats or docs yet
                                </p>
                                <div
                                    v-else
                                    class="project-children pb-1"
                                >
                                    <SidebarProjectChild
                                        v-for="child in children[project.id]"
                                        :key="`${project.id}:${child.id}`"
                                        :child="child"
                                        :active="isProjectChildActive(child)"
                                        @select="
                                            () => onProjectChildSelect(child)
                                        "
                                        @rename="
                                            emit('rename-entry', {
                                                projectId: project.id,
                                                entryId: child.id,
                                                kind: child.kind,
                                            })
                                        "
                                        @remove="
                                            emit('remove-from-project', {
                                                projectId: project.id,
                                                entryId: child.id,
                                                kind: child.kind,
                                            })
                                        "
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <UButton
                    v-if="hasMore"
                    label="Show more"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    class="mx-1 mt-1"
                    trailing-icon="i-lucide-chevron-right"
                    @click="emit('show-more')"
                />
                <p
                    v-if="childError"
                    role="alert"
                    class="px-3 text-xs text-[var(--md-error)]"
                >
                    {{ childError }}
                </p>
            </div>
        </div>

    </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue';
import { liveQuery } from 'dexie';
import {
    getDb,
    getWorkspaceGeneration,
    subscribeActiveWorkspaceDb,
} from '~/db/client';
import { isVisibleWorkspaceItem } from '~~/shared/posts/workspace-item';
import { parseFileHashes } from '~/db/files-util';
import type { SidebarProject } from '~/composables/sidebar/useSidebarProjectDisplay';
import type {
    ProjectEntry,
    ProjectEntryKind,
} from '~/utils/projects/normalizeProjectData';
import SidebarProjectRoot from './SidebarProjectRoot.vue';
import SidebarProjectChild from './SidebarProjectChild.vue';
import SidebarGroupHeader from './SidebarGroupHeader.vue';
import SidebarProjectExplorer from './SidebarProjectExplorer.vue';
import type { ExplorerFolderRow } from '~~/shared/explorer/tree';
import { useOr3Config } from '~/composables/useOr3Config';
import { useExplorerAvailable } from '~/composables/explorer/explorer-availability';
import { useViewOnlyAccess } from '~/composables/auth/useViewOnlyAccess';

type ProjectEntryPayload = {
    projectId: string;
    entryId: string;
    kind: ProjectEntryKind;
};

const props = defineProps<{
    projects: SidebarProject[];
    hasMore: boolean;
    collapsed: boolean;
    expandedProjects: string[];
    activeThreadIds: string[];
    activeDocumentIds: string[];
}>();


const emit = defineEmits<{
    (e: 'toggle-collapse'): void;
    (e: 'show-more'): void;
    (e: 'new-project'): void;
    (e: 'add-chat-to-project', id: string): void;
    (e: 'add-document-to-project-root', id: string): void;
    (e: 'rename-project', id: string): void;
    (e: 'delete-project', id: string): void;
    (e: 'rename-entry', payload: ProjectEntryPayload): void;
    (e: 'remove-from-project', payload: ProjectEntryPayload): void;
    (e: 'select-thread', id: string): void;
    (e: 'select-document', id: string): void;
    (e: 'create-in-project-folder', value: { kind: 'chat' | 'document'; projectId: string; folder: ExplorerFolderRow }): void;
    (e: 'update:expandedProjects', value: string[]): void;
}>();

const explorerEnabled = useExplorerAvailable();
const viewOnly = useViewOnlyAccess();
const or3Config = useOr3Config();
const projectExplorers = useTemplateRef<InstanceType<typeof SidebarProjectExplorer>[]>('projectExplorers');

const expandedProjectsSet = computed(() => new Set(props.expandedProjects));
const children = ref<Record<string, ProjectEntry[]>>({});
const childError = ref('');
let childSubscription: { unsubscribe(): void } | undefined;
function bindChildren() {
    childSubscription?.unsubscribe();
    children.value = {};
    childError.value = '';
    const expanded = props.collapsed
        ? []
        : props.projects.filter((project) =>
              expandedProjectsSet.value.has(project.id),
          );
    if (explorerEnabled.value || !expanded.length) return;
    const db = getDb();
    const generation = getWorkspaceGeneration();
    childSubscription = liveQuery(async () => {
        const result: Record<string, ProjectEntry[]> = {};
        for (const project of expanded) {
            const entries: ProjectEntry[] = [];
            for (const entry of project.data) {
                const row =
                    entry.kind === 'chat'
                        ? await db.threads.get(entry.id)
                        : await db.posts.get(entry.id);
                if (!row || !isVisibleWorkspaceItem(row)) continue;
                if (entry.kind !== 'chat') {
                    if (
                        !('postType' in row) ||
                        row.postType !==
                            (entry.kind === 'file' ? 'or3:file' : 'doc')
                    )
                        continue;
                    if (entry.kind === 'file') {
                        const hashes = parseFileHashes(row.file_hashes);
                        const meta =
                            hashes.length === 1
                                ? await db.file_meta.get(hashes[0]!)
                                : undefined;
                        if (!meta || meta.deleted) continue;
                    }
                }
                entries.push({
                    ...entry,
                    name: entry.kind === 'file'
                        ? entry.name ?? row.title ?? undefined
                        : row.title ?? entry.name ?? undefined,
                });
            }
            result[project.id] = entries;
        }
        return result;
    }).subscribe({
        next(value) {
            if (generation === getWorkspaceGeneration()) children.value = value;
        },
        error() {
            if (generation === getWorkspaceGeneration())
                childError.value = 'Could not load project shortcuts.';
        },
    });
}
watch(
    () => [props.projects, props.expandedProjects.slice(), props.collapsed, explorerEnabled.value],
    bindChildren,
    { immediate: true },
);
const stopWorkspace = subscribeActiveWorkspaceDb(() => {
    childSubscription?.unsubscribe();
    children.value = {};
    childError.value = '';
});
onBeforeUnmount(() => {
    stopWorkspace();
    childSubscription?.unsubscribe();
});

function toggleProjectExpand(id: string) {
    const next = new Set(props.expandedProjects);
    if (next.has(id)) {
        next.delete(id);
    } else {
        next.add(id);
    }
    emit('update:expandedProjects', Array.from(next));
}

async function createRootFolder(id: string) {
    if (!explorerEnabled.value || viewOnly.value) return;
    const generation = getWorkspaceGeneration();
    if (!expandedProjectsSet.value.has(id)) toggleProjectExpand(id);
    await nextTick();
    if (generation !== getWorkspaceGeneration()) return;
    projectExplorers.value?.find(explorer => explorer.projectId === id)?.openRootFolderDialog();
}

function isProjectChildActive(child: ProjectEntry) {
    if (child.kind === 'chat') {
        return props.activeThreadIds.includes(child.id);
    }
    return props.activeDocumentIds.includes(child.id);
}

function onProjectChildSelect(child: ProjectEntry) {
    if (child.kind === 'chat') {
        emit('select-thread', child.id);
    } else {
        emit('select-document', child.id);
    }
}
</script>
