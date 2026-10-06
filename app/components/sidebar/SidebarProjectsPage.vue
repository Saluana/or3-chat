<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch, toRaw } from 'vue';
import { liveQuery } from 'dexie';
import { subscribeActiveWorkspaceDb } from '~/db/client';
import { createThreadInDb } from '~/db/threads';
import { prepareProjectWrite } from '~/db/projects';
import { prepareDocumentCreate } from '~/db/documents';
import { getWriteTxTableNames } from '~/db/util';
import {
    readProjectWorkspace,
    saveProjectSettings,
    saveProjectMemory,
    deleteProjectRecord,
    saveProjectSource,
    moveChatToProject,
} from '~/db/project-workspace';
import {
    captureProjectOperation,
    projectToolEnabled,
} from '~/utils/projects/context';
import {
    addProjectUpload,
    addProjectDocument,
    processProjectSource,
    addExistingProjectFile,
} from '~/utils/projects/source-intake';
import { getFileBlob } from '~/db/files';
import { newId, nowSec } from '~/db/util';
import { getPaletteHostContext } from '~/composables/search/useCommandPalette';
import {
    useToolRegistry,
    type RegisteredTool,
} from '~/utils/chat/tool-registry';
import { useModelStore } from '~/composables/chat/useModelStore';
import {
    defaultProjectSettings,
    type ProjectSettings,
    type ProjectSource,
} from '~~/shared/projects/workspace';
import type { ProjectRecord } from '~/db/project-workspace';
import type { Project, Thread, Post } from '~/db/schema';
import { useProjectSidebar } from '~/composables/sidebar/useProjectSidebar';
import { useActiveSidebarPage } from '~/composables/sidebar/useActiveSidebarPage';
import SidebarEmptyState from './SidebarEmptyState.vue';
import SidebarPageLink from './SidebarPageLink.vue';
import SidebarTimeGroupedList from './SidebarTimeGroupedList.vue';
import type { UnifiedSidebarItem } from '~/types/sidebar';

defineOptions({ name: 'sidebar-projects-home' });
const props = defineProps<{
    sidebarQuery?: string;
    activeThreadIds?: string[];
    activeDocumentIds?: string[];
}>();
const emit = defineEmits<{
    (
        e:
            | 'rename-thread'
            | 'delete-thread'
            | 'add-to-project'
            | 'rename-document'
            | 'delete-document'
            | 'add-document-to-project-from-list',
        item: UnifiedSidebarItem,
    ): void;
}>();
const { projectId: id, returnTo } = useProjectSidebar();
const { setActivePage } = useActiveSidebarPage();
const backIcon = useIcon('ui.chevron.left');
const projectIcon = useIcon('sidebar.folder');
const newProjectIcon = useIcon('sidebar.new_folder');
const newChatIcon = useIcon('sidebar.new_chat');
const knowledgeIcon = useIcon('sidebar.note');
const settingsIcon = useIcon('ui.settings');
const editIcon = useIcon('ui.edit');
const chevronIcon = useIcon('ui.chevron.right');
const plusIcon = useIcon('ui.plus');
const trashIcon = useIcon('ui.trash');
const sourceInput = ref<'' | 'note' | 'document' | 'file'>('');
const sourceMenuOpen = ref(false);
const briefEditing = ref(false);
const creatingMemory = ref(false);
const editingMemory = ref<{
    record: NonNullable<
        Awaited<ReturnType<typeof readProjectWorkspace>>
    >['memories'][number];
    text: string;
} | null>(null);
const suggestionsReviewed = ref(false);
const creating = ref(false);
const tab = ref('Overview');
const sectionDescriptions: Record<string, string> = {
    Knowledge: 'Sources for this project.',
    Memory: 'What matters for this project.',
    Settings: 'Instructions and tools for this project.',
};
const query = ref('');
const name = ref('');
const projects = ref<Array<{ project: Project; pinned: boolean }>>([]);
const state = ref<Awaited<ReturnType<typeof readProjectWorkspace>> | null>(
    null,
);
const chats = ref<Thread[]>([]);
const documents = ref<Post[]>([]);
const settings = ref<ProjectSettings>(defaultProjectSettings());
const dirty = ref(false);
const editClock = ref<number | null>(null);
const memory = ref('');
const memoryKind = ref<'fact' | 'decision'>('fact');
const documentId = ref('');
const fileId = ref('');
const files = ref<Post[]>([]);
const busy = ref(false);
const error = ref('');
const previewText = ref('');
const previewTitle = ref('');
const previewImage = ref('');
const previewLocations = ref<
    Array<{ label: string; start: number; end: number }>
>([]);
const memoryEvidence = ref<{
    source_thread_id: string;
    source_message_id: string;
    summary_id: string;
} | null>(null);
const reviewedDecisions = ref(false);
const noteTitle = ref('');
const noteText = ref('');
const briefEvidence = ref<string | null>(null);
const upload = ref<HTMLInputElement | null>(null);
const replace = ref<ProjectRecord<ProjectSource> | undefined>();
const suggestions = ref<
    Awaited<
        ReturnType<
            typeof import('~/utils/projects/continuity').projectContinuity
        >
    >
