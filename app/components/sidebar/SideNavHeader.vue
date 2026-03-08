<template>
    <div id="side-nav-content-header" class="pt-2 pb-2">
        <div class="flex w-full items-center gap-2">
            <div class="relative flex-1">
                <UInput
                    ref="searchInputWrapper"
                    v-model="sidebarQuery"
                    v-bind="searchInputProps"
                    aria-label="Search"
                    class="w-full"
                    @keydown.escape.prevent.stop="onEscapeClear"
                >
                    <template #trailing>
                        <UButton
                            v-if="sidebarQuery.length > 0"
                            v-bind="searchClearButtonProps"
                            class="flex items-center justify-center p-0"
                            aria-label="Clear input"
                            @click="sidebarQuery = ''"
                        />
                    </template>
                </UInput>
            </div>
        </div>

        <SidebarRenameEntityModal
            :modal-props="renameModalProps"
            :open="showRenameModal"
            :title="isRenamingDoc ? 'Rename document' : 'Rename thread'"
            :placeholder="isRenamingDoc ? 'Document title' : 'Thread title'"
            :icon="iconEdit"
            :value="renameTitle"
            @update:open="showRenameModal = $event"
            @update:value="renameTitle = $event"
            @submit="saveRename"
        />

        <SidebarRenameProjectModal
            :modal-props="renameProjectModalProps"
            :open="showRenameProjectModal"
            :value="renameProjectName"
            :icon-folder="iconFolder"
            @update:open="showRenameProjectModal = $event"
            @update:value="renameProjectName = $event"
            @submit="saveRenameProject"
        />

        <SidebarCreateProjectModal
            :modal-props="createProjectModalProps"
            :open="showCreateProjectModal"
            title="New project"
            :name="createProjectState.name"
            :description="createProjectState.description"
            :name-error="createProjectErrors.name"
            :icon-folder="iconFolder"
            :loading-icon="iconLoading"
            :loading="creatingProject"
            :form-field-props="sidebarFormFieldProps"
            @update:open="showCreateProjectModal = $event"
            @update:name="createProjectState.name = $event"
            @update:description="createProjectState.description = $event"
            @close="closeCreateProject"
            @submit="submitCreateProject"
        />

        <SidebarAddToProjectModal
            :modal-props="addToProjectModalProps"
            :open="showAddToProjectModal"
            title="Add thread to project"
            :mode="addMode"
            :selected-project-id="selectedProjectId"
            :new-project-name="newProjectName"
            :new-project-description="newProjectDescription"
            :error-message="addToProjectError"
            :project-select-options="projectSelectOptions"
            :icon-folder="iconFolder"
            :loading-icon="iconLoading"
            :loading="addingToProject"
            :searchable="true"
            :form-field-props="sidebarFormFieldProps"
            :select-props="sidebarProjectSelectProps"
            @update:open="showAddToProjectModal = $event"
            @update:mode="addMode = $event"
            @update:selected-project-id="selectedProjectId = $event"
            @update:new-project-name="newProjectName = $event"
            @update:new-project-description="newProjectDescription = $event"
            @close="closeAddToProject"
            @submit="submitAddToProject"
        />

        <SidebarCreateDocumentModal
            :modal-props="createDocumentModalProps"
            :open="showCreateDocumentModal"
            title="Name new document"
            :value="newDocumentState.title"
            :error="newDocumentErrors.title"
            placeholder="Document title"
            :icon="iconNote"
            :loading-icon="iconLoading"
            :loading="creatingDocument"
            :form-field-props="sidebarFormFieldProps"
            @update:open="showCreateDocumentModal = $event"
            @update:value="newDocumentState.title = $event"
            @close="closeCreateDocumentModal"
            @submit="submitCreateDocument"
        />
    </div>
</template>
<script setup lang="ts">
import { ref, computed } from 'vue';
import { useProjectsCrud } from '~/composables/projects/useProjectsCrud';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { createSidebarModalProps } from '~/components/sidebar/modalProps';
import { useIcon } from '~/composables/useIcon';
import SidebarAddToProjectModal from '~/components/sidebar/SidebarAddToProjectModal.vue';
import SidebarCreateDocumentModal from '~/components/sidebar/SidebarCreateDocumentModal.vue';
import SidebarCreateProjectModal from '~/components/sidebar/SidebarCreateProjectModal.vue';
import SidebarRenameEntityModal from '~/components/sidebar/SidebarRenameEntityModal.vue';
import SidebarRenameProjectModal from '~/components/sidebar/SidebarRenameProjectModal.vue';
import type { Project } from '~/db';
import type {
    ProjectEntry,
    ProjectEntryKind,
} from '~/utils/projects/normalizeProjectData';
import type { UnifiedSidebarItem } from '~/types/sidebar';

type SidebarProject = Omit<Project, 'data'> & { data: ProjectEntry[] };
type RenameTarget =
    | UnifiedSidebarItem
    | { id: string; title?: string; kind?: 'chat' | 'doc' }
    | { projectId: string; entryId: string; kind: ProjectEntryKind }
    | { docId: string };
type AddToProjectRequest = {
    threadId: string | null;
    documentId: string | null;
    mode: 'select' | 'create';
    selectedProjectId: string | null | undefined;
    newProjectName: string;
    newProjectDescription: string;
};

const iconEdit = useIcon('ui.edit');
const iconFolder = useIcon('sidebar.folder');
const iconLoading = useIcon('ui.loading');
const iconNote = useIcon('sidebar.note');
const iconSearch = useIcon('sidebar.search');
const iconClose = useIcon('ui.close');

