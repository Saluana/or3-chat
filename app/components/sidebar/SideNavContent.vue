<template>
    <div
        ref="containerRef"
        class="flex flex-col h-full relative overflow-hidden"
    >
        <SideNavHeader
            ref="sideNavHeaderRef"
            :sidebar-query="sidebarQuery"
            :active-sections="activeSections"
            :projects="projects"
            @update:sidebar-query="sidebarQuery = $event"
            @update:active-sections="activeSections = $event"
            @new-chat="onNewChat"
            @new-document="emit('newDocument', $event)"
            @open-rename="openRename"
            @open-rename-project="openRenameProject"
            @add-to-project="openAddToProject"
            @add-document-to-project="openAddDocumentToProject"
        />
        <!-- Scrollable content area -->
        <div
            ref="scrollAreaRef"
            class="flex-1 min-h-0 px-2 flex flex-col gap-3 py-3"
            :style="{ paddingBottom: bottomPad + 'px' }"
        >
            <component
                v-for="section in resolvedSidebarSections.top"
                :key="`sidebar-section-top-${section.id}`"
                :is="section.component"
            />
            <component
                v-for="section in resolvedSidebarSections.main"
                :key="`sidebar-section-main-${section.id}`"
                :is="section.component"
            />
            <SidebarVirtualList
                class="flex-1"
                :height="listHeight"
                :projects="displayProjects"
                :threads="displayThreads"
                :documents="docs"
                :display-documents="displayDocuments"
                :expanded-projects="expandedProjects"
                :active-sections="{
                    projects: activeSections.projects,
                    threads: activeSections.chats,
                    docs: activeSections.docs,
                }"
                :active-thread="props.activeThread"
                :active-document="activeDocumentIds[0]"
                :active-threads="activeThreadIds"
                :active-documents="activeDocumentIds"
                @addChat="(id:any) => handleAddChatToProject(id)"
                @addDocument="(id:any) => handleAddDocumentToProject(id)"
                @renameProject="(id:any) => openRenameProject(id)"
                @deleteProject="(id:any) => confirmDeleteProject(id)"
                @renameEntry="(p:any) => openRename(p)"
                @removeFromProject="(p:any) => handleRemoveFromProject(p)"
                @chatSelected="(id:any) => onProjectChatSelected(id)"
                @documentSelected="(id:any) => onProjectDocumentSelected(id)"
                @selectThread="(id:any) => selectChat(id)"
                @renameThread="(t:any) => openRename(t)"
                @deleteThread="(t:any) => confirmDelete(t)"
                @addThreadToProject="(t:any) => openAddToProject(t)"
                @selectDocument="(id:any) => selectDocument(id)"
                @renameDocument="(d:any) => openRename({ docId: d.id })"
                @deleteDocument="(d:any) => confirmDeleteDocument(d)"
                @addDocumentToProject="(d:any) => openAddDocumentToProject(d)"
            />
            <component
                v-for="section in resolvedSidebarSections.bottom"
                :key="`sidebar-section-bottom-${section.id}`"
                :is="section.component"
            />
        </div>
        <div ref="bottomNavRef" class="shrink-0 px-2 pb-2 flex flex-col gap-2">
            <div
                v-if="sidebarFooterActions.length"
                class="flex flex-wrap gap-2"
            >
                <UTooltip
                    v-for="entry in sidebarFooterActions"
                    :key="`sidebar-footer-${entry.action.id}`"
                    :delay-duration="0"
                    :text="entry.action.tooltip || entry.action.label"
                >
                    <UButton
                        size="xs"
                        variant="ghost"
                        :color="(entry.action.color || 'neutral') as any"
                        :square="!entry.action.label"
                        :disabled="entry.disabled"
                        class="pointer-events-auto"
                        @click="() => handleSidebarFooterAction(entry)"
                    >
                        <UIcon :name="entry.action.icon" class="w-4 h-4" />
                        <span
                            v-if="entry.action.label"
                            class="ml-1 text-xs font-medium"
                        >
                            {{ entry.action.label }}
                        </span>
                    </UButton>
                </UTooltip>
            </div>
            <sidebar-side-bottom-nav
                @toggle-dashboard="emit('toggleDashboard')"
            />
        </div>

        <!-- Rename modal -->
        <UModal
            v-model:open="showRenameModal"
            :title="isRenamingDoc ? 'Rename document' : 'Rename thread'"
            :ui="{
                footer: 'justify-end ',
            }"
        >
            <template #body>
                <div class="space-y-4">
                    <UInput
                        v-model="renameTitle"
                        :placeholder="
                            isRenamingDoc ? 'Document title' : 'Thread title'
                        "
                        icon="pixelarticons:edit"
                        @keyup.enter="saveRename"
                    />
                </div>
            </template>
            <template #footer>
                <UButton variant="ghost" @click="showRenameModal = false"
                    >Cancel</UButton
                >
                <UButton color="primary" @click="saveRename">Save</UButton>
            </template>
        </UModal>

        <!-- Rename Project Modal -->
        <UModal
            v-model:open="showRenameProjectModal"
            title="Rename project"
            :ui="{ footer: 'justify-end' }"
        >
            <template #header><h3>Rename project?</h3></template>
            <template #body>
                <div class="space-y-4">
                    <UInput
                        v-model="renameProjectName"
                        placeholder="Project name"
                        icon="pixelarticons:folder"
                        @keyup.enter="saveRenameProject"
                    />
                </div>
            </template>
            <template #footer>
                <UButton variant="ghost" @click="showRenameProjectModal = false"
                    >Cancel</UButton
                >
                <UButton
                    color="primary"
                    :disabled="!renameProjectName.trim()"
                    @click="saveRenameProject"
                    >Save</UButton
                >
            </template>
        </UModal>

        <!-- Delete confirm modal -->
        <UModal
            v-model:open="showDeleteModal"
            title="Delete thread"
            :ui="{ footer: 'justify-end' }"
            class="border-2"
        >
            <template #body>
                <p class="text-sm opacity-70">
                    This will permanently remove the thread and its messages.
                </p>
            </template>
            <template #footer>
                <UButton variant="ghost" @click="showDeleteModal = false"
                    >Cancel</UButton
                >
                <UButton color="error" @click="deleteThread">Delete</UButton>
            </template>
        </UModal>

        <!-- Delete document confirm modal -->
        <UModal
            v-model:open="showDeleteDocumentModal"
            title="Delete document"
            :ui="{ footer: 'justify-end' }"
            class="border-2"
        >
            <template #body>
                <p class="text-sm opacity-70">
                    This will permanently remove the document.
                </p>
            </template>
            <template #footer>
                <UButton
                    variant="ghost"
                    @click="showDeleteDocumentModal = false"
                    >Cancel</UButton
                >
                <UButton color="error" @click="deleteDocument">Delete</UButton>
            </template>
        </UModal>

        <!-- Delete project confirm modal -->
        <UModal
            v-model:open="showDeleteProjectModal"
            title="Delete project"
            :ui="{ footer: 'justify-end' }"
            class="border-2"
        >
            <template #body>
                <p class="text-sm opacity-70">
                    This will remove the project from the sidebar. Project data
                    will be soft-deleted and can be recovered.
                </p>
            </template>
            <template #footer>
                <UButton variant="ghost" @click="showDeleteProjectModal = false"
                    >Cancel</UButton
                >
                <UButton color="error" @click="deleteProject">Delete</UButton>
            </template>
        </UModal>

        <!-- Create Project Modal -->
        <UModal
            v-model:open="showCreateProjectModal"
            title="New Project"
            :ui="{ footer: 'justify-end' }"
        >
            <template #body>
                <div class="space-y-4">
                    <UForm
                        :state="createProjectState"
                        @submit.prevent="submitCreateProject"
                    >
                        <div class="flex flex-col space-y-3">
                            <UFormField
                                label="Title"
                                name="name"
                                :error="createProjectErrors.name"
                            >
                                <UInput
                                    v-model="createProjectState.name"
                                    required
                                    placeholder="Project title"
                                    icon="pixelarticons:folder"
                                    class="w-full"
                                    @keyup.enter="submitCreateProject"
                                />
                            </UFormField>
                            <UFormField label="Description" name="description">
                                <UTextarea
                                    class="w-full border-2 rounded-[6px]"
                                    v-model="createProjectState.description"
                                    :rows="3"
                                    placeholder="Optional description"
                                />
                            </UFormField>
                        </div>
                    </UForm>
                </div>
            </template>
            <template #footer>
                <UButton variant="ghost" @click="closeCreateProject"
                    >Cancel</UButton
                >
                <UButton
                    :disabled="
                        !createProjectState.name.trim() || creatingProject
                    "
                    color="primary"
                    @click="submitCreateProject"
                >
                    <span v-if="!creatingProject">Create</span>
                    <span v-else class="inline-flex items-center gap-1">
                        <UIcon name="i-lucide-loader" class="animate-spin" />
                        Creating
                    </span>
                </UButton>
            </template>
        </UModal>

        <!-- Add To Project Modal -->
        <UModal
            v-model:open="showAddToProjectModal"
            title="Add to project"
            :ui="{ footer: 'justify-end' }"
        >
            <template #body>
                <div class="space-y-4">
                    <div class="flex gap-2 text-xs font-mono">
                        <button
                            class="retro-btn px-2 py-1 rounded-[4px] border-2"
                            :class="
                                addMode === 'select'
                                    ? 'bg-primary/30'
                                    : 'opacity-70'
                            "
                            @click="addMode = 'select'"
                        >
                            Select Existing
                        </button>
                        <button
                            class="retro-btn px-2 py-1 rounded-[4px] border-2"
                            :class="
                                addMode === 'create'
                                    ? 'bg-primary/30'
                                    : 'opacity-70'
                            "
                            @click="addMode = 'create'"
                        >
                            Create New
                        </button>
                    </div>
                    <div v-if="addMode === 'select'" class="space-y-3">
                        <UFormField label="Project" name="project">
                            <USelectMenu
                                v-model="selectedProjectId"
                                :items="projectSelectOptions"
                                :value-key="'value'"
                                placeholder="Select project"
                                class="w-full"
                            />
                        </UFormField>
                        <p v-if="addToProjectError" class="text-error text-xs">
                            {{ addToProjectError }}
                        </p>
                    </div>
                    <div v-else class="space-y-3">
                        <UFormField label="Project Title" name="newProjectName">
                            <UInput
                                v-model="newProjectName"
                                placeholder="Project name"
                                icon="pixelarticons:folder"
                                class="w-full"
                            />
                        </UFormField>
                        <UFormField
                            label="Description"
                            name="newProjectDescription"
                        >
                            <UTextarea
                                v-model="newProjectDescription"
                                :rows="3"
                                placeholder="Optional description"
                                class="w-full border-2 rounded-[6px]"
                            />
                        </UFormField>
                        <p v-if="addToProjectError" class="text-error text-xs">
                            {{ addToProjectError }}
                        </p>
                    </div>
                </div>
            </template>
            <template #footer>
                <UButton variant="ghost" @click="closeAddToProject"
                    >Cancel</UButton
                >
                <UButton
                    color="primary"
                    :disabled="
                        addingToProject ||
                        (addMode === 'select'
                            ? !selectedProjectId
                            : !newProjectName.trim())
                    "
                    @click="submitAddToProject"
                >
                    <span v-if="!addingToProject">Add</span>
                    <span v-else class="inline-flex items-center gap-1"
                        ><UIcon
                            name="i-lucide-loader"
                            class="animate-spin"
                        />Adding</span
                    >
                </UButton>
            </template>
        </UModal>
        <!-- New Document Naming Modal -->
        <UModal
            v-model:open="showCreateDocumentModal"
            title="New Document"
            :ui="{ footer: 'justify-end' }"
        >
            <template #body>
                <div class="space-y-4">
                    <UForm
                        :state="newDocumentState"
                        @submit.prevent="submitCreateDocument"
                    >
                        <UFormField
                            label="Title"
                            name="title"
                            :error="newDocumentErrors.title"
                        >
                            <UInput
                                v-model="newDocumentState.title"
                                required
                                placeholder="Document title"
                                icon="pixelarticons:note"
                                class="w-full"
                                @keyup.enter="submitCreateDocument"
                            />
                        </UFormField>
                    </UForm>
                </div>
            </template>
            <template #footer>
                <UButton variant="ghost" @click="closeCreateDocumentModal"
                    >Cancel</UButton
                >
                <UButton
                    color="primary"
                    :disabled="
                        creatingDocument || !newDocumentState.title.trim()
                    "
                    @click="submitCreateDocument"
                >
                    <span v-if="!creatingDocument">Create</span>
                    <span v-else class="inline-flex items-center gap-1">
                        <UIcon name="i-lucide-loader" class="animate-spin" />
                        Creating
                    </span>
                </UButton>
            </template>
        </UModal>
    </div>