>([]);
const existingChatId = ref('');
const allChats = ref<Thread[]>([]);
const tools = useToolRegistry().listTools;
const { catalog, favoriteModels } = useModelStore();
const toolQuery = ref('');
const manageChatsOpen = ref(false);
const chatDefaultModel = 'or3:chat-default';
const modelItems = computed(() => {
    const items = new Map<string, { label: string; value: string }>();
    items.set(chatDefaultModel, {
        label: 'Use chat default',
        value: chatDefaultModel,
    });
    for (const model of [...favoriteModels.value, ...catalog.value]) {
        const value = model.canonical_slug ?? model.id;
        items.set(value, { label: model.name || value, value });
    }
    const current = settings.value.default_model;
    if (current && !items.has(current))
        items.set(current, { label: current, value: current });
    return [...items.values()];
});
function toolLabel(tool: RegisteredTool) {
    return (
        tool.definition.ui?.label ||
        tool.definition.function.name
            .replaceAll('_', ' ')
            .replace(/^./, (letter) => letter.toUpperCase())
    );
}
function toolReady(tool: RegisteredTool) {
    return (
        tool.enabled.value && !toolCannotScope(tool.definition.function.name)
    );
}
const matchingTools = computed(() => {
    const query = toolQuery.value.trim().toLowerCase();
    return tools.value.filter((tool) =>
        `${toolLabel(tool)} ${tool.definition.ui?.category ?? ''} ${tool.definition.function.name}`
            .toLowerCase()
            .includes(query),
    );
});
const toolGroups = computed(() => {
    const groups = new Map<string, RegisteredTool[]>();
    for (const tool of matchingTools.value.filter(toolReady)) {
        const category =
            tool.definition.ui?.category ?? tool.definition.category ?? 'Other';
        const group = groups.get(category) ?? [];
        group.push(tool);
        groups.set(category, group);
    }
    return [...groups].map(([label, tools]) => ({ label, tools }));
});
const unavailableTools = computed(() =>
    matchingTools.value.filter((tool) => !toolReady(tool)),
);
function toolModeValue(name: string) {
    return (
        settings.value.tools[name]?.mode ??
        (projectToolEnabled(settings.value, name) ? 'enabled' : 'disabled')
    );
}
const toolModes: Array<{
    label: string;
    value: 'disabled' | 'ask' | 'enabled';
}> = [
    { label: 'Off', value: 'disabled' },
    { label: 'Ask first', value: 'ask' },
    { label: 'On', value: 'enabled' },
];
function supportsRepositories(tool: RegisteredTool) {
    const properties = tool.definition.function.parameters.properties;
    return ['repository', 'repo'].some((key) => {
        const property = properties?.[key];
        if (!property || typeof property !== 'object') return false;
        const type = (property as { type?: unknown }).type;
        return (
            type === 'string' ||
            (Array.isArray(type) && type.includes('string'))
        );
    });
}
function setToolResources(name: string, value: string) {
    settings.value.tools[name] = {
        mode: toolModeValue(name),
        resources: value
            .split('\n')
            .map((value) => value.trim())
            .filter(Boolean),
    };
    dirty.value = true;
}
function discardSettings() {
    if (!state.value) return;
    settings.value = structuredClone(toRaw(state.value.settings));
    editClock.value = state.value.settingsRow?.clock ?? null;
    briefEvidence.value = null;
    dirty.value = false;
}
let controller = new AbortController();
let scope = captureProjectOperation(controller.signal);
let subscription: { unsubscribe(): void } | undefined;
let disposed = false;
const filtered = computed(() =>
    projects.value
        .filter((p) =>
            p.project.name
                .toLowerCase()
                .includes((props.sidebarQuery ?? query.value).toLowerCase()),
        )
        .sort(
            (a, b) =>
                Number(b.pinned) - Number(a.pinned) ||
                b.project.updated_at - a.project.updated_at,
        ),
);
function releasePreview() {
    if (previewImage.value) URL.revokeObjectURL(previewImage.value);
    previewImage.value = '';
    previewText.value = '';
    previewLocations.value = [];
}
function connect() {
    subscription?.unsubscribe();
    controller.abort();
    controller = new AbortController();
    scope = captureProjectOperation(controller.signal);
    state.value = null;
    dirty.value = false;
    toolQuery.value = '';
    manageChatsOpen.value = false;
    suggestions.value = [];
    memory.value = '';
    memoryEvidence.value = null;
    briefEvidence.value = null;
    sourceInput.value = '';
    noteTitle.value = '';
    noteText.value = '';
    documentId.value = '';
    fileId.value = '';
    sourceMenuOpen.value = false;
    briefEditing.value = false;
    creatingMemory.value = false;
    editingMemory.value = null;
    suggestionsReviewed.value = false;
    releasePreview();
    const captured = scope;
    subscription = liveQuery(async () => {
        const rows = (await captured.db.projects.toArray()).filter(
            (p) => !p.deleted,
        );
        const list = await Promise.all(
            rows.map(async (project) => ({
                project,
                pinned: (await readProjectWorkspace(captured.db, project.id))
                    .settings.pinned,
            })),
        );
        const current = id.value
            ? await readProjectWorkspace(captured.db, id.value)
            : null;
        const all = (await captured.db.threads.toArray()).filter(
            (t) => !t.deleted,
        );
        const threads = current
            ? all.filter(
                  (t) =>
                      !t.deleted &&
                      (t.project_id === current.project.id ||
                          (!t.project_id &&
                              Array.isArray(current.project.data) &&
                              current.project.data.some((e: any) =>
                                  typeof e === 'string'
                                      ? e === t.id
                                      : e?.id === t.id &&
                                        (!e.kind || e.kind === 'chat'),
                              ))),
              )
            : [];
        const { isVisibleWorkspaceItem } =
            await import('~~/shared/posts/workspace-item');
        const docs = (
            await captured.db.posts.where('postType').equals('doc').toArray()
        ).filter(isVisibleWorkspaceItem);
        const files = (
            await captured.db.posts
                .where('postType')
                .equals('or3:file')
                .toArray()
        ).filter(isVisibleWorkspaceItem);
        return { list, current, threads, docs, all, files };
    }).subscribe({
        next(value) {
            if (disposed || captured !== scope) return;
            allChats.value = value.all;
            projects.value = value.list;
            state.value = value.current;
            chats.value = value.threads.sort(
                (a, b) =>
                    (b.last_message_at ?? b.updated_at) -
                    (a.last_message_at ?? a.updated_at),
            );
            documents.value = value.docs;
            files.value = value.files;
            if (!dirty.value && value.current) {
                settings.value = structuredClone(value.current.settings);
                editClock.value = value.current.settingsRow?.clock ?? null;
            }
        },
        error(cause) {
            error.value =
                cause instanceof Error
                    ? cause.message
                    : 'Could not load projects.';
        },
    });
}
const stopWorkspace = subscribeActiveWorkspaceDb(() => {
    id.value = '';
    connect();
});
watch(id, () => {
    tab.value = 'Overview';
    connect();
});
connect();
onBeforeUnmount(() => {
    disposed = true;
    subscription?.unsubscribe();
    stopWorkspace();
    controller.abort();
    releasePreview();
});
async function run(action: () => Promise<unknown>) {
    if (busy.value) return;
    busy.value = true;
    error.value = '';
    try {
        await action();
    } catch (cause) {
        error.value =
            cause instanceof Error
                ? cause.message
                : 'Project operation failed.';
    } finally {
        busy.value = false;
    }
}
async function openProject(projectId: string) {
    id.value = projectId;
    returnTo.value = 'projects';
    creating.value = false;
}
function goBack() {
    if (id.value && tab.value !== 'Overview') {
        tab.value = 'Overview';
    } else if (id.value && returnTo.value === 'projects') {
        id.value = '';
    } else {
        id.value = '';
        void setActivePage('sidebar-home');
    }
}
function chooseSource(kind: 'note' | 'document' | 'file') {
    sourceInput.value = kind;
    sourceMenuOpen.value = false;
}
function currentRevision(source: ProjectRecord<ProjectSource>) {
    return (
        source.value.revisions.find(
            (revision) => revision.id === source.value.current_revision_id,
        ) ?? source.value.revisions.at(-1)
    );
}
function cancelBriefEdit() {
    if (!state.value) return;
    settings.value.brief = state.value.settings.brief;
    briefEvidence.value = null;
    briefEditing.value = false;
    dirty.value =
        JSON.stringify(settings.value) !== JSON.stringify(state.value.settings);
    if (!dirty.value) editClock.value = state.value.settingsRow?.clock ?? null;
}
async function createProject() {
    const title = name.value.trim();
    if (!title) return;
    const projectId = newId();
    scope.assertCurrent('write');
    const captured = scope;
    const prepared = await prepareProjectWrite(
        {
            id: projectId,
            name: title,
            description: null,
            data: [],
            clock: 0,
            created_at: nowSec(),
            updated_at: nowSec(),
            deleted: false,
        },
        'create',
    );
    if (prepared.row.id !== projectId || prepared.row.deleted)
        throw new Error('A project filter changed the creation target.');
    await captured.db.transaction(
        'rw',
        getWriteTxTableNames(captured.db, 'projects'),
        async () => {
            captured.assertCurrent('write');
            await captured.db.projects.add(prepared.row);
            captured.assertCurrent('write');
        },
    );
    await prepared.afterCommit(prepared.row);
    captured.assertCurrent();
    name.value = '';
    await openProject(projectId);
}
async function pin(projectId: string) {
    const current = await readProjectWorkspace(scope.db, projectId);
    await saveProjectSettings(
        scope,
        projectId,
        { ...current.settings, pinned: !current.settings.pinned },
        current.settingsRow?.clock ?? null,
    );
}
async function newChat() {
    const projectId = id.value;
    scope.assertCurrent('write');
    const captured = scope;
    const thread = await createThreadInDb(
        captured.db,
        {
            id: newId(),
            title: 'New chat',
            project_id: projectId,
            forked: false,
            created_at: nowSec(),
            updated_at: nowSec(),
            clock: 0,
            deleted: false,
        },
        { assertCurrent: () => captured.assertCurrent('write') },
    );
    captured.assertCurrent();
    await openChat(thread.id);
}
async function openChat(threadId: string) {
    const result = await getPaletteHostContext()?.openChat(threadId, 'active');
    if (result && !result.ok) throw new Error(result.error.message);
}
async function openActivity(item: UnifiedSidebarItem) {
    scope.assertCurrent();
    if (item.type === 'thread') return openChat(item.id);
    const result = await getPaletteHostContext()?.openDocument(
        item.id,
        'active',
    );
    if (result && !result.ok) throw new Error(result.error.message);
}
async function verifySuggestion(summaryId: string) {
    const { projectContinuity } = await import('~/utils/projects/continuity');
    if (
        !(await projectContinuity(scope, id.value)).some(
            (item) => item.row.id === summaryId,
        )
    )
        throw new Error(
            'This suggestion is stale or excluded. Review a current handoff.',
        );
}
async function reviewMemory(
    suggestion: (typeof suggestions.value)[number],
    landmark: (typeof suggestion.data.landmarks)[number],
) {
    await verifySuggestion(suggestion.row.id);
    memory.value = landmark.summary;
    memoryKind.value = landmark.kind === 'decision' ? 'decision' : 'fact';
    memoryEvidence.value = {
        summary_id: suggestion.row.id,
        source_thread_id: landmark.thread_id,
        source_message_id: landmark.message_id,
    };
    reviewedDecisions.value = false;
    creatingMemory.value = true;
}
async function addNote() {
    const captured = scope;
    const projectId = id.value;
    const prepared = await prepareDocumentCreate({
        title: noteTitle.value.trim(),
        content: {
            type: 'doc',
            content: noteText.value.split('\n').map((text) => ({
                type: 'paragraph',
                content: text ? [{ type: 'text', text }] : [],
            })),
        },
    });
    captured.assertCurrent('write');
    await captured.db.transaction(
        'rw',
        getWriteTxTableNames(captured.db, 'posts'),
        async () => {
            captured.assertCurrent('write');
            await captured.db.posts.add(prepared.row);
            captured.assertCurrent('write');
        },
    );
    await prepared.afterCommit();
    captured.assertCurrent('write');
    await addProjectDocument(captured, projectId, prepared.row.id);
    noteTitle.value = '';
    noteText.value = '';
    sourceInput.value = '';
}
async function reviewBrief(suggestion: (typeof suggestions.value)[number]) {
    await verifySuggestion(suggestion.row.id);
    settings.value.brief = suggestion.data.summary_markdown.slice(0, 8000);
    briefEvidence.value = suggestion.row.id;
    dirty.value = true;
    briefEditing.value = true;
}
async function saveSettings() {
    if (briefEvidence.value) await verifySuggestion(briefEvidence.value);
    const saved = await saveProjectSettings(
        scope,
        id.value,
        settings.value,
        editClock.value,
    );
    editClock.value = saved.clock;
    dirty.value = false;
    briefEvidence.value = null;
}
async function uploadFiles(event: Event) {
    const files = Array.from((event.target as HTMLInputElement).files ?? []);
    (event.target as HTMLInputElement).value = '';
    const captured = scope;
    const projectId = id.value;
    const replacement = replace.value;
    replace.value = undefined;
    await run(async () => {
        for (const file of files)
            await addProjectUpload(captured, projectId, file, replacement);
    });
}
async function showRevision(
    source: ProjectRecord<ProjectSource>,
    revisionId: string,
) {
    releasePreview();
    previewTitle.value = source.value.title;
    const revision = source.value.revisions.find((r) => r.id === revisionId)!;
    previewLocations.value = revision.locations;
    if (source.value.kind === 'document') {
        const result = await getPaletteHostContext()?.openDocument(
            source.value.item_id,
            'active',
        );
        if (result && !result.ok) throw new Error(result.error.message);
        return;
    }
    previewText.value =
        revision.error ??
        'No extracted text. The original is available for download.';
    const captured = scope;
    if (revision.text_hash) {
        const blob = await getFileBlob(revision.text_hash, captured.db);
        captured.assertCurrent();
        if (blob) previewText.value = await blob.text();
    } else if (revision.original_hash) {
        const blob = await getFileBlob(revision.original_hash, captured.db);
        captured.assertCurrent();
        if (blob?.type.startsWith('image/'))
            previewImage.value = URL.createObjectURL(blob);
    }
}
async function download(hash: string) {
    const captured = scope;
    const blob = await getFileBlob(hash, captured.db);
    captured.assertCurrent();
    if (!blob) throw new Error('Original unavailable offline.');
    const meta = await captured.db.file_meta.get(hash);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = meta?.name ?? 'original';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function addMemory() {
    const evidence = memoryEvidence.value;
    if (evidence) await verifySuggestion(evidence.summary_id);
    if (
        evidence &&
        memoryKind.value === 'decision' &&
        state.value?.memories.some(
            (record) => record.value.kind === 'decision',
        ) &&
        !reviewedDecisions.value
    )
        throw new Error(
            'Review this suggestion against saved decisions before saving.',
        );
    await saveProjectMemory(scope, id.value, {
        text: memory.value,
        kind: memoryKind.value,
        ...(evidence
            ? {
                  source_thread_id: evidence.source_thread_id,
                  source_message_id: evidence.source_message_id,
              }
            : {}),
    });
    memory.value = '';
    memoryEvidence.value = null;
    creatingMemory.value = false;
}
async function saveMemoryEdit() {
    const edit = editingMemory.value;
    if (!edit) return;
    const record = edit.record;
    await saveProjectMemory(
        scope,
        id.value,
        { ...record.value, text: edit.text },
        record.row.id,
        record.row.clock,
    );
    editingMemory.value = null;
}
async function exclude(thread: Thread) {
    const current = await readProjectWorkspace(scope.db, id.value);
    const exclusions = current.settings.excluded_chat_ids;
    await saveProjectSettings(
        scope,
        id.value,
        {
            ...current.settings,
            excluded_chat_ids: exclusions.includes(thread.id)
                ? exclusions.filter((value) => value !== thread.id)
                : [...exclusions, thread.id],
        },
        current.settingsRow?.clock ?? null,
    );
}
function toolMode(name: string, mode: 'enabled' | 'disabled' | 'ask') {
    settings.value.tools[name] = {
        mode,
        resources: settings.value.tools[name]?.resources ?? [],
    };
    dirty.value = true;
}
function toolCannotScope(name: string) {
    return !projectToolEnabled(
        {
            ...settings.value,
            tools: { [name]: { mode: 'enabled', resources: [] } },
        },
        name,
    );
}
</script>

<template>
    <section
        class="sidebar-projects-page h-full flex flex-col min-h-0 min-w-0"
        aria-label="Projects"
    >
        <header
            class="px-3 py-2 flex items-center justify-between gap-2 shrink-0"
        >
            <UButton
                variant="ghost"
                color="neutral"
                size="sm"
                :icon="backIcon"
                class="min-w-0 hover:bg-[var(--md-surface-hover)] theme-btn"
                :aria-label="
                    id && tab !== 'Overview'
                        ? 'Overview'
                        : id && returnTo === 'projects'
                          ? 'All projects'
                          : 'Home'
                "
                @click="goBack"
            >
                <span class="truncate">{{
                    id && tab !== 'Overview'
                        ? state?.project.name
                        : id && returnTo === 'projects'
                          ? 'Projects'
                          : 'Home'
                }}</span>
            </UButton>
            <UButton
                v-if="!id"
                variant="ghost"
                color="neutral"
                size="sm"
                :icon="newProjectIcon"
                class="bg-[color:var(--md-primary)]/5 text-[color:var(--md-primary)] hover:bg-[color:var(--md-primary)]/10 theme-btn"
                @click="creating = !creating"
                >New project</UButton
            >
            <UButton
                v-else-if="tab !== 'Settings'"
                variant="ghost"
                color="neutral"
                size="sm"
                :icon="settingsIcon"
                aria-label="Settings"
                title="Project settings"
                square
                class="hover:bg-[var(--md-surface-hover)] theme-btn"
                :disabled="!state"
                @click="tab = 'Settings'"
            />
        </header>
        <p
            v-if="error"
            role="alert"
            class="px-3 text-sm text-[var(--md-error)]"
        >
            {{ error }}
        </p>
        <template v-if="!id">
            <h1 class="sr-only">Projects</h1>
            <label
                v-if="props.sidebarQuery === undefined"
                class="px-3 block text-sm"
            >
                Search projects<input
                    v-model="query"
                    type="search"
                    class="project-input"
                />
            </label>
            <form
                v-if="creating"
                class="px-3 py-2 flex flex-col gap-2"
                @submit.prevent="run(createProject)"
            >
                <UInput
                    v-model="name"
                    aria-label="New project name"
                    placeholder="Project name"
                    maxlength="200"
                    required
                    autofocus
                />
                <div class="flex gap-2">
                    <UButton
                        type="submit"
                        size="sm"
                        :disabled="busy"
                        label="Create project"
                    />
                    <UButton
                        size="sm"
                        color="neutral"
                        variant="ghost"
                        @click="creating = false"
                        >Cancel</UButton
                    >
                </div>
            </form>
            <div
                v-if="filtered.length"
                class="flex-1 min-h-0 overflow-y-auto sidebar-scroll"
            >
                <ul class="px-2 pb-3">
                    <li
                        v-for="(entry, index) in filtered"
                        :key="entry.project.id"
                    >
                        <p
                            v-if="
                                index === 0 ||
                                filtered[index - 1]?.pinned !== entry.pinned
                            "
                            class="px-2 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--md-on-surface-variant)]"
                        >
                            {{ entry.pinned ? 'Pinned' : 'Recent' }}
                        </p>
                        <div
                            class="min-w-0 group flex items-center gap-2.5 px-2.5 py-2.5 rounded-[var(--md-border-radius-small,var(--md-border-radius))] text-[var(--md-on-surface)] hover:bg-[var(--md-surface-hover)] unified-sb-item"
                        >
                            <button
                                class="min-w-0 flex-1 flex items-center gap-2.5 text-left"
                                @click="
                                    run(() => openProject(entry.project.id))
                                "
                            >
                                <UIcon
                                    :name="projectIcon"
                                    class="size-[18px] shrink-0 text-[var(--md-on-surface-variant)]"
                                />
                                <span class="min-w-0 flex-1">
                                    <span
                                        class="block truncate text-sm font-normal leading-tight sb-btn-title"
                                        >{{ entry.project.name }}</span
                                    >
                                    <span
                                        v-if="entry.project.description"
                                        class="block truncate text-xs text-[var(--md-on-surface-variant)]"
                                        >{{ entry.project.description }}</span
                                    >
                                </span>
                            </button>
                            <UButton
                                color="neutral"
                                variant="ghost"
                                size="xs"
                                square
                                :aria-label="
                                    entry.pinned
                                        ? 'Unpin project'
                                        : 'Pin project'
                                "
                                :icon="
                                    entry.pinned
                                        ? 'i-lucide-pin-off'
                                        : 'i-lucide-pin'
                                "
                                @click="run(() => pin(entry.project.id))"
                            />
                        </div>
                    </li>
                </ul>
            </div>
            <SidebarEmptyState
                v-else
                class="flex-1 min-h-0"
                :icon="projectIcon"
                :title="
                    projects.length ? 'No matching projects' : 'No projects yet'
                "
                :description="
                    projects.length
                        ? 'Try another search to find your project.'
                        : 'Create a project to keep your work organized.'
                "
            >
                <template v-if="!projects.length" #actions>
                    <UButton
                        size="sm"
                        color="neutral"
                        variant="ghost"
                        class="w-fit justify-center whitespace-nowrap truncate text-[14px] leading-tight bg-[color:var(--md-primary)]/10 text-[color:var(--md-on-surface)]/80 hover:bg-[color:var(--md-primary)]/15 backdrop-blur theme-btn"
                        @click="creating = true"
                        >Create a project</UButton
                    >
                </template>
            </SidebarEmptyState>
        </template>
        <template v-else-if="state">
            <SidebarTimeGroupedList
                v-if="tab === 'Overview'"
                role="region"
                aria-label="Project activity"
                type="all"
                :project-id="id"
                :query="props.sidebarQuery ?? query"
                :active-ids="[
                    ...(props.activeThreadIds ?? []),
                    ...(props.activeDocumentIds ?? []),
                ]"
                empty-message="No activity yet"
                empty-description="Your project chats and documents will appear here."
                @select="(item) => run(() => openActivity(item))"
                @rename="
                    (item) =>
                        emit(
                            item.type === 'thread'
                                ? 'rename-thread'
                                : 'rename-document',
                            item,
                        )
                "
                @delete="
                    (item) =>
                        emit(
                            item.type === 'thread'
                                ? 'delete-thread'
                                : 'delete-document',
                            item,
                        )
                "
                @add-to-project="
                    (item) =>
                        emit(
                            item.type === 'thread'
                                ? 'add-to-project'
                                : 'add-document-to-project-from-list',
                            item,
                        )
                "
                ><template #header>
                    <div class="project-content px-1 pt-2 pb-1 space-y-4">
                        <div class="flex items-center gap-3 min-w-0">
                            <span
                                class="project-avatar shrink-0"
                                aria-hidden="true"
                            >
                                <UIcon :name="projectIcon" class="size-5" />
                            </span>
                            <div class="min-w-0">
                                <h1
                                    class="text-lg font-semibold leading-snug break-words"
                                >
                                    {{ state.project.name }}
                                </h1>
                                <p class="project-muted text-xs mt-0.5">
                                    Your project workspace
                                </p>
                            </div>
                        </div>
                        <UButton
                            :icon="newChatIcon"
                            label="New chat"
                            color="neutral"
                            class="project-start theme-btn"
                            :disabled="busy"
                            @click="run(newChat)"
                        />
                        <section
                            class="project-brief"
                            aria-label="Project brief"
                        >
                            <div
                                class="flex items-center justify-between gap-2"
                            >
                                <h2 class="text-xs font-semibold">
                                    Project brief
                                </h2>
                                <UButton
                                    v-if="
                                        state.settings.brief ||
                                        state.project.description
                                    "
                                    :icon="editIcon"
                                    aria-label="Edit project brief"
                                    square
                                    size="xs"
                                    color="neutral"
                                    variant="ghost"
                                    @click="
                                        tab = 'Memory';
                                        briefEditing = true;
                                    "
                                />
                            </div>
                            <p
                                v-if="
                                    state.settings.brief ||
                                    state.project.description
                                "
                                class="project-muted mt-2 text-xs leading-relaxed whitespace-pre-wrap line-clamp-3"
                            >
                                {{
                                    state.settings.brief ||
                                    state.project.description
                                }}
                            </p>
                            <template v-else>
                                <p
                                    class="project-muted mt-2 text-xs leading-relaxed"
                                >
                                    Keep the important state close at hand.
                                </p>
                                <button
                                    class="project-brief-action mt-2"
                                    aria-label="Add project brief"
                                    @click="
                                        tab = 'Memory';
                                        briefEditing = true;
                                    "
                                >
                                    Add a brief
                                    <UIcon
                                        :name="chevronIcon"
                                        class="size-3.5"
                                    />
                                </button>
                            </template>
                        </section>
                        <nav aria-label="Project sections" class="space-y-1.5">
                            <SidebarPageLink
                                label="Knowledge"
                                :description="`${state.sources.length} ${state.sources.length === 1 ? 'source' : 'sources'}`"
                                :icon="knowledgeIcon"
                                accent="docs"
                                @select="tab = 'Knowledge'"
                            />
                            <SidebarPageLink
                                label="Memory"
                                :description="`${state.memories.length} saved ${state.memories.length === 1 ? 'memory' : 'memories'}`"
                                icon="i-lucide-bookmark"
                                accent="projects"
                                @select="tab = 'Memory'"
                            />
                        </nav>
                        <h2
                            class="project-section-label border-t border-[var(--md-outline-variant)] pt-4!"
                        >
                            Recent activity
                        </h2>
                    </div></template
                ></SidebarTimeGroupedList
            >
            <div v-else class="flex-1 min-h-0 flex flex-col">
                <div
                    class="project-content flex-1 min-h-0 overflow-y-auto sidebar-scroll px-3 pt-2 pb-5 space-y-4 text-sm"
                >
                    <div
                        v-if="tab !== 'Overview'"
                        class="project-section-heading"
                    >
                        <h1 class="text-lg font-semibold">{{ tab }}</h1>
                        <p class="project-muted text-xs leading-relaxed">
                            {{ sectionDescriptions[tab] }}
                        </p>
                    </div>
                    <div v-if="tab === 'Knowledge'" class="space-y-4">
                        <input
                            ref="upload"
                            type="file"
                            class="sr-only"
                            :multiple="!replace"
                            accept=".pdf,.docx,.txt,.md,.csv,image/png,image/jpeg,image/webp,image/gif"
                            aria-label="Upload project knowledge"
                            @change="uploadFiles"
                        />
                        <UPopover
                            v-model:open="sourceMenuOpen"
                            :content="{
                                align: 'start',
                                side: 'bottom',
                                sideOffset: 6,
                            }"
                        >
                            <UButton
                                :icon="plusIcon"
                                label="Add source"
                                class="project-start theme-btn"
                                color="neutral"
                                :disabled="busy"
                            />
                            <template #content>
                                <div class="p-1 w-56 space-y-1">
                                    <UButton
                                        icon="i-lucide-upload"
                                        label="Upload files"
                                        color="neutral"
                                        variant="ghost"
                                        class="w-full justify-start"
                                        @click="
                                            sourceMenuOpen = false;
                                            replace = undefined;
                                            upload?.click();
                                        "
                                    />
                                    <UButton
                                        :icon="knowledgeIcon"
                                        label="Write a note"
                                        color="neutral"
                                        variant="ghost"
                                        class="w-full justify-start"
                                        @click="chooseSource('note')"
                                    />
                                    <UButton
                                        icon="i-lucide-file-text"
                                        label="OR3 document"
                                        color="neutral"
                                        variant="ghost"
                                        class="w-full justify-start"
                                        @click="chooseSource('document')"
                                    />
                                    <UButton
                                        icon="i-lucide-paperclip"
                                        label="Saved file"
                                        color="neutral"
                                        variant="ghost"
                                        class="w-full justify-start"
                                        @click="chooseSource('file')"
                                    />
                                </div>
                            </template>
                        </UPopover>
                        <form
                            v-if="sourceInput === 'note'"
                            class="project-editor space-y-3"
                            @submit.prevent="run(addNote)"
                        >
                            <h2 class="font-semibold text-xs">Write a note</h2>
                            <input
                                v-model="noteTitle"
                                aria-label="Note title"
                                placeholder="Note title"
                                class="project-input"
                                autofocus
                                maxlength="500"
                                required
                            /><textarea
                                v-model="noteText"
                                aria-label="Note text"
                                placeholder="Write your note…"
                                class="project-input"
                                rows="3"
                                maxlength="16000"
                                required
                            />
                            <div class="flex justify-end gap-2">
                                <UButton
                                    label="Cancel"
                                    color="neutral"
                                    variant="ghost"
                                    @click="sourceInput = ''"
                                /><UButton
                                    type="submit"
                                    label="Add note"
                                    :disabled="busy"
                                />
                            </div>
                        </form>
                        <form
                            v-if="sourceInput === 'document'"
                            class="project-editor space-y-3"
                            @submit.prevent="
                                run(async () => {
                                    await addProjectDocument(
                                        scope,
                                        id,
                                        documentId,
                                    );
                                    sourceInput = '';
                                })
                            "
                        >
                            <h2 class="font-semibold text-xs">
                                Add an OR3 document
                            </h2>
                            <select
                                v-model="documentId"
                                aria-label="Existing OR3 document"
                                class="project-input"
                                required
                            >
                                <option value="">Choose an OR3 document</option>
                                <option
                                    v-for="doc in documents"
                                    :key="doc.id"
                                    :value="doc.id"
                                >
                                    {{ doc.title }}
                                </option>
                            </select>
                            <div class="flex justify-end gap-2">
                                <UButton
                                    label="Cancel"
                                    color="neutral"
                                    variant="ghost"
                                    @click="sourceInput = ''"
                                /><UButton
                                    type="submit"
                                    label="Add document"
                                    :disabled="busy"
                                />
                            </div>
                        </form>
                        <form
                            v-if="sourceInput === 'file'"
                            class="project-editor space-y-3"
                            @submit.prevent="
                                run(async () => {
                                    await addExistingProjectFile(
                                        scope,
                                        id,
                                        fileId,
                                    );
                                    sourceInput = '';
                                })
                            "
                        >
                            <h2 class="font-semibold text-xs">
                                Add a saved file
                            </h2>
                            <select
                                v-model="fileId"
                                aria-label="Existing workspace file"
                                class="project-input"
                                required
                            >
                                <option value="">Choose a saved file</option>
                                <option
                                    v-for="file in files"
                                    :key="file.id"
                                    :value="file.id"
                                >
                                    {{ file.title }}
                                </option>
                            </select>
                            <div class="flex justify-end gap-2">
                                <UButton
                                    label="Cancel"
                                    color="neutral"
                                    variant="ghost"
                                    @click="sourceInput = ''"
                                /><UButton
                                    type="submit"
                                    label="Add saved file"
                                    :disabled="busy"
                                />
                            </div>
                        </form>
                        <div class="flex items-center justify-between gap-2">
                            <h2 class="project-section-label">Sources</h2>
                            <span class="project-muted text-xs">{{
                                state.sources.length
                            }}</span>
                        </div>
                        <div v-if="!state.sources.length" class="project-empty">
                            <UIcon
                                :name="knowledgeIcon"
                                class="size-6 project-muted"
                            />
                            <p class="font-medium text-sm mt-2">
                                No sources yet
                            </p>
                            <p
                                class="project-muted text-xs mt-1 leading-relaxed"
                            >
                                Add files, documents, or notes to use in project
                                chats.
                            </p>
                        </div>
                        <article
                            v-for="source in state.sources"
                            :key="source.row.id"
                            class="project-source space-y-3"
                        >
                            <div class="flex items-start gap-2.5 min-w-0">
                                <span class="project-source-icon shrink-0"
                                    ><UIcon
                                        :name="
                                            source.value.kind === 'document'
                                                ? knowledgeIcon
                                                : 'i-lucide-file'
                                        "
                                        class="size-4"
                                /></span>
                                <div class="min-w-0 flex-1">
                                    <h2 class="font-medium text-sm break-words">
                                        {{ source.value.title }}
                                    </h2>
                                    <p
                                        class="project-muted text-xs mt-1 capitalize"
                                    >
                                        {{
                                            currentRevision(source)?.status ===
                                            'partial'
                                                ? 'Partially readable'
                                                : currentRevision(source)
                                                      ?.status
                                        }}
                                    </p>
                                </div>
                                <UButton
                                    v-if="source.value.current_revision_id"
                                    label="Preview"
                                    color="neutral"
                                    variant="ghost"
                                    size="xs"
                                    @click="
                                        run(() =>
                                            showRevision(
                                                source,
                                                source.value
                                                    .current_revision_id!,
                                            ),
                                        )
                                    "
                                />
                            </div>
                            <p
                                v-if="
                                    source.value.revisions.at(-1)?.status ===
                                    'failed'
                                "
                                class="text-xs text-[var(--md-error)] leading-relaxed"
                                role="status"
                            >
                                {{
                                    source.value.current_revision_id
                                        ? 'Last update failed. The current version is still available.'
                                        : 'Processing failed.'
                                }}
                                {{ source.value.revisions.at(-1)?.error }}
                            </p>
                            <label
                                class="flex items-center gap-2 text-xs project-muted"
                                >Context<select
                                    :value="source.value.mode"
                                    class="project-input flex-1!"
                                    @change="
                                        run(() =>
                                            saveProjectSource(
                                                scope,
                                                id,
                                                {
                                                    ...source.value,
                                                    mode: (
                                                        $event.target as HTMLSelectElement
                                                    ).value as any,
                                                },
                                                source.row.id,
                                                source.row.clock,
                                            ),
                                        )
                                    "
                                >
                                    <option value="relevant">
                                        Use when relevant
                                    </option>
                                    <option value="always">
                                        Always include
                                    </option>
                                    <option value="off">Do not use</option>
                                </select></label
                            >
                            <details class="project-source-details">
                                <summary
                                    class="project-muted text-xs cursor-pointer"
                                >
                                    History and actions ·
                                    {{ source.value.revisions.length }}
                                    {{
                                        source.value.revisions.length === 1
                                            ? 'revision'
                                            : 'revisions'
                                    }}
                                </summary>
                                <div class="space-y-3 pt-3">
                                    <div
                                        v-for="revision in [
                                            ...source.value.revisions,
                                        ].reverse()"
                                        :key="revision.id"
                                        class="flex flex-wrap gap-2 items-center text-sm"
                                    >
                                        <span
                                            >{{
                                                revision.id ===
                                                source.value.current_revision_id
                                                    ? 'Current · '
                                                    : 'Revision · '
                                            }}{{
                                                revision.status === 'partial'
                                                    ? 'Partially readable'
                                                    : revision.status
                                            }}
                                            ·
                                            {{
                                                new Date(
                                                    revision.created_at * 1000,
                                                ).toLocaleDateString()
                                            }}</span
                                        ><UButton
                                            color="neutral"
                                            variant="ghost"
                                            label="Preview revision"
                                            @click="
                                                run(() =>
                                                    showRevision(
                                                        source,
                                                        revision.id,
                                                    ),
                                                )
                                            "
                                        /><UButton
                                            v-if="revision.original_hash"
                                            color="neutral"
                                            variant="ghost"
                                            label="Download original"
                                            @click="
                                                run(() =>
                                                    download(
                                                        revision.original_hash!,
                                                    ),
                                                )
                                            "
                                        /><UButton
                                            v-if="
                                                [
                                                    'failed',
                                                    'processing',
                                                ].includes(revision.status)
                                            "
                                            label="Retry"
                                            color="neutral"
                                            variant="ghost"
                                            @click="
                                                run(() =>
                                                    processProjectSource(
                                                        scope,
                                                        id,
                                                        source,
                                                        revision.id,
                                                    ),
                                                )
                                            "
                                        />
                                        <p
                                            v-if="revision.error"
                                            class="w-full text-red-500"
                                        >
                                            {{ revision.error }}
                                        </p>
                                    </div>
                                    <UButton
                                        v-if="source.value.kind === 'file'"
                                        label="Replace"
                                        color="neutral"
                                        variant="outline"
                                        @click="
                                            replace = source;
                                            upload?.click();
                                        "
                                    /><UButton
                                        label="Remove knowledge"
                                        color="neutral"
                                        variant="ghost"
                                        @click="
                                            run(() =>
                                                deleteProjectRecord(
                                                    scope,
                                                    id,
                                                    source.row,
                                                ),
                                            )
                                        "
                                    />
                                </div>
                            </details>
                        </article>
                        <div
                            v-if="previewText || previewImage"
                            class="rounded border border-current/15 p-4"
                        >
                            <h2>{{ previewTitle }}</h2>
                            <img
                                v-if="previewImage"
                                :src="previewImage"
                                :alt="previewTitle"
                                class="max-h-80"
                            />
                            <p
                                v-if="previewLocations.length"
                                class="text-sm opacity-70"
                            >
                                {{
                                    previewLocations
                                        .map((location) => location.label)
                                        .join(', ')
                                }}
                            </p>
                            <pre
                                class="whitespace-pre-wrap max-h-96 overflow-auto"
                                >{{ previewText }}</pre
                            >
                        </div>
                    </div>
                    <div v-if="tab === 'Memory'" class="space-y-5">
                        <section
                            class="project-brief space-y-3"
                            aria-label="Project brief"
                        >
                            <div
                                class="flex items-center justify-between gap-2"
                            >
                                <h2 class="font-semibold text-xs">
                                    Project brief
                                </h2>
                                <UButton
                                    v-if="!briefEditing"
                                    :icon="editIcon"
                                    aria-label="Edit project brief"
                                    title="Edit project brief"
                                    square
                                    size="xs"
                                    color="neutral"
                                    variant="ghost"
                                    @click="briefEditing = true"
                                />
                            </div>
                            <template v-if="briefEditing">
                                <label
                                    class="sr-only"
                                    for="project-brief-editor"
                                    >Project brief</label
                                >
                                <textarea
                                    id="project-brief-editor"
                                    v-model="settings.brief"
                                    class="project-input"
                                    rows="4"
                                    maxlength="8000"
                                    placeholder="Describe the current state and next steps…"
                                    @input="dirty = true"
                                />
                                <div class="flex justify-end gap-2">
                                    <UButton
                                        label="Cancel"
                                        color="neutral"
                                        variant="ghost"
                                        @click="cancelBriefEdit"
                                    />
                                    <UButton
                                        label="Save brief"
                                        :disabled="busy"
                                        @click="
                                            run(async () => {
                                                await saveSettings();
                                                briefEditing = false;
                                            })
                                        "
                                    />
                                </div>
                            </template>
                            <template v-else>
                                <p
                                    v-if="state.settings.brief"
                                    class="project-muted text-xs leading-relaxed whitespace-pre-wrap"
                                >
                                    {{ state.settings.brief }}
                                </p>
                                <template v-else>
                                    <p
                                        class="project-muted text-xs leading-relaxed"
                                    >
                                        Keep the current state and next steps
                                        here.
                                    </p>
                                    <button
                                        class="project-brief-action"
                                        @click="briefEditing = true"
                                    >
                                        Add a brief
                                        <UIcon
                                            :name="chevronIcon"
                                            class="size-3.5"
                                        />
                                    </button>
                                </template>
                            </template>
                        </section>
                        <section class="space-y-3" aria-label="Saved memories">
                            <div
                                class="flex items-center justify-between gap-2"
                            >
                                <h2 class="project-section-label">
                                    Saved memories
                                    <span class="ml-1">{{
                                        state.memories.length
                                    }}</span>
                                </h2>
                                <UButton
                                    :icon="plusIcon"
                                    label="Add"
                                    aria-label="Add memory"
                                    size="xs"
                                    variant="ghost"
                                    color="neutral"
                                    :disabled="busy"
                                    @click="creatingMemory = true"
                                />
                            </div>
                            <form
                                v-if="creatingMemory"
                                class="project-editor space-y-3"
                                @submit.prevent="run(addMemory)"
                            >
                                <h3 class="font-semibold text-xs">
                                    New memory
                                </h3>
                                <select
                                    v-model="memoryKind"
                                    class="project-input"
                                    aria-label="Memory kind"
                                >
                                    <option value="fact">Fact</option>
                                    <option value="decision">Decision</option>
                                </select>
                                <textarea
                                    v-model="memory"
                                    class="project-input"
                                    rows="4"
                                    maxlength="4000"
                                    aria-label="New project memory"
                                    placeholder="Save a fact or decision…"
                                    required
                                />
                                <div
                                    v-if="
                                        memoryEvidence &&
                                        memoryKind === 'decision' &&
                                        state.memories.some(
                                            (record) =>
                                                record.value.kind ===
                                                'decision',
                                        )
                                    "
                                    class="space-y-2 text-xs"
                                >
                                    <p>
                                        Compare this suggestion with your saved
                                        decisions. Keep conflicting alternatives
                                        separate until you decide.
                                    </p>
                                    <blockquote
                                        v-for="decision in state.memories.filter(
                                            (record) =>
                                                record.value.kind ===
                                                'decision',
                                        )"
                                        :key="decision.row.id"
                                        class="border-l-2 pl-3"
                                    >
                                        {{ decision.value.text }}
                                    </blockquote>
                                    <label
                                        ><input
                                            v-model="reviewedDecisions"
                                            type="checkbox"
                                        />
                                        I reviewed this against saved
                                        decisions</label
                                    >
                                </div>
                                <div class="flex justify-end gap-2">
                                    <UButton
                                        label="Cancel"
                                        color="neutral"
                                        variant="ghost"
                                        @click="
                                            creatingMemory = false;
                                            memory = '';
                                            memoryEvidence = null;
                                        "
                                    />
                                    <UButton
                                        type="submit"
                                        label="Save memory"
                                        :disabled="
                                            busy ||
                                            (!!memoryEvidence &&
                                                memoryKind === 'decision' &&
                                                state.memories.some(
                                                    (record) =>
                                                        record.value.kind ===
                                                        'decision',
                                                ) &&
                                                !reviewedDecisions)
                                        "
                                    />
                                </div>
                            </form>
                            <div
                                v-if="!state.memories.length && !creatingMemory"
                                class="project-empty"
                            >
                                <UIcon
                                    name="i-lucide-bookmark"
                                    class="size-6 project-muted"
                                />
                                <p class="font-medium text-sm mt-2">
                                    No saved memories yet
                                </p>
                                <p
                                    class="project-muted text-xs mt-1 leading-relaxed"
                                >
                                    Save facts and decisions you want OR3 to
                                    remember.
                                </p>
                            </div>
                            <article
                                v-for="record in state.memories"
                                :key="record.row.id"
                                class="project-memory space-y-2"
                            >
                                <div
                                    class="flex items-center justify-between gap-2"
                                >
                                    <span
                                        class="project-memory-kind"
                                        :class="
                                            record.value.kind === 'decision'
                                                ? 'text-[var(--md-primary)]'
                                                : 'text-[var(--md-success)]'
                                        "
                                        >{{ record.value.kind }}</span
                                    >
                                    <div class="flex items-center gap-1">
                                        <UButton
                                            v-if="
                                                editingMemory?.record.row.id !==
                                                record.row.id
                                            "
                                            :icon="editIcon"
                                            aria-label="Edit memory"
                                            title="Edit memory"
                                            square
                                            size="xs"
                                            color="neutral"
                                            variant="ghost"
                                            @click="
                                                editingMemory = {
                                                    record,
                                                    text: record.value.text,
                                                }
                                            "
                                        />
                                        <UButton
                                            :icon="trashIcon"
                                            aria-label="Delete memory"
                                            title="Delete memory"
                                            square
                                            size="xs"
                                            color="neutral"
                                            variant="ghost"
                                            :disabled="busy"
                                            @click="
                                                run(() =>
                                                    deleteProjectRecord(
                                                        scope,
                                                        id,
                                                        record.row,
                                                    ),
                                                )
                                            "
                                        />
                                    </div>
                                </div>
                                <form
                                    v-if="
                                        editingMemory?.record.row.id ===
                                        record.row.id
                                    "
                                    class="space-y-3"
                                    @submit.prevent="run(saveMemoryEdit)"
                                >
                                    <textarea
                                        v-model="editingMemory.text"
                                        :aria-label="
                                            'Edit saved ' + record.value.kind
                                        "
                                        class="project-input"
                                        rows="4"
                                        maxlength="4000"
                                        required
                                    />
                                    <div class="flex justify-end gap-2">
                                        <UButton
                                            label="Cancel"
                                            color="neutral"
                                            variant="ghost"
                                            @click="editingMemory = null"
                                        />
                                        <UButton
                                            type="submit"
                                            label="Save changes"
                                            :disabled="busy"
                                        />
                                    </div>
                                </form>
                                <p
                                    v-else
                                    class="text-xs leading-relaxed whitespace-pre-wrap break-words"
                                >
                                    {{ record.value.text }}
                                </p>
                                <UButton
                                    v-if="record.value.source_thread_id"
                                    label="Open evidence"
                                    size="xs"
                                    variant="ghost"
                                    color="neutral"
                                    @click="
                                        run(() =>
                                            openChat(
                                                record.value.source_thread_id!,
                                            ),
                                        )
                                    "
                                />
                            </article>
                        </section>
                        <section
                            class="border-t border-[var(--md-outline-variant)] pt-3 space-y-3"
                            aria-label="Memory suggestions"
                        >
                            <UButton
                                icon="i-lucide-sparkles"
                                label="Review suggestions"
                                aria-label="Review handoff suggestions"
                                color="neutral"
                                variant="ghost"
                                class="w-full justify-start"
                                :disabled="busy"
                                @click="
                                    run(async () => {
                                        const { projectContinuity } =
                                            await import('~/utils/projects/continuity');
                                        suggestions = await projectContinuity(
                                            scope,
                                            id,
                                        );
                                        suggestionsReviewed = true;
                                    })
                                "
                            />
                            <p
                                v-if="
                                    suggestionsReviewed && !suggestions.length
                                "
                                class="project-muted text-xs leading-relaxed"
                            >
                                No current suggestions. Continue in new chat to
                                create a handoff.
                            </p>
                            <article
                                v-for="suggestion in suggestions"
                                :key="suggestion.row.id"
                                class="project-memory space-y-3"
                            >
                                <h2 class="font-medium text-xs">
                                    Handoff from
                                    {{ suggestion.thread.title }}
                                </h2>
                                <div class="flex flex-wrap gap-1">
                                    <UButton
                                        label="Review as brief"
                                        size="xs"
                                        color="neutral"
                                        variant="outline"
                                        @click="
                                            run(() => reviewBrief(suggestion))
                                        "
                                    />
                                    <UButton
                                        label="Open source chat"
                                        size="xs"
                                        color="neutral"
                                        variant="ghost"
                                        @click="
                                            run(() =>
                                                openChat(
                                                    suggestion.data
                                                        .source_thread_id,
                                                ),
                                            )
                                        "
                                    />
                                </div>
                                <div
                                    v-for="landmark in suggestion.data.landmarks.filter(
                                        (l) =>
                                            ['decision', 'constraint'].includes(
                                                l.kind,
                                            ),
                                    )"
                                    :key="landmark.message_id"
                                    class="space-y-2"
                                >
                                    <p class="text-xs leading-relaxed">
                                        {{ landmark.summary }}
                                    </p>
                                    <UButton
                                        label="Review as memory"
                                        size="xs"
                                        color="neutral"
                                        variant="ghost"
                                        @click="
                                            run(() =>
                                                reviewMemory(
                                                    suggestion,
                                                    landmark,
                                                ),
                                            )
                                        "
                                    />
                                </div>
                            </article>
                        </section>
                    </div>
                    <form
                        v-if="tab === 'Settings'"
                        :id="'project-settings-' + id"
                        class="project-settings space-y-5"
                        @submit.prevent="run(saveSettings)"
                    >
                        <section
                            class="space-y-3"
                            aria-label="Project behaviour"
                        >
                            <label class="block">
                                <span class="font-medium text-sm"
                                    >Instructions</span
                                >
                                <span class="project-muted block mt-1 text-xs"
                                    >How should OR3 work in this project?</span
                                >
                                <textarea
                                    v-model="settings.instructions"
                                    aria-label="Instructions"
                                    class="project-input !mt-2"
                                    placeholder="Tone, goals, or guidelines to keep in mind…"
                                    maxlength="16000"
                                    rows="4"
                                    @input="dirty = true"
                                />
                            </label>
                            <div class="space-y-2">
                                <label
                                    class="block font-medium text-sm"
                                    :for="'project-model-' + id"
                                    >Default model</label
                                >
                                <USelectMenu
                                    :id="'project-model-' + id"
                                    :model-value="
                                        settings.default_model ??
                                        chatDefaultModel
                                    "
                                    :items="modelItems"
                                    value-key="value"
                                    aria-label="Default model"
                                    :search-input="{
                                        placeholder: 'Search models…',
                                    }"
                                    class="w-full min-w-0"
                                    size="sm"
                                    color="neutral"
                                    @update:model-value="
                                        settings.default_model =
                                            $event === chatDefaultModel
                                                ? null
                                                : ($event ?? null);
                                        dirty = true;
                                    "
                                />
                                <p
                                    class="project-muted text-[11px] leading-relaxed"
                                >
                                    Individual chats can choose another model.
                                </p>
                            </div>
                        </section>
                        <section
                            class="border-t border-[var(--md-outline-variant)] pt-4 space-y-3"
                            aria-label="Project tools"
                        >
                            <div class="space-y-1">
                                <h2 class="font-semibold text-sm">Tools</h2>
                                <p
                                    class="project-muted text-xs leading-relaxed"
                                >
                                    Choose what OR3 can use. Send, publish, and
                                    delete actions still ask for approval.
                                </p>
                            </div>
                            <UInput
                                v-model="toolQuery"
                                icon="i-lucide-search"
                                aria-label="Search project tools"
                                placeholder="Search tools"
                                size="sm"
                                color="neutral"
                                class="w-full"
                            />
                            <div v-for="group in toolGroups" :key="group.label">
                                <h3
                                    class="project-muted text-[11px] font-medium py-2"
                                >
                                    {{ group.label }}
                                </h3>
                                <div
                                    v-for="tool in group.tools"
                                    :key="tool.definition.function.name"
                                    class="project-tool-row"
                                >
                                    <div class="flex items-start gap-2.5">
                                        <UIcon
                                            :name="
                                                tool.definition.ui?.icon ||
                                                tool.definition.icon ||
                                                'i-lucide-wrench'
                                            "
                                            class="size-4 mt-0.5 shrink-0 project-muted"
                                            aria-hidden="true"
                                        />
                                        <div class="min-w-0 flex-1">
                                            <p
                                                class="text-xs font-medium leading-5"
                                            >
                                                {{ toolLabel(tool) }}
                                            </p>
                                            <p
                                                v-if="
                                                    tool.definition.ui
                                                        ?.descriptionHint
                                                "
                                                class="project-muted text-[11px] leading-relaxed mt-0.5"
                                            >
                                                {{
                                                    tool.definition.ui
                                                        .descriptionHint
                                                }}
                                            </p>
                                        </div>
                                        <USelect
                                            :model-value="
                                                toolModeValue(
                                                    tool.definition.function
                                                        .name,
                                                )
                                            "
                                            :items="toolModes"
                                            value-key="value"
                                            :aria-label="
                                                'Permission for ' +
                                                toolLabel(tool)
                                            "
                                            size="xs"
                                            color="neutral"
                                            class="project-tool-permission shrink-0"
                                            @update:model-value="
                                                toolMode(
                                                    tool.definition.function
                                                        .name,
                                                    $event,
                                                )
                                            "
                                        />
                                    </div>
                                    <details
                                        v-if="supportsRepositories(tool)"
                                        class="project-repository-details mt-2 ml-6.5 text-xs"
                                    >
                                        <summary
                                            class="project-muted cursor-pointer py-1"
                                        >
                                            Repository restrictions<span
                                                v-if="
                                                    settings.tools[
                                                        tool.definition.function
                                                            .name
                                                    ]?.resources.length
                                                "
                                            >
                                                ·
                                                {{
                                                    settings.tools[
                                                        tool.definition.function
                                                            .name
                                                    ]?.resources.length
                                                }}</span
                                            >
                                        </summary>
                                        <label class="block mt-2">
                                            <span>Allowed repositories</span>
                                            <textarea
                                                :value="
                                                    settings.tools[
                                                        tool.definition.function
                                                            .name
                                                    ]?.resources.join('\n') ??
                                                    ''
                                                "
                                                :aria-label="
                                                    'Allowed repositories for ' +
                                                    toolLabel(tool)
                                                "
                                                class="project-input"
                                                placeholder="owner/repository"
                                                rows="2"
                                                @input="
                                                    setToolResources(
                                                        tool.definition.function
                                                            .name,
                                                        (
                                                            $event.target as HTMLTextAreaElement
                                                        ).value,
                                                    )
                                                "
                                            />
                                        </label>
                                        <p
                                            class="project-muted text-[11px] leading-relaxed mt-2"
                                        >
                                            One repository per line. Leave empty
                                            to allow any repository.
                                        </p>
                                    </details>
                                    <div
                                        v-else-if="
                                            settings.tools[
                                                tool.definition.function.name
                                            ]?.resources.length
                                        "
                                        class="mt-2 ml-6.5 text-xs"
                                    >
                                        <p class="project-muted">
                                            Saved repository restrictions cannot
                                            apply to this tool.
                                        </p>
                                        <UButton
                                            label="Clear restrictions"
                                            color="neutral"
                                            variant="ghost"
                                            size="xs"
                                            @click="
                                                setToolResources(
                                                    tool.definition.function
                                                        .name,
                                                    '',
                                                )
                                            "
                                        />
                                    </div>
                                </div>
                            </div>
                            <p
                                v-if="!matchingTools.length"
                                class="project-muted text-xs py-3"
                            >
                                No matching tools.
                            </p>
                            <details
                                v-if="unavailableTools.length"
                                class="project-unavailable-tools"
                            >
                                <summary
                                    class="flex items-center gap-2 cursor-pointer text-xs font-medium py-3"
                                >
                                    <UIcon
                                        name="i-lucide-chevron-right"
                                        class="size-3.5 project-disclosure-icon"
                                        aria-hidden="true"
                                    />
                                    Unavailable tools
                                    <span class="project-muted ml-auto">{{
                                        unavailableTools.length
                                    }}</span>
                                </summary>
                                <div
                                    v-for="tool in unavailableTools"
                                    :key="tool.definition.function.name"
                                    class="flex gap-2.5 py-2.5"
                                >
                                    <UIcon
                                        :name="
                                            tool.definition.ui?.icon ||
                                            'i-lucide-wrench'
                                        "
                                        class="size-4 mt-0.5 shrink-0 project-muted"
                                        aria-hidden="true"
                                    />
                                    <div class="min-w-0">
                                        <p class="text-xs font-medium">
                                            {{ toolLabel(tool) }}
                                        </p>
                                        <p
                                            class="project-muted text-[11px] leading-relaxed mt-1"
                                        >
                                            {{
                                                toolCannotScope(
                                                    tool.definition.function
                                                        .name,
                                                )
                                                    ? 'Cannot limit access to this project.'
                                                    : 'Turn this tool on in chat settings to use it here.'
                                            }}
                                        </p>
                                    </div>
                                </div>
                            </details>
                        </section>
                    </form>
                    <section
                        v-if="tab === 'Settings'"
                        class="project-chat-settings border-t border-[var(--md-outline-variant)] pt-3"
                    >
                        <button
                            type="button"
                            class="flex items-center gap-2 w-full py-2 text-left"
                            aria-label="Manage chats"
                            :aria-expanded="manageChatsOpen"
                            :aria-controls="'project-chats-' + id"
                            @click="manageChatsOpen = !manageChatsOpen"
                        >
                            <UIcon
                                name="i-lucide-messages-square"
                                class="size-4 project-muted shrink-0"
                                aria-hidden="true"
                            />
                            <span class="text-sm font-medium flex-1"
                                >Project chats</span
                            >
                            <span class="project-muted text-xs">{{
                                chats.length
                            }}</span>
                            <UIcon
                                name="i-lucide-chevron-right"
                                :class="[
                                    'size-4 project-muted',
                                    manageChatsOpen && 'rotate-90',
                                ]"
                                aria-hidden="true"
                            />
                        </button>
                        <div
                            v-if="manageChatsOpen"
                            :id="'project-chats-' + id"
                            class="space-y-3 pt-2"
                        >
                            <p class="project-muted text-xs leading-relaxed">
                                Choose which chats OR3 can recall. Changes here
                                save immediately.
                            </p>
                            <p v-if="dirty" class="project-muted text-xs">
                                Save or discard your settings before managing
                                chats.
                            </p>
                            <form
                                class="flex gap-2 items-center"
                                @submit.prevent="
                                    run(() =>
                                        moveChatToProject(
                                            scope,
                                            existingChatId,
                                            id,
                                        ),
                                    )
                                "
                            >
                                <select
                                    v-model="existingChatId"
                                    required
                                    aria-label="Move existing chat"
                                    class="project-input !mt-0 flex-1"
                                    :disabled="busy || dirty"
                                >
                                    <option value="">
                                        Add an existing chat…
                                    </option>
                                    <option
                                        v-for="chat in allChats"
                                        :key="chat.id"
                                        :value="chat.id"
                                    >
                                        {{ chat.title || chat.id }}
                                    </option>
                                </select>
                                <UButton
                                    type="submit"
                                    label="Add"
                                    aria-label="Move into project"
                                    size="xs"
                                    color="neutral"
                                    variant="outline"
                                    :disabled="busy || dirty || !existingChatId"
                                />
                            </form>
                            <p
                                v-if="!chats.length"
                                class="project-muted text-xs py-2"
                            >
                                No chats in this project yet.
                            </p>
                            <div
                                v-for="chat in chats"
                                :key="chat.id"
                                role="group"
                                :aria-label="chat.title || 'Chat'"
                                class="project-tool-row flex items-center gap-2"
                            >
                                <div class="min-w-0 flex-1">
                                    <button
                                        type="button"
                                        class="block text-left text-xs font-medium truncate max-w-full"
                                        :disabled="busy || dirty"
                                        @click="run(() => openChat(chat.id))"
                                    >
                                        {{ chat.title || 'Chat' }}
                                    </button>
                                    <p class="project-muted text-[11px] mt-1">
                                        {{
                                            state.settings.excluded_chat_ids.includes(
                                                chat.id,
                                            )
                                                ? 'Excluded from memory'
                                                : 'Included in memory'
                                        }}
                                    </p>
                                </div>
                                <USwitch
                                    :model-value="
                                        !state.settings.excluded_chat_ids.includes(
                                            chat.id,
                                        )
                                    "
                                    :aria-label="
                                        'Include ' +
                                        (chat.title || 'chat') +
                                        ' in memory'
                                    "
                                    :disabled="busy || dirty"
                                    size="xs"
                                    @update:model-value="
                                        run(() => exclude(chat))
                                    "
                                />
                                <UTooltip text="Remove from project">
                                    <UButton
                                        icon="i-lucide-x"
                                        aria-label="Remove"
                                        color="neutral"
                                        variant="ghost"
                                        size="xs"
                                        square
                                        :disabled="busy || dirty"
                                        @click="
                                            run(() =>
                                                moveChatToProject(
                                                    scope,
                                                    chat.id,
                                                    null,
                                                ),
                                            )
                                        "
                                    />
                                </UTooltip>
                            </div>
                        </div>
                    </section>
                </div>
                <footer
                    v-if="tab === 'Settings'"
                    class="project-settings-footer shrink-0 flex items-center gap-2 px-3 py-3 border-t border-[var(--md-outline-variant)]"
                >
                    <p
                        role="status"
                        class="project-muted text-[11px] flex-1 min-w-0"
                    >
                        {{ dirty ? 'Unsaved changes' : 'All changes saved' }}
                    </p>
                    <UButton
                        v-if="dirty"
                        label="Discard"
                        aria-label="Discard changes"
                        color="neutral"
                        variant="ghost"
                        size="xs"
                        :disabled="busy"
                        @click="discardSettings"
                    />
                    <UButton
                        :form="'project-settings-' + id"
                        type="submit"
                        label="Save changes"
                        size="xs"
                        class="project-settings-save"
                        :disabled="busy || !dirty"
                        :loading="busy"
                    />
                </footer>
            </div>
        </template>
        <p v-else class="p-3 text-sm text-[var(--md-on-surface-variant)]">
            {{
                error
                    ? 'Return to Projects to choose another workspace.'
                    : 'Loading project…'
            }}
        </p>
    </section>
