<template>
    <div class="flex flex-col flex-1 min-h-0 overflow-hidden">
        <!-- Single scroll container sized by measured height prop -->
        <div
            ref="scrollContainerRef"
            class="overflow-y-auto overflow-x-hidden overscroll-y-contain scrollbar-hidden pb-8"
            :style="{ height: `${height}px` }"
        >
            <Virtualizer
                :data="flatItems"
                :item-size="50"
                :scrollRef="scrollContainerRef || undefined"
            >
                <template v-slot="{ item }">
                    <div :key="item.key">
                        <!-- Section Header -->
                        <h1
                            v-if="item.type === 'sectionHeader'"
                            class="text-xs uppercase tracking-wide opacity-70 px-1 py-3 select-none"
                        >
                            {{ item.label }}
                        </h1>

                        <!-- Project Group (Root + Children) -->
                        <div
                            v-else-if="item.type === 'projectGroup'"
                            :class="[
                                'project-group-container mb-2 mx-0.5 bg-(--md-inverse-surface)/5 backdrop-blur ',
                                projectGroupContainerProps?.class || '',
                            ]"
                            :data-theme-target="
                                projectGroupContainerProps?.[
                                    'data-theme-target'
                                ]
                            "
                            :data-theme-matches="
                                projectGroupContainerProps?.[
                                    'data-theme-matches'
                                ]
                            "
                        >
                            <!-- Project Root -->
                            <SidebarProjectRoot
                                :project="item.project"
                                :expanded="
                                    expandedProjectsSet.has(item.project.id)
                                "
                                @toggle-expand="
                                    toggleProjectExpand(item.project.id)
                                "
                                @add-chat="emit('addChat', item.project.id)"
                                @add-document="
                                    emit('addDocument', item.project.id)
                                "
                                @rename="emit('renameProject', item.project.id)"
                                @delete="emit('deleteProject', item.project.id)"
                            />

                            <!-- Project Children Container -->
                            <Transition
                                name="project-expand"
                                @enter="onEnter"
                                @leave="onLeave"
                            >
                                <div
                                    v-if="
                                        item.children.length > 0 &&
                                        expandedProjectsSet.has(item.project.id)
                                    "
                                    class="pl-2 mt-1 space-y-1 overflow-hidden"
                                >
                                    <SidebarProjectChild
                                        v-for="child in item.children"
                                        :key="`${item.project.id}:${child.id}`"
                                        :child="child"
                                        :parent-id="item.project.id"
                                        :active="isProjectChildActive(child)"
                                        @select="onProjectChildSelect(child)"
                                        @rename="
                                            emit('renameEntry', {
                                                projectId: item.project.id,
                                                entryId: child.id,
                                                kind: child.kind,
                                            })
                                        "
                                        @remove="
                                            emit('removeFromProject', {
                                                projectId: item.project.id,
                                                entryId: child.id,
                                                kind: child.kind,
                                            })
                                        "
                                    />
                                </div>
                            </Transition>
                        </div>

                        <!-- Thread Item -->
                        <div v-else-if="item.type === 'thread'" class="mr-1">
                            <SidebarThreadItem
                                :thread="item.thread"
                                :active="activeThreadSet.has(item.thread.id)"
                                class="mb-2"
                                @select="emit('selectThread', $event)"
                                @rename="emit('renameThread', $event)"
                                @delete="emit('deleteThread', $event)"
                                @add-to-project="
                                    emit('addThreadToProject', $event)
                                "
                            />
                        </div>

                        <!-- Doc Item -->
                        <div v-else-if="item.type === 'doc'" class="mr-1">
                            <SidebarDocumentItem
                                :doc="item.doc"
                                class="mb-2"
                                :active="activeDocumentSet.has(item.doc.id)"
                                @select="emit('selectDocument', $event)"
                                @rename="emit('renameDocument', $event)"
                                @delete="emit('deleteDocument', $event)"
                                @add-to-project="
                                    emit('addDocumentToProject', $event)
                                "
                            />
                        </div>
                    </div>
                </template>
            </Virtualizer>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { Virtualizer } from 'virtua/vue';
import {
    normalizeProjectData,
    type ProjectEntry,
} from '~/utils/projects/normalizeProjectData';
import type { Thread } from '~/db';
import { useThemeOverrides } from '~/composables/useThemeResolver';

interface Project {
    id: string;
    name: string;
    data?: ProjectEntry[];
}
interface DocLite {
    id: string;
    title: string;
    updated_at?: number;
    created_at?: number;
    postType?: string;
}

// Row item discriminated union with explicit heights
interface SectionHeaderItem {
    type: 'sectionHeader';
    key: string;
    label: string;
    height: 36;
}
interface ProjectGroupItem {
    type: 'projectGroup';
    key: string;
    project: Project;
    children: ProjectEntry[];
    height: number; // dynamic: 48 + (children.length * 40)
}
interface ThreadItem {
    type: 'thread';
    key: string;
    thread: Thread;
    height: 44;
}
interface DocItem {
    type: 'doc';
    key: string;
    doc: DocLite;
    height: 44;
}

type SidebarVirtualItem =
    | SectionHeaderItem
    | ProjectGroupItem
    | ThreadItem
    | DocItem;

const props = defineProps<{
    projects: Project[];
    threads: Thread[];
    documents: any[]; // possibly full posts containing heavy fields
    displayDocuments?: any[]; // optional filtered docs from search
    expandedProjects: string[]; // mutated in place (passed to tree)
    activeSections: { projects?: boolean; threads?: boolean; docs?: boolean };
    activeThread?: string; // legacy single selection
    activeDocument?: string; // legacy single selection
    activeThreads?: string[]; // new multi-active selection
    activeDocuments?: string[]; // new multi-active selection
    height: number; // required external measured height
}>();