</template>
<script setup lang="ts">
import {
    onMounted,
    onUnmounted,
    ref,
    watch,
    computed,
    nextTick,
    defineAsyncComponent,
} from 'vue';
import type { Component } from 'vue';
import { useElementSize } from '@vueuse/core';
import { useHooks } from '~/composables/useHooks';
import SidebarVirtualList from '~/components/sidebar/SidebarVirtualList.vue';
import SideNavHeader from '~/components/sidebar/SideNavHeader.vue';
import { liveQuery } from 'dexie';
import {
    db,
    upsert,
    del as dbDel,
    create,
    type Post,
    type Project,
} from '~/db'; // Dexie + barrel helpers
import { nowSec, newId } from '~/db/util';
import { updateDocument } from '~/db/documents';
import { loadDocument } from '~/composables/useDocumentsStore';
import { useProjectsCrud } from '~/composables/useProjectsCrud';
import {
    normalizeProjectData,
    type ProjectEntry,
    type ProjectEntryKind,
} from '~/utils/projects/normalizeProjectData';
import {
    useSidebarSections,
    useSidebarFooterActions,
    type SidebarSection,
    type SidebarFooterActionEntry,
} from '~/composables/ui-extensions/chrome';
type SidebarProject = Omit<Project, 'data'> & { data: ProjectEntry[] };
// (Temporarily removed virtualization for chats — use simple list for now)

