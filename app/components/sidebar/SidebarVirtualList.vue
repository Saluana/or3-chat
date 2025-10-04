<template>
    <div class="flex flex-col flex-1 min-h-0 overflow-hidden">
        <VList
            :data="flatItems"
            :style="{ height: 'calc(100dvh - 314px)' }"
            :item-size="40"
            :overscan="10"
            class="overflow-y-auto overflow-x-hidden scrollbar-hidden pb-8"
            #default="{ item, index }"
        >
            <div :key="item.key || index">
                <h1
                    v-if="item.type === 'sectionHeader'"
                    class="text-xs uppercase tracking-wide opacity-70 px-1 py-3 select-none"
                >
                    {{ item.label }}
                </h1>
                <SidebarProjectTree
                    v-else-if="item.type === 'projectsTree'"
                    :projects="projects"
                    v-model:expanded="expandedProjectsLocal"
                    @chatSelected="emit('chatSelected', $event)"
                    @documentSelected="emit('documentSelected', $event)"
                    @addChat="emit('addChat', $event)"
                    @addDocument="emit('addDocument', $event)"
                    @renameProject="emit('renameProject', $event)"
                    @deleteProject="emit('deleteProject', $event)"
                    @renameEntry="emit('renameEntry', $event)"
                    @removeFromProject="emit('removeFromProject', $event)"
                />
                <div v-else-if="item.type === 'thread'" class="mr-1">
                    <SidebarThreadItem
                        :thread="item.thread"
                        :active="activeThreadSet.has(item.thread.id)"
                        class="mb-2"
                        @select="emit('selectThread', $event)"
                        @rename="emit('renameThread', $event)"
                        @delete="emit('deleteThread', $event)"
                        @add-to-project="emit('addThreadToProject', $event)"
                    />
                </div>
                <div v-else-if="item.type === 'doc'" class="mr-1">
                    <SidebarDocumentItem
                        :doc="item.doc"
                        class="mb-2"
                        :active="activeDocumentSet.has(item.doc.id)"
                        @select="emit('selectDocument', $event)"
                        @rename="emit('renameDocument', $event)"
                        @delete="emit('deleteDocument', $event)"
                        @add-to-project="emit('addDocumentToProject', $event)"
                    />
                </div>
            </div>
        </VList>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { VList } from 'virtua/vue';
import SidebarThreadItem from '~/components/sidebar/SidebarThreadItem.vue';
import SidebarDocumentItem from '~/components/sidebar/SidebarDocumentItem.vue';
import SidebarProjectTree from '~/components/sidebar/SidebarProjectTree.vue';
import type { ProjectEntry } from '~/utils/projects/normalizeProjectData';
interface Project {
    id: string;
    name: string;
    data?: ProjectEntry[];
}
interface Thread {
    id: string;
    title?: string;
    forked?: boolean;
}
interface DocLite {
    id: string;
    title: string;
    updated_at?: number;
    created_at?: number;
    postType?: string;
}

// Row item discriminated union
interface SectionHeaderItem {
    type: 'sectionHeader';
    key: string;
    label: string;
}
interface ProjectsTreeItem {
    type: 'projectsTree';
    key: string;
}
interface ThreadItem {
    type: 'thread';
    key: string;
    thread: Thread;
}
interface DocItem {
    type: 'doc';
    key: string;
    doc: DocLite;
}

type SidebarRowItem =
    | SectionHeaderItem
    | ProjectsTreeItem
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

// Local mirror for v-model with tree (keep reference semantics for parent array)
const expandedProjectsLocal = computed({
    get: () => props.expandedProjects,
    set: (val: string[]) => {
        // mutate original array for parent expectations
        props.expandedProjects.splice(0, props.expandedProjects.length, ...val);
    },
});

const flatItems = computed<SidebarRowItem[]>(() => {
    const out: SidebarRowItem[] = [];
    if (props.activeSections.projects && props.projects.length) {
        out.push({ type: 'projectsTree', key: 'projectsTree' });
    }
    // Threads section
    if (props.activeSections.threads && props.threads.length) {
        out.push({ type: 'sectionHeader', key: 'sec:threads', label: 'Chats' });
        for (const t of props.threads) {
            out.push({ type: 'thread', key: `thread:${t.id}`, thread: t });
        }
    }
    // Docs section
    if (props.activeSections.docs && effectiveDocs.value.length) {
        out.push({ type: 'sectionHeader', key: 'sec:docs', label: 'Docs' });
        for (const d of effectiveDocs.value) {
            out.push({ type: 'doc', key: `doc:${d.id}`, doc: d });
        }
    }
    return out;
});

// Constant row size estimate
const rowSize = 36;

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
</script>
