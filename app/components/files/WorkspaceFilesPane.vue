<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { liveQuery } from 'dexie';
import AppModal from '~/components/ui/AppModal.vue';
import WorkspaceFilePreview from './WorkspaceFilePreview.vue';
import PaletteImageThumb from '~/components/search/PaletteImageThumb.vue';
import { getActiveWorkspaceId, subscribeActiveWorkspaceDb } from '~/db/client';
import type { Post, Project, FileMeta } from '~/db/schema';
import { captureWorkspaceOperation, type WorkspaceOperationScope } from '~/utils/chat/workspace-access';
import { workspaceRevision } from '~/utils/chat/workspace-items';
import { FILE_CATALOG_POST_TYPE, isVisibleWorkspaceItem, workspaceItemMetadata } from '~~/shared/posts/workspace-item';
import { createRuntimeUuid } from '~~/shared/runtime-id';
import { parseFileHashes } from '~/db/files-util';
import { tiptapToPlainText } from '~/core/search/command-palette/normalize';
import { normalizeProjectData } from '~/utils/projects/normalizeProjectData';
import { isSupportedRasterMimeType } from '~~/shared/files/file-kind';
import { useSessionContext } from '~/composables/auth/useSessionContext';
import { useWorkspaceFileActions } from '~/composables/files/useWorkspaceFileActions';
import type { WorkspaceFileAction } from '~/composables/files/useWorkspaceFileActions';