const {
    createProject: createProjectCrud,
    renameProject: renameProjectCrud,
    deleteProject: deleteProjectCrud,
    updateProjectEntries,
    syncProjectEntryTitle,
} = useProjectsCrud();

// Section visibility (multi-select) defaults to all on
const activeSections = ref<{
    projects: boolean;
    chats: boolean;
    docs: boolean;
}>({ projects: true, chats: true, docs: true });

const props = defineProps<{
    activeThread?: string;
}>();

const sideNavHeaderRef = ref<InstanceType<typeof SideNavHeader> | null>(null);
const items = ref<any[]>([]);
const projects = ref<SidebarProject[]>([]);
const expandedProjects = ref<string[]>([]);
const scrollAreaRef = ref<HTMLElement | null>(null);
const bottomNavRef = ref<HTMLElement | null>(null);
// Root container (for height observation instead of window resize listener)
const containerRef = ref<HTMLElement | null>(null);
// Dynamic bottom padding to avoid content hidden under absolute bottom nav
const bottomPad = ref(140); // fallback
const listHeight = ref(400);
import { useSidebarSearch } from '~/composables/useSidebarSearch';
// Documents live query (docs only) to feed search
const docs = ref<Post[]>([]);
let subDocs: { unsubscribe: () => void } | null = null;

