<script setup lang="ts">
import { downloadBlob } from '~/utils/download-blob';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { liveQuery } from 'dexie';
import { shallowRef } from 'vue';
import { useVirtualizer } from '@tanstack/vue-virtual';
import { useLocalStorage } from '@vueuse/core';
import ExplorerMoveDialog from './ExplorerMoveDialog.vue';
import { useExplorerAvailable } from '~/composables/explorer/explorer-availability';
import { useExplorerSelection } from '~/composables/explorer/useExplorerSelection';
import { useExplorerDrag } from '~/composables/explorer/useExplorerDrag';
import { useExplorerUndo } from '~/composables/explorer/useExplorerUndo';
import { useFilesExplorerReveal, useProjectExplorerReveal } from '~/composables/explorer/useExplorerReveal';
import { useProjectSidebar } from '~/composables/sidebar/useProjectSidebar';
import { listExplorerItems } from '~/db/explorer-items';
import { assertExplorerQueueCapacity } from '~/db/explorer-admission';
import {
    createExplorerFolder, importPreviewExplorerRecords, explorerRevision, moveExplorerRows, readExplorerOrganization,
    planExplorerFolderRemoval, removeExplorerFolder, renameExplorerFolder, type ExplorerMoveRow, type ExplorerRevision,
} from '~/db/explorer';
import { EXPLORER_MAX_WRITES, explorerItemKey, explorerPlacementId } from '~~/shared/explorer/records';
import type { ExplorerItemRef } from '~~/shared/explorer/records';
import { explorerRecoveryLabel, type ExplorerFolderRow } from '~~/shared/explorer/tree';
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
import { useLocalWorkspaceSession } from '~/composables/auth/useLocalWorkspaceSession';
import { useWorkspaceFileActions } from '~/composables/files/useWorkspaceFileActions';
import type { WorkspaceFileAction } from '~/composables/files/useWorkspaceFileActions';
import { reportError } from '~/utils/errors';
import { isCloudFileStorageEnabled, isCloudFileStorageConfigured } from '~/core/storage/file-policy';
import type { StoredAttachment } from '~/components/chat/file-upload-utils';

const pageElement = ref<HTMLElement | null>(null);
const paneWidth = ref(0);
const filesHeading = ref<HTMLElement | null>(null);
const previewHeading = ref<HTMLElement | null>(null);
let resizeObserver: ResizeObserver | undefined;
let previewTrigger: HTMLElement | null = null;
const closeIcon = useIcon('ui.close');
const menuUi = {
    content: 'min-w-[220px]',
};
const pluginFileActions = useWorkspaceFileActions();
async function closePreview() {
    preview.value = false;
    await nextTick();
    if (previewTrigger?.isConnected && previewTrigger.getClientRects().length) {
        previewTrigger.focus();
        if (document.activeElement === previewTrigger) return;
    }
    const index = listRows.value.findIndex(row => row.kind === 'file' && row.file.id === selected.value?.id);
    if (index >= 0) await focusListRow(index, false);
}
const props = defineProps<{ recordId?: string | null }>();
type FileListRow = Pick<Post, 'id' | 'postType' | 'title' | 'file_hashes' | 'updated_at' | 'clock' | 'meta'>
    & { coverage?: 'none' | 'prefix' | 'full' };
const rows = shallowRef<FileListRow[]>([]);
const filesScope = { kind: 'files' } as const;
const explorerEnabled = useExplorerAvailable();
const widePreview = computed(() => paneWidth.value >= (explorerEnabled.value ? 1024 : 720));
const organization = shallowRef<Awaited<ReturnType<typeof readExplorerOrganization>>>();
const filesWorkspace = ref(getActiveWorkspaceId() ?? 'local');
const sessionData = useLocalWorkspaceSession();
const filesPreferenceScope = computed(() => JSON.stringify([sessionData.value?.session?.user?.id ?? 'local', filesWorkspace.value]));
const storedFolder = useLocalStorage(computed(() => 'or3:files-explorer:folder:v1:' + filesPreferenceScope.value), '');
const folderId = computed<string | null>({ get: () => storedFolder.value || null,
    set: value => { storedFolder.value = value ?? ''; } });
const searchAll = ref(false);
const filesPreferenceHint = computed(() => 'or3:files-explorer:sort:v1:' + filesPreferenceScope.value);
const sort = useLocalStorage<'recent' | 'name' | 'type'>(filesPreferenceHint, 'recent');
const showNavigator = useLocalStorage(computed(() => 'or3:files-explorer:navigator:v1:' + filesPreferenceScope.value), false);
const navigatorExpanded = ref<string[]>([]);
const editingFolder = ref<ExplorerFolderRow | null>(null);
const folderDialog = ref(false);
let folderExpected: ExplorerRevision | null = null;
let folderDestination: string | null = null;
const folderName = ref('');
const organizationError = ref('');
const folderFormError = ref('');
const moveDialog = ref(false);
const folderRemoval = shallowRef<Awaited<ReturnType<typeof planExplorerFolderRemoval>>>();
const removeFolderDialog = ref(false);
const bulkTrash = ref(false);
const listViewport = ref<HTMLElement | null>(null);
const rowHeight = 64;
const fileDetails = ref<Record<string, FileMeta>>({});
const previewSyncStatus = ref<string>();
const cloudEnabled = useRuntimeConfig().public.ssrAuthEnabled === true;
const icons = {
    upload: useIcon('ui.upload'), document: useIcon('sidebar.note'), folder: useIcon('sidebar.folder'),
    search: useIcon('ui.search'), more: useIcon('ui.more'), trash: useIcon('ui.trash'),
    file: useIcon('external-agent.file'), text: useIcon('external-agent.file.text'),
    pdf: useIcon('external-agent.file.pdf'), download: useIcon('ui.download'),
    chat: useIcon('sidebar.chat'), edit: useIcon('ui.edit'),
    check: useIcon('ui.check'), warning: useIcon('ui.warning'),
};
const query = ref('');
const trash = ref(false);
async function setTrashView(inTrash: boolean) {
    trash.value = inTrash;
    await nextTick();
    filesHeading.value?.focus();
}
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
const uploadStatus = ref<{ name: string; index: number; total: number; uploading: boolean } | null>(null);
const uploadResult = ref('');
const uploadReveal = shallowRef<Post>();
const previewProjectLocations = shallowRef<{ id: string; name: string; path: string }[]>([]);
const projectReveal = useProjectExplorerReveal();
const filesReveal = useFilesExplorerReveal();
const { openProjectSidebar } = useProjectSidebar();
let revealId: string | undefined;
let uploadDestination: string | null = null;
let uploadResultTimer: ReturnType<typeof setTimeout> | undefined;
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
let organizationSubscription: { unsubscribe(): void } | undefined;
let previewSubscription: { unsubscribe(): void } | undefined;
let resultTimer: ReturnType<typeof setTimeout> | undefined;
let generation = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let disposed = false;
const undo = useExplorerUndo(filesScope, () => scope ?? capture(), () => busy.value, runOrganization);
function fileErrorMessage(caught: unknown, fallback: string): string {
    const code = caught && typeof caught === 'object' && 'code' in caught ? caught.code : undefined;
    const message = code === 'conflict' ? 'This item changed. Refresh Files and try again.'
        : code === 'permission-denied' ? 'This file change is not allowed by workspace policy.' : fallback;
    return reportError(caught, { message, toast: false, tags: { domain: 'files' } }).message;
}
function clearPreview() {
    preview.value = false; selected.value = null; previewText.value = ''; previewProjectLocations.value = [];
    releasePreviewImage();
}
const activeExplorer = computed(() => explorerEnabled.value && !trash.value);
const filterActive = computed(() => !!query.value.trim() || typeFilter.value !== 'all' || projectFilter.value !== 'all');
watch(filterActive, (active, previous) => { if (active && !previous) searchAll.value = false; });
const folderPath = computed(() => organization.value?.tree.path(folderId.value) ?? []);
const folderLabel = computed(() => folderPath.value.at(-1)?.payload.name ?? 'Files');
/** Phone and narrow tablet panes get the condensed header and chip filters. */
const compact = computed(() => paneWidth.value > 0 && paneWidth.value <= 600);
const filterUi = computed(() => ({
    base: compact.value
        ? 'files-filter-base rounded-full! h-[34px]! min-h-[34px]! max-md:h-[34px]! max-md:min-h-[34px]! ps-3! pe-8! text-[13px]! max-md:text-[13px]!'
        : 'files-filter-base',
    trailingIcon: 'size-4',
}));
const navigatorAvailable = computed(() => activeExplorer.value && paneWidth.value >= 1280 && !preview.value);
interface NavigatorFolder {
    id: string;
    label: string;
    path: string;
    children?: NavigatorFolder[];
}
const navigatorFolders = computed(() => {
    const tree = organization.value?.tree;
    if (!showNavigator.value || !navigatorAvailable.value || !tree) return [];
    function children(parent: string | null, path: string): NavigatorFolder[] {
        return (tree!.children.get(parent) ?? []).map(folder => {
            const label = tree!.label(folder);
            const fullPath = path + ' / ' + label;
            const nested = children(folder.id, fullPath);
            return { id: folder.id, label, path: fullPath, ...(nested.length ? { children: nested } : {}) };
        }).sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
    }
    return children(null, 'Files');
});
watch(folderPath, path => {
    navigatorExpanded.value = [...new Set([...navigatorExpanded.value, ...path.map(folder => folder.id)])];
});
const contentRef = (row: FileListRow): ExplorerItemRef => ({
    kind: row.postType === 'doc' ? 'document' : 'file', item_id: row.id,
});
function location(row: FileListRow, tree = organization.value?.tree) {
    return tree?.placements.get(explorerItemKey(contentRef(row)))?.parentId ?? null;
}
const searchFolders = computed(() => {
    if (!filterActive.value || searchAll.value || folderId.value === null) return;
    const descendants = new Set([folderId.value]);
    const tree = organization.value?.tree;
    for (const id of descendants) {
        for (const child of tree?.children.get(id) ?? []) descendants.add(child.id);
    }
    return descendants;
});
function compareRows(a: { title: string; updatedAt: number; id: string; type?: string }, b: typeof a) {
    return (sort.value === 'recent' ? b.updatedAt - a.updatedAt : 0)
        || (sort.value === 'type' ? (a.type ?? '').localeCompare(b.type ?? '', undefined, { sensitivity: 'base' }) : 0)
        || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
}
type ListedFile = { key: string; kind: 'file'; file: FileListRow };
type ListedFolder = { key: string; kind: 'folder'; folder: ExplorerFolderRow };
const fileRows = computed<ListedFile[]>(() => {
    const entries = rows.value.map(file => ({ key: explorerItemKey(contentRef(file)), kind: 'file' as const, file }));
    if (trash.value && explorerEnabled.value) return entries.sort((a, b) =>
        b.file.updated_at - a.file.updated_at || b.file.id.localeCompare(a.file.id));
    if (!activeExplorer.value) return entries;
    return entries.map(entry => ({
        id: entry.file.id, title: entry.file.title, updatedAt: entry.file.updated_at,
        type: sort.value === 'type' ? fileType(entry.file) : undefined, entry,
    })).sort(compareRows).map(row => row.entry);
});
const rowsByFolder = computed(() => {
    const groups = new Map<string | null, (ListedFile | ListedFolder)[]>();
    const tree = organization.value?.tree;
    for (const [parent, folders] of tree?.children ?? []) {
        const sorted = [...folders].sort((a, b) => compareRows(
            { id: a.id, title: a.payload.name, updatedAt: a.updatedAt },
            { id: b.id, title: b.payload.name, updatedAt: b.updatedAt },
        ));
        groups.set(parent, sorted.map(folder => ({ key: folder.id, kind: 'folder', folder })));
    }
    for (const row of fileRows.value) {
        const parent = tree?.placements.get(row.key)?.parentId ?? null;
        const group = groups.get(parent);
        if (group) group.push(row);
        else groups.set(parent, [row]);
    }
    return groups;
});
const listRows = computed(() => {
    if (!activeExplorer.value) return fileRows.value;
    if (filterActive.value) {
        const folders = searchFolders.value;
        return folders ? fileRows.value.filter(row => folders.has(location(row.file) ?? '')) : fileRows.value;
    }
    return rowsByFolder.value.get(folderId.value) ?? [];
});
const explorerSelection = useExplorerSelection(computed(() => listRows.value.map(row => row.key)));
const { selected: selectedRows, selectMode, choose, clear: clearSelection, all: selectAll } = explorerSelection;
const hasPartialSelection = computed(() => activeExplorer.value && selectedRows.value.size > 0
    && selectedRows.value.size < listRows.value.length);
