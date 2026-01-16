<template>
    <div id="sidebar" class="flex flex-row w-full h-full">
        <SidebarSideNavContentCollapsed
            id="sidebar-content-collapsed"
            :active-thread="props.activeThread"
            @new-chat="onNewChat"
            @new-document="openCreateDocumentModal"
            @new-project="openCreateProject"
            @focus-search="focusSearchInput"
            @toggle-dashboard="emit('toggleDashboard')"
            @expand-sidebar="() => {}"
        />
        <SidebarSideNavContent
            ref="sideNavContentRef"
            id="sidebar-content-expanded"
            class="flex-1 min-w-0"
            :active-thread="props.activeThread"
            :items="items"
            :projects="projects"
            :expanded-projects="expandedProjects"
            :docs="docs"
            :list-height="listHeight"
            :active-sections="activeSections"
            :display-threads="displayThreads"
            :display-projects="displayProjects"
            :display-documents="displayDocuments"
            :sidebar-query="sidebarQuery"
            :active-document-ids="activeDocumentIds"
            :active-thread-ids="activeThreadIds"
            :sidebar-footer-actions="sidebarFooterActions"
            :resolved-sidebar-sections="resolvedSidebarSections"
            @update:sidebar-query="sidebarQuery = $event"
            @update:active-sections="activeSections = $event"
            @update:expanded-projects="expandedProjects = $event"
            @new-chat="onNewChat"
            @new-document="openCreateDocumentModal"
            @new-project="openCreateProject"
            @open-rename="openRename"
            @open-rename-project="openRenameProject"
            @add-to-project="openAddToProject"
            @add-document-to-project="openAddDocumentToProject"
            @add-chat-to-project="handleAddChatToProject"
            @add-document-to-project-root="handleAddDocumentToProject"
            @rename-project="openRenameProject"
            @delete-project="confirmDeleteProject"
            @rename-entry="handleRenameEntry"
            @remove-from-project="handleRemoveFromProject"
            @chat-selected-from-project="onProjectChatSelected"
            @document-selected-from-project="onProjectDocumentSelected"
            @select-thread="selectChat"
            @rename-thread="openRename"
            @delete-thread="confirmDelete"
            @add-thread-to-project="openAddToProject"
            @select-document="selectDocument"
            @rename-document="openRename"
            @delete-document="confirmDeleteDocument"
            @add-document-to-project-from-list="openAddDocumentToProject"
            @sidebar-footer-action="handleSidebarFooterAction"
        />
    </div>

    <!-- Rename modal -->
    <UModal
        v-bind="renameModalProps"
        v-model:open="showRenameModal"
        :title="isRenamingDoc ? 'Rename document' : 'Rename thread'"
    >
        <template #body>
            <div class="space-y-4">
                <UInput
                    v-model="renameTitle"
                    class="w-full"
                    :placeholder="
                        isRenamingDoc ? 'Document title' : 'Thread title'
                    "
                    :icon="iconEdit"
                    @keyup.enter="saveRename"
                />
            </div>
        </template>
        <template #footer>
            <UButton
                variant="ghost"
                class="theme-btn"
                @click="showRenameModal = false"
                >Cancel</UButton
            >
            <UButton color="primary" class="theme-btn" @click="saveRename"
                >Save</UButton
            >
        </template>
    </UModal>

    <!-- Rename Project Modal -->
    <UModal
        v-bind="renameProjectModalProps"
        v-model:open="showRenameProjectModal"
        title="Rename project"
    >
        <template #header><h3>Rename project?</h3></template>
        <template #body>
            <div class="space-y-4">
                <UInput
                    v-model="renameProjectName"
                    placeholder="Project name"
                    :icon="iconFolder"
                    @keyup.enter="saveRenameProject"
                />
            </div>
        </template>
        <template #footer>
            <UButton
                variant="ghost"
                class="theme-btn"
                @click="showRenameProjectModal = false"
                >Cancel</UButton
            >
            <UButton
                color="primary"
                class="theme-btn"
                :disabled="!renameProjectName.trim()"
                @click="saveRenameProject"
                >Save</UButton
            >
        </template>
    </UModal>

    <!-- Delete confirm modal -->
    <UModal
        v-bind="deleteThreadModalProps"
        v-model:open="showDeleteModal"
        title="Delete thread"
    >
        <template #body>
            <p class="text-sm opacity-70">
                This will permanently remove the thread and its messages.
            </p>
        </template>
        <template #footer>
            <UButton
                variant="ghost"
                class="theme-btn"
                @click="showDeleteModal = false"
                >Cancel</UButton
            >
            <UButton color="error" class="theme-btn" @click="deleteThread"
                >Delete</UButton
            >
        </template>
    </UModal>

    <!-- Delete document confirm modal -->
    <UModal
        v-bind="deleteDocumentModalProps"
        v-model:open="showDeleteDocumentModal"
        title="Delete document"
    >
        <template #body>
            <p class="text-sm opacity-70">
                This will permanently remove the document.
            </p>
        </template>
        <template #footer>
            <UButton
                variant="ghost"
                class="theme-btn"
                @click="showDeleteDocumentModal = false"
                >Cancel</UButton
            >
            <UButton color="error" class="theme-btn" @click="deleteDocument"
                >Delete</UButton
            >
        </template>
    </UModal>

    <!-- Delete project confirm modal -->
    <UModal
        v-bind="deleteProjectModalProps"
        v-model:open="showDeleteProjectModal"
        title="Delete project"
    >
        <template #body>
            <p class="text-sm opacity-70">
                This will remove the project from the sidebar. Project data will
                be soft-deleted and can be recovered.
            </p>
        </template>
        <template #footer>
            <UButton
                variant="ghost"
                class="theme-btn"
                @click="showDeleteProjectModal = false"
                >Cancel</UButton
            >
            <UButton color="error" class="theme-btn" @click="deleteProject"
                >Delete</UButton
            >
        </template>
    </UModal>

    <!-- Create Project Modal -->
    <UModal
        v-bind="createProjectModalProps"
        v-model:open="showCreateProjectModal"
        title="New Project"
    >
        <template #body>
            <div class="space-y-4">
                <UForm
                    :state="createProjectState"
                    @submit.prevent="submitCreateProject"
                >
                    <div class="flex flex-col space-y-3">
                        <UFormField
                            v-bind="sidebarFormFieldProps"
                            label="Title"
                            name="name"
                            :error="createProjectErrors.name"
                        >
                            <UInput
                                v-model="createProjectState.name"
                                required
                                placeholder="Project title"
                                :icon="iconFolder"
                                class="w-full"
                                @keyup.enter="submitCreateProject"
                            />
                        </UFormField>
                        <UFormField
                            v-bind="sidebarFormFieldProps"
                            label="Description"
                            name="description"
                        >
                            <UTextarea
                                class="w-full border-[var(--md-border-width)] rounded-[6px]"
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
            <UButton
                variant="ghost"
                class="theme-btn"
                @click="closeCreateProject"
                >Cancel</UButton
            >
            <UButton
                :disabled="!createProjectState.name.trim() || creatingProject"
                color="primary"
                class="theme-btn"
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
        v-bind="addToProjectModalProps"
        v-model:open="showAddToProjectModal"
        title="Add to project"
    >
        <template #body>
            <div class="space-y-4">
                <div class="flex gap-2 text-xs font-mono">
                    <button
                        class="theme-btn px-2 py-1 rounded-[4px] border-[var(--md-border-width)]"
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
                        class="theme-btn px-2 py-1 rounded-[4px] border-[var(--md-border-width)]"
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
                    <UFormField
                        v-bind="sidebarFormFieldProps"
                        label="Project"
                        name="project"
                    >
                        <USelectMenu
                            v-model="selectedProjectId"
                            :items="projectSelectOptions"
                            :value-key="'value'"
                            placeholder="Select project"
                            v-bind="sidebarProjectSelectProps"
                        />
                    </UFormField>
                    <p v-if="addToProjectError" class="text-error text-xs">
                        {{ addToProjectError }}
                    </p>
                </div>
                <div v-else class="space-y-3">
                    <UFormField
                        v-bind="sidebarFormFieldProps"
                        label="Project Title"
                        name="newProjectName"
                    >
                        <UInput
                            v-model="newProjectName"
                            placeholder="Project name"
                            :icon="iconFolder"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        v-bind="sidebarFormFieldProps"
                        label="Description"
                        name="newProjectDescription"
                    >
                        <UTextarea
                            v-model="newProjectDescription"
                            :rows="3"
                            placeholder="Optional description"
                            class="w-full border-[var(--md-border-width)] rounded-[6px]"
                        />
                    </UFormField>
                    <p v-if="addToProjectError" class="text-error text-xs">
                        {{ addToProjectError }}
                    </p>
                </div>
            </div>
        </template>
        <template #footer>
            <UButton
                variant="ghost"
                class="theme-btn"
                @click="closeAddToProject"
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
        v-bind="createDocumentModalProps"
        v-model:open="showCreateDocumentModal"
        title="New Document"
    >
        <template #body>
            <div class="space-y-4">
                <UForm
                    :state="newDocumentState"
                    @submit.prevent="submitCreateDocument"
                >
                    <UFormField
                        v-bind="sidebarFormFieldProps"
                        label="Title"
                        name="title"
                        :error="newDocumentErrors.title"
                    >
                        <UInput
                            v-model="newDocumentState.title"
                            required
                            placeholder="Document title"
                            :icon="iconNote"
                            class="w-full"
                            @keyup.enter="submitCreateDocument"
                        />
                    </UFormField>
                </UForm>
            </div>
        </template>
        <template #footer>
            <UButton
                variant="ghost"
                class="theme-btn"
                @click="closeCreateDocumentModal"
                >Cancel</UButton
            >
            <UButton
                color="primary"
                class="theme-btn"
                :disabled="creatingDocument || !newDocumentState.title.trim()"
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
import { useHooks } from '~/core/hooks/useHooks';
import { liveQuery } from 'dexie';
import {
    db,
    upsert,
    del as dbDel,
    type Post,
    type Project,
    type Thread,
} from '~/db'; // Dexie + barrel helpers
import { nowSec } from '~/db/util';
import { updateDocument } from '~/db/documents';
import { loadDocument } from '~/composables/documents/useDocumentsStore';
import { useProjectsCrud } from '~/composables/projects/useProjectsCrud';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { useIcon } from '~/composables/useIcon';
import {
    normalizeProjectData,
    type ProjectEntry,
    type ProjectEntryKind,
} from '~/utils/projects/normalizeProjectData';
import { createSidebarModalProps } from '~/components/sidebar/modalProps';
import type { ThreadItem, DocumentItem } from '~/types/sidebar';
import { getOpenDocumentIds, getOpenThreadIds } from '~/utils/multiPaneHelpers';