// Active item tracking (multi-pane aware). Uses global multi-pane API if present.
const activeDocumentIds = computed<string[]>(() => {
    const api: any = (globalThis as any).__or3MultiPaneApi;
    if (api && api.panes && Array.isArray(api.panes.value)) {
        return api.panes.value
            .filter((p: any) => p.mode === 'doc' && p.documentId)
            .map((p: any) => p.documentId as string);
    }
    return [];
});
const activeThreadIds = computed<string[]>(() => {
    const api: any = (globalThis as any).__or3MultiPaneApi;
    if (api && api.panes && Array.isArray(api.panes.value)) {
        const ids = api.panes.value
            .filter((p: any) => p.mode === 'chat' && p.threadId)
            .map((p: any) => p.threadId as string)
            .filter(Boolean);
        if (ids.length) return ids;
    }
    return props.activeThread ? [props.activeThread] : [];
});

const sectionComponentCache = new Map<string, Component>();

function resolveSidebarSectionComponent(
    id: string,
    source: SidebarSection['component']
): Component {
    if (
        typeof source === 'function' &&
        !(source as any).render &&
        !(source as any).setup
    ) {
        const cached = sectionComponentCache.get(id);
        if (cached) return cached;
        const asyncComp = defineAsyncComponent(async () => {
            const mod = await (source as () => Promise<any>)();
            const comp = mod?.default || mod;
            if (process.dev && (typeof comp !== 'object' || !comp)) {
                console.warn(
                    `[useSidebarSections] Async section loader for ${id} returned invalid component`,
                    comp
                );
            }
            return comp;
        });
        sectionComponentCache.set(id, asyncComp);
        return asyncComp;
    }
    return source as Component;
}

const sidebarSections = useSidebarSections();

const resolvedSidebarSections = computed(() => {
    const groups = sidebarSections.value;
    const mapSections = (entries: SidebarSection[]) =>
        entries.map((entry) => ({
            id: entry.id,
            component: resolveSidebarSectionComponent(
                entry.id,
                entry.component
            ),
        }));
    return {
        top: mapSections(groups.top),
        main: mapSections(groups.main),
        bottom: mapSections(groups.bottom),
    };
});

const getSidebarFooterContext = () => ({
    activeThreadId: activeThreadIds.value[0] ?? null,
    activeDocumentId: activeDocumentIds.value[0] ?? null,
    isCollapsed: false,
});

const sidebarFooterActions = useSidebarFooterActions(getSidebarFooterContext);

async function handleSidebarFooterAction(entry: SidebarFooterActionEntry) {
    if (entry.disabled) return;
    try {
        await entry.action.handler(getSidebarFooterContext());
    } catch (error) {
        console.error(
            `[Sidebar] footer action "${entry.action.id}" failed`,
            error
        );
    }
}

const {
    query: sidebarQuery,
    threadResults,
    projectResults,
    documentResults,
} = useSidebarSearch(items as any, projects as any, docs as any);

const displayThreads = computed(() =>
    sidebarQuery.value.trim() ? threadResults.value : items.value
);
// Filter projects + entries when query active
// Remove references to deleted threads/docs from project data live
const existingThreadIds = computed(
    () => new Set(items.value.map((t: any) => t.id))
);
const existingDocIds = computed(
    () => new Set(docs.value.map((d: any) => d.id))
);
const projectsFilteredByExistence = computed(() =>
    projects.value.map((p) => {
        const filteredEntries = p.data.filter((entry) => {
            const id = entry?.id;
            if (!id) return false;
            const kind = entry.kind ?? 'chat';
            if (kind === 'chat') return existingThreadIds.value.has(id);
            if (kind === 'doc') return existingDocIds.value.has(id);
            return true;
        });
        return filteredEntries.length === p.data.length
            ? p
            : { ...p, data: filteredEntries };
    })
);