const virtualizer = useVirtualizer(computed(() => ({
    count: explorerEnabled.value ? listRows.value.length : 0,
    estimateSize: () => rowHeight,
    getScrollElement: () => listViewport.value,
    getItemKey: index => listRows.value[index]?.key ?? index,
    overscan: 8,
})));
const renderedRows = computed(() => explorerEnabled.value
    ? virtualizer.value.getVirtualItems().flatMap(item => {
        const row = listRows.value[item.index];
        return row ? [{ ...row, start: item.start, index: item.index }] : [];
    })
    : listRows.value.map((row, index) => ({ ...row, start: 0, index })));
const toolbarBeforeDrag = ref(false);
const { directive: vExplorerDrag, announcement: dragAnnouncement, dragging } = useExplorerDrag({
    enabled: computed(() => activeExplorer.value && !readOnly.value && !busy.value),
    viewport: listViewport,
    start: id => {
        toolbarBeforeDrag.value = selectedRows.value.size > 0;
        if (!selectedRows.value.has(id)) { clearSelection(); choose(id); }
    },
    move: destination => { void moveSelection(destination); },
    accepts: destination => {
        const tree = organization.value?.tree;
        if (!tree || selectedRows.value.size > EXPLORER_MAX_WRITES
            || tree.path(destination).some(folder => selectedRows.value.has(folder.id))) return false;
        for (const key of selectedRows.value) {
            const location = tree.folderLocations.get(key) ?? tree.placements.get(key);
            if ((location?.parentId ?? null) !== destination) return true;
        }
        return false;
    },
});
const destinations = computed(() => {
    const tree = organization.value?.tree;
    if (!moveDialog.value || !tree) return [];
    return [...tree.folders.values()].filter(folder => !folder.deleted).map(folder => {
        const path = tree.path(folder.id);
        return { id: folder.id, path: path.map(tree.label).join(' / '),
            disabled: path.some(part => selectedRows.value.has(part.id)) };
    }).sort((a, b) => a.path.localeCompare(b.path));
});
function filePath(row: FileListRow) {
    const tree = organization.value?.tree;
    return tree?.path(location(row, tree)).map(tree.label).join(' / ') || 'Files root';
}
function recoveredPath(entry: ListedFile | ListedFolder) {
    const tree = organization.value?.tree;
    if (!tree) return;
    const resolved = entry.kind === 'folder' ? tree.folderLocations.get(entry.key) : tree.placements.get(entry.key);
    if (!resolved?.recovery) return;
    const path = tree.path(resolved.parentId).map(tree.label).join(' / ');
    return explorerRecoveryLabel(resolved, path ? 'Files / ' + path : 'Files root');
}
function navigateFolder(id: string | null) {
    folderId.value = id;
    clearSelection();
    listViewport.value?.scrollTo({ top: 0 });
}
function openFolderDialog(folder: ExplorerFolderRow | null = null) {
    editingFolder.value = folder;
    folderExpected = explorerRevision(folder ? organization.value?.canonical.get(folder.id) : undefined);
    folderDestination = folderId.value;
    folderName.value = folder?.payload.name ?? '';
    organizationError.value = '';
    folderFormError.value = '';
    folderDialog.value = true;
}
async function saveFolder() {
    const target = editingFolder.value;
    const name = folderName.value;
    const destination = folderDestination;
    const expected = folderExpected;
    await runOrganization(async origin => {
        if (target) undo.save(origin, await renameExplorerFolder(origin, filesScope, target.id, name, expected), 'Files folder renamed');
        else await createExplorerFolder(origin, filesScope, destination, name);
        folderDialog.value = false;
    }, folderFormError);
}
async function confirmRemoveFolder(folder: ExplorerFolderRow) {
    await runOrganization(async origin => {
        const plan = await planExplorerFolderRemoval(origin, filesScope, folder.id);
        if (!plan.children.length) await removeExplorerFolder(origin, filesScope, folder.id, plan);
        else {
            folderRemoval.value = plan;
            removeFolderDialog.value = true;
        }
    });
}
async function finishRemoveFolder() {
    const plan = folderRemoval.value;
    if (!plan) return;
    await runOrganization(async origin => {
        await removeExplorerFolder(origin, filesScope, plan.folder.id, plan);
        removeFolderDialog.value = false;
        clearSelection();
    });
}
const bulkTrashLabel = computed(() => `Move ${selectedRows.value.size} ${selectedRows.value.size === 1 ? 'item' : 'items'} to Trash`);
const selectedIncludesFolders = computed(() => listRows.value.some(row => row.kind === 'folder' && selectedRows.value.has(row.key)));
async function executeBulkTrash() {
    const targets = listRows.value.flatMap(row => row.kind === 'file' && selectedRows.value.has(row.key) ? [row] : []);
    if (selectedIncludesFolders.value || !targets.length || targets.length > EXPLORER_MAX_WRITES) return;
    await runOrganization(async origin => {
        const { updateWorkspaceFile } = await import('~/db/workspace-files');
        origin.assertCurrent('write');
        await assertExplorerQueueCapacity(origin, targets.length);
        let completed = 0;
        let failed = 0;
        const unfinished = new Set(targets.map(row => row.key));
        for (const target of targets) {
            try { origin.assertCurrent('write'); }
            catch { break; }
            try {
                const row = await origin.db.posts.get(target.file.id);
                if (!row || row.clock !== target.file.clock || !isVisibleWorkspaceItem(row)) throw new Error('This item changed.');
                await updateWorkspaceFile(origin, row.id, await workspaceRevision(row), { trashed: true }, { explorerBulk: true });
                unfinished.delete(target.key);
                completed++;
            } catch (cause) {
                try { origin.assertCurrent('write'); }
                catch { break; }
                if (cause instanceof DOMException && ['QuotaExceededError', 'AbortError'].includes(cause.name)) break;
                if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'explorer-queue-full') break;
                failed++;
            }
        }
        selectedRows.value = unfinished;
        bulkTrash.value = false;
        feedback.value = `${completed} moved to Trash, ${failed} failed, ${targets.length - completed - failed} not attempted.`;
    });
}
async function runOrganization(action: (origin: WorkspaceOperationScope) => Promise<void>, errorTarget = organizationError) {
    if (busy.value) return;
    busy.value = true;
    errorTarget.value = '';
    try {
        const origin = scope ?? capture();
        await action(origin);
        origin.assertCurrent();
    } catch (cause) {
        errorTarget.value = cause instanceof Error ? cause.message : 'Files organization could not be saved.';
    } finally { busy.value = false; }
}
function openMove() {
    organizationError.value = '';
    moveDialog.value = true;
}
function selectRowMenu(key: string) {
    if (!activeExplorer.value || selectedRows.value.has(key)) return;
    clearSelection();
    choose(key);
}
function folderActions(folder: ExplorerFolderRow) {
    const disabled = busy.value || readOnly.value;
    const multiple = selectedRows.value.has(folder.id) && selectedRows.value.size > 1;
    const move = { label: multiple ? `Move ${selectedRows.value.size} items to…` : 'Move to…',
        disabled: disabled || selectedRows.value.size > EXPLORER_MAX_WRITES, onSelect: openMove };
    if (multiple) return [move];
    return [
        { label: 'Rename folder', disabled, onSelect: () => openFolderDialog(folder) },
        { label: 'Remove folder, keep contents', disabled, onSelect: () => confirmRemoveFolder(folder) },
        move,
    ];
}
async function moveSelection(destination: string | null) {
    const selected = listRows.value.filter(row => selectedRows.value.has(row.key));
    if (!selected.length) return;
    const records = organization.value?.canonical;
    await runOrganization(async origin => {
        const targets = await Promise.all(selected.map(async (row): Promise<ExplorerMoveRow> => {
            if (row.kind === 'folder') return { row: { kind: 'folder', id: row.folder.id },
                expected: explorerRevision(records?.get(row.folder.id)) };
            const item = contentRef(row.file);
            return { row: { kind: 'item', item }, expected: explorerRevision(records?.get(await explorerPlacementId(filesScope, item))) };
        }));
        await moveExplorerRows(origin, filesScope, targets, destination, receipt => undo.save(origin, receipt, 'Files locations updated'));
        moveDialog.value = false;
        clearSelection();
        feedback.value = 'Files locations updated.';
    });
}
function chooseUpload() {
    uploadDestination = activeExplorer.value ? folderId.value : null;
    uploadInput.value?.click();
}
function dropFiles(event: DragEvent, destination: string | null) {
    const transfer = event.dataTransfer;
    if (!activeExplorer.value || !transfer?.types.includes('Files')) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.type !== 'drop' || busy.value || readOnly.value) return;
    if ([...transfer.items].some(item => item.webkitGetAsEntry?.()?.isDirectory)) {
        organizationError.value = 'Choose individual files to upload. Folder upload is unavailable.';
        return;
    }
    void intake([...transfer.files], false, destination);
}
function createMoveDestination(name: string, parent: string | null) {
    return createExplorerFolder(scope ?? capture(), filesScope, parent, name);
}
let typeahead = '';
let typeaheadTimer: ReturnType<typeof setTimeout> | undefined;
async function focusListRow(index: number, select: boolean) {
    const entry = listRows.value[index];
    if (!entry) return;
    virtualizer.value.scrollToIndex(index);
    if (select) choose(entry.key, { shiftKey: true });
    await nextTick();
    const selector = `[data-list-index="${index}"] .files-name-button`;
    // Scrolling and observing the virtual viewport can take separate browser frames.
    for (let frame = 0; frame < 5 && listRows.value[index]?.key === entry.key; frame++) {
        const button = listViewport.value?.querySelector<HTMLElement>(selector);
        if (button?.getClientRects().length) { button.focus(); return; }
        await new Promise(requestAnimationFrame);
    }
}
function listKey(event: KeyboardEvent) {
    if (!activeExplorer.value || event.isComposing || !(event.target instanceof HTMLElement)
        || event.target.closest('input:not([type="checkbox"]),textarea,[contenteditable="true"]')) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        selectAll();
        return;
    }
    const index = Number(event.target.closest<HTMLElement>('[data-list-index]')?.dataset.listIndex ?? -1);
    const entry = listRows.value[index];
    if (!entry) return;
    switch (event.key) {
        case 'ArrowDown':
        case 'ArrowUp':
        case 'Home':
        case 'End': {
            event.preventDefault();
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? listRows.value.length - 1
                : index + (event.key === 'ArrowDown' ? 1 : -1);
            void focusListRow(next, event.shiftKey);
            return;
        }
        case ' ': event.preventDefault(); choose(entry.key, event, true); return;
        case 'F2':
            event.preventDefault();
            if (readOnly.value || busy.value || selectedRows.value.size > 1) return;
            if (entry.kind === 'folder') openFolderDialog(entry.folder);
            else void withFileRow(entry.file, row => { actionTarget.value = row; newTitle.value = row.title; rename.value = true; });
            return;
        case 'Delete':
        case 'Backspace':
            event.preventDefault();
            if (readOnly.value || busy.value) return;
            if (!selectedRows.value.has(entry.key)) { clearSelection(); choose(entry.key); }
            if (entry.kind === 'folder' && selectedRows.value.size === 1) void confirmRemoveFolder(entry.folder);
            else if (selectedIncludesFolders.value) organizationError.value = 'Select files and documents only to move them to Trash.';
            else if (selectedRows.value.size <= EXPLORER_MAX_WRITES) bulkTrash.value = true;
            return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey || event.key.length !== 1) return;
    typeahead += event.key.toLocaleLowerCase();
    clearTimeout(typeaheadTimer);
    typeaheadTimer = setTimeout(() => { typeahead = ''; }, 700);
    const matches = (row: typeof entry) => (row.kind === 'folder' ? row.folder.payload.name : row.file.title)
        .toLocaleLowerCase().startsWith(typeahead);
    const after = listRows.value.findIndex((row, position) => position > index && matches(row));
    const next = after === -1 ? listRows.value.findIndex(matches) : after;
    if (next !== -1) { event.preventDefault(); void focusListRow(next, false); }
}
async function revealInFiles(row: FileListRow) {
    const origin = scope ?? capture();
    await closePreview();
    const current = await readExplorerOrganization(origin, filesScope);
    origin.assertCurrent();
    if (disposed || scope !== origin) return;
    revealId = row.id;
    query.value = '';
    trash.value = false;
    typeFilter.value = 'all';
    projectFilter.value = 'all';
    searchAll.value = false;
    navigateFolder(location(row, current.tree));
    await refresh();
}
watch(filesReveal, request => {
    if (!request || !explorerEnabled.value) return;
    const origin = scope ?? capture();
    if (request.generation !== origin.generation) return;
    filesReveal.value = null;
    void runOrganization(async () => {
        const row = await origin.db.posts.get(request.itemId);
        origin.assertCurrent();
        if (!row || !isVisibleWorkspaceItem(row)) throw new Error('This file is unavailable in Files.');
        await revealInFiles(row);
    });
}, { immediate: true, flush: 'post' });
async function revealInProject(projectId: string) {
    if (!selected.value) return;
    try {
        const origin = scope ?? capture();
        const item = selected.value;
        origin.assertCurrent();
        const project = await origin.db.projects.get(projectId);
        origin.assertCurrent();
        if (!project || project.deleted || selected.value?.id !== item.id) return;
        projectReveal.value = { projectId, key: explorerItemKey(contentRef(item)), generation: origin.generation };
        const request = projectReveal.value;
        try { await openProjectSidebar(projectId); }
        catch (error) { if (projectReveal.value === request) projectReveal.value = null; throw error; }
    } catch (cause) {
        error.value = fileErrorMessage(cause, 'The project location could not be opened.');
    }
}
async function activateFile(row: FileListRow, event: MouseEvent) {
    if (!activeExplorer.value || choose(explorerItemKey(contentRef(row)), event)) await open(row);
}
async function withFileRow(row: FileListRow, action: (current: Post) => unknown) {
    try {
        const origin = scope ?? capture();
        const current = await origin.db.posts.get(row.id);
        origin.assertCurrent();
        if (!current || current.deleted || current.clock !== row.clock || ('content' in row
            && await workspaceRevision(current) !== await workspaceRevision(row))) throw new Error('This file changed.');
        origin.assertCurrent();
        await action(current);
    } catch (cause) { error.value = fileErrorMessage(cause, 'This file changed. Refresh Files and try again.'); }
}
watch([trash, query, typeFilter, projectFilter, searchAll, sort], clearSelection);
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
function projectNames(row: FileListRow) {
    return rowProjects.value.get((row.postType === 'doc' ? 'doc' : 'file') + ':' + row.id) ?? [];
}
function detail(row: FileListRow) { return fileDetails.value[parseFileHashes(row.file_hashes)[0] ?? '']; }
function fileType(row: FileListRow) {
    if (row.postType === 'doc') return 'Document';
    const mime = detail(row)?.mime_type ?? '';
    if (mime === 'application/pdf') return 'PDF';
    if (mime.startsWith('image/')) return 'Image';
    if (mime === 'text/csv') return 'Spreadsheet';
    if (mime.startsWith('text/')) return 'Text';
    return 'File';
}
function fileIcon(row: FileListRow) {
    const type = fileType(row);
    return type === 'Document' ? icons.document.value : type === 'PDF' ? icons.pdf.value : type === 'Text' ? icons.text.value : icons.file.value;
}
function formatSize(row: FileListRow) {
    const bytes = detail(row)?.size_bytes;
    if (bytes == null) return '—';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
function modifiedDate(row: FileListRow) {
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
function rowActions(row: FileListRow) {
    const kind = row.postType === 'doc' ? 'document' : 'file';
    const extensions = pluginFileActions.value.filter(action => !action.kinds || action.kinds.includes(kind)).map(action => ({
        label: action.label, icon: action.icon ?? 'i-lucide-puzzle', disabled: busy.value || (action.requiresWrite && readOnly.value),
        onSelect: () => { void withFileRow(row, current => runPluginFileAction(action, current)); },
    }));
    const key = explorerItemKey(contentRef(row));
    const multiple = activeExplorer.value && selectedRows.value.has(key) && selectedRows.value.size > 1;
    const moveAction = { label: multiple ? `Move ${selectedRows.value.size} items to…` : 'Move to…', icon: icons.folder.value,
        disabled: readOnly.value || busy.value || selectedRows.value.size > EXPLORER_MAX_WRITES, onSelect: openMove };
    if (multiple) return [[moveAction, { label: bulkTrashLabel.value, icon: icons.trash.value, color: 'error' as const,
        disabled: selectedIncludesFolders.value || moveAction.disabled, onSelect: () => { bulkTrash.value = true; } }]];
    return [
        [
            ...(activeExplorer.value ? [moveAction] : []),
            ...(row.postType === 'doc' ? [{ label: 'Open document', icon: icons.document.value, onSelect: () => withFileRow(row, openEditor) }] : []),
            { label: 'Ask in chat', icon: icons.chat.value, onSelect: () => withFileRow(row, askInChat) },
            { label: 'Download', icon: icons.download.value, onSelect: () => { void withFileRow(row, current => download(current)); } },
            { label: 'Add to project', icon: icons.folder.value, disabled: busy.value || readOnly.value,
                onSelect: () => withFileRow(row, current => { actionTarget.value = current; associationProject.value = ''; associate.value = true; }) },
        ],
        [
            { label: 'Rename', icon: icons.edit.value, disabled: busy.value || readOnly.value,
                onSelect: () => withFileRow(row, current => { actionTarget.value = current; newTitle.value = current.title; rename.value = true; }) },
            ...(row.postType === FILE_CATALOG_POST_TYPE ? [
                ...((row.coverage ?? workspaceItemMetadata(row.meta)?.text?.coverage) !== 'full' ? [{ label: 'Enable text search', icon: icons.search.value,
                    disabled: busy.value || readOnly.value, onSelect: () => withFileRow(row, enableText) }] : []),
            ] : []),
        ],
        ...(extensions.length ? [extensions] : []),
        [{ label: 'Move to trash', icon: icons.trash.value, color: 'error' as const, disabled: busy.value || readOnly.value,
            onSelect: () => withFileRow(row, current => change(current, { trashed: true })) }],
    ];
}

async function runPluginFileAction(action: WorkspaceFileAction, row: Post) {
    busy.value = true; error.value = '';
    try {
        const origin = scope ?? capture();
        const { workspaceFileSnapshot } = await import('~/db/workspace-files');
        await action.run(await workspaceFileSnapshot(origin, row));
    } catch (failure) { error.value = fileErrorMessage(failure, 'The file action could not be completed. Try again.'); }
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
        const palette = term && !inTrash ? (await import('~/composables/search/useCommandPalette')).useCommandPalette() : null;
        if (palette && !palette.getCoordinator()) await palette.warm();
        if (disposed || current !== generation) return;
        // Observe the bounded result itself. Changes to unrelated transfers or
        // file metadata cannot trigger a full catalog refresh.
        subscription = liveQuery(async () => {
            origin.assertCurrent();
            const currentProjects = await origin.db.projects.filter(project => !project.deleted).toArray();
            const project = projectId === 'all' ? undefined : currentProjects.find(row => row.id === projectId);
            const missingProject = projectId !== 'all' && (!project || project.deleted);
            const members = project && !project.deleted ? new Set(normalizeProjectData(project.data)
                .filter(item => item.kind === 'doc' || item.kind === 'file').map(item => item.id)) : null;
            const items = explorerEnabled.value ? await listExplorerItems(origin.db, inTrash ? 'trash' : 'active') : null;
            let ids: Set<string> | undefined;
            if (palette) {
                const tree = organization.value?.tree;
                const folders = searchFolders.value;
                const eligible = items ? new Set(items.filter(item => {
                    if (type === 'image' && !item.file?.mime_type.startsWith('image/')) return false;
                    if (!folders) return true;
                    const key = explorerItemKey({ kind: item.kind, item_id: item.id });
                    return folders.has(tree?.placements.get(key)?.parentId ?? '');
                }).map(item => item.id)) : null;
                const result = await palette.getCoordinator()?.searchOnce({ term, sourceIds: ['document', 'file'], limit: 200,
                    accepts: resource => (type === 'all' || resource.sourceId === (type === 'image' ? 'file' : type))
                        && (!members || members.has(resource.recordId)) && (!eligible || eligible.has(resource.recordId)) });
                if (!result) throw new Error('Search is unavailable. Try again.');
                ids = new Set(result.results.map(hit => hit.recordId));
            }
            if (items) {
                const metadata: Record<string, FileMeta> = {};
                const rows = items.flatMap((item): FileListRow[] => {
                    if ((ids && !ids.has(item.id)) || (members && !members.has(item.id))
                        || (type === 'image' ? !item.file?.mime_type.startsWith('image/') : type !== 'all' && type !== item.kind)
                        || (inTrash && term && !item.title.toLowerCase().includes(term.toLowerCase()))) return [];
                    if (item.file) metadata[item.file.hash] = item.file;
                    return [{ id: item.id, title: item.title, postType: item.kind === 'document' ? 'doc' : FILE_CATALOG_POST_TYPE,
                        file_hashes: item.file ? JSON.stringify([item.file.hash]) : undefined,
                        updated_at: item.updatedAt, clock: item.clock, coverage: item.textCoverage }];
                });
                origin.assertCurrent();
                return { projects: currentProjects, missingProject, rows, metadata, more: false };
            }
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
                rows: candidates.slice(0, pageSize),
                metadata: Object.fromEntries(metadata), more: candidates.length > pageSize };
        }).subscribe({ next: snapshot => {
            clearTimeout(resultTimer);
            resultTimer = setTimeout(() => {
                if (disposed || current !== generation || origin !== scope) return;
                projects.value = snapshot.projects; rows.value = snapshot.rows;
                fileDetails.value = snapshot.metadata; more.value = snapshot.more;
                error.value = ''; loading.value = false;
                if (revealId) {
                    const index = listRows.value.findIndex(row => row.kind === 'file' && row.file.id === revealId);
                    if (index >= 0) {
                        revealId = undefined;
                        clearSelection();
                        choose(listRows.value[index]!.key);
                        void nextTick().then(() => focusListRow(index, false));
                    }
                }
                if (snapshot.missingProject) projectFilter.value = 'all';
            }, 40);
        }, error: caught => {
            if (disposed || current !== generation || origin !== scope) return;
            error.value = fileErrorMessage(caught, 'Files could not be loaded. Try again.');
            loading.value = false;
        } });
    } catch (caught) {
        if (disposed || current !== generation) return;
        rows.value = []; fileDetails.value = {}; clearPreview();
        error.value = fileErrorMessage(caught, 'Files could not be loaded. Try again.');
        loading.value = false;
    }
}