/**
 * Helper to check if a post is a document
 */
function isDocumentPost(
    post: Post | undefined
): post is Post & { postType: 'doc' } {
    return post !== undefined && post.postType === 'doc';
}

/**
 * Rename target types - can be from project tree or direct selection
 */
type RenamePayload =
    | { projectId: string; entryId: string; kind: 'chat' | 'doc' }
    | { docId: string }
    | ThreadItem
    | DocumentItem;

const iconEdit = useIcon('ui.edit');
const iconFolder = useIcon('sidebar.folder');
const iconNote = useIcon('sidebar.note');

type SidebarProject = Omit<Project, 'data'> & { data: ProjectEntry[] };
// (Temporarily removed virtualization for chats — use simple list for now)

const {
    createProject: createProjectCrud,
    renameProject: renameProjectCrud,
    deleteProject: deleteProjectCrud,
    createThreadEntry,
    createDocumentEntry,
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

/**
 * Type for SideNavContent component instance with exposed methods
 */
interface SideNavContentInstance extends ComponentPublicInstance {
    focusSearchInput?: () => boolean;
    headerElement?: HTMLElement | null;
}

const sideNavContentRef = ref<SideNavContentInstance | null>(null);
const items = ref<Thread[]>([]);
const projects = ref<SidebarProject[]>([]);
const expandedProjects = ref<string[]>([]);
const listHeight = ref(400);
import { useSidebarSearch } from '~/composables/sidebar/useSidebarSearch';
import {
    useSidebarSections,
    useSidebarFooterActions,
} from '~/composables/sidebar/useSidebarSections';
import { useActiveSidebarPage } from '~/composables/sidebar/useActiveSidebarPage';
import { getGlobalMultiPaneApi } from '~/utils/multiPaneApi';
import type { ComponentPublicInstance } from 'vue';
// Documents live query (docs only) to feed search
const docs = ref<Post[]>([]);
let subDocs: { unsubscribe: () => void } | null = null;

const DEFAULT_PAGE_ID = 'sidebar-home';

const { activePageId, resetToDefault } = useActiveSidebarPage();

// Active item tracking (multi-pane aware). Uses global multi-pane API if present.
const activeDocumentIds = computed<string[]>(() => {
    return getOpenDocumentIds();
});
const activeThreadIds = computed<string[]>(() => {
    const ids = getOpenThreadIds();
    if (ids.length) return ids;
    return props.activeThread ? [props.activeThread] : [];
});

const sectionComponentCache = new Map<string, Component>();

/**
 * Type guard to check if source is a Vue component (not an async loader)
 */
function isVueComponent(source: unknown): source is Component {
    return (
        typeof source === 'object' &&
        source !== null &&
        ('render' in source || 'setup' in source)
    );
}

/**
 * Module type for async component loading
 */
interface ComponentModule {
    default?: Component;
    component?: Component;
}

function resolveSidebarSectionComponent(
    id: string,
    source: SidebarSection['component']
): Component {
    // If it's already a component, return it directly
    if (isVueComponent(source)) {
        return source;
    }

    // Otherwise it's an async loader function
    if (typeof source === 'function') {
        const cached = sectionComponentCache.get(id);
        if (cached) return cached;

        const asyncComp = defineAsyncComponent(async () => {
            const mod = await (
                source as () => Promise<ComponentModule | Component>
            )();

            // Handle module with default export
            if (mod && typeof mod === 'object' && 'default' in mod) {
                const moduleWithDefault = mod as ComponentModule;
                const comp =
                    moduleWithDefault.default ?? moduleWithDefault.component;
                if (process.dev && !comp) {
                    console.warn(
                        `[useSidebarSections] Async section loader for ${id} returned invalid component`,
                        mod
                    );
                }
                return comp!;
            }

            // Module is the component itself
            return mod as Component;
        });
        sectionComponentCache.set(id, asyncComp);
        return asyncComp;
    }

    // Fallback - should not happen with proper types
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

const sidebarProjectSelectOverrides = useThemeOverrides({
    component: 'selectmenu',
    context: 'sidebar',
    identifier: 'sidebar.project-select',
    isNuxtUI: true,
});

const sidebarProjectSelectProps = computed(() => {
    const overrideValue =
        (sidebarProjectSelectOverrides.value as Record<string, any>) || {};
    const mergedClass = ['w-full', overrideValue.class || '']
        .filter(Boolean)
        .join(' ');

    return {
        ...overrideValue,
        class: mergedClass,
    };
});

const sidebarFormFieldProps = useThemeOverrides({
    component: 'formField',
    context: 'sidebar',
    isNuxtUI: true,
});

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
} = useSidebarSearch(items, projects, docs);

const displayThreads = computed(() =>
    sidebarQuery.value.trim() ? threadResults.value : items.value
);
// Filter projects + entries when query active
const projectsFilteredByExistence = computed<SidebarProject[]>(() => {
    const threadSet = new Set(items.value.map((t) => t.id));
    const docSet = new Set(docs.value.map((d) => d.id));

    return projects.value.map((p) => {
        const filteredEntries = p.data.filter((entry) => {
            const id = entry?.id;
            if (!id) return false;
            const kind = entry.kind ?? 'chat';
            return (
                (kind === 'chat' && threadSet.has(id)) ||
                (kind === 'doc' && docSet.has(id)) ||
                (kind !== 'chat' && kind !== 'doc')
            );
        });
        return filteredEntries.length === p.data.length
            ? p
            : { ...p, data: filteredEntries };
    });
});

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

// Calculate list height using specific element IDs for accuracy
import { inject, type Ref } from 'vue';
import {
    useResizeObserver,
    useEventListener,
    useDebounceFn,
} from '@vueuse/core';

// Inject header height at setup level
const topHeaderHeightInjected = inject<Ref<number>>('topHeaderHeight');

// Debounce resize recomputation
const recomputeListHeight = useDebounceFn(() => {
    // Get the viewport height
    const viewportHeight = window.innerHeight;

    // Get specific element heights
    const topHeaderHeight = topHeaderHeightInjected?.value || 48;

    const sideNavHeaderElement = sideNavContentRef.value?.headerElement;
    const sideNavHeaderHeight = sideNavHeaderElement?.offsetHeight || 67.3;

    // Calculate available space for the list
    // Add extra padding to account for borders, margins, and visual gaps (20px total)
    const available = viewportHeight - topHeaderHeight - sideNavHeaderHeight;

    listHeight.value = available > 100 ? available : 100;
}, 50);

// Ref for observed header element
const sideNavHeaderElementRef = computed(
    () => sideNavContentRef.value?.headerElement ?? null
);

// Setup resize observer on sidebar header element (VueUse handles cleanup)
useResizeObserver(sideNavHeaderElementRef, () => {
    recomputeListHeight();
});

// Listen to window resize (VueUse handles cleanup)
useEventListener(window, 'resize', recomputeListHeight);

// Watch injected height changes
if (topHeaderHeightInjected) {
    watch(topHeaderHeightInjected, recomputeListHeight);
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
            .and((r) => !r.deleted)
            .toArray()
    ).subscribe({
        next: (res) => {
            docs.value = res.map((d: any) => ({ ...d }));
        },
        error: (err) => console.error('documents liveQuery error', err),
    });
});