const pageElement = ref<HTMLElement | null>(null);
const widePreview = ref(false);
const previewHeading = ref<HTMLElement | null>(null);
let resizeObserver: ResizeObserver | undefined;
let previewTrigger: HTMLElement | null = null;
const closeIcon = useIcon('ui.close');
const menuUi = {
    content: 'min-w-[220px]',
    item: 'min-h-9! gap-3! px-3! py-2! items-center! justify-start! max-md:min-h-11!',
    itemLeadingIcon: 'size-5! shrink-0! self-center!',
    itemWrapper: 'min-w-0 flex-1 text-left',
    itemLabel: 'text-sm! leading-5! tracking-normal!',
};
const pluginFileActions = useWorkspaceFileActions();
async function closePreview() {
    preview.value = false;
    await nextTick();
    if (previewTrigger?.isConnected) previewTrigger.focus();
}
const props = defineProps<{ recordId?: string | null }>();
const rows = ref<Post[]>([]);
const fileDetails = ref<Record<string, FileMeta>>({});
const syncStatuses = ref<Record<string, string>>({});
const cloudEnabled = useRuntimeConfig().public.ssrAuthEnabled === true;
const icons = {
    upload: useIcon('ui.upload'), document: useIcon('sidebar.note'), folder: useIcon('sidebar.folder'),
    search: useIcon('ui.search'), more: useIcon('ui.more'), trash: useIcon('ui.trash'),
    file: useIcon('external-agent.file'), text: useIcon('external-agent.file.text'),
    pdf: useIcon('external-agent.file.pdf'), download: useIcon('ui.download'),
    chat: useIcon('sidebar.chat'), edit: useIcon('ui.edit'),
};
const query = ref('');
const trash = ref(false);
const limit = ref(50);
const more = ref(false);
const loading = ref(true);
const busy = ref(false);
const error = ref('');
const feedback = ref('');
const selected = ref<Post | null>(null);
const actionTarget = ref<Post | null>(null);
const preview = ref(false);
const previewText = ref('');
const previewImageUrl = ref('');
let previewGeneration = 0;
function releasePreviewImage() {
    previewGeneration++;
    if (previewImageUrl.value) URL.revokeObjectURL(previewImageUrl.value);
    previewImageUrl.value = '';
}
const rename = ref(false);
const newTitle = ref('');
const uploadInput = ref<HTMLInputElement | null>(null);
const failures = ref<Array<{ file: File; error: string }>>([]);
const readOnly = ref(false);
const typeFilter = ref('all');
const projectFilter = ref('all');
const projects = ref<Project[]>([]);
const existingCursor = ref('');
const existingComplete = ref(false);
const associate = ref(false);
const remove = ref(false);
const associationProject = ref('');
let scope: WorkspaceOperationScope | null = null;
let stop: (() => void) | undefined;
let subscription: { unsubscribe(): void } | undefined;
let statusSubscription: { unsubscribe(): void } | undefined;
let previewSubscription: { unsubscribe(): void } | undefined;
let resultTimer: ReturnType<typeof setTimeout> | undefined;
let generation = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let disposed = false;
const { data: sessionData } = useSessionContext();
function clearPreview() {
    preview.value = false; selected.value = null; previewText.value = '';
    releasePreviewImage();
}
const filtered = computed(() => rows.value);
const rowProjects = computed(() => {
    const labels = new Map<string, string[]>();
    for (const project of projects.value) {
        for (const entry of normalizeProjectData(project.data)) {
            if (entry.kind !== 'doc' && entry.kind !== 'file') continue;
            const key = entry.kind + ':' + entry.id;
            const names = labels.get(key) ?? [];
            names.push(project.name); labels.set(key, names);
        }
    }
    return labels;
});
function projectNames(row: Post) {
    return rowProjects.value.get((row.postType === 'doc' ? 'doc' : 'file') + ':' + row.id) ?? [];
}
function detail(row: Post) { return fileDetails.value[parseFileHashes(row.file_hashes)[0] ?? '']; }
function fileType(row: Post) {
    if (row.postType === 'doc') return 'Document';
    const mime = detail(row)?.mime_type ?? '';
    if (mime === 'application/pdf') return 'PDF';
    if (mime.startsWith('image/')) return 'Image';
    if (mime === 'text/csv') return 'Spreadsheet';
    if (mime.startsWith('text/')) return 'Text';
    return 'File';
}
function fileIcon(row: Post) {
    const type = fileType(row);
    return type === 'Document' ? icons.document.value : type === 'PDF' ? icons.pdf.value : type === 'Text' ? icons.text.value : icons.file.value;
}
function formatSize(row: Post) {
    const bytes = detail(row)?.size_bytes;
    if (bytes == null) return '—';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
function modifiedDate(row: Post) {
    // Dexie timestamps use Unix seconds.
    const date = new Date(row.updated_at * 1000);
    if (Number.isNaN(date.getTime())) return '—';
    const today = new Date();
    return date.toDateString() === today.toDateString()
        ? 'Today, ' + date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        : date.toLocaleDateString([], { month: 'short', day: 'numeric', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}
function textCoverage(row: Post) {
    if (row.postType === 'doc') return 'Document text is searchable';
    const coverage = workspaceItemMetadata(row.meta)?.text?.coverage;
    return coverage === 'full' ? 'Text searchable' : coverage === 'prefix' ? 'Text prefix searchable' : 'Filename searchable';
}
function rowActions(row: Post) {
    const kind = row.postType === 'doc' ? 'document' : 'file';
    const extensions = pluginFileActions.value.filter(action => !action.kinds || action.kinds.includes(kind)).map(action => ({
        label: action.label, icon: action.icon ?? 'i-lucide-puzzle', disabled: busy.value || (action.requiresWrite && readOnly.value),
        onSelect: () => { void runPluginFileAction(action, row); },
    }));
    return [
        [
            ...(row.postType === 'doc' ? [{ label: 'Open document', icon: icons.document.value, onSelect: () => openEditor(row) }] : []),
            { label: 'Ask in chat', icon: icons.chat.value, onSelect: () => askInChat(row) },
            { label: 'Download', icon: icons.download.value, onSelect: () => { void download(row); } },
            { label: 'Add to project', icon: icons.folder.value, disabled: busy.value || readOnly.value,
                onSelect: () => { actionTarget.value = row; associationProject.value = ''; associate.value = true; } },
        ],
        [
            { label: 'Rename', icon: icons.edit.value, disabled: busy.value || readOnly.value,
                onSelect: () => { actionTarget.value = row; newTitle.value = row.title; rename.value = true; } },
            ...(row.postType === FILE_CATALOG_POST_TYPE ? [
                ...(workspaceItemMetadata(row.meta)?.text?.coverage !== 'full' ? [{ label: 'Enable text search', icon: icons.search.value,
                    disabled: busy.value || readOnly.value, onSelect: () => enableText(row) }] : []),
            ] : []),
        ],
        ...(extensions.length ? [extensions] : []),
        [{ label: 'Move to trash', icon: icons.trash.value, color: 'error' as const, disabled: busy.value || readOnly.value,
            onSelect: () => change(row, { trashed: true }) }],
    ];
}

async function runPluginFileAction(action: WorkspaceFileAction, row: Post) {
    busy.value = true; error.value = '';
    try {
        const origin = scope ?? capture();
        const { workspaceFileSnapshot } = await import('~/db/workspace-files');
        await action.run(await workspaceFileSnapshot(origin, row));
    } catch (failure) { error.value = failure instanceof Error ? failure.message : 'File action failed.'; }
    finally { busy.value = false; }
}

function capture() {
    return captureWorkspaceOperation({ subject: null, workspaceId: getActiveWorkspaceId() ?? 'local',
        threadId: 'workspace-files', messageId: null, requestId: createRuntimeUuid(), callId: createRuntimeUuid(),
        abortSignal: new AbortController().signal });
}

function documentPreview(content: string): string {
    // Parsing valid native JSON first preserves an empty document as empty text.
    try { return tiptapToPlainText(JSON.parse(content)); }
    catch { return tiptapToPlainText(content); }
}
async function refresh() {
    const current = ++generation;
    subscription?.unsubscribe(); clearTimeout(resultTimer);
    loading.value = true;
    try {
        if (!scope) scope = capture();
        const origin = scope;
        origin.assertCurrent(); readOnly.value = !origin.writable;
        const term = query.value.trim(); const inTrash = trash.value;
        const type = typeFilter.value; const projectId = projectFilter.value; const pageSize = limit.value;
        const searchProject = projectId === 'all' ? undefined : await origin.db.projects.get(projectId);
        const searchMembers = searchProject && !searchProject.deleted ? new Set(normalizeProjectData(searchProject.data)
            .filter(item => item.kind === 'doc' || item.kind === 'file').map(item => item.id)) : null;
        const searchMembership = searchMembers ? [...searchMembers].sort().join('\n') : '';
        let ids: Set<string> | null = null;
        if (term && !inTrash) {
            const { useCommandPalette } = await import('~/composables/search/useCommandPalette');
            const palette = useCommandPalette();
            if (!palette.getCoordinator()) await palette.warm();
            origin.assertCurrent();
            const result = await palette.getCoordinator()?.searchOnce({ term, sourceIds: ['document', 'file'], limit: 200,
                accepts: resource => (type === 'all' || resource.sourceId === (type === 'image' ? 'file' : type))
                    && (!searchMembers || searchMembers.has(resource.recordId)) });
            if (!result) throw new Error('Search is unavailable. Try again.');
            ids = new Set(result.results.map(hit => hit.recordId));
        }
        if (disposed || current !== generation) return;
        // Observe the bounded result itself. Changes to unrelated transfers or
        // file metadata cannot trigger a full catalog refresh.
        subscription = liveQuery(async () => {
            origin.assertCurrent();
            const currentProjects = await origin.db.projects.filter(project => !project.deleted).limit(200).toArray();
            const project = projectId === 'all' ? undefined : await origin.db.projects.get(projectId);
            const missingProject = projectId !== 'all' && (!project || project.deleted);
            const members = project && !project.deleted ? new Set(normalizeProjectData(project.data)
                .filter(item => item.kind === 'doc' || item.kind === 'file').map(item => item.id)) : null;
            const collection = origin.db.posts.orderBy('updated_at').reverse().filter(row =>
                ['doc', FILE_CATALOG_POST_TYPE].includes(row.postType) && !row.deleted
                && (inTrash ? workspaceItemMetadata(row.meta)?.trashed_at != null : isVisibleWorkspaceItem(row))
                && (!ids || ids.has(row.id)) && (!members || members.has(row.id))
                && (type === 'all' || row.postType === (type === 'file' || type === 'image' ? FILE_CATALOG_POST_TYPE : 'doc'))
                && (!inTrash || !term || row.title.toLowerCase().includes(term.toLowerCase())));
            const candidates: Post[] = []; const metadata = new Map<string, FileMeta>();
            let offset = 0;
            while (candidates.length <= pageSize) {
                const count = pageSize + 1 - candidates.length;
                const batch = await collection.clone().offset(offset).limit(count).toArray();
                const hashes = [...new Set(batch.flatMap(row => parseFileHashes(row.file_hashes).slice(0, 1)))];
                const details = hashes.length ? await origin.db.file_meta.bulkGet(hashes) : [];
                for (const meta of details) if (meta && !meta.deleted) metadata.set(meta.hash, meta);
                for (const row of batch) {
                    const meta = metadata.get(parseFileHashes(row.file_hashes)[0]!);
                    if (type === 'image' ? meta?.mime_type.startsWith('image/') : row.postType === 'doc' || meta) candidates.push(row);
                }
                offset += batch.length;
                if (batch.length < count) break;
            }
            origin.assertCurrent();
            return { projects: currentProjects, missingProject,
                searchChanged: Boolean(term && !inTrash && !missingProject
                    && (members ? [...members].sort().join('\n') : '') !== searchMembership), rows: candidates.slice(0, pageSize),
                metadata: Object.fromEntries(metadata), more: candidates.length > pageSize };
        }).subscribe({ next: snapshot => {
            clearTimeout(resultTimer);
            resultTimer = setTimeout(() => {
                if (disposed || current !== generation || origin !== scope) return;
                if (snapshot.searchChanged) { void refresh(); return; }
                projects.value = snapshot.projects; rows.value = snapshot.rows;
                fileDetails.value = snapshot.metadata; more.value = snapshot.more;
                error.value = ''; loading.value = false;
                if (snapshot.missingProject) projectFilter.value = 'all';
            }, 40);
        }, error: caught => {
            if (disposed || current !== generation || origin !== scope) return;
            error.value = caught instanceof Error ? caught.message : 'Files are unavailable.';
            loading.value = false;
        } });
    } catch (caught) {
        if (disposed || current !== generation) return;
        rows.value = []; fileDetails.value = {}; syncStatuses.value = {}; clearPreview();
        error.value = caught instanceof Error ? caught.message : 'Files are unavailable.';
        loading.value = false;
    }
}

function bindVisibleStatus() {
    statusSubscription?.unsubscribe(); statusSubscription = undefined;
    const origin = scope; const displayed = rows.value;
    if (!origin || !cloudEnabled || !displayed.length) { syncStatuses.value = {}; return; }
    const hashes = [...new Set(displayed.flatMap(row => parseFileHashes(row.file_hashes).slice(0, 1)))];
    const keys = [...displayed.map(row => ['posts', row.id]), ...hashes.map(hash => ['file_meta', hash])];
    statusSubscription = liveQuery(async () => {
        const pending = (await origin.db.pending_ops.where('[tableName+pk]').anyOf(keys).toArray())
            .filter(op => op.status !== 'applied' && op.status !== 'discarded');
        const transfers = hashes.length ? await origin.db.file_transfers.where('[hash+direction]').anyOf(hashes.map(hash => [hash, 'upload'])).toArray() : [];
        const metadata = hashes.length ? await origin.db.file_meta.bulkGet(hashes) : [];
        return Object.fromEntries(displayed.map(row => {
            const hash = parseFileHashes(row.file_hashes)[0];
            const ops = pending.filter(op => op.pk === row.id || op.pk === hash);
            const transfer = transfers.filter(item => item.hash === hash).sort((a, b) => b.updated_at - a.updated_at)[0];
            const state = ops.some(op => ['failed', 'failed_retryable', 'failed_permanent'].includes(op.status)) ? 'Sync needs attention'
                : transfer?.state === 'failed' ? 'Upload needs attention' : transfer?.state === 'running' ? 'Uploading'
                : ops.length || (transfer && transfer.state !== 'done') ? 'Saved locally · Waiting to sync'
                : hash && !metadata.find(meta => meta?.hash === hash)?.storage_id ? 'Saved locally' : 'Synced';
            return [row.id, state];
        }));
    }).subscribe({ next: statuses => { if (!disposed && origin === scope) syncStatuses.value = statuses; },
        error: () => { if (!disposed && origin === scope) syncStatuses.value = {}; } });
}
watch(rows, bindVisibleStatus);
watch(() => preview.value ? selected.value?.id : null, id => {
    previewSubscription?.unsubscribe(); previewSubscription = undefined;
    const origin = scope;
    if (!id || !origin) return;
    previewSubscription = liveQuery(async () => {
        const row = await origin.db.posts.get(id);
        const hash = row?.postType === FILE_CATALOG_POST_TYPE ? parseFileHashes(row.file_hashes)[0] : undefined;
        const meta = hash ? await origin.db.file_meta.get(hash) : undefined;
        return row && isVisibleWorkspaceItem(row) && (row.postType === 'doc' || (meta && !meta.deleted)) ? row : null;
    }).subscribe({ next: row => {
        if (disposed || origin !== scope || selected.value?.id !== id) return;
        if (!row) { clearPreview(); return; }
        selected.value = row; previewText.value = row.postType === 'doc' ? documentPreview(row.content) : row.content;
    }, error: () => { if (!disposed && origin === scope) clearPreview(); } });
});

async function run(action: (origin: WorkspaceOperationScope) => Promise<void>) {
    if (busy.value) return;
    busy.value = true; error.value = '';
    try {
        const origin = scope ?? capture();
        origin.assertCurrent('write');
        await action(origin);
        origin.assertCurrent();
        await refresh();
    } catch (caught) { error.value = caught instanceof Error ? caught.message : 'This operation failed. Try again.'; }
    finally { busy.value = false; }
}

async function intake(files: File[], retry = false) {
    await run(async origin => {
        const { importWorkspaceFile } = await import('~/db/workspace-files');
        failures.value = retry ? failures.value.filter(failure => !files.includes(failure.file)) : [];
        let saved = 0;
        for (const file of files) {
            origin.assertCurrent('write');
            try {
                const result = await importWorkspaceFile(origin, file, file.name);
                saved++;
                feedback.value = result.restored ? 'Existing file restored locally' : result.duplicate ? 'File already exists' : 'File saved locally';
            } catch (caught) {
                origin.assertCurrent('write');
                failures.value.push({ file, error: caught instanceof Error ? caught.message : 'Upload failed' });
            }
        }
        if (files.length > 1) feedback.value = `${saved} saved locally · ${failures.value.length} failed`;
    });
}
async function upload(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    await intake(files);
}
async function change(row: Post, changes: { title?: string; trashed?: boolean }) {
    await run(async origin => {
        const { updateWorkspaceFile } = await import('~/db/workspace-files');
        await updateWorkspaceFile(origin, row.id, await workspaceRevision(row), changes);
        rename.value = false;
    });
}
async function open(row: Post) {
    previewTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    error.value = '';
    releasePreviewImage();
    const request = previewGeneration;
    try {
        const origin = scope ?? capture();
        const { readWorkspaceItem } = await import('~/utils/chat/workspace-items');
        const current = await readWorkspaceItem(origin, { kind: row.postType === 'doc' ? 'document' : 'file', id: row.id });
        origin.assertCurrent();
        if (request !== previewGeneration) return;
        selected.value = current.row as Post; previewText.value = row.postType === 'doc' ? documentPreview(selected.value.content) : current.content; preview.value = true;
        await nextTick();
        previewHeading.value?.focus();
        const hash = parseFileHashes(selected.value.file_hashes)[0];
        const meta = hash ? await origin.db.file_meta.get(hash) : undefined;
        origin.assertCurrent();
        if (row.postType === FILE_CATALOG_POST_TYPE && meta?.kind === 'image' && isSupportedRasterMimeType(meta.mime_type)) {
            const { getFileBlob } = await import('~/db/files');
            const blob = await getFileBlob(meta.hash, origin.db);
            origin.assertCurrent();
            await readWorkspaceItem(origin, { kind: 'file', id: row.id });
            origin.assertCurrent();
            if (blob && request === previewGeneration && preview.value && selected.value?.id === row.id) previewImageUrl.value = URL.createObjectURL(blob);
        }
    } catch (caught) {
        if (request === previewGeneration) error.value = caught instanceof Error ? caught.message : 'This item is unavailable.';
    }
}
async function openEditor(row: Post) {
    error.value = '';
    try {
        const origin = scope ?? capture();
        const revision = await workspaceRevision(row);
        origin.assertCurrent();
        const { openWorkspaceSource } = await import('~/utils/chat/workspace-source-receipts');
        origin.assertCurrent();
        await openWorkspaceSource({ workspaceId: origin.workspaceId, source: { kind: 'document', id: row.id, title: row.title, revision }, partial: false });
        preview.value = false;
    } catch (caught) { error.value = caught instanceof Error ? caught.message : 'This document is unavailable.'; }
}
async function download(row = selected.value) {
    error.value = '';
    try {
        const origin = scope ?? capture();
        if (!row) return;
        if (row.postType === 'doc') {
            const { settleWorkspaceDocumentEditors } = await import('~/composables/documents/useDocumentEditorSessions');
            origin.assertCurrent();
            await settleWorkspaceDocumentEditors(row.id, origin.db);
            origin.assertCurrent();
        }
        const current = await origin.db.posts.get(row.id);
        origin.assertCurrent();
        if (!current || !isVisibleWorkspaceItem(current)) throw new Error('This file is unavailable.');
        if (current.postType === 'doc') {
            const { documentToMarkdown } = await import('~/utils/documents/document-to-markdown');
            const markdown = await documentToMarkdown(JSON.parse(current.content));
            const latest = await origin.db.posts.get(row.id);
            origin.assertCurrent();
            if (!latest || !isVisibleWorkspaceItem(latest) || JSON.stringify(latest) !== JSON.stringify(current)) {
                throw new Error('This document changed. Download it again.');
            }
            saveDownload(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }), `${current.title}.md`);
            return;
        }
        const hash = parseFileHashes(current.file_hashes)[0];
        if (!hash) throw new Error('This file has no original bytes.');
        const { getFileBlob } = await import('~/db/files');
        const blob = await getFileBlob(hash, origin.db);
        origin.assertCurrent();
        if (!blob) throw new Error('Original file unavailable offline. Connect and retry.');
        const latest = await origin.db.posts.get(row.id);
        const metadata = await origin.db.file_meta.get(hash);
        origin.assertCurrent();
        if (!latest || !isVisibleWorkspaceItem(latest) || JSON.stringify(latest) !== JSON.stringify(current)
            || !metadata || metadata.deleted) throw new Error('This file changed. Open it again before downloading.');
        saveDownload(blob, current.title);
    } catch (caught) { error.value = caught instanceof Error ? caught.message : 'Download failed.'; }
}
function saveDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function askInChat(row: Post) {
    error.value = '';
    try {
        const origin = scope ?? capture();
        const { readWorkspaceItem } = await import('~/utils/chat/workspace-items');
        await readWorkspaceItem(origin, { kind: row.postType === 'doc' ? 'document' : 'file', id: row.id });
        origin.assertCurrent();
        const { getGlobalMultiPaneApi } = await import('~/utils/multiPaneApi');
        const { getPaletteHostContext } = await import('~/composables/search/useCommandPalette');
        const { programmaticInsertReference, programmaticAttachFile, waitForPaneInput } = await import('~/composables/chat/useChatInputBridge');
        const hash = parseFileHashes(row.file_hashes)[0];
        const meta = hash ? await origin.db.file_meta.get(hash) : undefined;
        origin.assertCurrent();
        let attachment: File | undefined;
        if (row.postType === FILE_CATALOG_POST_TYPE && meta && ['image', 'pdf'].includes(meta.kind)) {
            const { getFileBlob } = await import('~/db/files');
            const blob = await getFileBlob(meta.hash, origin.db);
            origin.assertCurrent();
            if (!blob) throw new Error('Original file unavailable offline. Connect and retry.');
            attachment = new File([blob], meta.name, { type: meta.mime_type });
        }
        const api = getGlobalMultiPaneApi();
        const host = getPaletteHostContext();
        if (!api || !host) throw new Error('Chat navigation is unavailable.');
        const chatIndex = api.panes.value.findIndex(pane => pane.mode === 'chat');
        if (chatIndex >= 0) api.setActive(chatIndex);
        else {
            const { getOpenWorkspaceTabs } = await import('~/core/search/command-palette/sources/workspace-tab-source');
            const previousChat = getOpenWorkspaceTabs().filter(tab => tab.resource.kind === 'chat').sort((a, b) => b.lastActivatedAt - a.lastActivatedAt)[0];
            const opened = previousChat && host.openWorkspaceTab ? await host.openWorkspaceTab(previousChat.id) : await host.openChat(previousChat?.resource.kind === 'chat' ? previousChat.resource.threadId : null, 'active');
            if (!opened.ok) throw new Error(opened.error.message);
        }
        await nextTick();
        origin.assertCurrent();
        const paneId = api.activePaneId.value;
        const targetThread = paneId ? api.getPaneById(paneId)?.threadId : undefined;
        if (!paneId || !await waitForPaneInput(paneId, origin.signal)) throw new Error('The chat composer is unavailable.');
        origin.assertCurrent();
        if (api.activePaneId.value !== paneId || api.getPaneById(paneId)?.threadId !== targetThread || api.getPaneById(paneId)?.mode !== 'chat') throw new Error('The target chat changed. Retry from Files.');
        const current = await readWorkspaceItem(origin, { kind: row.postType === 'doc' ? 'document' : 'file', id: row.id });
        origin.assertCurrent();
        const result = !paneId ? { status: 'unavailable' } : attachment ? await programmaticAttachFile(paneId, attachment)
            : programmaticInsertReference(paneId, { id: row.id, source: row.postType === 'doc' ? 'document' : 'file', label: current.source.title });
        origin.assertCurrent();
        if (result.status !== 'ready') {
            throw new Error('This chat cannot accept references. Enable mentions and retry.');
        }
        preview.value = false;
    } catch (caught) { error.value = caught instanceof Error ? caught.message : 'Chat handoff failed.'; }
}
async function addExisting() {
    await run(async origin => {
        const { catalogWorkspaceFile } = await import('~/db/workspace-files');
        const candidates = await origin.db.file_meta.where('hash').above(existingCursor.value).filter(meta => !meta.deleted).limit(51).toArray();
        origin.assertCurrent('write');
        let imported = 0;
        for (const meta of candidates.slice(0, 50)) {
            await catalogWorkspaceFile(origin, meta.hash);
            origin.assertCurrent('write');
            existingCursor.value = meta.hash;
            imported++;
            feedback.value = `${imported} existing uploads processed · Importing this page…`;
        }
        existingComplete.value = candidates.length <= 50;
        feedback.value = `${imported} existing uploads processed${existingComplete.value ? ' · Import complete' : ' · More available; continue importing'}`;
    });
}
async function enableText(row: Post) {
    await run(async origin => {
        const { enableWorkspaceFileText } = await import('~/db/workspace-files');
        const updated = await enableWorkspaceFileText(origin, row.id, await workspaceRevision(row));
        feedback.value = workspaceItemMetadata(updated.meta)?.text?.coverage === 'none' ? 'File saved; this format cannot be text searched.' : 'Text search enabled locally';
    });
}
async function removeCatalog() {
    await run(async origin => {
        const row = actionTarget.value;
        if (!row) throw new Error('Choose a catalog entry.');
        const { removeWorkspaceFile } = await import('~/db/workspace-files');
        await removeWorkspaceFile(origin, row.id, await workspaceRevision(row));
        remove.value = false; actionTarget.value = null;
        feedback.value = 'Catalog entry removed. Shared original bytes are retained.';
    });
}
async function associateItem(remove = false) {
    await run(async origin => {
        const row = actionTarget.value;
        const project = await origin.db.projects.get(associationProject.value);
        origin.assertCurrent('write');
        if (!row || !project || project.deleted) throw new Error('Choose an existing project.');
        const { updateWorkspaceProject } = await import('~/utils/chat/workspace-projects');
        await updateWorkspaceProject({ operation: remove ? 'remove_item' : 'add_item', projectId: project.id,
            revision: await workspaceRevision(project), item: { kind: row.postType === 'doc' ? 'document' : 'file', id: row.id } },
        { subject: origin.subject, workspaceId: origin.workspaceId, threadId: 'workspace-files', messageId: null,
            requestId: createRuntimeUuid(), callId: createRuntimeUuid(), abortSignal: origin.signal });
        origin.assertCurrent(); associate.value = false;
    });
}
async function newDocument() {
    await run(async origin => {
        const { prepareDocumentCreate } = await import('~/db/documents');
        const { getWriteTxTableNames } = await import('~/db/util');
        const prepared = await prepareDocumentCreate({ title: 'Untitled document', content: { type: 'doc', content: [{ type: 'paragraph' }] } });
        origin.assertCurrent('write');
        await origin.db.transaction('rw', getWriteTxTableNames(origin.db, 'posts'), async () => {
            origin.assertCurrent('write');
            await origin.db.posts.add(prepared.row);
            origin.assertCurrent('write');
        });
        try { await prepared.afterCommit(); } catch (caught) { console.warn('Document saved; notification failed.', caught); }
        origin.assertCurrent();
        const row = await origin.db.posts.get(prepared.row.id);
        origin.assertCurrent();
        if (row) await openEditor(row);
    });
}

watch([query, trash, typeFilter, projectFilter], () => { limit.value = 50; clearTimeout(timer); timer = setTimeout(() => void refresh(), 120); });
watch(preview, open => { if (!open) releasePreviewImage(); });
watch(() => props.recordId, async id => {
    if (!id || !scope) return;
    const origin = scope;
    try {
        const row = await origin.db.posts.get(id);
        origin.assertCurrent();
        if (!disposed && origin === scope && row && isVisibleWorkspaceItem(row)) await open(row);
    } catch (caught) {
        if (!disposed && origin === scope) { clearPreview(); error.value = caught instanceof Error ? caught.message : 'This file is unavailable.'; }
    }
});
function resetScope() {
    if (disposed) return;
    generation++; scope = null; rows.value = []; fileDetails.value = {}; syncStatuses.value = {}; clearPreview(); rename.value = false;
    associate.value = false; remove.value = false; existingCursor.value = ''; existingComplete.value = false;
    failures.value = []; projects.value = []; readOnly.value = true; projectFilter.value = 'all'; actionTarget.value = null;
    statusSubscription?.unsubscribe(); previewSubscription?.unsubscribe(); clearTimeout(resultTimer);
    subscription?.unsubscribe(); subscription = undefined; void initialize();
}
watch(() => [sessionData.value?.session?.user?.id, sessionData.value?.session?.role,
    sessionData.value?.session?.authorizationRevision, sessionData.value?.session?.authenticated], resetScope);
onMounted(async () => {
    if (pageElement.value) {
        // Match DocumentEditorRoot.css: full-pane inspector below 720px.
        resizeObserver = new ResizeObserver(entries => { widePreview.value = (entries[0]?.contentRect.width ?? 0) >= 720; });
        resizeObserver.observe(pageElement.value);
    }
    stop = subscribeActiveWorkspaceDb(resetScope);
    await initialize();
});
async function initialize() {
    let origin: WorkspaceOperationScope | null = null;
    try {
        scope = capture(); readOnly.value = !scope.writable;
        origin = scope;
        if (origin.writable) await catalogExistingImages(origin);
        origin.assertCurrent();
        if (disposed || origin !== scope) return;
        await refresh();
        if (disposed || origin !== scope) return;
        if (props.recordId) {
            const row = await origin.db.posts.get(props.recordId);
            origin.assertCurrent();
            if (row && isVisibleWorkspaceItem(row)) await open(row);
        }
    } catch (caught) {
        if (disposed || origin !== scope) return;
        clearPreview(); error.value = caught instanceof Error ? caught.message : 'Files are unavailable.'; loading.value = false;
    }
}
async function catalogExistingImages(origin: WorkspaceOperationScope) {
    const { catalogWorkspaceFile, workspaceFileId } = await import('~/db/workspace-files');
    let cursor = '';
    while (!disposed && origin === scope) {
        origin.assertCurrent('write');
        const batch = await origin.db.file_meta.where('hash').above(cursor).limit(50).toArray();
        origin.assertCurrent('write');
        for (const meta of batch) {
            if (!meta.deleted && meta.mime_type.startsWith('image/')) {
                const existing = await origin.db.posts.get(workspaceFileId(meta.hash));
                origin.assertCurrent('write');
                if (!existing) await catalogWorkspaceFile(origin, meta.hash);
            }
        }
        if (batch.length < 50) return;
        cursor = batch[batch.length - 1]!.hash;
    }
}
onBeforeUnmount(() => { resizeObserver?.disconnect(); disposed = true; generation++; releasePreviewImage(); clearTimeout(timer); stop?.(); subscription?.unsubscribe(); statusSubscription?.unsubscribe(); previewSubscription?.unsubscribe(); clearTimeout(resultTimer); });
</script>

<template>
    <section ref="pageElement" aria-label="Workspace Files" class="files-page" :data-preview="preview && widePreview" :data-compact-preview="preview && !widePreview">
        <div v-show="!preview || widePreview" class="files-content">
            <header class="files-header">
                <div>
                    <h1>{{ trash ? 'Trash' : 'Files' }}</h1>
                    <p>{{ trash ? 'Restore files you want to keep.' : 'Your documents and uploads, all in one place.' }}</p>
                </div>
                <div class="files-header-actions">
                    <UButton size="workspace" label="New document" :icon="icons.document.value" color="neutral" variant="outline" :disabled="busy || readOnly" @click="newDocument" />
                    <UButton size="workspace" label="Upload" :icon="icons.upload.value" :disabled="busy || readOnly" @click="uploadInput?.click()" />
                    <UDropdownMenu :ui="menuUi" :content="{ align: 'end', sideOffset: 6 }" :items="[
                        { label: trash ? 'Show active files' : 'Show Trash', icon: icons.trash.value, onSelect: () => { trash = !trash; } },
                        { label: 'Add existing uploads', icon: icons.upload.value, disabled: busy || readOnly || existingComplete, onSelect: addExisting },
                    ]">
                        <UButton size="workspace" :icon="icons.more.value" aria-label="Files options" color="neutral" variant="ghost" square />
                    </UDropdownMenu>
                </div>
            </header>
            <input ref="uploadInput" type="file" multiple aria-label="Upload files" class="sr-only" :disabled="busy || readOnly" @change="upload">
            <div class="files-toolbar">
                <UInput v-model="query" aria-label="Search Files" placeholder="Search files or their contents…" :icon="icons.search.value" class="files-search" size="workspace" />
                <USelect v-model="typeFilter" aria-label="File type" size="workspace" :items="[{ label: 'All types', value: 'all' }, { label: 'Documents', value: 'document' }, { label: 'Uploads', value: 'file' }, { label: 'Images', value: 'image' }]" />
                <USelect v-model="projectFilter" aria-label="Filter by project" size="workspace" :ui="{ content: 'min-w-[240px] max-w-[calc(100vw-2rem)]' }" :items="[{ label: 'All projects', value: 'all' }, ...projects.map(project => ({ label: project.name, value: project.id }))]" />
            </div>
            <div v-if="readOnly || feedback || error" class="files-notices">
                <p v-if="readOnly" role="status">This workspace is read-only.</p>
                <p v-if="feedback" role="status">{{ feedback }}</p>
                <p v-if="error" role="alert">{{ error }} <UButton size="workspace" label="Retry" color="neutral" variant="ghost" @click="refresh" /></p>
            </div>
            <div class="files-list">
                <div class="files-columns" :data-trash="trash" aria-hidden="true">
                    <span class="files-name-label">Name</span><span class="files-type-column">Type</span><span class="files-project-column">Project</span><span class="files-date-column">Last modified</span><span class="files-size-column">Size</span><span />
                </div>
                <div v-if="loading && !filtered.length" class="files-empty" role="status">
                    <UIcon :name="icons.folder.value" class="size-9 opacity-50" /><p>Loading your files…</p>
                </div>
                <div v-else-if="!filtered.length && !error" class="files-empty">
                    <div class="files-empty-icon"><UIcon :name="query ? icons.search.value : trash ? icons.trash.value : icons.folder.value" class="size-8" /></div>
                    <h2>{{ query ? 'No matching files' : trash ? 'Trash is empty' : 'A home for your work' }}</h2>
                    <p>{{ query ? 'Try a different name or a few words from the file.' : trash ? 'Files you move to trash will appear here.' : 'Upload a file or create a document to get started.' }}</p>
                    <UButton v-if="!query && !trash" size="workspace" label="Upload your first file" :icon="icons.upload.value" :disabled="busy || readOnly" @click="uploadInput?.click()" />
                </div>
                <ul v-else aria-label="Files" class="files-rows">
                    <li v-for="row in filtered" :key="row.id" class="files-row" :data-trash="trash" :data-selected="preview && selected?.id === row.id">
                        <div class="files-name-cell">
                            <PaletteImageThumb v-if="row.postType === FILE_CATALOG_POST_TYPE && isSupportedRasterMimeType(detail(row)?.mime_type ?? '')" :key="`${scope?.workspaceId}:${row.id}`" :hash="parseFileHashes(row.file_hashes)[0]!" alt="" :fallback-icon="fileIcon(row)" :size-bytes="detail(row)?.size_bytes" class="size-8! rounded-[var(--md-border-radius-small)]!" />
                            <span v-else class="files-kind-icon" :data-kind="fileType(row)"><UIcon :name="fileIcon(row)" class="size-5" /></span>
                            <div class="files-name-text">
                                <UButton size="workspace" :label="row.title" :aria-label="'Open ' + row.title" color="neutral" variant="ghost" class="files-name-button" :ui="{ base: 'px-0! gap-0!' }" :title="row.title" @click="open(row)" />
                                <span class="files-mobile-detail">{{ fileType(row) }} · {{ modifiedDate(row) }}</span>
                            </div>
                        </div>
                        <span class="files-type-column"><span class="files-type-badge" :data-kind="fileType(row)">{{ fileType(row) }}</span></span>
                        <span class="files-project-column files-project" :title="projectNames(row).join(', ')">
                            <UIcon v-if="projectNames(row).length" :name="icons.folder.value" class="size-4 shrink-0" />
                            <span>{{ projectNames(row)[0] ?? '—' }}{{ projectNames(row).length > 1 ? ' +' + (projectNames(row).length - 1) : '' }}</span>
                        </span>
                        <span class="files-date-column files-muted">{{ modifiedDate(row) }}</span>
                        <span class="files-size-column files-muted">{{ formatSize(row) }}</span>
                        <div class="files-row-actions">
                            <template v-if="trash">
                                <UButton size="workspace" label="Restore" color="neutral" variant="ghost" :disabled="busy || readOnly" @click="change(row, { trashed: false })" />
                                <UDropdownMenu :ui="menuUi" :content="{ align: 'end', sideOffset: 6 }" :items="[{ label: 'Remove entry', color: 'error', disabled: busy || readOnly, onSelect: () => { actionTarget = row; remove = true; } }]">
                                    <UButton size="workspace" :icon="icons.more.value" :aria-label="'More actions for ' + row.title" color="neutral" variant="ghost" square />
                                </UDropdownMenu>
                            </template>
                            <UDropdownMenu v-else :ui="menuUi" :content="{ align: 'end', sideOffset: 6 }" :items="rowActions(row)">
                                <UButton size="workspace" :icon="icons.more.value" :aria-label="'More actions for ' + row.title" color="neutral" variant="ghost" square />
                            </UDropdownMenu>
                        </div>
                    </li>
                </ul>
                <footer v-if="filtered.length" class="files-footer">
                    <span>{{ filtered.length }} {{ filtered.length === 1 ? 'file' : 'files' }}{{ more ? ' shown' : '' }}</span>
                    <span class="files-sort-label">Recently modified</span>
                    <UButton v-if="more" size="workspace" label="Load more" color="neutral" variant="outline" :disabled="loading" @click="limit += 50; refresh()" />
                </footer>
            </div>
            <ul v-if="failures.length" aria-label="Failed uploads" class="files-notices">
                <li v-for="failure in failures" :key="failure.file.name">{{ failure.file.name }}: {{ failure.error }} <UButton size="workspace" label="Retry upload" :disabled="busy || readOnly" @click="intake([failure.file], true)" /></li>
            </ul>
        </div>
        <Transition name="files-inspector">
        <aside v-if="preview" aria-label="File preview" class="files-inspector" :class="{ 'files-inspector-compact': !widePreview }" @keydown.esc.stop="closePreview">
            <div class="files-inspector-header"><h2 ref="previewHeading" tabindex="-1">File preview</h2><UButton size="workspace" :icon="closeIcon" aria-label="Close" color="neutral" variant="ghost" square @click="closePreview" /></div>
            <div class="files-inspector-body">
            <WorkspaceFilePreview v-if="selected" :title="selected.title" :type="fileType(selected)" :size="formatSize(selected)" :icon="fileIcon(selected)" :coverage="textCoverage(selected)" :project="projectNames(selected).join(', ')" :text="previewText" :image-url="previewImageUrl" :partial="workspaceItemMetadata(selected.meta)?.text?.coverage !== 'full'" :disabled="trash" :document="selected.postType === 'doc'" :status="syncStatuses[selected.id]" @ask="askInChat(selected)" @download="download" @open="openEditor(selected)" />
            <p v-if="error" role="alert">{{ error }}</p>
            </div>
        </aside>
        </Transition>
        <AppModal v-model:open="rename" title="Rename item" close-label="Close">
            <UInput v-model="newTitle" aria-label="Item title" class="w-full" size="workspace" @keydown.enter="actionTarget && change(actionTarget, { title: newTitle })" />
            <p v-if="error" role="alert">{{ error }}</p>
            <template #footer><UButton size="workspace" label="Save title" :disabled="busy || readOnly" @click="actionTarget && change(actionTarget, { title: newTitle })" /></template>
        </AppModal>
        <AppModal v-model:open="associate" title="Add to project" close-label="Close">
            <USelect v-model="associationProject" aria-label="Project" class="w-full" size="workspace" :ui="{ content: 'min-w-[240px] max-w-[calc(100vw-2rem)]' }" :items="projects.map(project => ({ label: project.name, value: project.id }))" />
            <p v-if="error" role="alert">{{ error }}</p>
            <template #footer>
                <UButton size="workspace" label="Remove from project" color="neutral" variant="ghost" :disabled="busy || readOnly || !associationProject" @click="associateItem(true)" />
                <UButton size="workspace" label="Add to project" :disabled="busy || readOnly || !associationProject" @click="associateItem()" />
            </template>
        </AppModal>
        <AppModal v-model:open="remove" :title="actionTarget?.postType === 'doc' ? 'Remove document?' : 'Remove catalog entry?'" close-label="Cancel">
            <p>{{ actionTarget?.title }} will be removed from Files. Chat attachments and other retained references keep their original bytes.</p>
            <p v-if="error" role="alert">{{ error }}</p>
            <template #footer><UButton size="workspace" :label="actionTarget?.postType === 'doc' ? 'Remove document' : 'Remove catalog entry'" color="error" :disabled="busy || readOnly" @click="removeCatalog" /></template>
        </AppModal>
    </section>