watch([
    () => preview.value ? selected.value?.id : undefined,
    () => preview.value && selected.value ? parseFileHashes(selected.value.file_hashes)[0] : undefined,
], ([id, hash], _, onCleanup) => {
    previewSyncStatus.value = undefined;
    const origin = scope;
    if (!origin || !cloudEnabled || !id) return;
    const keys = [['posts', id]];
    if (hash) keys.push(['file_meta', hash]);
    const sub = liveQuery(async () => {
        const [operations, uploads, meta] = await Promise.all([
            origin.db.pending_ops.where('[tableName+pk]').anyOf(keys).toArray(),
            hash ? origin.db.file_transfers.where('[hash+direction]').equals([hash, 'upload']).toArray() : [],
            hash ? origin.db.file_meta.get(hash) : undefined,
        ]);
        const pending = operations.filter(op => op.status !== 'applied' && op.status !== 'discarded');
        const transfer = uploads.sort((a, b) => b.updated_at - a.updated_at)[0];
        if (pending.some(op => ['failed', 'failed_retryable', 'failed_permanent'].includes(op.status))) return 'Sync needs attention';
        if (transfer?.state === 'failed') return 'Upload needs attention';
        if (transfer?.state === 'running') return 'Uploading';
        if (pending.length || (transfer && transfer.state !== 'done')) return 'Saved locally · Waiting to sync';
        return hash && !meta?.storage_id ? 'Saved locally' : 'Synced';
    }).subscribe({
        next: status => { if (origin === scope && selected.value?.id === id) previewSyncStatus.value = status; },
        error: () => { if (origin === scope && selected.value?.id === id) previewSyncStatus.value = undefined; },
    });
    onCleanup(() => sub.unsubscribe());
});
watch(() => preview.value ? selected.value?.id : null, id => {
    previewSubscription?.unsubscribe(); previewSubscription = undefined;
    const origin = scope;
    if (!id || !origin) return;
    previewSubscription = liveQuery(async () => {
        const row = await origin.db.posts.get(id);
        const hash = row?.postType === FILE_CATALOG_POST_TYPE ? parseFileHashes(row.file_hashes)[0] : undefined;
        const meta = hash ? await origin.db.file_meta.get(hash) : undefined;
        if (!row || !isVisibleWorkspaceItem(row) || (row.postType !== 'doc' && (!meta || meta.deleted))) return null;
        const locations = [];
        if (explorerEnabled.value) {
            const kind = row.postType === 'doc' ? 'doc' : 'file';
            const candidates = await origin.db.projects.filter(project => !project.deleted).toArray();
            for (const project of candidates) {
                if (!normalizeProjectData(project.data).some(item => item.id === row.id && item.kind === kind)) continue;
                const result = await readExplorerOrganization(origin, { kind: 'project', project_id: project.id });
                const parent = result.tree.placements.get(explorerItemKey(contentRef(row)))?.parentId ?? null;
                locations.push({ id: project.id, name: project.name,
                    path: result.tree.path(parent).map(result.tree.label).join(' / ') || 'Project root' });
            }
        }
        return { row, locations };
    }).subscribe({ next: result => {
        if (disposed || origin !== scope || selected.value?.id !== id) return;
        if (!result) { clearPreview(); return; }
        const { row, locations } = result;
        previewProjectLocations.value = locations;
        selected.value = row; previewText.value = row.postType === 'doc' ? documentPreview(row.content) : row.content;
    }, error: () => { if (!disposed && origin === scope) clearPreview(); } });
});