// Re-measure bottom pad when data that can change nav size or list height updates (debounced by nextTick)
watch([projects, expandedProjects, sidebarFooterActions], () => {
    nextTick(() => {
        recomputeListHeight();
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

const renameModalProps = createSidebarModalProps('sidebar.rename', {
    ui: { footer: 'justify-end' },
});

const renameProjectModalProps = createSidebarModalProps(
    'sidebar.rename-project',
    {
        ui: { footer: 'justify-end' },
    }
);

const showDeleteModal = ref(false);
const deleteId = ref<string | null>(null);
const deleteThreadModalProps = createSidebarModalProps(
    'sidebar.delete-thread',
    {
        ui: { footer: 'justify-end' },
        class: 'border-[var(--md-border-width)]',
    }
);
// Document delete state
const showDeleteDocumentModal = ref(false);
const deleteDocumentId = ref<string | null>(null);
const deleteDocumentModalProps = createSidebarModalProps(
    'sidebar.delete-document',
    {
        ui: { footer: 'justify-end' },
        class: 'border-[var(--md-border-width)]',
    }
);

// Project delete state
const showDeleteProjectModal = ref(false);
const deleteProjectId = ref<string | null>(null);
const deleteProjectModalProps = createSidebarModalProps(
    'sidebar.delete-project',
    {
        ui: { footer: 'justify-end' },
        class: 'border-[var(--md-border-width)]',
    }
);

async function openRename(target: RenamePayload) {
    // Case 1: payload from project tree: { projectId, entryId, kind }
    if ('entryId' in target) {
        const { entryId, kind } = target;
        if (kind === 'chat') {
            const t = await db.threads.get(entryId);
            renameId.value = entryId;
            renameTitle.value = t?.title || 'New Thread';
            showRenameModal.value = true;
            renameMetaKind.value = 'chat';
        } else if (kind === 'doc') {
            const doc = await db.posts.get(entryId);
            if (isDocumentPost(doc)) {
                renameId.value = entryId;
                renameTitle.value = doc.title || 'Untitled';
                showRenameModal.value = true;
                renameMetaKind.value = 'doc';
            }
        }
        return;
    }
    // Case 1b: direct doc rename trigger { docId }
    if ('docId' in target) {
        const doc = await db.posts.get(target.docId);
        if (isDocumentPost(doc)) {
            renameId.value = target.docId;
            renameTitle.value = doc.title || 'Untitled';
            showRenameModal.value = true;
            renameMetaKind.value = 'doc';
            return;
        }
    }
    // Case 2: direct thread or document object
    if ('id' in target) {
        renameId.value = target.id;
        renameTitle.value = 'title' in target ? (target.title ?? '') : '';
        showRenameModal.value = true;
        renameMetaKind.value =
            'postType' in target && target.postType === 'doc' ? 'doc' : 'chat';
    }
}

async function saveRename() {
    if (!renameId.value) return;
    // Determine if it's a thread or document by checking posts table first
    const maybeDoc = await db.posts.get(renameId.value);
    const now = nowSec();
    if (isDocumentPost(maybeDoc)) {
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

function confirmDelete(thread: ThreadItem) {
    deleteId.value = thread.id;
    showDeleteModal.value = true;
}

// Confirm deletion of a project (opens modal)
function confirmDeleteProject(projectOrId: string | Project) {
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
function confirmDeleteDocument(doc: DocumentItem) {
    deleteDocumentId.value = doc.id;
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
    try {
        const created = await createThreadEntry(projectId);
        if (!created) return;
        if (!expandedProjects.value.includes(projectId))
            expandedProjects.value.push(projectId);
        emit('chatSelected', created.id);
    } catch (e) {
        console.error('add chat to project failed', e);
    }
}

async function handleAddDocumentToProject(projectId: string) {
    try {
        const doc = await createDocumentEntry(projectId);
        if (!doc) return;
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
const createProjectModalProps = createSidebarModalProps(
    'sidebar.create-project',
    {
        ui: { footer: 'justify-end' },
    }
);

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
const addToProjectModalProps = createSidebarModalProps(
    'sidebar.add-to-project',
    {
        ui: { footer: 'justify-end' },
    }
);

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
            if (!doc || doc.postType !== 'doc')
                throw new Error('Document not found');
            entry = {
                id: doc.id,
                name: doc.title || 'Untitled',
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
const createDocumentModalProps = createSidebarModalProps(
    'sidebar.create-document',
    {
        ui: { footer: 'justify-end' },
    }
);

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
async function focusSearchInput() {
    if (activePageId.value !== DEFAULT_PAGE_ID) {
        const switched = await resetToDefault();
        if (!switched) return false;
        await nextTick();
    }

    let focused = sideNavContentRef.value?.focusSearchInput?.() ?? false;
    if (focused) return true;

    await nextTick();
    focused = sideNavContentRef.value?.focusSearchInput?.() ?? false;
    return focused;
}

defineExpose({
    focusSearchInput,
    openCreateDocumentModal,
    openCreateProject,
});
</script>