</template>
<style scoped>
.sidebar-projects-page {
    --project-accent: var(--blank-brand-accent, var(--md-primary));
}
.project-muted {
    color: var(--md-on-surface-variant);
}
.project-avatar {
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    border-radius: var(--md-border-radius-medium, 12px);
    background: color-mix(in srgb, var(--project-accent) 12%, transparent);
    color: var(--project-accent);
}
.project-start {
    width: 100%;
    min-height: 38px;
    justify-content: center;
    background: color-mix(in srgb, var(--project-accent) 80%, #000);
    color: #fff;
}
.project-start:hover {
    background: color-mix(in srgb, var(--project-accent) 70%, #000);
}
.project-brief {
    padding: 12px;
    border: 1px solid var(--md-outline-variant);
    border-radius: var(--md-border-radius-medium, 12px);
    background: var(--md-surface-container-low);
}
.project-brief-action {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 24px;
    padding: 2px 0;
    font-size: 12px;
    font-weight: 500;
    color: var(--project-accent);
}
.project-section-label {
    padding: 0 4px 6px;
    font-size: 11px;
    font-weight: 600;
    color: var(--md-on-surface-variant);
}
.project-section-heading {
    display: grid;
    gap: 5px;
    margin-bottom: 16px;
}
.project-editor,
.project-memory {
    padding: 12px;
    border: 1px solid var(--md-outline-variant);
    border-radius: var(--md-border-radius-medium, 12px);
}
.project-editor {
    background: var(--md-surface-container-low);
}
.project-empty {
    padding: 24px 12px;
    text-align: center;
    border-radius: var(--md-border-radius-medium, 12px);
    background: var(--md-surface-container-low);
}
.project-source {
    padding: 12px 0 16px;
    border-bottom: 1px solid var(--md-outline-variant);
}
.project-source-icon {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: var(--md-border-radius-small, 8px);
    background: color-mix(in srgb, var(--md-success) 10%, transparent);
    color: var(--md-success);
}
.project-memory-kind {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
}
.project-source-details :deep(button) {
    font-size: 11px;
}
.project-source-details :deep(summary) {
    min-height: 24px;
}
.project-editor :deep(button),
.project-memory :deep(button) {
    font-size: 12px;
}
.project-content :deep(.project-input) {
    font-size: 12px;
}
.project-input {
    display: block;
    width: 100%;
    min-width: 0;
    padding: 8px 10px;
    margin-top: 6px;
    border: 1px solid var(--md-outline-variant, #8886);
    border-radius: var(--md-border-radius-small, 8px);
    background: var(--md-surface-container-low);
    color: inherit;
}
.project-content {
    overflow-wrap: anywhere;
}
.project-tool-row {
    padding: 10px 0;
    border-bottom: 1px solid var(--md-outline-variant);
}
.project-tool-row:last-child {
    border-bottom: 0;
}
.project-tool-permission {
    width: 88px;
}
.project-unavailable-tools {
    border-top: 1px solid var(--md-outline-variant);
}
.project-unavailable-tools > summary {
    list-style: none;
}
.project-unavailable-tools > summary::-webkit-details-marker {
    display: none;
}
.project-unavailable-tools[open] .project-disclosure-icon {
    transform: rotate(90deg);
}
.project-settings-footer {
    background: var(--md-surface);
}
.project-settings-save {
    background: var(--project-accent);
    color: var(--md-on-primary, #fff);
    white-space: nowrap;
}
.project-settings :deep(button),
.project-settings :deep(input) {
    font-size: 12px;
}
.project-link {
    padding: 8px 0;
    text-decoration: underline;
    text-underline-offset: 4px;
}
</style>