async function run(action: (origin: WorkspaceOperationScope) => Promise<void>, failureMessage = 'The file action could not be completed. Try again.') {
    if (busy.value) return;
    busy.value = true; error.value = '';
    try {
        const origin = scope ?? capture();
        origin.assertCurrent('write');
        await action(origin);
        origin.assertCurrent();
        await refresh();
    } catch (caught) { error.value = fileErrorMessage(caught, failureMessage); }
    finally { busy.value = false; }
}

async function intake(files: File[], retry = false, destination = activeExplorer.value ? folderId.value : null) {
    if (!files.length) return;
    clearTimeout(uploadResultTimer); uploadResult.value = ''; uploadReveal.value = undefined;
    await run(async origin => {
        // Show the strip before any await: large Cloud files are hashed and
        // uploaded directly, and their row appears only once committed.
        uploadStatus.value = { name: files[0]!.name, index: 1, total: files.length, uploading: false };
        try {
            const { importWorkspaceFile } = await import('~/db/workspace-files');
            failures.value = retry ? failures.value.filter(failure => !files.includes(failure.file)) : [];
            let saved = 0; let background = 0; let note = '';
            for (const [index, file] of files.entries()) {
                origin.assertCurrent('write');
                const status = { name: file.name, index: index + 1, total: files.length, uploading: false };
                uploadStatus.value = status;
                let direct = false;
                try {
                    const result = await importWorkspaceFile(origin, file, file.name, { onDirectUpload: () => {
                        direct = true; uploadStatus.value = { ...status, uploading: true };
                    } });
                    saved++;
                    if (!direct) background++;
                    if (activeExplorer.value && result.duplicate) uploadReveal.value = result.post;
                    note = result.duplicate ? 'File already exists' : result.restored ? 'Existing file restored' : '';
                    if (destination && !result.duplicate) {
                        try {
                            await moveExplorerRows(origin, filesScope,
                                [{ row: { kind: 'item', item: { kind: 'file', item_id: result.post.id } }, expected: null }],
                                destination);
                        } catch { feedback.value = 'Upload saved to Files root. The selected folder could not be used.'; }
                    }
                } catch (caught) {
                    origin.assertCurrent('write');
                    failures.value.push({ file, error: fileErrorMessage(caught, 'The file could not be uploaded. Try again.') });
                }
            }
            origin.assertCurrent();
            if (!saved) return;
            // Smaller Cloud files are saved locally first and uploaded by the transfer queue.
            const local = background > 0;
            const syncing = isCloudFileStorageEnabled() && local;
            const paused = isCloudFileStorageConfigured() && !isCloudFileStorageEnabled() && local;
            const summary = files.length === 1 ? note || (local ? 'Saved locally' : 'Upload complete')
                : `${saved} of ${files.length} files ${local ? 'saved' : 'uploaded'}`;
            uploadResult.value = !(files.length === 1 && note) && (syncing || paused)
                ? `${summary} · ${syncing ? 'Syncing in background' : 'Cloud paused'}` : summary;
            uploadResultTimer = setTimeout(() => { uploadResult.value = ''; }, 4000);
        } finally { uploadStatus.value = null; }
    });
}
async function upload(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    const destination = uploadDestination;
    uploadDestination = null;
    input.value = '';
    await intake(files, false, destination);
}
async function change(row: Post, changes: { title?: string; trashed?: boolean }) {
    await run(async origin => {
        const { updateWorkspaceFile } = await import('~/db/workspace-files');
        await updateWorkspaceFile(origin, row.id, await workspaceRevision(row), changes);
        rename.value = false;
    });
}
function submitRename() {
    if (!actionTarget.value || busy.value || readOnly.value || !newTitle.value.trim()) return;
    void change(actionTarget.value, { title: newTitle.value });
}
function renameOnEnter(event: KeyboardEvent) {
    if (event.isComposing || event.keyCode === 229) return;
    submitRename();
}
async function open(row: FileListRow) {
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
        previewProjectLocations.value = [];
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
        if (request === previewGeneration) error.value = fileErrorMessage(caught, 'This item could not be opened. Refresh Files and try again.');
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
    } catch (caught) { error.value = fileErrorMessage(caught, 'This document could not be opened. Refresh Files and try again.'); }
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
            const markdown = await documentToMarkdown(JSON.parse(current.content), origin.db);
            const latest = await origin.db.posts.get(row.id);
            origin.assertCurrent();
            if (!latest || !isVisibleWorkspaceItem(latest) || JSON.stringify(latest) !== JSON.stringify(current)) {
                throw new Error('This document changed. Download it again.');
            }
            downloadBlob(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }), `${current.title}.md`);
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
        downloadBlob(blob, current.title);
    } catch (caught) { error.value = fileErrorMessage(caught, 'The download could not be completed. Try again.'); }
}

let askInChatRequest = 0;
async function askInChat(row: Post) {
    const request = ++askInChatRequest;
    let origin: WorkspaceOperationScope | undefined;
    let openingChat = false;
    let targetStillActive: (() => boolean) | undefined;
    let failureMessage = 'This item could not be added to chat. Try again.';
    const assertCurrent = () => {
        // Opening the target chat can unmount this pane. The handoff still
        // belongs to the original workspace and most recent Files action.
        if ((!openingChat && disposed) || request !== askInChatRequest)
            throw new DOMException('Files action is no longer current', 'AbortError');
        origin?.assertCurrent();
    };
    error.value = '';
    try {
        origin = scope ?? capture();
        const sourceKind = row.postType === 'doc' ? 'document' : 'file';
        const [{ readWorkspaceItem }, { getGlobalMultiPaneApi }, { getPaletteHostContext },
            { getPaneInputTabId, hasPane, programmaticInsertReference, programmaticAttachStoredFile, waitForPaneInput },
            { getOpenWorkspaceTabs }] = await Promise.all([
            import('~/utils/chat/workspace-items'),
            import('~/utils/multiPaneApi'),
            import('~/composables/search/useCommandPalette'),
            import('~/composables/chat/useChatInputBridge'),
            import('~/core/search/command-palette/sources/workspace-tab-source'),
        ]);
        assertCurrent();
        const current = await readWorkspaceItem(origin, { kind: sourceKind, id: row.id });
        assertCurrent();
        let attachment: StoredAttachment | undefined;
        if (sourceKind === 'file') {
            const hash = parseFileHashes((current.row as Post).file_hashes)[0];
            const meta = hash ? await origin.db.file_meta.get(hash) : undefined;
            const { resolveStoredFileKind } = await import('~/db/files');
            assertCurrent();
            if (!meta || meta.deleted) throw new Error('That saved file is unavailable.');
            const kind = resolveStoredFileKind(meta);
            if (kind === 'image' || kind === 'pdf') {
                failureMessage = 'This file could not be attached. Try again from Files.';
                const { loadStoredAttachment, StoredAttachmentOfflineError } = await import('~/components/chat/file-upload-utils');
                try {
                    attachment = await loadStoredAttachment({
                        id: row.id, hash: meta.hash, kind, workspaceId: origin.workspaceId, generation: origin.generation,
                    }, { signal: origin.signal, assertCurrent });
                } catch (caught) {
                    if (!(caught instanceof StoredAttachmentOfflineError)) throw caught;
                    assertCurrent();
                    error.value = caught.message;
                    return;
                }
            }
        }
        assertCurrent();
        const api = getGlobalMultiPaneApi();
        const host = getPaletteHostContext();
        if (!api || !host) throw new Error('Chat navigation is unavailable.');
        const chatIndex = api.panes.value.findIndex(pane => pane.mode === 'chat');
        const chatPane = api.panes.value[chatIndex];
        const paneId = chatPane?.id ?? api.activePaneId.value;
        if (!paneId) throw new Error('The chat composer is unavailable.');
        const previousChat = chatPane ? undefined : getOpenWorkspaceTabs()
            .filter(tab => tab.resource.kind === 'chat').sort((a, b) => b.lastActivatedAt - a.lastActivatedAt)[0];
        const savedThreadId = previousChat?.resource.kind === 'chat' ? previousChat.resource.threadId : null;
        const targetThread = chatPane?.pendingThreadId ?? chatPane?.threadId ?? savedThreadId ?? '';
        const targetTab = chatPane ? getPaneInputTabId(paneId) : host.openWorkspaceTab ? previousChat?.id : undefined;
        const isTargetChat = () => {
            const pane = api.getPaneById(paneId);
            return api.activePaneId.value === paneId && pane?.mode === 'chat'
                && (pane.threadId ?? '') === targetThread
                && (pane.pendingThreadId === undefined || pane.pendingThreadId === targetThread)
                && (!targetTab || !hasPane(paneId) || hasPane(paneId, targetTab));
        };
        openingChat = true;
        if (chatPane) api.setActive(chatIndex);
        else {
            const opened = targetTab && host.openWorkspaceTab
                ? await host.openWorkspaceTab(targetTab) : await host.openChat(savedThreadId, 'active');
            assertCurrent();
            if (opened.ok ? opened.superseded : opened.error.code === 'not-found') return;
            if (!opened.ok) throw new Error(opened.error.message);
        }
        targetStillActive = isTargetChat;
        await nextTick();
        assertCurrent();
        const ready = await waitForPaneInput(paneId, origin.signal, targetTab);
        assertCurrent();
        if (!isTargetChat()) return;
        if (!ready) throw new Error('The chat composer is unavailable.');
        let result: ReturnType<typeof programmaticInsertReference>;
        if (attachment) {
            result = await programmaticAttachStoredFile(paneId, attachment);
        } else {
            const latest = await readWorkspaceItem(origin, { kind: sourceKind, id: row.id });
            assertCurrent();
            if (!isTargetChat()) return;
            result = programmaticInsertReference(paneId, { id: row.id, source: sourceKind, label: latest.source.title });
        }
        assertCurrent();
        if (!isTargetChat()) return;
        if (result.status !== 'ready') {
            if (!attachment) failureMessage = 'This chat cannot accept references. Enable mentions and retry.';
            throw new Error(failureMessage);
        }
        preview.value = false;
    } catch (caught) {
        try { assertCurrent(); } catch { return; }
        if (targetStillActive?.() === false) return;
        if (openingChat) reportError(caught, { message: failureMessage, toast: true, tags: { domain: 'files' } });
        else error.value = fileErrorMessage(caught, failureMessage);
    }
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
        feedback.value = 'Removed from Files. Copies used elsewhere are still available.';
    }, 'The item could not be removed. Try again.');
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
    const destination = activeExplorer.value ? folderId.value : null;
    await run(async origin => {
        const { prepareDocumentCreate } = await import('~/db/documents');
        const { getWriteTxTableNames } = await import('~/db/util');
        const prepared = await prepareDocumentCreate({});
        origin.assertCurrent('write');
        await origin.db.transaction('rw', getWriteTxTableNames(origin.db, 'posts'), async () => {
            origin.assertCurrent('write');
            await origin.db.posts.add(prepared.row);
            origin.assertCurrent('write');
        });
        try { await prepared.afterCommit(); } catch (caught) { console.warn('Document saved; notification failed.', caught); }
        if (destination) {
            try {
                await moveExplorerRows(origin, filesScope,
                    [{ row: { kind: 'item', item: { kind: 'document', item_id: prepared.row.id } }, expected: null }],
                    destination);
            } catch { feedback.value = 'Document saved to Files root. The selected folder could not be used.'; }
        }
        origin.assertCurrent();
        const row = await origin.db.posts.get(prepared.row.id);
        origin.assertCurrent();
        if (row) await openEditor(row);
    });
}

