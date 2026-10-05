<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
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
import { useToolRegistry } from '~/utils/chat/tool-registry';
import {
    defaultProjectSettings,
    type ProjectSettings,
    type ProjectSource,
} from '~~/shared/projects/workspace';
import type { ProjectRecord } from '~/db/project-workspace';
import type { Project, Thread, Post } from '~/db/schema';

const props = defineProps<{ recordId?: string | null }>();
const id = ref(props.recordId ?? '');
const tab = ref('Overview');
const tabs = ['Overview', 'Chats', 'Knowledge', 'Memory', 'Settings'];
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
let controller = new AbortController();
let scope = captureProjectOperation(controller.signal);
let subscription: { unsubscribe(): void } | undefined;
let disposed = false;
const filtered = computed(() =>
    projects.value
        .filter((p) =>
            p.project.name.toLowerCase().includes(query.value.toLowerCase()),
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
    suggestions.value = [];
    memory.value = '';
    memoryEvidence.value = null;
    briefEvidence.value = null;
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
watch(
    () => props.recordId,
    (value) => {
        id.value = value ?? '';
        connect();
    },
);
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
    const host = getPaletteHostContext();
    if (host) {
        const result = await host.openPaneApp(
            'or3-projects',
            projectId,
            'active',
        );
        if (!result.ok) throw new Error(result.error.message);
    } else id.value = projectId;
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
}
async function addNote() {
    const captured = scope;
    const projectId = id.value;
    const prepared = await prepareDocumentCreate({
        title: noteTitle.value.trim(),
        content: {
            type: 'doc',
            content: noteText.value
                .split('\n')
                .map((text) => ({
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
}
async function reviewBrief(suggestion: (typeof suggestions.value)[number]) {
    await verifySuggestion(suggestion.row.id);
    settings.value.brief = suggestion.data.summary_markdown.slice(0, 8000);
    briefEvidence.value = suggestion.row.id;
    dirty.value = true;
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
}
async function editMemory(
    record: NonNullable<typeof state.value>['memories'][number],
    event: Event,
) {
    await saveProjectMemory(
        scope,
        id.value,
        { ...record.value, text: (event.target as HTMLTextAreaElement).value },
        record.row.id,
        record.row.clock,
    );
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
function toolMode(name: string, event: Event) {
    settings.value.tools[name] = {
        mode: (event.target as HTMLSelectElement).value as
            | 'enabled'
            | 'disabled'
            | 'ask',
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
        class="projects-pane h-full overflow-auto p-5 md:p-8 space-y-5"
        aria-label="Projects"
    >
        <p v-if="error" role="alert" class="text-red-500">{{ error }}</p>
        <template v-if="!id">
            <h1 class="text-2xl font-semibold">Projects</h1>
            <p class="opacity-70">
                Your files, decisions, and conversations in one workspace.
            </p>
            <label class="block"
                >Search projects<input
                    v-model="query"
                    type="search"
                    class="project-input"
            /></label>
            <form class="flex gap-2" @submit.prevent="run(createProject)">
                <input
                    v-model="name"
                    aria-label="New project name"
                    placeholder="Project name"
                    maxlength="200"
                    class="project-input"
                    required
                /><UButton
                    type="submit"
                    :disabled="busy"
                    label="Create project"
                />
            </form>
            <ul class="space-y-3">
                <li
                    v-for="entry in filtered"
                    :key="entry.project.id"
                    class="flex items-center gap-3 rounded border border-current/15 p-3"
                >
                    <button
                        class="flex-1 text-left"
                        @click="run(() => openProject(entry.project.id))"
                    >
                        <span class="font-medium">{{ entry.project.name }}</span
                        ><span class="block text-sm opacity-60"
                            >{{ entry.pinned ? 'Pinned' : 'Recent' }} ·
                            {{ entry.project.description }}</span
                        >
                    </button>
                    <UButton
                        color="neutral"
                        variant="ghost"
                        :aria-label="
                            entry.pinned ? 'Unpin project' : 'Pin project'
                        "
                        :icon="
                            entry.pinned ? 'i-lucide-pin-off' : 'i-lucide-pin'
                        "
                        @click="run(() => pin(entry.project.id))"
                    />
                </li>
            </ul>
            <p v-if="!filtered.length">Create a project to begin.</p>
        </template>
        <template v-else-if="state">
            <header class="flex items-center gap-3">
                <UButton
                    color="neutral"
                    variant="ghost"
                    aria-label="All projects"
                    icon="i-lucide-arrow-left"
                    @click="id = ''"
                />
                <h1 class="text-2xl font-semibold flex-1">
                    {{ state.project.name }}
                </h1>
                <UButton
                    label="New chat"
                    :disabled="busy"
                    @click="run(newChat)"
                />
            </header>
            <nav class="flex gap-2 overflow-auto" aria-label="Project sections">
                <UButton
                    v-for="section in tabs"
                    :key="section"
                    :label="section"
                    color="neutral"
                    :variant="tab === section ? 'solid' : 'ghost'"
                    :aria-current="tab === section ? 'page' : undefined"
                    @click="tab = section"
                />
            </nav>
            <div v-if="tab === 'Overview'" class="space-y-4">
                <h2 class="font-semibold">Project brief</h2>
                <p class="whitespace-pre-wrap">
                    {{
                        state.settings.brief ||
                        state.project.description ||
                        'Add a brief in Memory to describe what matters now.'
                    }}
                </p>
                <h2
                    v-if="chats.some((chat) => chat.pinned)"
                    class="font-semibold"
                >
                    Pinned chats
                </h2>
                <button
                    v-for="chat in chats.filter((chat) => chat.pinned)"
                    :key="chat.id"
                    class="block project-link"
                    @click="run(() => openChat(chat.id))"
                >
                    {{ chat.title || 'Chat' }}
                </button>
                <h2 class="font-semibold">Where you left off</h2>
                <button
                    v-for="chat in chats.slice(0, 5)"
                    :key="chat.id"
                    class="block project-link"
                    @click="run(() => openChat(chat.id))"
                >
                    {{ chat.title || 'Chat' }}
                </button>
                <p>
                    {{ state.sources.length }} knowledge sources ·
                    {{ state.memories.length }} saved memories
                </p>
            </div>
            <div v-if="tab === 'Chats'" class="space-y-3">
                <form
                    class="flex gap-2"
                    @submit.prevent="
                        run(() => moveChatToProject(scope, existingChatId, id))
                    "
                >
                    <select
                        v-model="existingChatId"
                        required
                        aria-label="Move existing chat"
                        class="project-input"
                    >
                        <option value="">
                            Choose a chat to move into this project
                        </option>
                        <option
                            v-for="chat in allChats"
                            :key="chat.id"
                            :value="chat.id"
                        >
                            {{ chat.title || chat.id }}
                        </option></select
                    ><UButton
                        type="submit"
                        label="Move into project"
                        :disabled="busy"
                    />
                </form>
                <p class="text-sm opacity-70">
                    Excluded chats stay in the project but are not retrieved as
                    memory. Open a chat and use Continue in new chat for a clean
                    handoff.
                </p>
                <div
                    v-for="chat in chats"
                    :key="chat.id"
                    class="flex items-center gap-3"
                >
                    <button
                        class="project-link flex-1 text-left"
                        @click="run(() => openChat(chat.id))"
                    >
                        {{ chat.title || 'Chat' }}</button
                    ><UButton
                        color="neutral"
                        variant="ghost"
                        :label="
                            state.settings.excluded_chat_ids.includes(chat.id)
                                ? 'Include in memory'
                                : 'Exclude from memory'
                        "
                        @click="run(() => exclude(chat))"
                    /><UButton
                        color="neutral"
                        variant="ghost"
                        label="Remove"
                        @click="
                            run(() => moveChatToProject(scope, chat.id, null))
                        "
                    />
                </div>
            </div>
            <div v-if="tab === 'Knowledge'" class="space-y-4">
                <p class="text-sm opacity-70">
                    Only sources added here become project knowledge. Chat
                    attachments stay in that chat.
                </p>
                <input
                    ref="upload"
                    type="file"
                    class="sr-only"
                    :multiple="!replace"
                    accept=".pdf,.docx,.txt,.md,.csv,image/png,image/jpeg,image/webp,image/gif"
                    aria-label="Upload project knowledge"
                    @change="uploadFiles"
                />
                <UButton
                    label="Upload knowledge"
                    :disabled="busy"
                    @click="
                        replace = undefined;
                        upload?.click();
                    "
                />
                <form class="space-y-2" @submit.prevent="run(addNote)">
                    <input
                        v-model="noteTitle"
                        aria-label="Note title"
                        placeholder="Note title"
                        class="project-input"
                        maxlength="500"
                        required
                    /><textarea
                        v-model="noteText"
                        aria-label="Note text"
                        class="project-input"
                        rows="3"
                        maxlength="16000"
                        required
                    /><UButton
                        type="submit"
                        label="Add note"
                        :disabled="busy"
                    />
                </form>
                <form
                    class="flex gap-2"
                    @submit.prevent="
                        run(() => addProjectDocument(scope, id, documentId))
                    "
                >
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
                        </option></select
                    ><UButton
                        type="submit"
                        label="Add document"
                        :disabled="busy"
                    />
                </form>
                <form
                    class="flex gap-2"
                    @submit.prevent="
                        run(() => addExistingProjectFile(scope, id, fileId))
                    "
                >
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
                        </option></select
                    ><UButton
                        type="submit"
                        label="Add saved file"
                        :disabled="busy"
                    />
                </form>
                <article
                    v-for="source in state.sources"
                    :key="source.row.id"
                    class="rounded border border-current/15 p-4 space-y-2"
                >
                    <h2 class="font-medium">{{ source.value.title }}</h2>
                    <label class="block"
                        >Context<select
                            :value="source.value.mode"
                            class="project-input"
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
                            <option value="relevant">Use when relevant</option>
                            <option value="always">Always include</option>
                            <option value="off">Do not use</option>
                        </select></label
                    >
                    <div
                        v-for="revision in [
                            ...source.value.revisions,
                        ].reverse()"
                        :key="revision.id"
                        class="flex flex-wrap gap-2 items-center text-sm"
                    >
                        <span
                            >{{
                                revision.id === source.value.current_revision_id
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
                            label="Preview"
                            @click="
                                run(() => showRevision(source, revision.id))
                            "
                        /><UButton
                            v-if="revision.original_hash"
                            color="neutral"
                            variant="ghost"
                            label="Download original"
                            @click="
                                run(() => download(revision.original_hash!))
                            "
                        /><UButton
                            v-if="
                                ['failed', 'processing'].includes(
                                    revision.status,
                                )
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
                        <p v-if="revision.error" class="w-full text-red-500">
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
                                deleteProjectRecord(scope, id, source.row),
                            )
                        "
                    />
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
                    <pre class="whitespace-pre-wrap max-h-96 overflow-auto">{{
                        previewText
                    }}</pre>
                </div>
            </div>
            <div v-if="tab === 'Memory'" class="space-y-4">
                <UButton
                    label="Review handoff suggestions"
                    color="neutral"
                    variant="outline"
                    @click="
                        run(async () => {
                            const { projectContinuity } =
                                await import('~/utils/projects/continuity');
                            suggestions = await projectContinuity(scope, id);
                        })
                    "
                />
                <p class="text-sm opacity-70">
                    Use Continue in new chat to generate a handoff. Review
                    suggestions against saved decisions before saving; no
                    decision is accepted automatically.
                </p>
                <article
                    v-for="suggestion in suggestions"
                    :key="suggestion.row.id"
                    class="rounded border border-current/15 p-3 space-y-2"
                >
                    <h2>Handoff from {{ suggestion.thread.title }}</h2>
                    <UButton
                        label="Review as brief"
                        color="neutral"
                        variant="ghost"
                        @click="run(() => reviewBrief(suggestion))"
                    /><UButton
                        label="Open source chat"
                        color="neutral"
                        variant="ghost"
                        @click="
                            run(() =>
                                openChat(suggestion.data.source_thread_id),
                            )
                        "
                    />
                    <div
                        v-for="landmark in suggestion.data.landmarks.filter(
                            (l) => ['decision', 'constraint'].includes(l.kind),
                        )"
                        :key="landmark.message_id"
                    >
                        <p>{{ landmark.summary }}</p>
                        <UButton
                            label="Review as memory"
                            color="neutral"
                            variant="ghost"
                            @click="
                                run(() => reviewMemory(suggestion, landmark))
                            "
                        />
                    </div>
                </article>
                <label class="block"
                    >Project brief<textarea
                        v-model="settings.brief"
                        class="project-input"
                        rows="5"
                        maxlength="8000"
                        @input="dirty = true"
                    /></label
                ><UButton
                    label="Save brief"
                    :disabled="busy"
                    @click="run(saveSettings)"
                />
                <p class="text-sm opacity-70">
                    Save facts and decisions explicitly. Suggestions do not
                    become memories until you save them.
                </p>
                <form class="space-y-2" @submit.prevent="run(addMemory)">
                    <textarea
                        v-model="memory"
                        class="project-input"
                        rows="3"
                        maxlength="4000"
                        aria-label="New project memory"
                        required
                    /><select
                        v-model="memoryKind"
                        class="project-input"
                        aria-label="Memory kind"
                    >
                        <option value="fact">Fact</option>
                        <option value="decision">Decision</option>
                    </select>
                    <div
                        v-if="
                            memoryEvidence &&
                            memoryKind === 'decision' &&
                            state.memories.some(
                                (record) => record.value.kind === 'decision',
                            )
                        "
                        class="space-y-2"
                    >
                        <p>
                            Compare this suggestion with your saved decisions.
                            Keep conflicting alternatives separate until you
                            decide.
                        </p>
                        <blockquote
                            v-for="decision in state.memories.filter(
                                (record) => record.value.kind === 'decision',
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
                            I reviewed this against saved decisions</label
                        >
                    </div>
                    <UButton
                        type="submit"
                        label="Save memory"
                        :disabled="
                            busy ||
                            (!!memoryEvidence &&
                                memoryKind === 'decision' &&
                                state.memories.some(
                                    (record) =>
                                        record.value.kind === 'decision',
                                ) &&
                                !reviewedDecisions)
                        "
                    />
                </form>
                <article
                    v-for="record in state.memories"
                    :key="record.row.id"
                    class="space-y-2"
                >
                    <span class="text-sm opacity-70"
                        >Saved {{ record.value.kind }}</span
                    ><textarea
                        :value="record.value.text"
                        :aria-label="'Edit saved ' + record.value.kind"
                        class="project-input"
                        maxlength="4000"
                        @change="run(() => editMemory(record, $event))"
                    /><UButton
                        v-if="record.value.source_thread_id"
                        label="Open evidence"
                        variant="ghost"
                        color="neutral"
                        @click="
                            run(() => openChat(record.value.source_thread_id!))
                        "
                    /><UButton
                        label="Delete memory"
                        variant="ghost"
                        color="neutral"
                        @click="
                            run(() =>
                                deleteProjectRecord(scope, id, record.row),
                            )
                        "
                    />
                </article>
            </div>
            <form
                v-if="tab === 'Settings'"
                class="space-y-4"
                @submit.prevent="run(saveSettings)"
            >
                <label class="block"
                    >Instructions<textarea
                        v-model="settings.instructions"
                        class="project-input"
                        maxlength="16000"
                        rows="6"
                        @input="dirty = true"
                    /></label
                ><label class="block"
                    >Default model<input
                        v-model="settings.default_model"
                        class="project-input"
                        placeholder="Use chat default"
                        @input="dirty = true"
                /></label>
                <h2 class="font-semibold">Tools</h2>
                <p class="text-sm opacity-70">
                    Project rules restrict tools you already have. Sending,
                    publishing, and deleting require approval.
                </p>
                <div
                    v-for="tool in tools"
                    :key="tool.definition.function.name"
                    class="space-y-2"
                >
                    <label class="flex items-center gap-3"
                        ><span class="flex-1">{{
                            tool.definition.function.name
                        }}</span
                        ><select
                            :disabled="
                                toolCannotScope(tool.definition.function.name)
                            "
                            :value="
                                toolCannotScope(tool.definition.function.name)
                                    ? 'disabled'
                                    : (settings.tools[
                                          tool.definition.function.name
                                      ]?.mode ??
                                      (projectToolEnabled(
                                          settings,
                                          tool.definition.function.name,
                                      )
                                          ? 'enabled'
                                          : 'disabled'))
                            "
                            class="project-input !w-auto"
                            @change="
                                toolMode(tool.definition.function.name, $event)
                            "
                        >
                            <option value="enabled">Enabled</option>
                            <option value="ask">Ask first</option>
                            <option value="disabled">Disabled</option>
                        </select></label
                    >
                    <p
                        v-if="toolCannotScope(tool.definition.function.name)"
                        class="text-sm opacity-70"
                    >
                        Unavailable: this tool cannot restrict reads to the
                        project.
                    </p>
                    <p
                        v-else-if="!tool.enabled.value"
                        class="text-sm opacity-70"
                    >
                        Enable this tool globally before using it here.
                    </p>
                    <label
                        v-if="!toolCannotScope(tool.definition.function.name)"
                        class="block text-sm"
                        >Allowed repositories (one per line; leave empty for no
                        project restriction)<textarea
                            :value="
                                settings.tools[
                                    tool.definition.function.name
                                ]?.resources.join('\n') ?? ''
                            "
                            class="project-input"
                            rows="2"
                            @change="
                                settings.tools[tool.definition.function.name] =
                                    {
                                        mode:
                                            settings.tools[
                                                tool.definition.function.name
                                            ]?.mode ??
                                            (projectToolEnabled(
                                                settings,
                                                tool.definition.function.name,
                                            )
                                                ? 'enabled'
                                                : 'disabled'),
                                        resources: (
                                            $event.target as HTMLTextAreaElement
                                        ).value
                                            .split('\n')
                                            .map((value) => value.trim())
                                            .filter(Boolean),
                                    };
                                dirty = true;
                            "
                        />
                    </label>
                </div>
                <UButton type="submit" label="Save settings" :disabled="busy" />
                <p v-if="dirty" class="text-sm">Unsaved changes</p>
            </form>
        </template>
    </section>
</template>
<style scoped>
.project-input {
    display: block;
    width: 100%;
    padding: 10px 12px;
    margin-top: 6px;
    border: 1px solid var(--md-outline-variant, #8886);
    border-radius: var(--md-border-radius-small, 8px);
    background: var(--md-surface-container-low);
    color: inherit;
}
.project-link {
    padding: 8px 0;
    text-decoration: underline;
    text-underline-offset: 4px;
}
</style>