const props = defineProps<{
    sidebarQuery: string;
    activeSections: {
        projects: boolean;
        chats: boolean;
        docs: boolean;
    };
    projects: SidebarProject[];
}>();

const emit = defineEmits<{
    (e: 'update:sidebarQuery', value: string): void;
    (e: 'update:activeSections', value: typeof props.activeSections): void;
    (e: 'new-chat'): void;
    (e: 'new-document', initial?: { title?: string }): void;
    (e: 'open-rename', target: RenameTarget): void;
    (e: 'open-rename-project', projectId: string): void;
    (
        e: 'add-to-project',
        payload: UnifiedSidebarItem | AddToProjectRequest
    ): void;
    (e: 'add-document-to-project', payload: UnifiedSidebarItem): void;
}>();

const { createProject: createProjectCrud, renameProject: renameProjectCrud } =
    useProjectsCrud();

// Theme overrides for interactive elements
const searchInputOverrides = useThemeOverrides({
    component: 'input',
    context: 'sidebar',
    identifier: 'sidebar.search',
    isNuxtUI: true,
});

const searchClearButtonOverrides = useThemeOverrides({
    component: 'button',
    context: 'sidebar',
    identifier: 'sidebar.search-clear',
    isNuxtUI: true,
});

const searchInputProps = computed(() => {
    // Merge theme UI with component-specific UI
    const themeUi = (searchInputOverrides.value as any)?.ui || {};
    const componentUi = {
        base: 'rounded-[18px] border border-[color:var(--md-border-color)]/80 bg-[color:var(--md-surface)]/85 shadow-[inset_0_1px_2px_rgba(15,23,42,0.06)] placeholder:text-[color:var(--md-on-surface-variant)]/70 focus:border-[color:var(--md-primary)]/40 focus:ring-2 focus:ring-[color:var(--md-primary)]/10',
        trailing: 'pr-1',
    };
    const mergedUi = { ...componentUi, ...themeUi };

    return {
        leadingIcon: iconSearch.value,
        trailing: false,
        size: 'md' as const,
        variant: 'outline' as const,
        placeholder: 'Search...',
        ...(searchInputOverrides.value as any),
        ui: mergedUi,
    };
});

const searchClearButtonProps = computed(() => {
    return {
        color: 'neutral' as const,
        variant: 'subtle' as const,
        size: 'xs' as const,
        icon: iconClose.value,
        ...(searchClearButtonOverrides.value as any),
    };
});

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

// Direct focus support for external callers
const searchInputWrapper = ref<any | null>(null);
function focusSearchInput() {
    // Access underlying input inside UInput component
    const root: HTMLElement | null = (searchInputWrapper.value?.$el ||
        searchInputWrapper.value) as HTMLElement | null;
    if (!root) return false;
    const input = root.querySelector('input') as HTMLInputElement | null;
    if (!input) return false;
    input.focus();
    input.select?.();
    return true;
}
defineExpose({ focusSearchInput });

const sidebarQuery = computed({
    get: () => props.sidebarQuery,
    set: (value) => emit('update:sidebarQuery', value),
});

function onEscapeClear() {
    if (sidebarQuery.value) sidebarQuery.value = '';
}

// ----- Actions: menu, rename, delete -----
const showRenameModal = ref(false);
const renameId = ref<string | null>(null);
const renameTitle = ref('');
const renameMetaKind = ref<'chat' | 'doc' | null>(null);
const isRenamingDoc = computed(() => renameMetaKind.value === 'doc');

const renameModalProps = createSidebarModalProps('sidebar.rename', {
    ui: { footer: 'justify-end' },
});

async function saveRename() {
    if (!renameId.value) return;
    emit('open-rename', {
        id: renameId.value,
        title: renameTitle.value,
        kind: renameMetaKind.value ?? undefined,
    });
    showRenameModal.value = false;
    renameId.value = null;
    renameTitle.value = '';
    renameMetaKind.value = null;
}

// ---- Project Rename Modal Logic ----
const showRenameProjectModal = ref(false);
const renameProjectId = ref<string | null>(null);
const renameProjectName = ref('');

const renameProjectModalProps = createSidebarModalProps(
    'sidebar.rename-project',
    {
        ui: { footer: 'justify-end' },
    }
);

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
        await createProjectCrud({
            name,
            description:
                createProjectState.value.description?.trim() || undefined,
        });
        closeCreateProject();
    } catch (e) {
        console.error('Failed to create project', e);
    } finally {
        creatingProject.value = false;
    }
}

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
    props.projects.map((p) => ({ label: p.name, value: p.id }))
);

const addToProjectModalProps = createSidebarModalProps(
    'sidebar.add-to-project',
    {
        ui: { footer: 'justify-end' },
    }
);

function openAddToProject(thread: UnifiedSidebarItem) {
    emit('add-to-project', thread);
}

function openAddDocumentToProject(doc: UnifiedSidebarItem) {
    emit('add-document-to-project', doc);
}

function closeAddToProject() {
    showAddToProjectModal.value = false;
    addToProjectThreadId.value = null;
    addToProjectDocumentId.value = null;
}

async function submitAddToProject() {
    emit('add-to-project', {
        threadId: addToProjectThreadId.value,
        documentId: addToProjectDocumentId.value,
        mode: addMode.value,
        selectedProjectId: selectedProjectId.value,
        newProjectName: newProjectName.value,
        newProjectDescription: newProjectDescription.value,
    });
    closeAddToProject();
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
        emit('new-document', { title });
        closeCreateDocumentModal();
    } finally {
        creatingDocument.value = false;
    }
}
</script>