watch([query, typeFilter, projectFilter], scheduleFilesRefresh);
watch(trash, () => {
    // Never render a snapshot with actions belonging to the other view.
    rows.value = [];
    more.value = false;
    limit.value = 50;
    clearTimeout(timer);
    void refresh();
});
watch([folderId, searchAll], () => { if (query.value.trim()) scheduleFilesRefresh(); });
function scheduleFilesRefresh() {
    limit.value = 50;
    clearTimeout(timer);
    timer = setTimeout(() => void refresh(), 120);
}
watch(preview, open => { if (!open) releasePreviewImage(); });
watch(() => props.recordId, async id => {
    if (!id || !scope) return;
    const origin = scope;
    try {
        const row = await origin.db.posts.get(id);
        origin.assertCurrent();
        if (!disposed && origin === scope && row && isVisibleWorkspaceItem(row)) await open(row);
    } catch (caught) {
        if (!disposed && origin === scope) { clearPreview(); error.value = fileErrorMessage(caught, 'This file could not be opened. Refresh Files and try again.'); }
    }
});
function resetScope() {
    if (disposed) return;
    undo.clear();
    generation++; scope = null; organization.value = undefined;
    filesWorkspace.value = getActiveWorkspaceId() ?? 'local';
    clearSelection(); revealId = undefined; rows.value = []; fileDetails.value = {}; clearPreview(); rename.value = false;
    folderDialog.value = false; moveDialog.value = false; removeFolderDialog.value = false; bulkTrash.value = false;
    associate.value = false; remove.value = false; existingCursor.value = ''; existingComplete.value = false;
    failures.value = []; uploadResult.value = ''; clearTimeout(uploadResultTimer); projects.value = []; readOnly.value = true; projectFilter.value = 'all'; actionTarget.value = null;
    organizationSubscription?.unsubscribe(); previewSubscription?.unsubscribe(); clearTimeout(resultTimer);
    subscription?.unsubscribe(); subscription = undefined; void initialize();
}
watch([
    () => sessionData.value?.session?.user?.id,
    () => sessionData.value?.session?.role,
    () => sessionData.value?.session?.authorizationRevision,
    () => sessionData.value?.session?.authenticated,
    explorerEnabled,
], resetScope);
// The container query widths in the styles below (page and list).
const LAYOUT_BREAKPOINTS = [600, 800, 1050];
const layoutTier = (width: number) => LAYOUT_BREAKPOINTS.filter(breakpoint => width > breakpoint).length;
let pageTier: number | undefined;
let listTier: number | undefined;
// Opening or closing a split crosses breakpoints in one frame (table ↔ cards).
// Fade the content in its new layout instead of cutting to it.
function softenLayoutChange(page: HTMLElement) {
    const list = page.querySelector<HTMLElement>('.files-list');
    const nextPageTier = layoutTier(page.clientWidth);
    const nextListTier = list ? layoutTier(list.clientWidth) : undefined;
    const changed = (pageTier !== undefined && nextPageTier !== pageTier)
        || (listTier !== undefined && nextListTier !== undefined && nextListTier !== listTier);
    pageTier = nextPageTier;
    listTier = nextListTier;
    if (changed && !window.matchMedia('(prefers-reduced-motion: reduce)').matches)
        page.querySelector('.files-content')?.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
}
onMounted(async () => {
    if (pageElement.value) {
        const page = pageElement.value;
        // Match DocumentEditorRoot.css: full-pane inspector below 720px.
        resizeObserver = new ResizeObserver(entries => {
            paneWidth.value = entries[0]?.contentRect.width ?? 0;
            softenLayoutChange(page);
        });
        resizeObserver.observe(pageElement.value);
    }
    stop = subscribeActiveWorkspaceDb(resetScope);
    await initialize();
});
function observeOrganization(origin: WorkspaceOperationScope) {
    organizationSubscription?.unsubscribe();
    organizationSubscription = liveQuery(async () => readExplorerOrganization(origin, filesScope)).subscribe({
        next: state => {
            if (disposed || origin !== scope) return;
            organization.value = state;
            const folder = folderId.value;
            if (folder && state.tree.folders.get(folder)?.deleted !== false) {
                navigateFolder(state.tree.folderLocations.get(folder)?.parentId ?? null);
            } else if (folder && !searchAll.value && !trash.value && query.value.trim()) {
                scheduleFilesRefresh();
            }
        },
        error: cause => {
            if (!disposed && origin === scope) organizationError.value = fileErrorMessage(cause, 'Folders could not be loaded.');
        },
    });
}
async function initialize() {
    let origin: WorkspaceOperationScope | null = null;
    try {
        scope = capture(); readOnly.value = !scope.writable;
        origin = scope;
        if (explorerEnabled.value) await importPreviewExplorerRecords(origin, filesScope);
        if (origin.writable) await catalogExistingImages(origin);
        origin.assertCurrent();
        if (disposed || origin !== scope) return;
        if (explorerEnabled.value) observeOrganization(origin);
        await refresh();
        if (disposed || origin !== scope) return;
        if (props.recordId) {
            const row = await origin.db.posts.get(props.recordId);
            origin.assertCurrent();
            if (row && isVisibleWorkspaceItem(row)) await open(row);
        }
    } catch (caught) {
        if (disposed || origin !== scope) return;
        clearPreview(); error.value = fileErrorMessage(caught, 'Files could not be loaded. Try again.'); loading.value = false;
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
onBeforeUnmount(() => { resizeObserver?.disconnect(); disposed = true; generation++; clearTimeout(typeaheadTimer); releasePreviewImage(); clearTimeout(timer); clearTimeout(uploadResultTimer); stop?.(); subscription?.unsubscribe(); organizationSubscription?.unsubscribe(); previewSubscription?.unsubscribe(); clearTimeout(resultTimer); });
</script>

<template>
    <section ref="pageElement" aria-label="Workspace Files" class="files-page" :data-explorer-dragging="dragging || undefined" :data-preview="preview && widePreview" :data-compact-preview="preview && !widePreview" :data-selecting="activeExplorer && (selectMode || selectedRows.size > 0) || undefined">
        <nav v-if="navigatorAvailable && showNavigator" aria-label="Files folders" class="files-navigator">
            <UButton v-explorer-drag="{ destination: null, label: 'Files root' }" color="neutral" variant="ghost" size="workspace" label="Files root" :icon="icons.folder.value"
                :aria-current="folderId === null ? 'location' : undefined" @click="navigateFolder(null)" />
            <UTree v-if="navigatorFolders.length" v-model:expanded="navigatorExpanded" :items="navigatorFolders"
                :get-key="item => item.id" :virtualize="{ estimateSize: 40, overscan: 6 }"
                aria-label="Folders" class="files-navigator-tree">
                <template #item-wrapper="{ item, level, expanded }">
                    <div v-explorer-drag="{ destination: item.id, label: item.path }" class="flex min-w-0 items-center" :style="{ paddingInlineStart: Math.min((level - 1) * 12, 48) + 'px' }">
                        <UButton v-if="item.children?.length" color="neutral" variant="ghost" size="workspace"
                            :icon="expanded ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                            :aria-label="(expanded ? 'Collapse ' : 'Expand ') + item.label"
                            :aria-expanded="expanded" @click.stop="navigatorExpanded = expanded ? navigatorExpanded.filter(id => id !== item.id) : [...navigatorExpanded, item.id]" />
                        <UButton color="neutral" variant="ghost" size="workspace" class="min-w-0 flex-1 justify-start"
                            :label="item.label" :title="item.path" :ui="{ label: 'truncate' }"
                            :aria-current="folderId === item.id ? 'location' : undefined" @click.stop="navigateFolder(item.id)" />
                    </div>
                </template>
            </UTree>
        </nav>
        <div v-show="!preview || widePreview" class="files-content" @keydown="undo.onKey">
            <header class="files-header" :data-trash="trash">
                <div class="files-heading">
                    <UButton v-if="trash" class="files-back" size="workspace" color="neutral" variant="ghost" label="Files" aria-label="Back to files"
                        icon="i-lucide-arrow-left" @click="setTrashView(false)" />
                    <h1 ref="filesHeading" tabindex="-1">{{ trash ? 'Trash' : 'Files' }}</h1>
                    <p v-if="!compact || trash">{{ trash ? 'Restore items to put them back where they were.' : 'Your documents and uploads, all in one place.' }}</p>
                </div>
                <div v-if="!trash" class="files-header-actions">
                    <template v-if="compact">
                        <UButton size="workspace" aria-label="New document" icon="i-lucide-file-plus" color="neutral" variant="ghost" square :disabled="busy || readOnly" @click="newDocument" />
                        <UButton v-if="activeExplorer" size="workspace" :aria-label="'New folder in ' + folderLabel" icon="i-lucide-folder-plus" color="neutral" variant="ghost" square :disabled="busy || readOnly" @click="openFolderDialog()" />
                        <UDropdownMenu :ui="menuUi" :content="{ align: 'end', sideOffset: 6 }" :items="[
                            { label: 'Trash', icon: icons.trash.value, onSelect: () => setTrashView(true) },
                            ...(hasPartialSelection ? [{ label: 'Select all results', onSelect: selectAll }] : []),
                            { label: 'Add existing uploads', icon: icons.upload.value, disabled: busy || readOnly || existingComplete, onSelect: addExisting },
                        ]">
                            <UButton size="workspace" :icon="icons.more.value" aria-label="Files options" color="neutral" variant="ghost" square />
                        </UDropdownMenu>
                        <UButton size="workspace" class="files-upload-button" label="Upload" :aria-label="activeExplorer ? 'Upload to ' + folderLabel : 'Upload'" :icon="icons.upload.value" :disabled="busy || readOnly" @click="chooseUpload" />
                    </template>
                    <template v-else>
                        <UButton size="workspace" label="New document" :icon="icons.document.value" color="neutral" variant="outline" :disabled="busy || readOnly" @click="newDocument" />
                        <UButton v-if="activeExplorer" size="workspace" label="New folder" :aria-label="'New folder in ' + folderLabel" :icon="icons.folder.value" color="neutral" variant="outline" :disabled="busy || readOnly" @click="openFolderDialog()" />
                        <UButton size="workspace" label="Upload" :aria-label="activeExplorer ? 'Upload to ' + folderLabel : 'Upload'" :icon="icons.upload.value" :disabled="busy || readOnly" @click="chooseUpload" />
                        <span class="files-header-divider" aria-hidden="true" />
                        <UTooltip text="Trash">
                            <UButton size="workspace" color="neutral" variant="ghost" aria-label="Trash" :icon="icons.trash.value" square @click="setTrashView(true)" />
                        </UTooltip>
                        <UDropdownMenu :ui="menuUi" :content="{ align: 'end', sideOffset: 6 }" :items="[
                            { label: 'Add existing uploads', icon: icons.upload.value, disabled: busy || readOnly || existingComplete, onSelect: addExisting },
                        ]">
                            <UButton size="workspace" :icon="icons.more.value" aria-label="Files options" color="neutral" variant="ghost" square />
                        </UDropdownMenu>
                    </template>
                </div>
            </header>
            <input ref="uploadInput" type="file" multiple aria-label="Upload files" hidden tabindex="-1" aria-hidden="true" :disabled="busy || readOnly" @change="upload">
            <div class="files-toolbar">
                <UInput v-model="query" :aria-label="trash ? 'Search trash' : 'Search Files'" :placeholder="trash ? 'Search deleted files…' : 'Search files or their contents…'" :icon="icons.search.value" class="files-search" size="workspace" />
                <div class="files-filters">
                    <USelect v-model="typeFilter" aria-label="File type" size="workspace" class="files-filter" :ui="filterUi" :items="[{ label: 'All types', value: 'all' }, { label: 'Documents', value: 'document' }, { label: 'Uploads', value: 'file' }, { label: 'Images', value: 'image' }]" />
                    <USelect v-model="projectFilter" aria-label="Filter by project" size="workspace" class="files-filter" :ui="{ ...filterUi, content: 'min-w-[240px] max-w-[calc(100vw-2rem)]' }" :items="[{ label: 'All projects', value: 'all' }, ...projects.map(project => ({ label: project.name, value: project.id }))]" />
                    <USelect v-if="activeExplorer" v-model="sort" aria-label="Sort Files" size="workspace" class="files-filter" :ui="filterUi"
                        :items="[{ label: 'Recently modified', value: 'recent' }, { label: 'Name', value: 'name' }, { label: 'Type', value: 'type' }]" />
                </div>
            </div>
            <div v-if="readOnly || feedback || error" class="files-notices">
                <p v-if="readOnly" role="status">This workspace is read-only.</p>
                <p v-if="feedback" role="status">{{ feedback }}</p>
                <UAlert v-if="error && !rename && !associate && !remove" role="alert" color="error" variant="soft" title="Files action failed" :description="error">
                    <template #actions><UButton size="workspace" label="Refresh files" color="neutral" variant="ghost" @click="refresh" /></template>
                </UAlert>
            </div>
            <div role="status">
                <Transition name="files-upload" mode="out-in">
                    <div v-if="uploadStatus" class="files-upload">
                        <div class="files-upload-line">
                            <UIcon :name="icons.upload.value" class="files-upload-icon size-4" />
                            <span class="files-upload-text">
                                {{ uploadStatus.total > 1 ? `Uploading ${uploadStatus.index} of ${uploadStatus.total} files ·` : 'Uploading' }}
                                <strong :title="uploadStatus.name">{{ uploadStatus.name }}</strong>
                            </span>
                            <span class="files-upload-phase">{{ uploadStatus.uploading ? 'Uploading…' : 'Preparing…' }}</span>
                        </div>
                        <UProgress :model-value="null" size="xs" color="primary" aria-label="Upload in progress" />
                    </div>
                    <div v-else-if="uploadResult" class="files-upload" data-state="complete">
                        <p class="files-upload-line"><UIcon :name="icons.check.value" class="files-upload-icon size-4" />{{ uploadResult }}
                            <UButton v-if="uploadReveal" size="workspace" label="Show in Files" color="neutral" variant="ghost" @click="revealInFiles(uploadReveal)" />
                        </p>
                    </div>
                </Transition>
            </div>
            <ul v-if="failures.length" aria-label="Failed uploads" class="files-upload-failures">
                <li v-for="failure in failures" :key="failure.file.name" class="files-upload files-upload-line" data-state="failed">
                    <UIcon :name="icons.warning.value" class="files-upload-icon size-4" />
                    <span class="files-upload-text"><strong>Couldn’t upload {{ failure.file.name }}</strong> <span class="files-upload-reason">{{ failure.error }}</span></span>
                    <UButton size="workspace" label="Retry upload" color="neutral" variant="outline" :disabled="busy || readOnly" @click="intake([failure.file], true)" />
                </li>
            </ul>
            <template v-if="activeExplorer">
                <div class="files-explorer-tools">
                    <span class="sr-only" role="status">{{ dragAnnouncement }}</span>
                    <UButton v-if="navigatorAvailable" size="workspace" color="neutral" variant="ghost" :icon="icons.folder.value"
                        :aria-pressed="showNavigator" :label="showNavigator ? 'Hide folders' : 'Show folders'" @click="showNavigator = !showNavigator" />
                    <span v-if="compact && !folderPath.length" class="files-count">{{ listRows.length }} {{ listRows.length === 1 ? 'item' : 'items' }}</span>
                    <nav aria-label="Files location" class="files-breadcrumbs" :class="{ 'sr-only': compact && !folderPath.length }">
                        <UButton v-explorer-drag="{ destination: null, label: 'Files root' }" color="neutral" variant="ghost" label="Files" size="workspace" @dragover="dropFiles($event, null)" @drop="dropFiles($event, null)" :aria-current="folderId === null ? 'location' : undefined" :tabindex="compact && !folderPath.length ? -1 : undefined" @click="navigateFolder(null)" />
                        <template v-for="folder in folderPath" :key="folder.id">
                            <span aria-hidden="true">/</span>
                            <UButton v-explorer-drag="{ destination: folder.id, label: folder.payload.name }" color="neutral" variant="ghost" :label="organization?.tree.label(folder)" size="workspace" @dragover="dropFiles($event, folder.id)" @drop="dropFiles($event, folder.id)" :aria-current="folder.id === folderId ? 'location' : undefined" @click="navigateFolder(folder.id)" />
                        </template>
                    </nav>
                    <USelect v-if="filterActive" :model-value="searchAll ? 'all' : 'folder'" aria-label="Search location" size="workspace"
                        :items="[{ label: 'This folder', value: 'folder' }, { label: 'All Files', value: 'all' }]" @update:model-value="searchAll = $event === 'all'" />
                    <UButton size="workspace" color="neutral" variant="ghost" :label="selectMode ? 'Done' : 'Select'" :aria-pressed="selectMode" @click="selectMode = !selectMode" />
                    <UButton v-if="selectMode && !selectedRows.size" size="workspace" color="neutral" variant="ghost"
                        label="Select all results" @click="selectAll" />
                </div>
                <div v-if="dragging ? toolbarBeforeDrag : selectedRows.size" class="files-explorer-tools files-selection-bar">
                    <span aria-live="polite" class="text-muted">{{ selectedRows.size }} selected</span>
                    <UButton v-if="!compact" size="workspace" color="neutral" variant="ghost" label="Select all results" @click="selectAll" />
                    <UButton size="workspace" color="neutral" variant="ghost" label="Clear" @click="clearSelection" />
                    <span v-if="compact" class="flex-1" aria-hidden="true" />
                    <UButton size="workspace" color="neutral" :variant="compact ? 'ghost' : 'outline'" :label="compact ? undefined : bulkTrashLabel"
                        :aria-label="bulkTrashLabel" :icon="compact ? icons.trash.value : undefined" :square="compact"
                        :title="selectedIncludesFolders ? 'Select files and documents only' : undefined"
                        :disabled="selectedIncludesFolders || !selectedRows.size || selectedRows.size > EXPLORER_MAX_WRITES || busy || readOnly" @click="bulkTrash = true" />
                    <span v-if="selectedIncludesFolders" class="files-selection-note text-muted text-xs">Select files and documents only to move them to Trash.</span>
                    <UButton size="workspace" label="Move to…" :disabled="!selectedRows.size || selectedRows.size > EXPLORER_MAX_WRITES || busy || readOnly" @click="openMove" />
                </div>
                <UAlert v-if="organizationError && !folderDialog" role="alert" :description="organizationError" color="error" variant="soft" class="mb-3" />
            </template>
            <div class="files-list" @dragover="dropFiles($event, folderId)" @drop="dropFiles($event, folderId)">
                <div class="files-columns" :data-trash="trash" :data-checkboxes="activeExplorer || undefined" aria-hidden="true">
                    <span class="files-name-label">Name</span><span class="files-type-column">Type</span><span class="files-project-column">{{ activeExplorer && filterActive || explorerEnabled && trash ? 'Files location' : 'Project' }}</span><span class="files-date-column">Last modified</span><span class="files-size-column">Size</span><span />
                </div>
                <div v-if="loading && !listRows.length" class="files-empty or3-loading-delay" role="status">
                    <UIcon :name="icons.folder.value" class="size-9 opacity-50" /><p>Loading your files…</p>
                </div>
                <div v-else-if="!listRows.length && !error" class="files-empty">
                    <div class="files-empty-icon"><UIcon :name="query ? icons.search.value : trash ? icons.trash.value : icons.folder.value" class="size-8" /></div>
                    <h2>{{ query ? 'No matching files' : trash ? 'Trash is empty' : 'A home for your work' }}</h2>
                    <p>{{ query ? 'Try a different name or a few words from the file.' : trash ? 'Files you move to trash will appear here.' : 'Upload a file or create a document to get started.' }}</p>
                    <UButton v-if="!query && !trash" size="workspace" label="Upload your first file" :icon="icons.upload.value" :disabled="busy || readOnly" @click="chooseUpload" />
                </div>
                <div v-else ref="listViewport" :class="{ 'files-viewport': explorerEnabled }"
                    @keydown.esc.stop="clearSelection" @keydown="listKey">
                <ul :aria-label="trash ? 'Trash' : 'Files'" class="files-rows"
                    :style="explorerEnabled ? { position: 'relative', height: virtualizer.getTotalSize() + 'px' } : undefined">
                    <li v-for="entry in renderedRows" :key="entry.key" class="files-row"
                        :data-list-index="entry.index" @dragover="entry.kind === 'folder' && dropFiles($event, entry.folder.id)"
                        @drop="entry.kind === 'folder' && dropFiles($event, entry.folder.id)"
                        v-explorer-drag="activeExplorer && (entry.kind === 'folder'
                            ? { source: entry.key, destination: entry.folder.id, label: entry.folder.payload.name }
                            : { source: entry.key, label: entry.file.title })"
                        :style="explorerEnabled ? { position: 'absolute', insetInline: '0', top: entry.start + 'px', height: rowHeight + 'px' } : undefined"
                        :data-trash="trash" :data-selected="selectedRows.has(entry.key) || (entry.kind === 'file' && preview && selected?.id === entry.file.id)">
                        <template v-if="entry.kind === 'folder'">
                            <div class="files-name-cell">
                                <input type="checkbox" :aria-label="'Select ' + entry.folder.payload.name" :checked="selectedRows.has(entry.key)"
                                    class="accent-(--ui-primary)" @click.stop="choose(entry.key, $event, true)">
                                <span data-explorer-drag-handle class="files-kind-icon"><UIcon :name="icons.folder.value" class="size-5" /></span>
                                <UButton size="workspace" :label="organization?.tree.label(entry.folder)" color="neutral" variant="ghost"
                                    class="files-name-button" :title="recoveredPath(entry) ?? entry.folder.payload.name" @click="choose(entry.key, $event) && navigateFolder(entry.folder.id)" />
                                <UTooltip v-if="recoveredPath(entry)" :text="recoveredPath(entry)">
                                    <UButton :icon="icons.warning.value" size="workspace" color="neutral" variant="ghost" square :aria-label="recoveredPath(entry)" />
                                </UTooltip>
                            </div>
                            <span class="files-type-column">Folder</span><span class="files-project-column" /><span class="files-date-column" /><span class="files-size-column" />
                            <div class="files-row-actions">
                                <UDropdownMenu :ui="menuUi" :items="folderActions(entry.folder)" @update:open="open => { if (open) selectRowMenu(entry.key); }">
                                    <UButton size="workspace" :icon="icons.more.value" :aria-label="'More actions for ' + entry.folder.payload.name" color="neutral" variant="ghost" square />
                                </UDropdownMenu>
                            </div>
                        </template>
                        <template v-else>
                        <template v-for="row in [entry.file]" :key="row.id">
                        <div class="files-name-cell">
                            <input v-if="activeExplorer" type="checkbox" :aria-label="'Select ' + row.title" :checked="selectedRows.has(entry.key)"
                                class="accent-(--ui-primary)" @click.stop="choose(entry.key, $event, true)">
                            <PaletteImageThumb v-if="row.postType === FILE_CATALOG_POST_TYPE && isSupportedRasterMimeType(detail(row)?.mime_type ?? '')" :key="`${scope?.workspaceId}:${row.id}`" :hash="parseFileHashes(row.file_hashes)[0]!" alt="" :fallback-icon="fileIcon(row)" :size-bytes="detail(row)?.size_bytes" class="size-8! rounded-[var(--md-border-radius-small)]!" />
                            <span v-else data-explorer-drag-handle class="files-kind-icon" :data-kind="fileType(row)"><UIcon :name="fileIcon(row)" class="size-5" /></span>
                            <div class="files-name-text">
                                <UButton size="workspace" :label="row.title" :aria-label="'Open ' + row.title" color="neutral" variant="ghost" class="files-name-button" :ui="{ base: 'px-0! gap-0! py-0! h-auto! min-h-5! max-md:h-auto! max-md:min-h-5!' }" :title="row.title" @click="activateFile(row, $event)" />
                                <span class="files-mobile-detail">{{ fileType(row) }} · {{ modifiedDate(row) }}</span>
                                <span v-if="explorerEnabled && (filterActive || trash)" class="files-mobile-detail truncate">
                                    {{ trash ? 'Restores to' : 'Files location' }} · {{ filePath(row) }}
                                </span>
                                <span v-if="recoveredPath(entry)" class="files-muted block truncate text-xs" :title="recoveredPath(entry)">
                                    {{ recoveredPath(entry) }}
                                </span>
                            </div>
                        </div>
                        <span class="files-type-column"><span class="files-type-badge" :data-kind="fileType(row)">{{ fileType(row) }}</span></span>
                        <span v-if="explorerEnabled && (filterActive || trash)" class="files-project-column files-project" :title="filePath(row)">
                            <span>{{ trash ? 'Restores to ' : '' }}{{ filePath(row) }}</span>
                        </span>
                        <span v-else class="files-project-column files-project" :title="projectNames(row).join(', ')">
                            <UIcon v-if="projectNames(row).length" :name="icons.folder.value" class="size-4 shrink-0" />
                            <span>{{ projectNames(row)[0] ?? '—' }}{{ projectNames(row).length > 1 ? ' +' + (projectNames(row).length - 1) : '' }}</span>
                        </span>
                        <span class="files-date-column files-muted">{{ modifiedDate(row) }}</span>
                        <span class="files-size-column files-muted">{{ formatSize(row) }}</span>
                        <div class="files-row-actions">
                            <template v-if="trash">
                                <UButton size="workspace" label="Restore" color="neutral" variant="ghost" :disabled="busy || readOnly" @click="withFileRow(row, current => change(current, { trashed: false }))" />
                                <UDropdownMenu :ui="menuUi" :content="{ align: 'end', sideOffset: 6 }" :items="[{ label: 'Remove entry', color: 'error', disabled: busy || readOnly, onSelect: () => withFileRow(row, current => { error = ''; actionTarget = current; remove = true; }) }]">
                                    <UButton size="workspace" :icon="icons.more.value" :aria-label="'More actions for ' + row.title" color="neutral" variant="ghost" square />
                                </UDropdownMenu>
                            </template>
                            <UDropdownMenu v-else :ui="menuUi" :content="{ align: 'end', sideOffset: 6 }" :items="rowActions(row)"
                                @update:open="open => { if (open) selectRowMenu(entry.key); }">
                                <UButton size="workspace" :icon="icons.more.value" :aria-label="'More actions for ' + row.title" color="neutral" variant="ghost" square />
                            </UDropdownMenu>
                        </div>
                        </template>
                        </template>
                    </li>
                </ul>
                </div>
                <footer v-if="listRows.length" class="files-footer" :data-count-shown="compact && activeExplorer && !folderPath.length || undefined">
                    <span class="files-footer-count">{{ listRows.length }} {{ activeExplorer ? (listRows.length === 1 ? 'item' : 'items') : (listRows.length === 1 ? 'file' : 'files') }}{{ more ? ' shown' : '' }}{{ activeExplorer && query.trim() ? ' · Up to 200 search results' : '' }}</span>
                    <UButton v-if="more" size="workspace" label="Load more" color="neutral" variant="outline" :disabled="loading" @click="limit += 50; refresh()" />
                </footer>
            </div>
        </div>
        <Transition name="files-inspector">
        <aside v-if="preview" aria-label="File preview" class="files-inspector" :class="{ 'files-inspector-compact': !widePreview }" @keydown.esc.stop="closePreview">
            <div class="files-inspector-header"><h2 ref="previewHeading" tabindex="-1">File preview</h2><UButton size="workspace" :icon="closeIcon" aria-label="Close" color="neutral" variant="ghost" square @click="closePreview" /></div>
            <div class="files-inspector-body">
            <WorkspaceFilePreview v-if="selected" :title="selected.title" :type="fileType(selected)" :size="formatSize(selected)" :icon="fileIcon(selected)" :coverage="textCoverage(selected)" :project="projectNames(selected).join(', ')"
                :files-location="explorerEnabled ? filePath(selected) : undefined" :project-locations="explorerEnabled ? previewProjectLocations : undefined"
                @reveal="revealInFiles(selected)" @reveal-project="revealInProject" :text="previewText" :image-url="previewImageUrl" :partial="workspaceItemMetadata(selected.meta)?.text?.coverage !== 'full'" :disabled="trash" :document="selected.postType === 'doc'" :status="previewSyncStatus" @ask="askInChat(selected)" @download="download" @open="openEditor(selected)" />
            <UAlert v-if="error" role="alert" color="error" variant="soft" title="Could not open item" :description="error" />
            </div>
        </aside>
        </Transition>
        <ExplorerMoveDialog v-if="activeExplorer" v-model="moveDialog" label="Files" :folders="destinations" :busy="busy" :error="organizationError" :create-folder="createMoveDestination" @move="moveSelection" />
        <AppModal v-model:open="removeFolderDialog" title="Remove folder, keep contents">
            <p v-if="folderRemoval">
                {{ folderRemoval.counts.file }} {{ folderRemoval.counts.file === 1 ? 'file' : 'files' }},
                {{ folderRemoval.counts.document }} {{ folderRemoval.counts.document === 1 ? 'document' : 'documents' }} and
                {{ folderRemoval.counts.folder }} {{ folderRemoval.counts.folder === 1 ? 'subfolder' : 'subfolders' }} will move to
                {{ folderRemoval.destination ? 'Files / ' + folderRemoval.destination : 'Files root' }}.
                <span v-if="folderRemoval.counts.hidden">{{ folderRemoval.counts.hidden }} entries are hidden or in Trash.</span>
            </p>
            <UAlert v-if="organizationError" role="alert" :description="organizationError" color="error" variant="soft" class="mt-3" />
            <template #footer>
                <UButton size="workspace" label="Cancel" color="neutral" variant="ghost" @click="removeFolderDialog = false" />
                <UButton size="workspace" label="Remove folder" :loading="busy" @click="finishRemoveFolder" />
            </template>
        </AppModal>
        <AppModal v-model:open="bulkTrash" :title="bulkTrashLabel">
            <p>You can restore these items from Files Trash.</p>
            <template #footer>
                <UButton size="workspace" label="Cancel" color="neutral" variant="ghost" @click="bulkTrash = false" />
                <UButton size="workspace" color="error" label="Move to Trash" :loading="busy" @click="executeBulkTrash" />
            </template>
        </AppModal>
        <AppModal v-model:open="folderDialog" :title="editingFolder ? 'Rename folder in Files' : 'New folder in ' + folderLabel">
            <form id="files-folder-form" @submit.prevent="saveFolder">
                <UInput v-model="folderName" aria-label="Folder name" class="w-full" size="workspace" />
                <UAlert v-if="folderFormError" role="alert" :description="folderFormError" color="error" variant="soft" class="mt-3" />
            </form>
            <template #footer>
                <UButton size="workspace" label="Cancel" color="neutral" variant="ghost" @click="folderDialog = false" />
                <UButton size="workspace" :label="editingFolder ? 'Save name' : 'Create folder'" form="files-folder-form" type="submit" :loading="busy" :disabled="!folderName.trim()" />
            </template>
        </AppModal>
        <AppModal v-model:open="rename" title="Rename item" close-label="Close">
            <p class="mb-3 text-sm text-muted">This changes the shared title in Files and projects.</p>
            <UInput v-model="newTitle" aria-label="Item title" class="w-full" size="workspace" @keydown.enter="renameOnEnter" />
            <UAlert v-if="error" role="alert" color="error" variant="soft" title="Could not rename item" :description="error" class="mt-4" />
            <template #footer><UButton size="workspace" label="Save title" :loading="busy" :disabled="readOnly || !newTitle.trim()" @click="submitRename" /></template>
        </AppModal>
        <AppModal v-model:open="associate" title="Add to project" close-label="Close">
            <USelect v-model="associationProject" aria-label="Project" class="w-full" size="workspace" :ui="{ content: 'min-w-[240px] max-w-[calc(100vw-2rem)]' }" :items="projects.map(project => ({ label: project.name, value: project.id }))" />
            <UAlert v-if="error" role="alert" color="error" variant="soft" title="Could not update project" :description="error" class="mt-4" />
            <template #footer>
                <UButton size="workspace" label="Remove from project" color="neutral" variant="ghost" :disabled="busy || readOnly || !associationProject" @click="associateItem(true)" />
                <UButton size="workspace" label="Add to project" :disabled="busy || readOnly || !associationProject" @click="associateItem()" />
            </template>
        </AppModal>
        <AppModal v-model:open="remove" :title="actionTarget?.postType === 'doc' ? 'Remove document?' : 'Remove from Files?'" close-label="Cancel">
            <p>{{ actionTarget?.title }} will be removed from Files. Copies used by chats and other saved work will remain available.</p>
            <UAlert v-if="error" role="alert" color="error" variant="soft" title="Could not remove item" :description="error" class="mt-4" />
            <template #footer><UButton size="workspace" :label="actionTarget?.postType === 'doc' ? 'Remove document' : 'Remove catalog entry'" color="error" :disabled="busy || readOnly" @click="removeCatalog" /></template>
        </AppModal>
    </section>