const displayProjects = computed<SidebarProject[]>(() => {
    if (!sidebarQuery.value.trim()) return projectsFilteredByExistence.value;
    const threadSet = new Set(threadResults.value.map((t: any) => t.id));
    const docSet = new Set(documentResults.value.map((d: any) => d.id));
    const directProjectSet = new Set(
        projectResults.value.map((p: any) => p.id)
    );
    const results: SidebarProject[] = [];
    for (const project of projectsFilteredByExistence.value) {
        const filteredEntries = project.data.filter(
            (entry) => threadSet.has(entry.id) || docSet.has(entry.id)
        );
        if (directProjectSet.has(project.id) || filteredEntries.length > 0) {
            results.push({ ...project, data: filteredEntries });
        }
    }
    return results;
});
const displayDocuments = computed(() =>
    sidebarQuery.value.trim() ? (documentResults.value as Post[]) : undefined
);
function onEscapeClear() {
    if (sidebarQuery.value) sidebarQuery.value = '';
}
let sub: { unsubscribe: () => void } | null = null;
let subProjects: { unsubscribe: () => void } | null = null;

// Virtualization removed — always render the simple list for chats.

// Observe container + bottom nav heights (ResizeObserver via VueUse) and recompute list height.
// NOTE: TS plugin was over-narrowing DOM element types; cast refs to any to satisfy MaybeElementRef.
const _containerSize = useElementSize(containerRef as any);
const _bottomSize = useElementSize(bottomNavRef as any);
const containerHeight = _containerSize.height;
const bottomNavHeight = _bottomSize.height;

function recomputeListHeight() {
    const container = containerRef.value; // full sidebar container
    if (!container) return;
    const headerEl = container.querySelector('header');
    const total = container.clientHeight || 0;
    const headerH = (headerEl as HTMLElement | null)?.offsetHeight || 0;
    const bottomH = bottomNavRef.value?.offsetHeight || 0; // also tracked separately but read directly for safety
    const available = total - headerH - bottomH - 8; // small gap
    listHeight.value = available > 100 ? available : 100;
}

onMounted(async () => {
    await nextTick();
    recomputeListHeight();
    // Threads subscription (sorted by last opened, excluding deleted)
    sub = liveQuery(() =>
        db.threads
            .orderBy('updated_at')
            .reverse()
            .filter((t) => !t.deleted)
            .toArray()
    ).subscribe({
        next: (results) => (items.value = results),
        error: (err) => console.error('liveQuery error', err),
    });
    // Projects subscription (most recently updated first)
    subProjects = liveQuery(() =>
        db.projects
            .orderBy('updated_at')
            .reverse()
            .filter((p: any) => !p.deleted)
            .toArray()
    ).subscribe({
        next: (res) => {
            projects.value = res.map((p: Project) => ({
                ...p,
                data: normalizeProjectData(p.data),
            }));
        },
        error: (err) => console.error('projects liveQuery error', err),
    });
    // Documents subscription (docs only, excluding deleted)
    subDocs = liveQuery(() =>
        db.posts
            .where('postType')
            .equals('doc')
            .and((r) => !(r as any).deleted)
            .toArray()
    ).subscribe({
        next: (res) => {
            docs.value = res.map((d: any) => ({ ...d }));
        },
        error: (err) => console.error('documents liveQuery error', err),
    });
    // (virtualization removed — nothing to lazy-load here)
});

// Recompute when container or bottom nav size changes (ResizeObserver driven)
watch([containerHeight, bottomNavHeight], () => {
    recomputeListHeight();
});

// (virtualization removed — no watcher required)

// Re-measure bottom pad when data that can change nav size or list height updates (debounced by nextTick)
watch([projects, expandedProjects, sidebarFooterActions], () => {
    nextTick(() => {
        const navContainer = bottomNavRef.value as HTMLElement | null;
        const containerHeight = navContainer?.offsetHeight ?? 0;
        const hudHeight = (
            navContainer?.querySelector('.hud') as HTMLElement | null
        )?.offsetHeight;
        const h = Math.max(containerHeight, hudHeight ?? 0);
        bottomPad.value = h + 12;
    });
});

// (Removed verbose debug watcher)

onUnmounted(() => {
    sub?.unsubscribe();
    subProjects?.unsubscribe();
    subDocs?.unsubscribe();
});

const emit = defineEmits<{
    (e: 'chatSelected', id: string): void;
    (e: 'newChat'): void;
    (e: 'newDocument', initial?: { title?: string }): void;
    (e: 'documentSelected', id: string): void;
    (e: 'toggleDashboard'): void;
}>();
const hooks = useHooks();

// ----- Actions: menu, rename, delete -----
const showRenameModal = ref(false);
const renameId = ref<string | null>(null);
const renameTitle = ref('');
const renameMetaKind = ref<'chat' | 'doc' | null>(null);
const isRenamingDoc = computed(() => renameMetaKind.value === 'doc');

const showDeleteModal = ref(false);
const deleteId = ref<string | null>(null);
// Document delete state
const showDeleteDocumentModal = ref(false);
const deleteDocumentId = ref<string | null>(null);