// Simplified emit typing (broad) to accommodate both legacy kebab-case and new camelCase events during transition
// TODO: tighten types once integration finalized
// eslint-disable-next-line @typescript-eslint/ban-types
const emit = defineEmits<(e: string, ...args: any[]) => void>();

// Scroll container ref for Virtualizer
const scrollContainerRef = ref<HTMLElement | null>(null);

// Theme overrides for project group container
const projectGroupContainerProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'div',
        context: 'sidebar',
        identifier: 'sidebar.project-group-container',
        isNuxtUI: false,
    });
    return overrides.value;
});

// Lightweight docs mapping (strip heavy fields like content)
const lightweightDocs = computed<DocLite[]>(() =>
    (props.documents || []).map((d: any) => ({
        id: d.id,
        title: d.title || '(untitled document)',
        updated_at: d.updated_at,
        created_at: d.created_at,
        postType: d.postType,
    }))
);

const effectiveDocs = computed<DocLite[]>(() => {
    if (props.displayDocuments && props.displayDocuments.length) {
        return props.displayDocuments.map((d: any) => ({
            id: d.id,
            title: d.title || '(untitled document)',
            updated_at: d.updated_at,
            created_at: d.created_at,
            postType: d.postType,
        }));
    }
    return lightweightDocs.value;
});

// Expanded projects as a Set for O(1) lookup
const expandedProjectsSet = computed(() => new Set(props.expandedProjects));

// Toggle project expansion
function toggleProjectExpand(projectId: string) {
    const idx = props.expandedProjects.indexOf(projectId);
    if (idx >= 0) {
        props.expandedProjects.splice(idx, 1);
    } else {
        props.expandedProjects.push(projectId);
    }
}

// Flattened items with explicit heights per type
const flatItems = computed<SidebarVirtualItem[]>(() => {
    const out: SidebarVirtualItem[] = [];

    // Projects section (grouped: root + children in one item)
    if (props.activeSections.projects && props.projects.length) {
        out.push({
            type: 'sectionHeader',
            key: 'header:projects',
            label: 'Projects',
            height: 36,
        });
        for (const project of props.projects) {
            const entries = normalizeProjectData(project.data);
            const children = expandedProjectsSet.value.has(project.id)
                ? entries
                : [];
            // Dynamic height: 48 (root) + children.length * 40 + spacing
            const childrenHeight =
                children.length > 0 ? children.length * 41 + 4 : 0; // 40px per child + 1px gap + 4px margin
            out.push({
                type: 'projectGroup',
                key: `project:${project.id}`,
                project,
                children,
                height: 48 + childrenHeight,
            });
        }
    }

    // Threads section
    if (props.activeSections.threads && props.threads.length) {
        out.push({
            type: 'sectionHeader',
            key: 'header:threads',
            label: 'Chats',
            height: 36,
        });
        for (const t of props.threads) {
            out.push({
                type: 'thread',
                key: `thread:${t.id}`,
                thread: t,
                height: 44,
            });
        }
    }

    // Docs section
    if (props.activeSections.docs && effectiveDocs.value.length) {
        out.push({
            type: 'sectionHeader',
            key: 'header:docs',
            label: 'Docs',
            height: 36,
        });
        for (const d of effectiveDocs.value) {
            out.push({
                type: 'doc',
                key: `doc:${d.id}`,
                doc: d,
                height: 44,
            });
        }
    }

    return out;
});

// ---- Multi-active support ----
const activeThreadSet = computed(() => {
    if (Array.isArray(props.activeThreads))
        return new Set(props.activeThreads.filter(Boolean));
    return new Set(props.activeThread ? [props.activeThread] : []);
});
const activeDocumentSet = computed(() => {
    if (Array.isArray(props.activeDocuments))
        return new Set(props.activeDocuments.filter(Boolean));
    return new Set(props.activeDocument ? [props.activeDocument] : []);
});

// Check if project child is active (either a thread or doc selection)
function isProjectChildActive(child: ProjectEntry): boolean {
    const kind = child.kind ?? 'chat';
    if (kind === 'chat') {
        return activeThreadSet.value.has(child.id);
    } else if (kind === 'doc') {
        return activeDocumentSet.value.has(child.id);
    }
    return false;
}

// Handle project child selection
function onProjectChildSelect(child: ProjectEntry) {
    const kind = child.kind ?? 'chat';
    if (kind === 'chat') {
        emit('chatSelected', child.id);
    } else if (kind === 'doc') {
        emit('documentSelected', child.id);
    }
}

// Transition handlers for smooth expand/collapse
function onEnter(el: Element) {
    const element = el as HTMLElement;
    element.style.height = '0';
    // Force reflow
    void element.offsetHeight;
    // Delay measurement to ensure margins are settled
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const height = element.scrollHeight;
            element.style.height = `${height}px`;
        });
    });
}

function onLeave(el: Element) {
    const element = el as HTMLElement;
    const height = element.scrollHeight;
    element.style.height = `${height}px`;
    // Force reflow
    void element.offsetHeight;
    requestAnimationFrame(() => {
        element.style.height = '0';
    });
}
</script>

<style scoped>
.project-expand-enter-active,
.project-expand-leave-active {
    transition: height 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.project-expand-enter-from,
.project-expand-leave-to {
    height: 0;
}
</style>