</template>

<style scoped>
.files-page :deep([data-explorer-drop="true"]) {
    outline: var(--md-border-width, 1px) solid var(--md-primary);
    outline-offset: -2px;
    background: var(--md-surface-hover);
}

.files-row:has([data-explorer-drag-handle]), .files-row .files-name-button { cursor: grab; user-select: none; }
.files-viewport { max-height: min(64vh, 720px); overflow-y: auto; overscroll-behavior: contain; }
.files-explorer-tools { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px; margin-bottom: 8px; }
.files-selection-bar { padding: 6px 8px 6px 14px; border-radius: var(--md-border-radius-small); background: color-mix(in srgb, var(--md-primary) 6%, var(--md-surface)); font-size: 13px; }
.files-breadcrumbs { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 4px; flex-wrap: wrap; color: var(--md-on-surface-variant); }
.files-explorer-tools .files-breadcrumbs :deep(button) { min-width: 0; max-width: 100%; }
.files-row :deep([data-slot="label"]) { min-width: 0; overflow: hidden; text-overflow: ellipsis; }

.files-page { container-type: inline-size; position: relative; display: flex; min-width: 0; color: var(--md-on-surface); background: var(--md-surface); height: 100%; min-height: 0; overflow: hidden; }
.files-content { flex: 1; min-width: 0; min-height: 0; overflow-y: auto; overscroll-behavior: contain; max-width: 1440px; margin: 0 auto; padding: 32px; }
.files-navigator { flex: 0 0 224px; min-height: 0; padding: 24px 12px; border-inline-end: var(--md-border-width, 1px) solid var(--md-border-color, var(--md-outline-variant)); background: var(--md-surface-container-low, var(--md-surface)); }
.files-navigator-tree { max-height: calc(100% - 48px); overflow: auto; overscroll-behavior: contain; }
.files-navigator :deep([aria-current="location"]) { background: var(--md-surface-hover); color: var(--md-primary); }
.files-header { display: flex; align-items: center; justify-content: space-between; gap: 16px 24px; margin-bottom: 24px; }
.files-heading { min-width: 0; }
.files-header h1 { font-size: 28px; font-weight: 700; line-height: 1.2; letter-spacing: -0.03em; }
.files-header p { color: var(--md-on-surface-variant); font-size: 14px; margin-top: 6px; line-height: 1.5; }
.files-back { margin: -8px 0 2px -10px; color: var(--md-on-surface-variant); }
.files-header-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.files-header-actions :deep(button) { gap: 8px; white-space: nowrap; }
.files-header-actions :deep([data-slot="label"]) { letter-spacing: normal; }
.files-header-divider { width: 1px; height: 24px; margin-inline: 4px; background: var(--md-border-color, var(--md-outline-variant)); }
.files-toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
.files-filters { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.files-count { flex: 1; min-width: 0; font-size: 13px; color: var(--md-on-surface-variant); padding-inline: 4px; }
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
.files-page[data-selecting] .files-columns[data-checkboxes] .files-name-label { padding-left: 72px; }
.files-columns { min-height: 42px; font-size: 12px; font-weight: 500; color: var(--md-on-surface-variant); background: var(--md-surface-container-lowest,var(--md-surface-container-low,var(--md-surface-variant))); border-bottom: 1px solid var(--md-border-color,var(--md-outline-variant)); }
.files-rows { margin: 0; padding: 0; list-style: none; }
.files-row { min-height: 56px; border-bottom: 1px solid color-mix(in srgb, var(--md-border-color,var(--md-outline-variant)) 40%, var(--md-surface)); font-size: 13px; transition: background 120ms ease; }
.files-row:last-child { border-bottom: 0; }
@media (hover: hover) { .files-row:hover { background: var(--md-surface-hover); } }
.files-row[data-selected="true"] { background: color-mix(in srgb, var(--md-primary) 8%, var(--md-surface)); }
.files-name-cell { display: flex; gap: 12px; align-items: center; min-width: 0; }
.files-name-cell { position: relative; }
.files-name-cell > input[type="checkbox"] { flex-shrink: 0; width: 16px; height: 16px; transition: opacity 120ms ease; }
.files-name-cell > input[type="checkbox"] + * { transition: opacity 120ms ease; }
/* Outside selection mode the checkbox sits over the file icon and appears on hover or focus,
   so rows don't carry an empty checkbox gutter. */
.files-page:not([data-selecting]) .files-name-cell > input[type="checkbox"] { position: absolute; left: 8px; top: 50%; margin-top: -8px; z-index: 1; opacity: 0; }
.files-page:not([data-selecting]) .files-row:is(:hover, :focus-within) .files-name-cell > input[type="checkbox"] { opacity: 1; }
.files-page:not([data-selecting]) .files-row:is(:hover, :focus-within) .files-name-cell > input[type="checkbox"] + * { opacity: 0; }
/* The title stays compact; its hit area covers the whole title/detail block. */
.files-name-text :deep(button.files-name-button) { position: static; }
.files-name-text :deep(button.files-name-button)::after { content: ""; position: absolute; inset: -8px 0; }
.files-name-text { position: relative; min-width: 0; flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 1px; }
.files-name-text :deep(button.files-name-button) { padding-inline: 0 !important; }
.files-name-button { width: 100%; min-width: 0; padding-left: 0 !important; padding-right: 0 !important; justify-content: flex-start !important; font-size: 14px; font-weight: 500; background: transparent !important; }
.files-name-button :deep(span) { letter-spacing: normal; }
.files-kind-icon { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: var(--md-border-radius-small); flex-shrink: 0; color: var(--md-primary); background: color-mix(in srgb, var(--md-primary) 9%, var(--md-surface)); }
.files-kind-icon[data-kind="PDF"] { color: var(--md-error); background: color-mix(in srgb, var(--md-error) 8%, var(--md-surface)); }
.files-type-badge { display: inline-block; margin-inline-start: -8px; font-size: 12px; padding: 4px 8px; border-radius: var(--md-border-radius-small); background: transparent; color: var(--md-on-surface-variant); }
.files-type-badge[data-kind="Document"] { color: var(--md-primary); background: color-mix(in srgb, var(--md-primary) 8%, var(--md-surface)); }
.files-type-badge[data-kind="PDF"] { color: var(--md-error); background: color-mix(in srgb, var(--md-error) 8%, var(--md-surface)); }
.files-project { display: flex; align-items: center; gap: 8px; min-width: 0; color: var(--md-on-surface-variant); }
.files-project span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.files-muted, .files-footer { color: var(--md-on-surface-variant); }
.files-row-actions { display: flex; justify-content: flex-end; align-items: center; }
.files-row[data-trash="true"], .files-columns[data-trash="true"] { grid-template-columns: minmax(180px, 1fr) 110px minmax(100px, .5fr) 155px 80px 130px; }
.files-footer[data-count-shown] .files-footer-count { display: none; }
.files-footer[data-count-shown]:not(:has(button)) { display: none; }
.files-footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 20px; border-top: 1px solid var(--md-border-color,var(--md-outline-variant)); font-size: 12px; }
.files-mobile-detail { display: none; color: var(--md-on-surface-variant); font-size: 12px; line-height: 16px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.files-empty { min-height: 320px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; text-align: center; padding: 32px; }
.files-empty h2 { font-size: 18px; font-weight: 600; letter-spacing: -.02em; }
.files-empty p { color: var(--md-on-surface-variant); font-size: 14px; max-width: 320px; line-height: 1.6; }
.files-empty-icon { width: 72px; height: 72px; display: grid; place-items: center; border-radius: var(--md-border-radius); background: var(--md-surface-container-lowest,var(--md-surface-container-low,var(--md-surface-variant))); color: var(--md-primary); }
.files-notices { margin: 12px 0; padding: 12px 16px; background: var(--md-surface-container-lowest,var(--md-surface-container-low,var(--md-surface-variant))); border-radius: var(--md-border-radius-small); font-size: 13px; }
.files-upload { display: flex; flex-direction: column; gap: 10px; margin: 0 0 12px; padding: 10px 14px; border: var(--md-border-width,1px) solid var(--md-border-color,var(--md-outline-variant)); border-radius: var(--md-border-radius-small); background: var(--md-surface-container-lowest,var(--md-surface-container-low,var(--md-surface-variant))); font-size: 13px; }
.files-upload-line { display: flex; align-items: center; gap: 10px; min-width: 0; }
.files-upload-icon { flex-shrink: 0; color: var(--md-primary); }
.files-upload-text { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--md-on-surface-variant); }
.files-upload-text strong { font-weight: 600; color: var(--md-on-surface); }
.files-upload-phase { flex-shrink: 0; color: var(--md-on-surface-variant); }
.files-upload[data-state="complete"] { color: var(--md-on-surface-variant); }
.files-upload-failures { display: grid; gap: 8px; margin: 0 0 12px; padding: 0; list-style: none; }
.files-upload[data-state="failed"] { flex-direction: row; flex-wrap: wrap; margin: 0; border-color: color-mix(in srgb, var(--md-error) 45%, var(--md-surface)); background: color-mix(in srgb, var(--md-error) 6%, var(--md-surface)); }
.files-upload[data-state="failed"] .files-upload-icon { color: var(--md-error); }
.files-upload[data-state="failed"] .files-upload-text { white-space: normal; }
.files-upload-reason { display: block; margin-top: 2px; color: var(--md-on-surface-variant); }
.files-upload-leave-active { transition: opacity 200ms ease; }
.files-upload-leave-to { opacity: 0; }
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
    .files-content { padding: 16px 16px 24px; }
    .files-header, .files-page[data-preview="true"] .files-header { flex-direction: row; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 16px; }
    .files-header[data-trash="true"] { align-items: flex-start; }
    .files-header[data-trash="true"] { margin-bottom: 20px; }
    .files-header h1 { font-size: 24px; }
    .files-header p { font-size: 13px; margin-top: 4px; }
    .files-header[data-trash="false"] .files-heading { flex-shrink: 0; }
    .files-header-actions { max-width: 100%; flex-wrap: wrap; justify-content: flex-end; gap: 2px; margin-inline-start: auto; }
    .files-header-actions .files-upload-button { margin-left: 6px; }
    .files-toolbar { flex-direction: column; align-items: stretch; gap: 10px; margin-bottom: 8px; }
    .files-search :deep(input) { border-color: transparent !important; background: var(--md-surface-container-low, var(--md-surface-variant)); }
    /* Filters become one row of compact chips that scrolls sideways instead of wrapping. */
    .files-filters { overflow-x: auto; scrollbar-width: none; margin-inline: -16px; padding: 2px 16px; gap: 6px; }
    .files-filters::-webkit-scrollbar { display: none; }
    .files-filter { flex-shrink: 0; }
    .files-explorer-tools:not(.files-selection-bar) { flex-wrap: nowrap; gap: 0; margin-bottom: 4px; }
    .files-explorer-tools:not(.files-selection-bar) .files-breadcrumbs { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; }
    .files-breadcrumbs > * { flex-shrink: 0; }
    .files-selection-bar { margin-bottom: 8px; flex-wrap: wrap; padding: 4px 4px 4px 14px; gap: 0 4px; }
    .files-selection-note { order: 10; flex-basis: 100%; padding-bottom: 6px; }
    /* Edge-to-edge list with inset separators, like a native list. */
    .files-list { border: 0; border-radius: 0; box-shadow: none; margin-inline: -16px; overflow: visible; }
    .files-columns { display: none; }
    .files-type-column, .files-date-column { display: none; }
    .files-row { position: relative; grid-template-columns: minmax(0, 1fr) 40px; padding: 0 8px 0 16px; gap: 4px; border-bottom: 0; }
    .files-row::after { content: ""; position: absolute; left: 64px; right: 0; bottom: 0; height: 1px; background: color-mix(in srgb, var(--md-border-color, var(--md-outline-variant)) 55%, transparent); }
    .files-page[data-selecting] .files-row::after { left: 92px; }
    .files-row:last-child::after { display: none; }
    .files-row[data-trash="true"], .files-columns[data-trash="true"] { grid-template-columns: minmax(0, 1fr) auto; }
    .files-page:not([data-selecting]) .files-name-cell > input[type="checkbox"] { display: none; }
    .files-page:not([data-selecting]) .files-row:is(:hover, :focus-within) .files-name-cell > input[type="checkbox"] + * { opacity: 1; }
    .files-mobile-detail { display: block; }
    .files-name-cell > .files-name-button { min-height: 44px !important; }
    .files-footer { border-top: 0; padding: 12px 16px; justify-content: center; }
    .files-empty { min-height: 260px; padding: 24px 16px; }
}
@media (pointer: coarse) { .files-page :deep(button:not(.files-name-button):not(.files-filter-base)), .files-page :deep(input:not([type="checkbox"])), .files-page :deep([role=combobox]:not(.files-filter-base)) { min-height: 44px !important; } }
@media (prefers-reduced-motion: reduce) { .files-row, .files-inspector-enter-active, .files-inspector-leave-active, .files-upload-leave-active { transition: none; } }
</style>