// Project delete state
const showDeleteProjectModal = ref(false);
const deleteProjectId = ref<string | null>(null);

async function openRename(target: any) {
    // Case 1: payload from project tree: { projectId, entryId, kind }
    if (target && typeof target === 'object' && 'entryId' in target) {
        const { entryId, kind } = target as {
            projectId: string;
            entryId: string;
            kind?: string;
        };
        if (kind === 'chat') {
            const t = await db.threads.get(entryId);
            renameId.value = entryId;
            renameTitle.value = t?.title || 'New Thread';
            showRenameModal.value = true;
            renameMetaKind.value = 'chat';
        } else if (kind === 'doc') {
            const doc = await db.posts.get(entryId);
            if (doc && (doc as any).postType === 'doc') {
                renameId.value = entryId;
                renameTitle.value = (doc as any).title || 'Untitled';
                showRenameModal.value = true;
                renameMetaKind.value = 'doc';
            }
        }
        return;
    }
    // Case 1b: direct doc rename trigger { docId }
    if (target && typeof target === 'object' && 'docId' in target) {
        const doc = await db.posts.get(target.docId as string);
        if (doc && (doc as any).postType === 'doc') {
            renameId.value = target.docId as string;
            renameTitle.value = (doc as any).title || 'Untitled';
            showRenameModal.value = true;
            renameMetaKind.value = 'doc';
            return;
        }
    }
    // Case 2: direct thread object from thread list
    if (target && typeof target === 'object' && 'id' in target) {
        renameId.value = (target as any).id;
        renameTitle.value = (target as any).title ?? '';
        showRenameModal.value = true;
        renameMetaKind.value = 'chat';
    }
}

async function saveRename() {
    if (!renameId.value) return;
    // Determine if it's a thread or document by checking posts table first
    const maybeDoc = await db.posts.get(renameId.value);
    const now = nowSec();
    if (maybeDoc && (maybeDoc as any).postType === 'doc') {
        // Update doc title via documents API (fires hooks for sidebar refresh)
        await updateDocument(renameId.value, { title: renameTitle.value });
        // Refresh open document state if loaded in editor
        try {
            await loadDocument(renameId.value);
        } catch {}
        // Sync inside projects
        try {
            await syncProjectEntryTitle(
                renameId.value,
                'doc',
                renameTitle.value
            );
        } catch (e) {
            console.error('project doc title sync failed', e);
        }
    } else {
        const t = await db.threads.get(renameId.value);
        if (!t) return;
        await upsert.thread({
            ...t,
            title: renameTitle.value,
            updated_at: now,
        });
        // Sync title inside any project entries containing this thread
        try {
            await syncProjectEntryTitle(
                renameId.value,
                'chat',
                renameTitle.value
            );
        } catch (e) {
            console.error('project title sync failed', e);
        }
    }
    showRenameModal.value = false;
    renameId.value = null;
    renameTitle.value = '';
    renameMetaKind.value = null;
}

function confirmDelete(thread: any) {
    deleteId.value = thread.id as string;
    showDeleteModal.value = true;
}

// Confirm deletion of a project (opens modal)
function confirmDeleteProject(projectOrId: any) {
    // SidebarProjectTree may emit either the project id (string) or
    // a project object; handle both safely.
    const id =
        typeof projectOrId === 'string'
            ? projectOrId
            : projectOrId && typeof projectOrId === 'object'
            ? projectOrId.id
            : null;
    if (!id) return;
    deleteProjectId.value = id as string;
    showDeleteProjectModal.value = true;
}

async function deleteThread() {
    if (!deleteId.value) return;
    await dbDel.hard.thread(deleteId.value);
    showDeleteModal.value = false;
    deleteId.value = null;
}

async function deleteProject() {
    if (!deleteProjectId.value) return;
    try {
        // Use soft delete so project is recoverable like existing handler
        await deleteProjectCrud(deleteProjectId.value);
    } catch (e) {
        console.error('delete project failed', e);
    } finally {
        showDeleteProjectModal.value = false;
        deleteProjectId.value = null;
    }
}

// Document delete handling
function confirmDeleteDocument(doc: any) {
    deleteDocumentId.value = doc.id as string;
    showDeleteDocumentModal.value = true;
}
async function deleteDocument() {
    if (!deleteDocumentId.value) return;
    await dbDel.hard.document(deleteDocumentId.value);
    showDeleteDocumentModal.value = false;
    deleteDocumentId.value = null;
}

async function onNewChat() {
    emit('newChat');
    await hooks.doAction('ui.chat.new:action:after', {});
}

async function selectChat(id: string) {
    await hooks.doAction('ui.sidebar.select:action:before', {
        kind: 'chat',
        id,
    });
    emit('chatSelected', id);
    await hooks.doAction('ui.sidebar.select:action:after', {
        kind: 'chat',
        id,
    });
}
async function selectDocument(id: string) {
    await hooks.doAction('ui.sidebar.select:action:before', {
        kind: 'doc',
        id,
    });
    emit('documentSelected', id);
    await hooks.doAction('ui.sidebar.select:action:after', { kind: 'doc', id });
}
async function onProjectChatSelected(id: string) {
    await selectChat(id);
}
async function onProjectDocumentSelected(id: string) {
    await selectDocument(id);
}