</template>

<style scoped>
.files-page { container-type: inline-size; position: relative; display: flex; min-width: 0; color: var(--md-on-surface); background: var(--md-surface); height: 100%; min-height: 0; overflow: hidden; }
.files-content { flex: 1; min-width: 0; min-height: 0; overflow-y: auto; overscroll-behavior: contain; max-width: 1440px; margin: 0 auto; padding: 32px; }
.files-header { display: flex; align-items: center; justify-content: space-between; gap: 24px; margin-bottom: 24px; }
.files-header h1 { font-size: 30px; font-weight: 700; line-height: 1.2; letter-spacing: -0.035em; }
.files-header p { color: var(--md-on-surface-variant); font-size: 14px; margin-top: 8px; line-height: 1.5; }
.files-header-actions :deep(button) { gap: 8px; }
.files-header-actions :deep([data-slot="label"]) { letter-spacing: normal; }
.files-header-actions { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.files-toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 20px; }
.files-search { flex: 1; min-width: 180px; }
.files-list { box-shadow: var(--app-elevation-low, none); container-type: inline-size; border: var(--md-border-width,1px) solid var(--md-border-color,var(--md-outline-variant)); border-radius: var(--md-border-radius); overflow: hidden; }
.files-page[data-preview="true"] .files-header { align-items: flex-start; flex-direction: column; gap: 20px; }
.files-page[data-preview="true"] .files-content { width: 100%; padding: 28px; }
.files-page[data-compact-preview="true"] { overflow: hidden; }
.files-inspector { flex: 0 0 320px; width: 320px; min-width: 320px; display: flex; flex-direction: column; min-height: 0; height: 100%; overflow: hidden; border-left: var(--md-border-width-subtle, var(--md-border-width, 1px)) solid var(--md-border-color,var(--md-outline-variant)); background: var(--md-surface); box-shadow: -12px 0 36px rgb(0 0 0 / 4%); }
.files-inspector-compact { position: absolute; inset: 0; width: 100%; min-width: 0; border-left: 0; }
.files-inspector-enter-active, .files-inspector-leave-active { transition: flex-basis 240ms var(--app-motion-easing-standard, ease), min-width 240ms var(--app-motion-easing-standard, ease), width 240ms var(--app-motion-easing-standard, ease), opacity 180ms ease, transform 240ms var(--app-motion-easing-standard, ease); }
.files-inspector-enter-from, .files-inspector-leave-to { flex-basis: 0; min-width: 0; width: 0; opacity: 0; transform: translateX(1rem); }
.files-inspector-compact.files-inspector-enter-from, .files-inspector-compact.files-inspector-leave-to { width: 100%; transform: translateX(100%); }
@container (min-width: 720px) and (max-width: 1119px) {
    .files-inspector { flex-basis: 300px; width: 300px; min-width: 300px; }
    .files-inspector-enter-from, .files-inspector-leave-to { flex-basis: 0; width: 0; min-width: 0; }
}
.files-inspector-header { display: flex; flex-shrink: 0; align-items: center; justify-content: space-between; gap: 12px; padding: 20px 24px; background: var(--md-surface); }
.files-inspector-body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 0 24px 20px; }
.files-inspector-compact .files-inspector-header { padding: 20px; }
.files-inspector-compact .files-inspector-body { padding: 0 20px 20px; }
.files-inspector-header h2 { font-size: 13px; font-weight: 600; }
.files-columns, .files-row { display: grid; grid-template-columns: minmax(180px, 1fr) 110px minmax(100px, .5fr) 155px 80px 48px; gap: 16px; align-items: center; padding: 0 20px; }
.files-name-label { padding-left: 44px; }
.files-columns { min-height: 42px; font-size: 12px; font-weight: 500; color: var(--md-on-surface-variant); background: var(--md-surface-container-lowest,var(--md-surface-container-low,var(--md-surface-variant))); border-bottom: 1px solid var(--md-border-color,var(--md-outline-variant)); }
.files-rows { margin: 0; padding: 0; list-style: none; }
.files-row { min-height: 56px; border-bottom: 1px solid color-mix(in srgb, var(--md-border-color,var(--md-outline-variant)) 40%, var(--md-surface)); font-size: 13px; transition: background 120ms ease; }
.files-row:last-child { border-bottom: 0; }
.files-row:hover { background: var(--md-surface-hover); }
.files-row[data-selected="true"] { background: color-mix(in srgb, var(--md-primary) 8%, var(--md-surface)); }
.files-name-cell { display: flex; gap: 12px; align-items: center; min-width: 0; }
.files-name-text { min-width: 0; flex: 1; }
.files-name-text :deep(button.files-name-button) { padding-inline: 0 !important; }
.files-name-button { width: 100%; min-width: 0; padding-left: 0 !important; padding-right: 0 !important; justify-content: flex-start !important; font-size: 14px; font-weight: 500; background: transparent !important; }
.files-name-button :deep(span) { letter-spacing: normal; }
.files-kind-icon { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: var(--md-border-radius-small); flex-shrink: 0; color: var(--md-primary); background: color-mix(in srgb, var(--md-primary) 9%, var(--md-surface)); }
.files-kind-icon[data-kind="PDF"] { color: var(--md-error); background: color-mix(in srgb, var(--md-error) 8%, var(--md-surface)); }
.files-type-badge { display: inline-block; font-size: 12px; padding: 4px 8px; border-radius: var(--md-border-radius-small); background: var(--md-surface-container-lowest,var(--md-surface-container-low,var(--md-surface-variant))); color: var(--md-on-surface-variant); }
.files-type-badge[data-kind="Document"] { color: var(--md-primary); background: color-mix(in srgb, var(--md-primary) 8%, var(--md-surface)); }
.files-type-badge[data-kind="PDF"] { color: var(--md-error); background: color-mix(in srgb, var(--md-error) 8%, var(--md-surface)); }
.files-project { display: flex; align-items: center; gap: 8px; min-width: 0; color: var(--md-on-surface-variant); }
.files-project span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.files-muted, .files-footer { color: var(--md-on-surface-variant); }
.files-row-actions { display: flex; justify-content: flex-end; align-items: center; }
.files-row[data-trash="true"], .files-columns[data-trash="true"] { grid-template-columns: minmax(180px, 1fr) 110px minmax(100px, .5fr) 155px 80px 130px; }
.files-footer { display: flex; align-items: center; gap: 16px; padding: 16px 20px; border-top: 1px solid var(--md-border-color,var(--md-outline-variant)); font-size: 12px; }
.files-sort-label { margin-left: auto; }
.files-mobile-detail { display: none; color: var(--md-on-surface-variant); font-size: 12px; }
.files-empty { min-height: 320px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; text-align: center; padding: 32px; }
.files-empty h2 { font-size: 18px; font-weight: 600; letter-spacing: -.02em; }
.files-empty p { color: var(--md-on-surface-variant); font-size: 14px; max-width: 320px; line-height: 1.6; }
.files-empty-icon { width: 72px; height: 72px; display: grid; place-items: center; border-radius: var(--md-border-radius); background: var(--md-surface-container-lowest,var(--md-surface-container-low,var(--md-surface-variant))); color: var(--md-primary); }
.files-notices { margin: 12px 0; padding: 12px 16px; background: var(--md-surface-container-lowest,var(--md-surface-container-low,var(--md-surface-variant))); border-radius: var(--md-border-radius-small); font-size: 13px; }
@container (max-width: 1050px) {
    .files-size-column { display: none; }
    .files-columns, .files-row { grid-template-columns: minmax(150px, 1fr) 100px minmax(90px, .45fr) 140px 48px; gap: 12px; }
    .files-row[data-trash="true"], .files-columns[data-trash="true"] { grid-template-columns: minmax(150px, 1fr) 100px minmax(90px, .45fr) 140px 130px; }
}
@container (max-width: 800px) {
    .files-content { padding: 24px; }
    .files-header { align-items: flex-start; flex-direction: column; gap: 20px; margin-bottom: 24px; }
    .files-project-column { display: none; }
    .files-columns, .files-row { grid-template-columns: minmax(140px, 1fr) 100px 140px 48px; }
    .files-row[data-trash="true"], .files-columns[data-trash="true"] { grid-template-columns: minmax(140px, 1fr) 100px 140px 130px; }
}
@container (max-width: 600px) {
    .files-content { padding: 20px 16px; }
    .files-header h1 { font-size: 26px; }
    .files-toolbar { flex-wrap: wrap; gap: 8px; }
    .files-search { flex-basis: 100%; }
    .files-toolbar > :not(.files-search) { flex: 1; min-width: 0; }
    .files-columns { display: none; }
    .files-type-column, .files-date-column { display: none; }
    .files-row { grid-template-columns: minmax(0, 1fr) 44px; padding: 8px 12px; gap: 8px; }
    .files-row[data-trash="true"], .files-columns[data-trash="true"] { grid-template-columns: minmax(0, 1fr) 116px; }
    .files-mobile-detail { display: block; padding-bottom: 4px; }
    .files-name-button { min-height: 44px !important; padding-top: 2px !important; padding-bottom: 2px !important; }
    .files-header-actions { flex-wrap: wrap; gap: 8px; }
    .files-sort-label { display: none; }
    .files-empty { min-height: 260px; padding: 24px 16px; }
}
@media (pointer: coarse) { .files-page :deep(button), .files-page :deep(input), .files-page :deep([role=combobox]) { min-height: 44px !important; } }
@media (prefers-reduced-motion: reduce) { .files-row, .files-inspector-enter-active, .files-inspector-leave-active { transition: none; } }
</style>
