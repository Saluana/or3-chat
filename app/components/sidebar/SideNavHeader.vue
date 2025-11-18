<template>
    <div id="side-nav-content-header" class="px-2 pt-2 flex flex-col space-y-2">
        <div class="flex w-full items-center gap-2 mb-1">
            <div class="relative flex-1">
                <UInput
                    ref="searchInputWrapper"
                    v-model="sidebarQuery"
                    v-bind="searchInputProps"
                    aria-label="Search"
                    class="w-full"
                    @keydown.escape.prevent.stop="onEscapeClear"
                >
                    <template v-if="sidebarQuery.length > 0" #trailing>
                        <UButton
                            v-bind="searchClearButtonProps"
                            class="flex items-center justify-center p-0"
                            aria-label="Clear input"
                            @click="sidebarQuery = ''"
                        />
                    </template>
                </UInput>
            </div>
            <UPopover :content="{ side: 'bottom', align: 'end' }">
                <UButton
                    v-bind="filterButtonProps"
                    aria-label="Filter sections"
                    class="filter-trigger flex items-center justify-center h-[40px] w-[40px] rounded-[var(--md-border-radius)] border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] bg-[var(--md-inverse-surface)]/5 backdrop-blur"
                />
                <template #content>
                    <div class="space-y-2 min-w-[140px]">
                        <div
                            class="px-2 pb-1 border-b-[length:var(--md-border-width)] border-[color:var(--md-border-color)]"
                        >
                            <span
                                class="text-xs font-medium text-[color:var(--md-on-surface)]/60 tracking-wide"
                            >
                                Toggle sections
                            </span>
                        </div>
                        <div class="space-y-1">
                            <UButton
                                v-for="item in filterItems"
                                :key="item.key"
                                v-bind="filterItemButtonProps"
                                :leading-icon="
                                    activeSections[item.key]
                                        ? iconView
                                        : iconViewOff
                                "
                                @click="toggleSection(item.key)"
                            >
                                {{ item.label }}
                            </UButton>
                        </div>
                    </div>
                </template>
            </UPopover>
        </div>

        <div
            class="border-b-3 border-primary/50 pb-2 sidenav-header-separator"
        ></div>

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
                        :placeholder="
                            isRenamingDoc ? 'Document title' : 'Thread title'
                        "
                        :icon="iconEdit"
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
            v-bind="renameProjectModalProps"
            v-model:open="showRenameProjectModal"
            title="Rename project"
        >
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

        <!-- Create Project Modal -->
        <UModal
            v-bind="createProjectModalProps"
            v-model:open="showCreateProjectModal"
            title="New project"
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
                        <UIcon
                            :name="iconLoading"
                            class="animate-spin"
                        />
                        Creating
                    </span>
                </UButton>
            </template>
        </UModal>

        <!-- Add To Project Modal -->
        <UModal
            v-bind="addToProjectModalProps"
            v-model:open="showAddToProjectModal"
            title="Add thread to project"
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
                                searchable
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
                            :name="iconLoading"
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
            title="Name new document"
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
                        <UIcon
                            :name="iconLoading"
                            class="animate-spin"
                        />
                        Creating
                    </span>
                </UButton>
            </template>
        </UModal>
    </div>
</template>
<script setup lang="ts">
import { ref, computed } from 'vue';
import { useProjectsCrud } from '~/composables/projects/useProjectsCrud';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { createSidebarModalProps } from '~/components/sidebar/modalProps';
import { useIcon } from '~/composables/useIcon';

const iconView = useIcon('ui.view');
const iconViewOff = useIcon('ui.view_off');
const iconEdit = useIcon('ui.edit');
const iconFolder = useIcon('sidebar.folder');
const iconLoading = useIcon('ui.loading');
const iconNote = useIcon('sidebar.note');
const iconSearch = useIcon('sidebar.search');
const iconClose = useIcon('ui.close');
const iconFilter = useIcon('ui.filter');

const props = defineProps<{
    sidebarQuery: string;
    activeSections: {
        projects: boolean;
        chats: boolean;
        docs: boolean;
    };
    projects: any[];
}>();

const emit = defineEmits<{
    (e: 'update:sidebarQuery', value: string): void;
    (e: 'update:activeSections', value: typeof props.activeSections): void;
    (e: 'new-chat'): void;
    (e: 'new-document', initial?: { title?: string }): void;
    (e: 'open-rename', target: any): void;
    (e: 'open-rename-project', projectId: string): void;
    (e: 'add-to-project', thread: any): void;
    (e: 'add-document-to-project', doc: any): void;
}>();

const { createProject: createProjectCrud, renameProject: renameProjectCrud } =
    useProjectsCrud();

// Theme overrides for interactive elements
const searchInputProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'input',
        context: 'sidebar',
        identifier: 'sidebar.search',
        isNuxtUI: true,
    });

    // Merge theme UI with component-specific UI
    const themeUi = (overrides.value as any)?.ui || {};
    const componentUi = { leadingIcon: 'h-[20px] w-[20px]' };
    const mergedUi = { ...themeUi, ...componentUi };

    return {
        icon: iconSearch.value,
        size: 'md' as const,
        variant: 'outline' as const,
        placeholder: 'Search...',
        ...(overrides.value as any),
        ui: mergedUi,
    };
});

const searchClearButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'sidebar',
        identifier: 'sidebar.search-clear',
        isNuxtUI: true,
    });
    return {
        color: 'neutral' as const,
        variant: 'subtle' as const,
        size: 'xs' as const,
        icon: iconClose.value,
        ...(overrides.value as any),
    };
});

const filterButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'sidebar',
        identifier: 'sidebar.filter',
        isNuxtUI: true,
    });
    return {
        size: 'md' as const,
        color: 'neutral' as const,
        variant: 'ghost' as const,
        icon: iconFilter.value,
        square: true,
        ...(overrides.value as any),
    };
});

const filterItemButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'sidebar',
        identifier: 'sidebar.filter-item',
        isNuxtUI: true,
    });
    return {
        color: 'neutral' as const,
        variant: 'ghost' as const,
        size: 'sm' as const,
        block: true,
        ...(overrides.value as any),
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

// Section visibility (multi-select) defaults to all on
const filterItems = [
    { label: 'Projects', key: 'projects' as const },
    { label: 'Chats', key: 'chats' as const },
    { label: 'Docs', key: 'docs' as const },
] as const;

const activeSections = computed(() => props.activeSections);

function toggleSection(v: 'projects' | 'chats' | 'docs') {
    const next = { ...props.activeSections, [v]: !props.activeSections[v] };
    emit('update:activeSections', next);
}

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

async function openRename(target: any) {
    emit('open-rename', target);
}

async function saveRename() {
    emit('open-rename', {
        id: renameId.value,
        title: renameTitle.value,
        kind: renameMetaKind.value,
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

async function openRenameProject(projectId: string) {
    emit('open-rename-project', projectId);
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
const selectedProjectId = ref<string | null>(null);
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

function openAddToProject(thread: any) {
    emit('add-to-project', thread);
}

function openAddDocumentToProject(doc: any) {
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
        emit('new-document', { title });
        closeCreateDocumentModal();
    } finally {
        creatingDocument.value = false;
    }
}
</script>
