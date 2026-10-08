<script setup lang="ts">
import { saveClassifiedProjectMemory } from '~/utils/projects/memory';
import {
    computed,
    onBeforeUnmount,
    onActivated,
    onDeactivated,
    nextTick,
    ref,
    watch,
    toRaw,
} from 'vue';
import { liveQuery } from 'dexie';
import { Or3Scroll } from 'or3-scroll';
import { subscribeActiveWorkspaceDb } from '~/db/client';
import { createThreadInDb } from '~/db/threads';
import { getWriteTxTableNames } from '~/db/util';
import {
    readProjectWorkspace,
    saveProjectSettings,
    deleteProjectRecord,
    saveProjectSource,
    saveProjectNote,
    PROJECT_INTAKE_TIMEOUT_SECONDS,
    moveChatToProject,
    projectSettingsId,
} from '~/db/project-workspace';
import {
    captureProjectOperation,
    projectToolEnabled,
} from '~/utils/projects/context';
import { relatedChatsNotice } from '~/utils/projects/related-chats';
import { useToast } from '#imports';
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
    ProjectSettingsSchema,
    readPersistedProjectRecord,
    type ProjectSettings,
    type ProjectSource,
} from '~~/shared/projects/workspace';
import type { ProjectRecord } from '~/db/project-workspace';
import type { Project, Thread, Post } from '~/db/schema';
import { useProjectSidebar } from '~/composables/sidebar/useProjectSidebar';
import { useActiveSidebarPage } from '~/composables/sidebar/useActiveSidebarPage';
import { useOr3Config } from '~/composables/useOr3Config';
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
    (e: 'new-project'): void;
    (e: 'add-document-to-project-root', projectId: string): void;
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
const chatIcon = useIcon('sidebar.chat');
const newDocumentIcon = useIcon('sidebar.new_note');
const or3Config = useOr3Config();
const documentsEnabled = computed(() => or3Config.features.documents.enabled);
const knowledgeIcon = useIcon('sidebar.note');
const settingsIcon = useIcon('ui.settings');
const editIcon = useIcon('ui.edit');
const chevronIcon = useIcon('ui.chevron.right');
const plusIcon = useIcon('ui.plus');
const trashIcon = useIcon('ui.trash');
const moreIcon = useIcon('ui.more');
const sourceInput = ref<'' | 'note' | 'document' | 'file'>('');
const sourceMenuOpen = ref(false);
const briefEditing = ref(false);
const inlineBriefEditor = ref<HTMLTextAreaElement | null>(null);
const creatingMemory = ref(false);
const editingMemory = ref<{
    record: NonNullable<
        Awaited<ReturnType<typeof readProjectWorkspace>>
    >['memories'][number];
    text: string;
} | null>(null);
const tab = ref('Overview');
const sectionDescriptions: Record<string, string> = {
    Knowledge: 'Sources for this project.',
    Memory: 'What matters for this project.',
    Settings: 'Instructions and tools for this project.',
};
const query = ref('');
const projects = ref<Array<{ project: Project; pinned: boolean }>>([]);
const state = ref<Awaited<ReturnType<typeof readProjectWorkspace>> | null>(
    null,
);
const chats = ref<Thread[]>([]);
const documents = ref<Post[]>([]);
const settings = ref<ProjectSettings>(defaultProjectSettings());
const dirty = ref(false);
// Sync can land different settings at the same clock; edits keep the revision they read.
const editRevision = ref<Pick<Post, 'clock' | 'content'> | null>(null);
const revisionOf = (row?: Post) => (row ? { clock: row.clock, content: row.content } : null);
const memory = ref('');
const documentId = ref('');
const fileId = ref('');
const files = ref<Post[]>([]);
const busy = ref(false);
const error = ref('');
const toast = useToast();
const notifyRelatedChats = (count: number) => {
    const notice = relatedChatsNotice(count);
    if (notice) toast.add(notice);
};
const previewText = ref('');
const previewTitle = ref('');
const previewImage = ref('');
const previewLocations = ref<
    Array<{ label: string; start: number; end: number }>