// ---- Project Tree Handlers ----
async function handleAddChatToProject(projectId: string) {
    // Create a new chat thread and insert into project data array
    try {
        const now = nowSec();
        const threadId = newId();
        await create.thread({
            id: threadId,
            title: 'New Thread',
            forked: false,
            created_at: now,
            updated_at: now,
            deleted: false,
            clock: 0,
            meta: null,
        } as any);
        const project = await db.projects.get(projectId);
        if (!project) return;
        const entries = normalizeProjectData(project.data);
        entries.push({ id: threadId, name: 'New Thread', kind: 'chat' });
        await updateProjectEntries(projectId, entries);
        if (!expandedProjects.value.includes(projectId))
            expandedProjects.value.push(projectId);
        emit('chatSelected', threadId);
    } catch (e) {
        console.error('add chat to project failed', e);
    }
}

async function handleAddDocumentToProject(projectId: string) {
    try {
        // Create document (minimal title)
        const doc = await create.document({ title: 'Untitled' });
        const project = await db.projects.get(projectId);
        if (!project) return;
        const entries = normalizeProjectData(project.data);
        entries.push({ id: doc.id, name: doc.title, kind: 'doc' });
        await updateProjectEntries(projectId, entries);
        if (!expandedProjects.value.includes(projectId))
            expandedProjects.value.push(projectId);
        emit('documentSelected', doc.id);
    } catch (e) {
        console.error('add document to project failed', e);
    }
}

// ---- Project Rename Modal Logic ----
const showRenameProjectModal = ref(false);
const renameProjectId = ref<string | null>(null);
const renameProjectName = ref('');

async function openRenameProject(projectId: string) {
    const project =
        projects.value.find((p) => p.id === projectId) ||
        (await db.projects.get(projectId));
    if (!project) return;
    renameProjectId.value = projectId;
    renameProjectName.value = project.name || '';
    showRenameProjectModal.value = true;
}

async function saveRenameProject() {
    if (!renameProjectId.value) return;
    const name = renameProjectName.value.trim();
    if (!name) return;
    try {
        await renameProjectCrud(renameProjectId.value, name);
        showRenameProjectModal.value = false;
        renameProjectId.value = null;
        renameProjectName.value = '';
    } catch (e) {
        console.error('rename project failed', e);
    }
}

async function handleRenameEntry(payload: {
    projectId: string;
    entryId: string;
    kind?: ProjectEntryKind;
}) {
    try {
        const project = await db.projects.get(payload.projectId);
        if (!project) return;
        const entries = normalizeProjectData(project.data);
        const entry = entries.find((d) => d.id === payload.entryId);
        if (!entry) return;
        const newName = prompt('Rename entry', entry.name || '');
        if (newName == null) return;
        const name = newName.trim();
        if (!name) return;
        entry.name = name;
        if (!entry.kind && payload.kind) entry.kind = payload.kind;
        await updateProjectEntries(payload.projectId, entries);
        if (payload.kind === 'chat') {
            // sync thread title too
            const t = await db.threads.get(payload.entryId);
            if (t && t.title !== name) {
                await upsert.thread({
                    ...t,
                    title: name,
                    updated_at: nowSec(),
                });
            }
        }
    } catch (e) {
        console.error('rename entry failed', e);
    }
}

async function handleRemoveFromProject(payload: {
    projectId: string;
    entryId: string;
    kind?: ProjectEntryKind;
}) {
    try {
        const project = await db.projects.get(payload.projectId);
        if (!project) return;
        const entries = normalizeProjectData(project.data);
        const idx = entries.findIndex((d) => d.id === payload.entryId);
        if (idx === -1) return;
        entries.splice(idx, 1);
        await updateProjectEntries(payload.projectId, entries);
    } catch (e) {
        console.error('remove from project failed', e);
    }
}

// ---- Project Creation ----
const showCreateProjectModal = ref(false);
const creatingProject = ref(false);
const createProjectState = ref<{ name: string; description: string }>({
    name: '',
    description: '',
});
const createProjectErrors = ref<{ name?: string }>({});

function openCreateProject() {
    showCreateProjectModal.value = true;
    createProjectState.value = { name: '', description: '' };
    createProjectErrors.value = {};
}
function closeCreateProject() {
    showCreateProjectModal.value = false;
}

async function submitCreateProject() {
    if (creatingProject.value) return;
    const name = createProjectState.value.name.trim();
    if (!name) {
        createProjectErrors.value.name = 'Title required';
        return;
    }
    creatingProject.value = true;
    try {
        const newId = await createProjectCrud({
            name,
            description:
                createProjectState.value.description?.trim() || undefined,
        });
        // Auto expand the new project
        if (!expandedProjects.value.includes(newId))
            expandedProjects.value.push(newId);
        closeCreateProject();
    } catch (e) {
        console.error('Failed to create project', e);
    } finally {
        creatingProject.value = false;
    }
}