>([]);
const noteTitle = ref('');
const noteText = ref('');
const upload = ref<HTMLInputElement | null>(null);
const replace = ref<ProjectRecord<ProjectSource> | undefined>();
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
        tool.runtime !== 'server' && tool.enabled.value && !toolCannotScope(tool.definition.function.name)
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
    return [...groups].map(([label, tools]) => ({
        label,
        tools,
        allowed: tools.filter(
            (tool) =>
                toolModeValue(tool.definition.function.name) !== 'disabled',
        ).length,
    }));
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
    editRevision.value = revisionOf(state.value.settingsRow);
    dirty.value = false;
}
let controller = new AbortController();
let scope = captureProjectOperation(controller.signal);
let subscription: { unsubscribe(): void } | undefined;
let disposed = false;
let active = true;
let readRevision = 0;
let intakeRefresh: ReturnType<typeof setTimeout> | undefined;
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
const projectListItems = computed(() =>
    filtered.value.map((entry, index, entries) => ({
        ...entry,
        heading:
            index === 0 || entries[index - 1]?.pinned !== entry.pinned
                ? entry.pinned
                    ? 'Pinned'
                    : 'Recent'
                : '',
    })),
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
    busy.value = false;
    error.value = '';
    dirty.value = false;
    toolQuery.value = '';
    manageChatsOpen.value = false;
    memory.value = '';
    sourceInput.value = '';
    noteTitle.value = '';
    noteText.value = '';
    documentId.value = '';
    fileId.value = '';
    sourceMenuOpen.value = false;
    briefEditing.value = false;
    creatingMemory.value = false;
    editingMemory.value = null;
    releasePreview();
    subscribePage();
}
function subscribePage() {
    clearTimeout(intakeRefresh);
    subscription?.unsubscribe();
    const revision = ++readRevision;
    if (!active || disposed) return;
    const captured = scope;
    const projectId = id.value;
    const section = tab.value;
    const picker = sourceInput.value;
    const manage = manageChatsOpen.value;
    subscription = liveQuery(async () => {
        const rows = projectId
            ? []
            : (await captured.db.projects.toArray()).filter((p) => !p.deleted);
        const settingsRows = await captured.db.posts.bulkGet(
            rows.map((project) => projectSettingsId(project.id)),
        );
        const list = rows.map((project, index) => {
            const settingsRow = settingsRows[index];
            return {
                project,
                pinned:
                    settingsRow && !settingsRow.deleted
                        ? (readPersistedProjectRecord(
                              ProjectSettingsSchema,
                              settingsRow.content,
                          )?.pinned ?? false)
                        : false,
            };
        });
        const current = projectId
            ? await readProjectWorkspace(captured.db, projectId)
            : null;
        const all =
            projectId && section === 'Settings' && manage
                ? (await captured.db.threads.toArray()).filter(
                      (t) => !t.deleted,
                  )
                : [];
        let threads: Thread[] = [];
        if (current && section === 'Settings') {
            const owned = (
                await captured.db.threads
                    .where('project_id')
                    .equals(projectId)
                    .toArray()
            ).filter((t) => !t.deleted);
            const { preservedProjectEntries, projectEntryIdentity } =
                await import('~/utils/projects/normalizeProjectData');
            const legacyIds = preservedProjectEntries(current.project.data)
                .map(projectEntryIdentity)
                .filter((key): key is string =>
                    Boolean(key?.startsWith('chat:')),
                )
                .map((key) => key.slice(5));
            const legacy = (
                await captured.db.threads.bulkGet(legacyIds)
            ).filter((t): t is Thread =>
                Boolean(t && !t.deleted && !t.project_id),
            );
            threads = [...owned, ...legacy];
        }
        const { isVisibleWorkspaceItem } =
            await import('~~/shared/posts/workspace-item');
        const docs =
            projectId && section === 'Knowledge' && picker === 'document'
                ? (
                      await captured.db.posts
                          .where('postType')
                          .equals('doc')
                          .toArray()
                  ).filter(isVisibleWorkspaceItem)
                : [];
        const files =
            projectId && section === 'Knowledge' && picker === 'file'
                ? (
                      await captured.db.posts
                          .where('postType')
                          .equals('or3:file')
                          .toArray()
                  ).filter(isVisibleWorkspaceItem)
                : [];
        captured.assertCurrent();
        return { list, current, threads, docs, all, files };
    }).subscribe({
        next(value) {
            if (
                disposed ||
                !active ||
                captured !== scope ||
                revision !== readRevision
            )
                return;
            clearTimeout(intakeRefresh);
            allChats.value = value.all;
            projects.value = value.list;
            state.value = value.current;
            const processing = value.current?.sources.flatMap(source => source.value.revisions)
                .filter(revision => revision.status === 'processing') ?? [];
            if (processing.length) {
                const deadline = Math.min(...processing.map(revision =>
                    (revision.processing_started_at ?? revision.created_at) + PROJECT_INTAKE_TIMEOUT_SECONDS));
                intakeRefresh = setTimeout(() => {
                    if (active && !disposed && captured === scope && revision === readRevision) subscribePage();
                }, Math.max(1, deadline * 1000 - Date.now()));
            }
            chats.value = value.threads.sort(
                (a, b) =>
                    (b.last_message_at ?? b.updated_at) -
                    (a.last_message_at ?? a.updated_at),
            );
            documents.value = value.docs;
            files.value = value.files;
            if (!dirty.value && value.current) {
                settings.value = structuredClone(value.current.settings);
                editRevision.value = revisionOf(value.current.settingsRow);
            }
        },
        error(cause) {
            if (!active || captured !== scope || revision !== readRevision)
                return;
            error.value =
                cause instanceof Error
                    ? cause.message
                    : 'Could not load projects.';
        },
    });
}
watch([tab, sourceInput, manageChatsOpen], subscribePage);
onDeactivated(() => {
    clearTimeout(intakeRefresh);
    active = false;
    readRevision++;
    subscription?.unsubscribe();
    controller.abort();
    releasePreview();
});
onActivated(() => {
    if (active) return;
    active = true;
    controller = new AbortController();
    scope = captureProjectOperation(controller.signal);
    busy.value = false;
    subscribePage();
});
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
    clearTimeout(intakeRefresh);
    disposed = true;
    subscription?.unsubscribe();
    stopWorkspace();
    controller.abort();
    releasePreview();
});
async function run(action: () => Promise<unknown>) {
    if (busy.value) return;
    const captured = scope;
    busy.value = true;
    error.value = '';
    try {
        await action();
    } catch (cause) {
        if (captured !== scope || captured.signal.aborted) return;
        error.value =
            cause instanceof Error
                ? cause.message
                : 'Project operation failed.';
    } finally {
        if (captured === scope) busy.value = false;
    }
}
async function openProject(projectId: string) {
    id.value = projectId;
    returnTo.value = 'projects';
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
    briefEditing.value = false;
    dirty.value =
        JSON.stringify(settings.value) !== JSON.stringify(state.value.settings);
    if (!dirty.value) editRevision.value = revisionOf(state.value.settingsRow);
}
async function editInlineBrief() {
    if (!state.value || busy.value) return;
    settings.value.brief = state.value.settings.brief || state.value.project.description || '';
    dirty.value = JSON.stringify(settings.value) !== JSON.stringify(state.value.settings);
    briefEditing.value = true;
    await nextTick();
    inlineBriefEditor.value?.focus();
}
async function pin(projectId: string) {
    const captured = scope;
    const current = await readProjectWorkspace(captured.db, projectId);
    await saveProjectSettings(
        captured,
        projectId,
        { ...current.settings, pinned: !current.settings.pinned },
        current.settingsRow ?? null,
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
async function addNote() {
    const captured = scope;
    const projectId = id.value;
    const title = noteTitle.value;
    const text = noteText.value;
    await saveProjectNote(captured, projectId, { title, text });
    if (captured !== scope || projectId !== id.value || sourceInput.value !== 'note'
        || noteTitle.value !== title || noteText.value !== text) return;
    noteTitle.value = '';
    noteText.value = '';
    sourceInput.value = '';
}
async function addSelectedDocument() {
    const captured = scope;
    const projectId = id.value;
    const selected = documentId.value;
    await addProjectDocument(captured, projectId, selected);
    if (captured === scope && projectId === id.value && sourceInput.value === 'document' && documentId.value === selected)
        sourceInput.value = '';
}
async function addSelectedFile() {
    const captured = scope;
    const projectId = id.value;
    const selected = fileId.value;
    await addExistingProjectFile(captureIntakeScope(), projectId, selected);
    if (captured === scope && projectId === id.value && sourceInput.value === 'file' && fileId.value === selected)
        sourceInput.value = '';
}

async function saveSettings() {
    const captured = scope;
    const projectId = id.value;
    const draft = ProjectSettingsSchema.parse(settings.value);
    const expected = editRevision.value;
    captured.assertCurrent('write');
    const saved = await saveProjectSettings(captured, projectId, draft, expected);
    if (captured !== scope || projectId !== id.value) return;
    editRevision.value = revisionOf(saved);
    dirty.value = JSON.stringify(settings.value) !== JSON.stringify(draft);
}
async function saveBrief() {
    const captured = scope;
    const projectId = id.value;
    const brief = settings.value.brief;
    const expected = editRevision.value;
    captured.assertCurrent('write');
    const current = await readProjectWorkspace(captured.db, projectId);
    if (JSON.stringify(revisionOf(current.settingsRow)) !== JSON.stringify(expected))
        throw new Error(
            'Project settings changed. Reload before saving your brief.',
        );
    const next = { ...current.settings, brief };
    const saved = await saveProjectSettings(
        captured,
        projectId,
        next,
        current.settingsRow ?? null,
    );
    if (captured !== scope || projectId !== id.value) return;
    editRevision.value = revisionOf(saved);
    dirty.value = JSON.stringify(settings.value) !== JSON.stringify(next);
    if (settings.value.brief === brief) briefEditing.value = false;
}
async function uploadFiles(event: Event) {
    const files = Array.from((event.target as HTMLInputElement).files ?? []);
    (event.target as HTMLInputElement).value = '';
    const projectId = id.value;
    const replacement = replace.value;
    replace.value = undefined;
    await run(async () => {
        const captured = captureIntakeScope();
        for (const file of files)
            await addProjectUpload(captured, projectId, file, replacement);
    });
}
function captureIntakeScope() {
    scope.assertCurrent('write');
    // An admitted extraction belongs to its captured workspace/project, not
    // the sidebar view. Workspace and permission changes still fence writes.
    return captureProjectOperation();
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
        if (blob) {
            const text = await blob.text();
            captured.assertCurrent();
            if (captured === scope) previewText.value = text;
        }
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
    captured.assertCurrent();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = meta?.name ?? 'original';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function addMemory() {
    const captured = scope;
    const projectId = id.value;
    const text = memory.value;
    captured.assertCurrent('write');
    await saveClassifiedProjectMemory(captured, projectId, { text });
    if (
        captured !== scope ||
        projectId !== id.value ||
        memory.value !== text
    )
        return;
    memory.value = '';
    creatingMemory.value = false;
}
async function saveMemoryEdit() {
    const edit = editingMemory.value;
    if (!edit) return;
    const captured = scope;
    const projectId = id.value;
    const record = edit.record;
    const text = edit.text;
    await saveClassifiedProjectMemory(
        captured,
        projectId,
        { ...record.value, text },
        record.row.id,
        record.row,
    );
    if (
        captured === scope &&
        projectId === id.value &&
        editingMemory.value === edit &&
        edit.text === text
    )
        editingMemory.value = null;
}
async function exclude(thread: Thread) {
    const captured = scope;
    const projectId = id.value;
    const threadId = thread.id;
    const current = await readProjectWorkspace(captured.db, projectId);
    const exclusions = current.settings.excluded_chat_ids;
    await saveProjectSettings(
        captured,
        projectId,
        {
            ...current.settings,
            excluded_chat_ids: exclusions.includes(threadId)
                ? exclusions.filter((value) => value !== threadId)
                : [...exclusions, threadId],
        },
        current.settingsRow ?? null,
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
                @click="emit('new-project')"
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
            <Or3Scroll
                v-if="filtered.length"
                :items="projectListItems"
                :item-key="(entry) => entry.project.id"
                :estimate-height="48"
                :overscan="240"
                mutation-mode="arbitrary"
                :maintain-bottom="false"
                role="list"
                aria-label="Project list"
                class="flex-1 min-h-0 sidebar-scroll px-2 pb-3"
            >
                <template #default="{ item: entry }">
                    <div role="listitem">
                        <p
                            v-if="entry.heading"
                            class="px-2 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--md-on-surface-variant)]"
                        >
                            {{ entry.heading }}
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
                    </div>
                </template>
            </Or3Scroll>
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
                        @click="emit('new-project')"
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
                            <div class="min-w-0 flex-1">
                                <h1
                                    class="text-lg font-semibold leading-snug break-words"
                                >
                                    {{ state.project.name }}
                                </h1>
                                <div v-if="!briefEditing" class="flex items-center gap-1 mt-0.5">
                                    <p
                                        class="project-muted min-w-0 text-xs leading-relaxed whitespace-pre-wrap line-clamp-2"
                                        aria-label="Project brief"
                                    >
                                        {{ state.settings.brief || state.project.description || 'Add a project brief' }}
                                    </p>
                                    <UButton
                                        :icon="editIcon"
                                        :aria-label="state.settings.brief || state.project.description ? 'Edit project brief' : 'Add project brief'"
                                        square
                                        size="xs"
                                        color="neutral"
                                        variant="ghost"
                                        class="project-brief-edit shrink-0"
                                        @click="editInlineBrief"
                                    />
                                </div>
                            </div>
                        </div>
                        <form
                            v-if="briefEditing"
                            class="project-inline-brief space-y-2"
                            aria-label="Edit project brief"
                            @submit.prevent="run(saveBrief)"
                        >
                            <label class="sr-only" for="project-inline-brief-editor">Project brief</label>
                            <textarea
                                id="project-inline-brief-editor"
                                ref="inlineBriefEditor"
                                v-model="settings.brief"
                                class="project-input !mt-0"
                                rows="3"
                                maxlength="8000"
                                placeholder="Describe the current state and next steps…"
                                :disabled="busy"
                                @input="dirty = true"
                                @keydown.esc.stop.prevent="cancelBriefEdit"
                            />
                            <div class="flex justify-end items-center gap-2">
                                <UButton
                                    label="Cancel"
                                    color="neutral"
                                    variant="ghost"
                                    size="xs"
                                    :disabled="busy"
                                    @click="cancelBriefEdit"
                                />
                                <UButton
                                    type="submit"
                                    label="Save brief"
                                    color="neutral"
                                    size="xs"
                                    :loading="busy"
                                    :disabled="busy"
                                />
                            </div>
                        </form>
                        <div class="project-create-actions">
                            <UButton
                                :icon="newChatIcon"
                                label="New chat"
                                color="neutral"
                                class="project-start theme-btn"
                                :disabled="busy"
                                @click="run(newChat)"
                            />
                            <UButton
                                v-if="documentsEnabled"
                                :icon="newDocumentIcon"
                                label="New document"
                                color="neutral"
                                variant="ghost"
                                class="project-new-document theme-btn"
                                :disabled="busy"
                                @click="emit('add-document-to-project-root', id)"
                            />
                        </div>
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
                    class="project-content flex-1 min-h-0 min-w-0 overflow-y-auto sidebar-scroll px-3 pt-2 pb-5 space-y-4 text-sm"
                    :class="{ 'project-settings-content': tab === 'Settings' }"
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
                            :disabled="busy"
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
                                        :disabled="busy"
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
                            @submit.prevent="run(addSelectedDocument)"
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
                            @submit.prevent="run(addSelectedFile)"
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
                                    source.value.revisions.at(-1)?.id !==
                                        source.value.current_revision_id &&
                                    ['ready', 'partial'].includes(
                                        currentRevision(source)!.status,
                                    )
                                        ? 'Last update failed. The current version is still available.'
                                        : 'Processing failed.'
                                }}
                                {{ source.value.revisions.at(-1)?.error }}
                            </p>
                            <label
                                class="flex items-center gap-2 text-xs project-muted"
                                >Context<select
                                    :disabled="busy"
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
                                                source.row,
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
                                            :disabled="busy"
                                            color="neutral"
                                            variant="ghost"
                                            @click="
                                                run(() =>
                                                    processProjectSource(
                                                        captureIntakeScope(),
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
                                        :disabled="busy"
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
                    <div
                        v-if="tab === 'Memory'"
                        class="project-memory-view space-y-5"
                    >
                        <section
                            class="project-saved-memories"
                            aria-label="Saved memories"
                        >
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
                                <textarea
                                    v-model="memory"
                                    class="project-input"
                                    rows="4"
                                    maxlength="4000"
                                    aria-label="New project memory"
                                    placeholder="What should OR3 remember?"
                                    required
                                />
                                <div class="flex justify-end gap-2">
                                    <UButton
                                        label="Cancel"
                                        color="neutral"
                                        variant="ghost"
                                        @click="
                                            creatingMemory = false;
                                            memory = '';
                                        "
                                    />
                                    <UButton
                                        type="submit"
                                        label="Save memory"
                                        :disabled="busy || !memory.trim()"
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
                                    Save what you want OR3 to remember.
                                </p>
                            </div>
                            <article
                                v-for="record in state.memories"
                                :key="record.row.id"
                                class="project-saved-memory"
                                :class="{
                                    'is-editing':
                                        editingMemory?.record.row.id ===
                                        record.row.id,
                                }"
                            >
                                <UDropdownMenu
                                    v-if="
                                        editingMemory?.record.row.id !==
                                        record.row.id
                                    "
                                    :content="{ align: 'end', sideOffset: 4 }"
                                    :items="[
                                        ...(record.value.source_thread_id
                                            ? [
                                                {
                                                    label: 'View original chat',
                                                    icon: chatIcon,
                                                    disabled: busy,
                                                    onSelect: () =>
                                                        run(() =>
                                                            openChat(record.value.source_thread_id!),
                                                        ),
                                                },
                                            ]
                                            : []),
                                        {
                                            label: 'Edit memory',
                                            icon: editIcon,
                                            onSelect: () => {
                                                editingMemory = {
                                                    record,
                                                    text: record.value.text,
                                                };
                                            },
                                        },
                                        {
                                            label: 'Delete memory',
                                            icon: trashIcon,
                                            color: 'error',
                                            disabled: busy,
                                            onSelect: () =>
                                                run(() =>
                                                    deleteProjectRecord(
                                                        scope,
                                                        id,
                                                        record.row,
                                                    ),
                                                ),
                                        },
                                    ]"
                                >
                                    <UButton
                                        :icon="moreIcon"
                                        aria-label="Memory actions"
                                        title="Memory actions"
                                        class="project-memory-actions"
                                        square
                                        size="xs"
                                        color="neutral"
                                        variant="ghost"
                                    />
                                </UDropdownMenu>
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
                                        aria-label="Edit saved memory"
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
                                <p v-else class="project-memory-text">
                                    {{ record.value.text }}
                                </p>
                            </article>
                        </section>
                    </div>
                    <form
                        v-if="tab === 'Settings'"
                        :id="'project-settings-' + id"
                        class="project-settings min-w-0 space-y-7"
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
                        <section class="space-y-3" aria-label="Project tools">
                            <div class="space-y-1">
                                <h2 class="font-semibold text-sm">Tools</h2>
                                <p
                                    class="project-muted text-xs leading-relaxed"
                                >
                                    Choose what OR3 can use. Sending,
                                    publishing, and deleting still require
                                    approval.
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
                                :ui="{
                                    base: 'border-0! bg-[var(--md-surface-container-low)]! focus-visible:outline-2 focus-visible:outline-[var(--md-primary)]',
                                }"
                            />
                            <details
                                v-for="group in toolGroups"
                                :key="group.label"
                                :open="!!toolQuery.trim()"
                                class="project-tool-group"
                            >
                                <summary
                                    class="project-tool-summary"
                                    role="button"
                                    :aria-label="group.label + ' tools'"
                                >
                                    <span class="min-w-0 flex-1 font-medium">{{
                                        group.label
                                    }}</span>
                                    <span class="project-muted text-[11px]">{{
                                        group.allowed
                                            ? `${group.allowed} allowed`
                                            : 'All off'
                                    }}</span>
                                    <UIcon
                                        name="i-lucide-chevron-right"
                                        class="size-3.5 shrink-0 project-muted project-disclosure-icon"
                                        aria-hidden="true"
                                    />
                                </summary>
                                <div
                                    v-for="tool in group.tools"
                                    :key="tool.definition.function.name"
                                    class="project-tool-row"
                                >
                                    <div class="flex items-center gap-2.5">
                                        <UIcon
                                            :name="
                                                tool.definition.ui?.icon ||
                                                tool.definition.icon ||
                                                'i-lucide-wrench'
                                            "
                                            class="size-4 shrink-0 project-muted"
                                            aria-hidden="true"
                                        />
                                        <p
                                            class="min-w-0 flex-1 text-xs font-medium leading-5"
                                        >
                                            {{ toolLabel(tool) }}
                                        </p>
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
                                            variant="ghost"
                                            class="project-tool-permission shrink-0"
                                            :ui="{
                                                base: 'border-0! bg-transparent! shadow-none! min-h-8',
                                            }"
                                            @update:model-value="
                                                toolMode(
                                                    tool.definition.function
                                                        .name,
                                                    $event,
                                                )
                                            "
                                        >
                                            <template #content-top>
                                                <div
                                                    class="w-56 max-w-[calc(100vw-2rem)] px-3 py-2"
                                                >
                                                    <p
                                                        class="text-xs font-medium"
                                                    >
                                                        {{ toolLabel(tool) }}
                                                    </p>
                                                    <p
                                                        v-if="
                                                            tool.definition.ui
                                                                ?.descriptionHint
                                                        "
                                                        class="project-muted text-[11px] leading-relaxed mt-1"
                                                    >
                                                        {{
                                                            tool.definition.ui
                                                                .descriptionHint
                                                        }}
                                                    </p>
                                                </div>
                                            </template>
                                        </USelect>
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
                            </details>
                            <p
                                v-if="!matchingTools.length"
                                class="project-muted text-xs py-3"
                            >
                                No matching tools.
                            </p>
                            <details
                                v-if="unavailableTools.length"
                                :open="!!toolQuery.trim()"
                                class="project-unavailable-tools project-tool-group"
                            >
                                <summary
                                    class="project-tool-summary text-xs font-medium"
                                    role="button"
                                >
                                    <span class="flex-1"
                                        >Unavailable tools</span
                                    >
                                    <span class="project-muted text-[11px]">{{
                                        unavailableTools.length
                                    }}</span>
                                    <UIcon
                                        name="i-lucide-chevron-right"
                                        class="size-3.5 project-disclosure-icon"
                                        aria-hidden="true"
                                    />
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
                                                tool.runtime === 'server'
                                                    ? 'Server-owned tools cannot run in browser project chats.'
                                                    : toolCannotScope(
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
                        class="project-chat-settings pt-3"
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
                                        ).then(notifyRelatedChats),
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
                                                ).then(notifyRelatedChats),
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
                    class="project-settings-footer shrink-0 flex items-center gap-2 px-5 py-3"
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
                        color="neutral"
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
.project-brief-edit {
    color: var(--md-on-surface-variant);
    background: transparent;
}
.project-brief-edit:hover {
    color: var(--md-on-surface);
    background: transparent;
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
.project-create-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
}
.project-create-actions > button {
    flex: 1 1 auto;
    width: auto;
    min-width: 0;
    padding-inline: 10px !important;
    white-space: nowrap;
    justify-content: center;
    min-height: 38px;
}
.project-new-document {
    background: var(--md-surface-hover);
    color: var(--md-on-surface);
}
.project-new-document:hover {
    background: var(--md-surface-container-high);
}
.project-start:hover {
    background: color-mix(in srgb, var(--project-accent) 70%, #000);
}
.project-saved-memories > .project-editor,
.project-saved-memories > .project-empty {
    margin-top: 12px;
}
.project-saved-memory {
    position: relative;
    padding: 16px 34px 16px 4px;
}
.project-saved-memory + .project-saved-memory {
    border-top: 1px solid
        color-mix(in srgb, var(--md-outline-variant) 45%, transparent);
}
.project-saved-memory.is-editing {
    padding-right: 4px;
}
.project-memory-text {
    font-size: 12px;
    line-height: 1.65;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}
.project-memory-actions {
    position: absolute;
    top: 10px;
    right: 0;
    min-width: 28px;
    min-height: 28px;
    color: var(--md-on-surface-variant);
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
.project-editor {
    padding: 12px;
    border: 1px solid var(--md-outline-variant);
    border-radius: var(--md-border-radius-medium, 12px);
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
.project-source-details :deep(button) {
    font-size: 11px;
}
.project-source-details :deep(summary) {
    min-height: 24px;
}
.project-editor :deep(button) {
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
.project-content.project-settings-content {
    padding-inline: 20px;
    scrollbar-gutter: stable;
}
.project-tool-summary {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 40px;
    padding: 8px;
    cursor: pointer;
    list-style: none;
    border-radius: var(--md-border-radius-small, 8px);
    font-size: 12px;
}
.project-tool-summary:hover {
    background: var(--md-surface-hover);
}
.project-tool-summary:focus-visible,
.project-tool-permission:focus-visible {
    outline: 2px solid var(--md-primary);
    outline-offset: 2px;
}
.project-tool-row {
    padding: 8px 0;
    margin-inline: 8px;
}
.project-tool-permission {
    width: auto;
    max-width: 88px;
}
.project-tool-summary::-webkit-details-marker {
    display: none;
}
.project-tool-group[open] > summary .project-disclosure-icon {
    transform: rotate(90deg);
}
.project-settings-footer {
    background: var(--md-surface);
}
.project-settings-save {
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