// (Project tree logic moved to SidebarProjectTree component)

// ---- Add To Project Flow ----
const showAddToProjectModal = ref(false);
const addToProjectThreadId = ref<string | null>(null);
// Support documents
const addToProjectDocumentId = ref<string | null>(null);
const addMode = ref<'select' | 'create'>('select');
const selectedProjectId = ref<string | undefined>(undefined);
const newProjectName = ref('');
const newProjectDescription = ref('');
const addingToProject = ref(false);
const addToProjectError = ref<string | null>(null);

const projectSelectOptions = computed(() =>
    projects.value.map((p) => ({ label: p.name, value: p.id }))
);

function openAddToProject(thread: any) {
    addToProjectThreadId.value = thread.id;
    addToProjectDocumentId.value = null;
    addMode.value = 'select';
    selectedProjectId.value = undefined;
    newProjectName.value = '';
    newProjectDescription.value = '';
    addToProjectError.value = null;
    showAddToProjectModal.value = true;
}
function openAddDocumentToProject(doc: any) {
    addToProjectDocumentId.value = doc.id;
    addToProjectThreadId.value = null;
    addMode.value = 'select';
    selectedProjectId.value = undefined;
    newProjectName.value = '';
    newProjectDescription.value = '';
    addToProjectError.value = null;
    showAddToProjectModal.value = true;
}
function closeAddToProject() {
    showAddToProjectModal.value = false;
    addToProjectThreadId.value = null;
    addToProjectDocumentId.value = null;
}

async function submitAddToProject() {
    if (addingToProject.value) return;
    if (!addToProjectThreadId.value && !addToProjectDocumentId.value) return;
    addToProjectError.value = null;
    addingToProject.value = true;
    try {
        let entry: ProjectEntry | null = null;
        if (addToProjectThreadId.value) {
            const thread = await db.threads.get(addToProjectThreadId.value);
            if (!thread) throw new Error('Thread not found');
            entry = {
                id: thread.id,
                name: thread.title || 'New Thread',
                kind: 'chat',
            };
        } else if (addToProjectDocumentId.value) {
            const doc = await db.posts.get(addToProjectDocumentId.value);
            if (!doc || (doc as any).postType !== 'doc')
                throw new Error('Document not found');
            entry = {
                id: doc.id,
                name: (doc as any).title || 'Untitled',
                kind: 'doc',
            };
        }
        if (!entry) throw new Error('Nothing to add');
        let projectId: string | null = null;
        if (addMode.value === 'create') {
            const projectName = newProjectName.value.trim();
            if (!projectName) {
                addToProjectError.value = 'Project name required';
                return;
            }
            const pid = await createProjectCrud({
                name: projectName,
                description: newProjectDescription.value.trim() || undefined,
            });
            await updateProjectEntries(pid, [entry]);
            projectId = pid;
            if (!expandedProjects.value.includes(pid))
                expandedProjects.value.push(pid);
        } else {
            const targetProjectId = selectedProjectId.value;
            if (!targetProjectId) {
                addToProjectError.value = 'Select a project';
                return;
            }
            projectId = targetProjectId;
            const project = await db.projects.get(targetProjectId);
            if (!project) throw new Error('Project not found');
            const entries = normalizeProjectData(project.data);
            const existing = entries.find(
                (d) => d.id === entry.id && d.kind === entry.kind
            );
            if (!existing) entries.push(entry);
            else existing.name = entry.name;
            await updateProjectEntries(project.id, entries);
        }
        closeAddToProject();
    } catch (e: any) {
        console.error('add to project failed', e);
        addToProjectError.value = e?.message || 'Failed to add';
    } finally {
        addingToProject.value = false;
    }
}

// ---- New Document Flow (naming modal) ----
const showCreateDocumentModal = ref(false);
const creatingDocument = ref(false);
const newDocumentState = ref<{ title: string }>({ title: '' });
const newDocumentErrors = ref<{ title?: string }>({});

function openCreateDocumentModal() {
    showCreateDocumentModal.value = true;
    newDocumentState.value = { title: '' };
    newDocumentErrors.value = {};
}
function closeCreateDocumentModal() {
    showCreateDocumentModal.value = false;
}
async function submitCreateDocument() {
    if (creatingDocument.value) return;
    const title = newDocumentState.value.title.trim();
    if (!title) {
        newDocumentErrors.value.title = 'Title required';
        return;
    }
    creatingDocument.value = true;
    try {
        emit('newDocument', { title });
        closeCreateDocumentModal();
    } finally {
        creatingDocument.value = false;
    }
}

// Expose focusSearchInput to parent components
function focusSearchInput() {
    sideNavHeaderRef.value?.focusSearchInput?.();
}

defineExpose({ focusSearchInput });
</script>
