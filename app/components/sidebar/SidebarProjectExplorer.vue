<script setup lang="ts">
import { computed, nextTick, onScopeDispose, ref, shallowRef, useId, watch } from 'vue';
import { useLocalStorage } from '@vueuse/core';
import { liveQuery } from 'dexie';
import AppModal from '~/components/ui/AppModal.vue';
import ExplorerMoveDialog from '~/components/files/ExplorerMoveDialog.vue';
import { useExplorerDrag } from '~/composables/explorer/useExplorerDrag';
import { useExplorerSelection } from '~/composables/explorer/useExplorerSelection';
import { useExplorerUndo } from '~/composables/explorer/useExplorerUndo';
import { openFilesTab, useFilesExplorerReveal, useProjectExplorerReveal } from '~/composables/explorer/useExplorerReveal';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { useProjectTreeActions, type ProjectTreeChild, type ProjectTreeRoot } from '~/composables/projects/useProjectTreeActions';
import { getPaletteHostContext } from '~/composables/search/useCommandPalette';
import {
    createExplorerFolder, explorerRevision, moveExplorerRows, planExplorerFolderRemoval,
    importPreviewExplorerRecords, readExplorerOrganization, readExplorerProjectItems, removeExplorerFolder, renameExplorerFolder, type ExplorerRevision,
} from '~/db/explorer';
import { listExplorerItems } from '~/db/explorer-items';
import { removeExplorerProjectItems } from '~/db/explorer-project-removal';
import { captureProjectOperation } from '~/utils/projects/operation';
import { readFamilyPage } from '~/utils/sidebar/thread-families';
import {
    EXPLORER_MAX_WRITES, explorerItemKey, explorerPlacementId, type ExplorerItemRef,
} from '~~/shared/explorer/records';
import { explorerRecoveryLabel, type ExplorerFolderRow } from '~~/shared/explorer/tree';
import { workspaceRevision } from '~~/shared/posts/workspace-revision';
import type { Post, Thread } from '~/db/schema';
import { nowSec } from '~/db/util';

type Node = {
    key: string;
    label: string;
    path: string;
    icon: string;
    folder?: ExplorerFolderRow;
    item?: ExplorerItemRef;
    openId?: string;
    children?: Node[];
};
const props = defineProps<{ projectId: string; projectName: string; rootTarget?: HTMLElement | null; query?: string; documentsEnabled: boolean; compact?: boolean }>();
const emit = defineEmits<{
    view: [active: boolean];
    create: [kind: 'chat' | 'document', folder: ExplorerFolderRow];
    addFile: [folder: ExplorerFolderRow];
    clearSearch: [];
}>();
const controller = new AbortController();
const origin = captureProjectOperation(controller.signal, 'project-explorer');
const scope = { kind: 'project', project_id: props.projectId } as const;
const deviceKey = JSON.stringify([origin.subject ?? 'local', origin.workspaceId, props.projectId]);
const view = useLocalStorage<'automatic' | 'recent' | 'explorer'>(
    'or3:project-explorer:view:' + deviceKey, 'automatic',
);
const expanded = useLocalStorage<string[]>('or3:project-explorer:expanded:' + deviceKey, []);
const organization = shallowRef<Awaited<ReturnType<typeof readExplorerOrganization>>>();
const items = shallowRef<Node[]>([]);
const viewport = ref<HTMLElement | null>(null);
const revealRequest = useProjectExplorerReveal();
const filesReveal = useFilesExplorerReveal();
const activeQuery = computed(() => props.query);
const status = ref('');
const error = ref('');
const busy = ref(false);
const undo = useExplorerUndo(scope, () => origin, () => busy.value, action => run(() => action(origin)));
const folderDialog = ref(false);
let folderExpected: ExplorerRevision | null = null;
const folderName = ref('');
const folderFormId = useId();
const titleFormId = useId();
const renameTarget = shallowRef<Post | Thread>();
const titleDialog = ref(false);
const newTitle = ref('');
const folderTarget = shallowRef<ExplorerFolderRow>();
const dialogMode = ref<'new' | 'rename'>('new');
const moveDialog = ref(false);
const removeContents = ref(false);
const removal = shallowRef<Awaited<ReturnType<typeof planExplorerFolderRemoval>>>();
const folderIcon = useIcon('sidebar.folder');
const noteIcon = useIcon('sidebar.note');
const chatIcon = useIcon('sidebar.chat');
const fileIcon = useIcon('external-agent.file');
const moreIcon = useIcon('ui.more');
const warningIcon = useIcon('ui.warning');
const chevronIcon = useIcon('ui.chevron.right');
const newFolderIcon = useIcon('sidebar.new_folder');
const newChatIcon = useIcon('sidebar.new_chat');
const newNoteIcon = useIcon('sidebar.new_note');
const editIcon = useIcon('ui.edit');
const uploadIcon = useIcon('ui.upload');
const rowButtons = useThemeOverrides({
    component: 'button', context: 'sidebar', identifier: 'sidebar.project-content.action', isNuxtUI: true,
});
const menuButtons = useThemeOverrides({
    component: 'button', context: 'sidebar', identifier: 'sidebar.project-explorer.menu-item', isNuxtUI: true,
});
const ROW_HEIGHT = 36;
const treeVirtualization = {
    estimateSize: ROW_HEIGHT,
    overscan: 8,
    // Reka supplies the row value directly to the virtualizer's type-ahead callback.
    textContent: (item: Node) => item.label,
};
// The global Tree recipe draws each row as a card; Explorer rows use sidebar list geometry instead.
const treeUi = { root: '', item: 'm-0 p-0 border-0 rounded-none bg-transparent shadow-none backdrop-blur-none' };
const extensionActions = useProjectTreeActions();
const scopeLabel = computed(() => 'project ' + props.projectName);
const explorer = computed(() => props.compact || view.value !== 'recent');
watch(explorer, active => emit('view', active), { immediate: true });
watch(explorer, () => clearSelection());
watch(() => props.query, () => clearSelection());

async function projectContent() {
    const [metadata, families] = await Promise.all([
        readExplorerProjectItems(origin.db, props.projectId).then(members => listExplorerItems(origin.db, 'active', members)),
        readFamilyPage(origin.db, { limit: Number.MAX_SAFE_INTEGER, type: 'thread', filter: { projectId: props.projectId } }),
    ]);
    origin.assertCurrent();
    const content = metadata.flatMap((row): Node[] => {
        if (row.kind === 'document' && !props.documentsEnabled) return [];
        const item: ExplorerItemRef = { kind: row.kind, item_id: row.id };
        const key = explorerItemKey(item);
        return [{ key, item, label: row.title, icon: row.kind === 'document' ? noteIcon.value : fileIcon.value, path: '' }];
    });
    for (const thread of families.items) {
        if (thread.type !== 'thread') continue;
        const id = thread.family?.rootId ?? thread.id;
        const item: ExplorerItemRef = { kind: 'chat', item_id: id };
        content.push({ key: explorerItemKey(item), label: thread.title, item, openId: thread.family?.originalId ?? thread.id,
            icon: chatIcon.value, path: '' });
    }
    return content;
}
watch(() => explorer.value || (!props.compact && revealRequest.value?.projectId === props.projectId
    && revealRequest.value.generation === origin.generation), (active, _, onCleanup) => {
    if (!active) {
        items.value = [];
        organization.value = undefined;
        return;
    }
    const onError = (cause: unknown) => {
        if (!controller.signal.aborted) error.value = cause instanceof Error ? cause.message : 'Project Explorer could not load.';
    };
    void importPreviewExplorerRecords(origin, scope).catch(onError);
    const folders = liveQuery(async () => readExplorerOrganization(origin, scope)).subscribe({
        next: value => { organization.value = value; }, error: onError,
    });
    const content = liveQuery(projectContent).subscribe({ next: value => { items.value = value; }, error: onError });
    onCleanup(() => { folders.unsubscribe(); content.unsubscribe(); });
}, { immediate: true });
onScopeDispose(() => controller.abort());

const tree = computed(() => {
    const projection = organization.value?.tree;
    if (!projection) return [];
    const byParent = new Map<string | null, Node[]>();
    for (const item of items.value) {
        const parent = projection.placements.get(item.key)?.parentId ?? null;
        const path = projection.path(parent).map(projection.label).join(' / ');
        const siblings = byParent.get(parent) ?? [];
        siblings.push({ ...item, path });
        byParent.set(parent, siblings);
    }
    const byName = (a: Node, b: Node) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key);
    const term = activeQuery.value?.trim().toLocaleLowerCase();
    if (term) return [...byParent.values()].flat().filter(item => item.label.toLocaleLowerCase().includes(term)
        || item.path.toLocaleLowerCase().includes(term)).sort(byName);

    function nodes(parent: string | null): Node[] {
        const folders = (projection!.children.get(parent) ?? []).map((folder): Node => ({
            key: folder.id, label: projection!.label(folder), folder, icon: folderIcon.value,
            path: projection!.path(folder.id).map(projection!.label).join(' / '),
            children: nodes(folder.id),
        })).sort(byName);
        return [...folders, ...(byParent.get(parent) ?? []).sort(byName)];
    }
    return nodes(null);
});
const visible = computed(() => {
    const result: Node[] = [];
    const open = new Set(expanded.value);
    function visit(nodes: Node[]) {
        for (const node of nodes) {
            result.push(node);
            if (node.children && open.has(node.key)) visit(node.children);
        }
    }
    visit(tree.value);
    return result;
});
const { selected, selectMode, choose, clear: clearSelection, all } = useExplorerSelection(computed(() => visible.value.map(node => node.key)));
async function focusNode(node: Node) {
    await nextTick();
    const root = viewport.value?.querySelector<HTMLElement>('.project-explorer-tree');
    if (!root) return;
    const selector = `[data-project-row="${CSS.escape(node.key)}"] .project-explorer-activate`;
    const position = visible.value.findIndex(item => item.key === node.key);
    if (!root.querySelector(selector) && position >= 0) {
        root.scrollTop = position * ROW_HEIGHT;
        await new Promise(requestAnimationFrame);
        await nextTick();
    }
    root.querySelector<HTMLElement>(selector)?.focus();
}
async function revealInTree(node: Node) {
    const projection = organization.value?.tree;
    if (!projection) return;
    emit('clearSearch');
    view.value = 'explorer';
    for (const folder of projection.path(projection.placements.get(node.key)?.parentId ?? null)) expand(folder.id);
    await focusNode(node);
}
watch([revealRequest, items, organization], ([request, content, state]) => {
    if (!state || props.compact || !request || request.projectId !== props.projectId || request.generation !== origin.generation) return;
    const item = content.find(row => row.key === request.key);
    if (!item) return;
    revealRequest.value = null;
    void revealInTree(item);
}, { immediate: true, flush: 'post' });
const destinations = computed(() => {
    const tree = organization.value?.tree;
    if (!moveDialog.value || !tree) return [];
    return [...tree.folders.values()].filter(row => !row.deleted).map(folder => {
        const ancestors = tree.path(folder.id);
        return { id: folder.id, path: ancestors.map(tree.label).join(' / '),
            disabled: ancestors.some(parent => selected.value.has(parent.id)) };
    }).sort((a, b) => a.path.localeCompare(b.path));
});

async function run(action: () => Promise<void>) {
    if (busy.value) return;
    busy.value = true;
    error.value = '';
    try { await action(); }
    catch (cause) { if (!controller.signal.aborted) error.value = cause instanceof Error ? cause.message : 'The project action failed.'; }
    finally { busy.value = false; }
}
function expand(key: string, toggle = false) {
    expanded.value = expanded.value.includes(key)
        ? toggle ? expanded.value.filter(entry => entry !== key) : expanded.value
        : [...expanded.value, key];
}
function activate(node: Node, event: MouseEvent | KeyboardEvent) {
    if (!choose(node.key, event)) return;
    if (node.folder) { expand(node.key, true); return; }
    if (node.item) void run(async () => {
        origin.assertCurrent();
        const host = getPaletteHostContext();
        const item = node.item!;
        const result = item.kind === 'chat' ? await host?.openChat(node.openId ?? item.item_id, 'active')
            : item.kind === 'document' ? await host?.openDocument(item.item_id, 'active')
                : await host?.openPaneApp('or3-files', item.item_id, 'active');
        if (result && !result.ok) throw new Error(result.error.message);
    });
}
function openFolderDialog(folder?: ExplorerFolderRow, mode: 'new' | 'rename' = 'new') {
    dialogMode.value = mode;
    folderTarget.value = folder;
    folderExpected = explorerRevision(folder ? organization.value?.canonical.get(folder.id) : undefined);
    folderName.value = mode === 'rename' ? folder?.payload.name ?? '' : '';
    error.value = '';
    folderDialog.value = true;
}
function saveFolder() {
    const target = folderTarget.value;
    const name = folderName.value;
    const expected = folderExpected;
    void run(async () => {
        if (dialogMode.value === 'rename' && target) {
            undo.save(origin, await renameExplorerFolder(origin, scope, target.id, name, expected), 'Project folder renamed');
        }
        else await createExplorerFolder(origin, scope, target?.id ?? null, name);
        if (target) expand(target.id);
        folderDialog.value = false;
    });
}
function requestRename(node: Node) {
    if (node.folder) { openFolderDialog(node.folder, 'rename'); return; }
    if (!node.item) return;
    const item = node.item;
    void run(async () => {
        const row = item.kind === 'chat' ? await origin.db.threads.get(node.openId ?? item.item_id)
            : await origin.db.posts.get(item.item_id);
        origin.assertCurrent('write');
        if (!row || row.deleted) throw new Error('This item is unavailable.');
        renameTarget.value = row;
        newTitle.value = row.title ?? '';
        titleDialog.value = true;
    });
}
function saveContentTitle() {
    const request = renameTarget.value;
    const title = newTitle.value.trim();
    if (!request || !title) return;
    void run(async () => {
        const row = request;
        if ('postType' in row) {
            const { updateWorkspaceFile } = await import('~/db/workspace-files');
            await updateWorkspaceFile(origin, row.id, await workspaceRevision(row), { title });
        } else {
            const { upsertThread } = await import('~/db/threads');
            await upsertThread({ ...row, title, title_source: 'manual', updated_at: nowSec() },
                { db: origin.db, row, assertCurrent: () => origin.assertCurrent('write') });
        }
        titleDialog.value = false;
    });
}
async function move(parent: string | null) {
    const nodes = visible.value.filter(node => selected.value.has(node.key));
    const records = organization.value?.canonical;
    if (!nodes.length) return;
    await run(async () => {
        await moveExplorerRows(origin, scope, await Promise.all(nodes.map(async node => {
            if (node.folder) return { row: { kind: 'folder' as const, id: node.key },
                expected: explorerRevision(records?.get(node.key)) };
            const item = node.item!;
            return { row: { kind: 'item' as const, item },
                expected: explorerRevision(records?.get(await explorerPlacementId(scope, item))) };
        })), parent, receipt => undo.save(origin, receipt, 'Project locations updated'));
        if (parent) expand(parent);
        clearSelection();
        moveDialog.value = false;
        showLanded(nodes.map(node => node.key));
    });
}
/** Rows that just moved, briefly highlighted where they landed. */
const landed = ref(new Set<string>());
let landedTimer: ReturnType<typeof setTimeout> | undefined;
onScopeDispose(() => clearTimeout(landedTimer));
function showLanded(keys: string[]) {
    clearTimeout(landedTimer);
    landed.value = new Set(keys);
    landedTimer = setTimeout(() => { landed.value = new Set(); }, 1200);
}
function openMove(node?: Node) {
    if (node && !selected.value.has(node.key)) { clearSelection(); choose(node.key); }
    error.value = '';
    moveDialog.value = true;
}
function selectForMenu(node: Node) {
    if (selected.value.has(node.key)) return;
    clearSelection();
    choose(node.key);
}
function showInFiles(item: ExplorerItemRef) {
    void run(async () => {
        const host = getPaletteHostContext();
        if (!host) throw new Error('Files is unavailable in this workspace.');
        origin.assertCurrent();
        const result = await openFilesTab(host);
        if (!result.ok) throw new Error(result.error.message);
        origin.assertCurrent();
        filesReveal.value = { itemId: item.item_id, generation: origin.generation };
    });
}
const selectionHasFolders = computed(() => visible.value.some(node => node.folder && selected.value.has(node.key)));
function removeSelectedContents() {
    if (selectionHasFolders.value) return;
    const content = visible.value.flatMap(node => node.item && selected.value.has(node.key) ? [node.item] : []);
    if (!content.length || content.length > EXPLORER_MAX_WRITES) return;
    void run(async () => {
        const outcome = await removeExplorerProjectItems(origin, props.projectId, content);
        const count = outcome.completed.size;
        for (const item of outcome.completed) selected.value.delete(explorerItemKey(item));
        status.value = `${count} removed from ${scopeLabel.value}, ${outcome.failed.size} failed, ${content.length - count - outcome.failed.size} not attempted.`;
        removeContents.value = false;
    });
}
function requestRemoval(folder: ExplorerFolderRow) {
    void run(async () => {
        const plan = await planExplorerFolderRemoval(origin, scope, folder.id);
        if (!plan.children.length) await removeExplorerFolder(origin, scope, folder.id, plan);
        else removal.value = plan;
    });
}
function finishRemoval() {
    const plan = removal.value;
    if (!plan) return;
    void run(async () => {
        await removeExplorerFolder(origin, scope, plan.folder.id, plan);
        removal.value = undefined;
        clearSelection();
    });
}
const parentOf = computed(() => {
    const projection = organization.value?.tree;
    const parents = new Map<string, string | null>();
    if (!projection) return parents;
    for (const [id, location] of projection.folderLocations) parents.set(id, location.parentId);
    for (const item of items.value) parents.set(item.key, projection.placements.get(item.key)?.parentId ?? null);
    return parents;
});
/** True when `key` sits somewhere below `folder`. */
function isWithin(key: string, folder: string) {
    for (let parent = parentOf.value.get(key) ?? null; parent !== null; parent = parentOf.value.get(parent) ?? null) {
        if (parent === folder) return true;
    }
    return false;
}
function isSelectedOrDescendant(key: string) {
    for (let id: string | null = key; id !== null; id = parentOf.value.get(id) ?? null) {
        if (selected.value.has(id)) return true;
    }
    return false;
}
/** A drop is shown only when it moves something and never puts a folder inside itself. */
function acceptsDrop(destination: string | null) {
    if (selected.value.size > EXPLORER_MAX_WRITES || (destination !== null && isSelectedOrDescendant(destination))) return false;
    for (const key of selected.value) if ((parentOf.value.get(key) ?? null) !== destination) return true;
    return false;
}
const toolbarBeforeDrag = ref(false);
const { directive: vExplorerDrag, announcement, dragging, over } = useExplorerDrag({
    enabled: computed(() => explorer.value && !busy.value && origin.writable),
    viewport: computed(() => visible.value.length ? viewport.value?.querySelector<HTMLElement>('.project-explorer-tree') ?? null : null),
    start: key => {
        toolbarBeforeDrag.value = selected.value.size > 1 || selectMode.value;
        if (!selected.value.has(key)) { clearSelection(); choose(key); }
    },
    move: parent => { void move(parent); },
    accepts: acceptsDrop,
    rootTarget: () => props.rootTarget ?? (props.compact
        ? viewport.value?.closest('[data-project-shortcut]')?.querySelector<HTMLElement>('[data-project-id]')
        : null),
    count: () => selected.value.size,
});
/** Rows travelling with the drag: the selection and everything inside selected folders. */
const draggedRows = computed(() => {
    if (!dragging.value) return new Set<string>();
    return new Set(visible.value.filter(node => isSelectedOrDescendant(node.key)).map(node => node.key));
});
/** The destination folder and its visible contents, marked so they read as one drop zone. */
const dropBlock = computed(() => {
    const marks = new Map<string, 'only' | 'first' | 'middle' | 'last'>();
    const target = over.value;
    const order = visible.value;
    if (target === undefined || !order.length) return marks;
    // The root zone spans every row, drawn exactly like a folder zone.
    const start = target === null ? 0 : order.findIndex(node => node.key === target);
    if (start < 0) return marks;
    let end = start;
    while (end + 1 < order.length && (target === null || isWithin(order[end + 1]!.key, target))) end++;
    for (let index = start; index <= end; index++) {
        marks.set(order[index]!.key, start === end ? 'only' : index === start ? 'first' : index === end ? 'last' : 'middle');
    }
    return marks;
});
function blockExternal(event: DragEvent) {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    if (event.type === 'drop') error.value = 'For uploads, use Knowledge → Add source or upload to Files and add the file to this project.';
}
let prefix = '';
let prefixTimer: ReturnType<typeof setTimeout> | undefined;
onScopeDispose(() => clearTimeout(prefixTimer));
function explorerKey(event: KeyboardEvent) {
    undo.onKey(event);
    if (event.defaultPrevented || event.isComposing || !(event.target instanceof HTMLElement)
        || event.target.closest('input,textarea,[contenteditable="true"]')) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        all();
        return;
    }
    if (event.key === 'Escape') { clearSelection(); return; }
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const key = event.target.closest<HTMLElement>('[data-project-row]')?.dataset.projectRow;
    const index = visible.value.findIndex(row => row.key === key);
    const node = visible.value[index];
    if (!node) return;
    if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !activeQuery.value) {
        event.preventDefault();
        event.stopPropagation();
        const right = event.key === 'ArrowRight';
        if (node.folder && expanded.value.includes(node.key) !== right) expand(node.key, true);
        else {
            const next = right ? node.children?.[0] : visible.value.find(item => item.key === parentOf.value.get(node.key));
            if (next) void focusNode(next);
        }
        return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        const target = event.key === 'Home' ? 0 : event.key === 'End' ? visible.value.length - 1
            : index + (event.key === 'ArrowDown' ? 1 : -1);
        const next = visible.value[target];
        if (!next) return;
        event.preventDefault();
        if (event.shiftKey) choose(next.key, { shiftKey: true });
        void focusNode(next);
        return;
    }
    if (event.key.length === 1 && event.key !== ' ') {
        prefix += event.key.toLocaleLowerCase();
        clearTimeout(prefixTimer);
        prefixTimer = setTimeout(() => { prefix = ''; }, 700);
        const match = (row: Node) => row.label.toLocaleLowerCase().startsWith(prefix);
        const next = visible.value.find((row, position) => position > index && match(row)) ?? visible.value.find(match);
        if (next) { event.preventDefault(); void focusNode(next); }
        return;
    }
    if (!origin.writable || busy.value) return;
    if (event.key === 'F2' && selected.value.size <= 1) {
        event.preventDefault();
        event.stopPropagation();
        requestRename(node);
    }
    if (event.key !== 'Delete' && event.key !== 'Backspace') return;
    event.preventDefault();
    if (!selected.value.has(node.key)) { clearSelection(); choose(node.key); }
    if (selected.value.size === 1 && node.folder) requestRemoval(node.folder);
    else if (!selectionHasFolders.value && selected.value.size <= EXPLORER_MAX_WRITES) removeContents.value = true;
    else error.value = 'Select project items without folders to remove them from the project.';
}
const rootExtensions = computed(() => {
    const root: ProjectTreeRoot = { value: props.projectId, label: props.projectName };
    return extensionActions.value.filter(action => !action.showOn || action.showOn.includes('root'))
        .map(action => ({ label: action.label, icon: action.icon, onSelect: () => run(async () => {
            origin.assertCurrent();
            await action.handler({ root, treeRow: root });
        }) }));
});
type MenuEntry = { label: string; ariaLabel?: string; icon?: string; disabled?: boolean; onSelect: () => void };
function menu(node: Node): MenuEntry[][] {
    const create: MenuEntry[] = [];
    const tooMany = selected.value.has(node.key) && selected.value.size > EXPLORER_MAX_WRITES;
    const items: MenuEntry[] = [];
    const removal: MenuEntry[] = [];
    if (origin.writable) items.push({ label: 'Move to…', disabled: tooMany, icon: 'i-lucide-folder-input', onSelect: () => openMove(node) });
    if (node.item && activeQuery.value && (!origin.writable || selected.value.size <= 1)) {
        items.push({ label: 'Show in project', ariaLabel: 'Show in ' + scopeLabel.value, icon: 'i-lucide-locate', onSelect: () => revealInTree(node) });
    }
    const single = !selected.value.has(node.key) || selected.value.size === 1;
    if (node.item && node.item.kind !== 'chat' && (!origin.writable || single)) {
        items.push({ label: 'Show in Files', icon: 'i-lucide-folder-search', onSelect: () => showInFiles(node.item!) });
    }
    if (!origin.writable) return [items];
    if (node.item && single) {
        items.push({ label: 'Rename', icon: editIcon.value, onSelect: () => requestRename(node) });
        const child: ProjectTreeChild = { value: node.item.item_id, label: node.label, icon: node.icon,
            parentId: props.projectId, kind: node.item.kind === 'document' ? 'doc' : node.item.kind };
        for (const action of extensionActions.value) {
            if (!child.kind || (action.showOn && !action.showOn.includes(child.kind))) continue;
            items.push({ label: action.label, icon: action.icon, onSelect: () => run(async () => {
                origin.assertCurrent();
                await action.handler({ child, treeRow: child });
            }) });
        }
    }
    if (node.item && (!selected.value.has(node.key) || !selectionHasFolders.value)) {
        removal.push({ label: 'Remove from project', disabled: tooMany, ariaLabel: 'Remove from ' + scopeLabel.value, icon: 'i-lucide-circle-minus', onSelect: () => {
            if (!selected.value.has(node.key)) { clearSelection(); choose(node.key); }
            removeContents.value = true;
        } });
    }
    if (node.folder && (!selected.value.has(node.key) || selected.value.size < 2)) {
        const folder = node.folder;
        const within = ' in ' + node.label;
        create.push(
            { label: 'New chat', ariaLabel: 'New chat' + within, icon: newChatIcon.value, onSelect: () => emit('create', 'chat', folder) },
            ...(props.documentsEnabled ? [{ label: 'New document', ariaLabel: 'New document' + within, icon: newNoteIcon.value,
                onSelect: () => emit('create', 'document', folder) }] : []),
            ...(!props.compact ? [{ label: 'Add file', ariaLabel: 'Add file' + within, icon: uploadIcon.value, onSelect: () => emit('addFile', folder) }] : []),
            { label: 'New folder', ariaLabel: 'New folder' + within, icon: newFolderIcon.value, onSelect: () => openFolderDialog(folder) },
        );
        items.push({ label: 'Rename folder', icon: editIcon.value, onSelect: () => openFolderDialog(folder, 'rename') });
        removal.push({ label: 'Remove folder', ariaLabel: 'Remove folder, keep contents', icon: 'i-lucide-folder-minus', onSelect: () => requestRemoval(folder) });
    }
    return [create, items, removal].filter(group => group.length);
}
function recoveredLocation(node: Node) {
    const projection = organization.value?.tree;
    const resolved = node.folder ? projection?.folderLocations.get(node.key) : projection?.placements.get(node.key);
    const shownIn = node.path ? scopeLabel.value + ' / ' + node.path : scopeLabel.value + ' root';
    return explorerRecoveryLabel(resolved, shownIn);
}
</script>

<template>
    <section v-if="explorer || !compact" :aria-label="explorer ? (compact ? 'Project shortcuts for ' + projectName : 'Project Explorer') : undefined"
        class="project-explorer" :class="{ 'project-explorer--compact': compact }" :data-explorer-dragging="dragging || undefined"
        @dragover="blockExternal" @drop="blockExternal" @keydown.capture="explorer && explorerKey($event)">
        <header v-if="!compact" v-explorer-drag="{ destination: null, label: projectName }" class="project-explorer-header">
            <div role="group" aria-label="Project content view" class="explorer-views">
                <button type="button" class="explorer-view" :aria-pressed="!explorer" @click="view = 'recent'">Recent</button>
                <button type="button" class="explorer-view" :aria-pressed="explorer" @click="view = 'explorer'">Explorer</button>
            </div>
            <div v-if="explorer" class="explorer-tools">
                <UButton v-bind="rowButtons" class="explorer-tool" :icon="newFolderIcon" :aria-label="'New folder in ' + projectName" title="New folder"
                    color="neutral" variant="ghost" size="xs" square :disabled="busy || !origin.writable" @click="openFolderDialog()" />
                <UButton v-bind="rowButtons" class="explorer-tool" icon="i-lucide-fold-vertical" aria-label="Collapse all folders" title="Collapse all folders"
                    color="neutral" variant="ghost" size="xs" square :disabled="!expanded.length" @click="expanded = []" />
                <UButton v-bind="rowButtons" class="explorer-tool"  icon="i-lucide-list-checks" :aria-label="selectMode ? 'Done' : 'Select'" title="Select items"
                    :aria-pressed="selectMode" color="neutral" variant="ghost" size="xs" square @click="selectMode = !selectMode" />
                <UPopover v-if="rootExtensions.length && selected.size <= 1" :content="{ side: 'right', align: 'start', sideOffset: 6 }">
                    <UButton v-bind="rowButtons" class="explorer-tool" :icon="moreIcon" aria-label="Project Explorer actions"
                        color="neutral" variant="ghost" size="xs" square />
                    <template #content="{ close }">
                        <div class="or3-action-menu p-1 w-56 max-w-[calc(100vw-2rem)]">
                            <UButton v-for="entry in rootExtensions" :key="entry.label" color="neutral" variant="popover" size="sm"
                                v-bind="menuButtons" :icon="entry.icon" class="w-full justify-start"
                                @click="close(); entry.onSelect()">{{ entry.label }}</UButton>
                        </div>
                    </template>
                </UPopover>
            </div>
        </header>
        <template v-if="explorer">
        <div v-if="dragging ? toolbarBeforeDrag : selected.size > 1 || selectMode" class="explorer-selection">
            <span role="status" class="explorer-selection-count">{{ selected.size }} selected</span>
            <UButton v-bind="rowButtons" size="xs" color="neutral" variant="ghost" label="All" aria-label="Select all results" @click="all" />
            <UButton v-bind="rowButtons" size="xs" color="neutral" variant="ghost" label="Move" aria-label="Move to…"
                :disabled="!selected.size || selected.size > EXPLORER_MAX_WRITES || busy || !origin.writable" @click="openMove()" />
            <UButton v-bind="rowButtons" size="xs" color="neutral" variant="ghost" label="Remove" :aria-label="'Remove ' + selected.size + ' items'"
                :disabled="selectionHasFolders || !selected.size || selected.size > EXPLORER_MAX_WRITES || busy || !origin.writable" @click="removeContents = true" />
            <UButton v-bind="rowButtons" size="xs" color="neutral" variant="ghost" icon="i-lucide-x" square aria-label="Clear" title="Clear selection" class="ms-auto" @click="clearSelection" />
        </div>
        <p v-if="selectionHasFolders && (selected.size > 1 || selectMode)" class="explorer-note">Folders can't be removed with project items.</p>
        <p role="status" class="sr-only">{{ announcement }}</p>
        <p v-if="status" role="status" class="explorer-note">{{ status }}</p>
        <UAlert v-if="error && !folderDialog && !titleDialog && !removal" role="alert" :description="error" color="error" variant="soft" class="mb-1" />
        <div ref="viewport" v-explorer-drag="{ destination: null, label: projectName }" class="explorer-viewport">
            <UTree v-if="tree.length" v-model:expanded="expanded" :items="tree" :get-key="item => item.key"
                :virtualize="treeVirtualization" :as="{ link: 'div' }" :ui="treeUi" aria-label="Project contents"
                class="project-explorer-tree max-h-[60vh] overflow-auto sidebar-scroll">
                <template #item-wrapper="{ item, level, expanded: open }">
                    <div v-explorer-drag="item.folder ? { source: item.key, destination: item.key, label: item.label,
                        target: item.path, hover: () => expand(item.key) } : { source: item.key, label: item.label,
                        destination: parentOf.get(item.key) ?? null, target: item.path || projectName }"
                        class="explorer-row group"
                        :data-drop="dropBlock.get(item.key)"
                        :data-dragged="draggedRows.has(item.key) || undefined"
                        :data-landed="landed.has(item.key) || undefined"
                        :style="{ '--depth': Math.min(level - 1, 6) }"
                        :data-project-row="item.key"
                        :aria-selected="selected.has(item.key)" :data-selected="selected.has(item.key)"
                        :title="item.path ? item.path + (item.folder ? '' : ' / ' + item.label) : item.label"
                        @keydown.enter.stop.prevent="activate(item, $event)" @keydown.space.stop.prevent="choose(item.key, $event, true)">
                        <input v-if="selectMode" type="checkbox" :aria-label="'Select ' + item.label" :checked="selected.has(item.key)"
                            class="explorer-check" @click.stop="choose(item.key, $event, true)" @keydown.stop>
                        <button v-if="item.folder" type="button" class="explorer-disclosure" :aria-label="(open ? 'Collapse ' : 'Expand ') + item.label"
                            :aria-expanded="open" @click.stop="expand(item.key, true)">
                            <UIcon :name="open ? 'i-lucide-folder-open' : folderIcon" class="explorer-icon explorer-icon--rest" data-explorer-drag-handle />
                            <UIcon :name="chevronIcon" class="explorer-icon explorer-icon--hover" :class="{ 'rotate-90': open }" />
                        </button>
                        <button type="button" class="project-explorer-activate tree-name" :class="{ 'tree-name--folder': item.folder }" :title="item.label"
                            @click.stop="activate(item, $event)" @keydown.enter.stop>
                            <UIcon v-if="!item.folder" :name="item.icon" class="explorer-icon" data-explorer-drag-handle />
                            <span class="tree-label">{{ item.label }}</span>
                            <span v-if="activeQuery" class="tree-path" :title="item.path">{{ item.path || 'Project root' }}</span>
                        </button>
                        <UTooltip v-if="recoveredLocation(item)" :text="recoveredLocation(item)">
                            <UButton v-bind="rowButtons" size="xs" :icon="warningIcon" color="warning" variant="ghost" square :aria-label="recoveredLocation(item)" />
                        </UTooltip>
                        <UPopover v-if="origin.writable || (item.item && (item.item.kind !== 'chat' || activeQuery))" :content="{ side: 'right', align: 'start', sideOffset: 6 }"
                            @update:open="value => { if (value) selectForMenu(item); }">
                            <UButton v-bind="rowButtons" class="tree-more" :icon="moreIcon" :aria-label="'More actions for ' + item.label"
                                color="neutral" variant="ghost" size="xs" square @click.stop @keydown.stop />
                            <template #content="{ close }">
                                <div class="or3-action-menu p-1 w-56 max-w-[calc(100vw-2rem)]">
                                    <template v-for="(group, index) in menu(item)" :key="index">
                                        <div v-if="index" class="my-1 border-t border-[color:var(--md-border-color)]/30" />
                                        <UButton v-for="entry in group" :key="entry.label" color="neutral" variant="popover" size="sm"
                                            v-bind="menuButtons" :icon="entry.icon" :aria-label="entry.ariaLabel" :disabled="entry.disabled" class="w-full justify-start"
                                            @click="close(); entry.onSelect()">{{ entry.label }}</UButton>
                                    </template>
                                </div>
                            </template>
                        </UPopover>
                    </div>
                </template>
            </UTree>
            <p v-else class="explorer-empty">{{ activeQuery ? 'No matches in this project' : 'Nothing in this project yet' }}</p>
        </div>
        </template>
        <ExplorerMoveDialog v-model="moveDialog" :label="scopeLabel" :folders="destinations" :busy="busy" :error="error" :create-folder="(name, parent) => createExplorerFolder(origin, scope, parent, name)" @move="move" />
        <AppModal v-model:open="removeContents" :title="'Remove ' + selected.size + ' items from ' + scopeLabel">
            <p>Selected chat families and their branches leave this project. Files and documents remain available in Files.</p>
            <UAlert v-if="error" role="alert" :description="error" color="error" variant="soft" class="mt-3" />
            <template #footer>
                <UButton size="workspace" label="Cancel" color="neutral" variant="ghost" @click="removeContents = false" />
                <UButton size="workspace" label="Remove from project" color="error" :loading="busy" @click="removeSelectedContents" />
            </template>
        </AppModal>
        <AppModal v-model:open="folderDialog" :title="dialogMode === 'rename' ? 'Rename folder in ' + scopeLabel : 'New folder in ' + (folderTarget?.payload.name || projectName)">
            <form :id="folderFormId" @submit.prevent="saveFolder">
                <UInput v-model="folderName" aria-label="Folder name" class="w-full" size="workspace" />
                <UAlert v-if="error" role="alert" :description="error" color="error" variant="soft" class="mt-3" />
            </form>
            <template #footer>
                <UButton size="workspace" label="Cancel" color="neutral" variant="ghost" @click="folderDialog = false" />
                <UButton size="workspace" :label="dialogMode === 'rename' ? 'Save name' : 'Create folder'" :form="folderFormId"
                    type="submit" :disabled="!folderName.trim()" :loading="busy" />
            </template>
        </AppModal>
        <AppModal v-model:open="titleDialog" :title="'Rename item in ' + scopeLabel">
            <form :id="titleFormId" @submit.prevent="saveContentTitle">
                <p class="mb-3 text-sm text-muted">This changes the shared title wherever the item appears.</p>
                <UInput v-model="newTitle" aria-label="Item title" class="w-full" size="workspace" />
                <UAlert v-if="error" role="alert" :description="error" color="error" variant="soft" class="mt-3" />
            </form>
            <template #footer>
                <UButton size="workspace" label="Cancel" color="neutral" variant="ghost" @click="titleDialog = false" />
                <UButton size="workspace" label="Save title" :form="titleFormId" type="submit" :disabled="!newTitle.trim()" :loading="busy" />
            </template>
        </AppModal>
        <AppModal :open="!!removal" title="Remove folder, keep contents" @update:open="value => { if (!value) removal = undefined; }">
            <p v-if="removal">{{ removal.counts.chat }} chat families, {{ removal.counts.document }} documents,
                {{ removal.counts.file }} files and {{ removal.counts.folder }} subfolders will move to
                {{ removal.destination || projectName + ' root' }}.
                <span v-if="removal.counts.hidden">{{ removal.counts.hidden }} entries are hidden or in Trash.</span>
            </p>
            <UAlert v-if="error" role="alert" :description="error" color="error" variant="soft" class="mt-3" />
            <template #footer>
                <UButton size="workspace" label="Cancel" color="neutral" variant="ghost" @click="removal = undefined" />
                <UButton size="workspace" label="Remove folder" :loading="busy" @click="finishRemoval" />
            </template>
        </AppModal>
    </section>
</template>

<style scoped>
.project-explorer-header { display:flex; align-items:center; justify-content:space-between; gap:8px; min-height:32px; margin-bottom:6px; border-radius:var(--md-border-radius-small,var(--md-border-radius)); }
.explorer-views { display:flex; align-items:center; gap:2px; }
.explorer-view {
    height:28px; padding-inline:10px; border-radius:var(--md-border-radius-small,var(--md-border-radius));
    font-size:13px; font-weight:500; color:var(--md-on-surface-variant);
    transition:background-color var(--app-motion-duration-fast,150ms) var(--app-motion-easing-standard,ease), color var(--app-motion-duration-fast,150ms) var(--app-motion-easing-standard,ease);
}
.explorer-view:hover { color:var(--md-on-surface); background:var(--md-surface-hover); }
.explorer-view[aria-pressed="true"] { color:var(--md-on-surface); background:var(--md-surface-active,var(--md-surface-hover)); }
.explorer-tools { display:flex; align-items:center; gap:2px; color:var(--md-on-surface-variant); }
.explorer-tool[aria-pressed="true"] { color:var(--md-primary); background:color-mix(in srgb,var(--md-primary) 10%,transparent); }
.explorer-selection {
    display:flex; align-items:center; gap:2px; min-height:32px; margin-bottom:4px; padding-inline:10px 2px;
    border-radius:var(--md-border-radius-small,var(--md-border-radius)); background:var(--md-surface-hover);
    font-size:12px; color:var(--md-on-surface-variant);
}
.explorer-selection-count { margin-inline-end:auto; font-weight:500; color:var(--md-on-surface); }
.explorer-note { padding:2px 10px 6px; font-size:12px; color:var(--md-on-surface-variant); }
.explorer-empty { padding:16px 10px; font-size:13px; color:var(--md-on-surface-variant); }

/* Themes tune row geometry through --row-icon and --row-gap. */
.project-explorer { --row-icon:18px; --row-gap:10px; }
.explorer-row {
    --indent:16px; --base:10px;
    position:relative; display:flex; align-items:center; gap:0; min-width:0; height:36px;
    padding-inline:calc(var(--base) + var(--depth) * var(--indent)) 4px;
    border-radius:var(--md-border-radius-small,var(--md-border-radius));
    color:var(--md-on-surface); user-select:none;
    transition:background-color var(--app-motion-duration-fast,150ms) var(--app-motion-easing-standard,ease), opacity 150ms ease;
}
.project-explorer--compact .explorer-row { --base:38px; }
/* One faint guide per ancestor, centred under that ancestor's icon. */
.explorer-row::before {
    content:''; position:absolute; inset-block:0; inset-inline-start:calc(var(--base) + var(--row-icon) / 2 - .5px); width:calc(var(--depth) * var(--indent));
    pointer-events:none; opacity:.5;
    background:repeating-linear-gradient(to right, var(--md-outline-variant) 0 1px, transparent 1px var(--indent));
}
.explorer-row:hover { background:var(--md-surface-hover); }
.explorer-row[data-selected="true"] { background:color-mix(in srgb,var(--md-primary) 12%,transparent); color:var(--md-primary); }
.explorer-check { flex:none; margin-inline-end:6px; accent-color:var(--md-primary); }
.explorer-icon { flex:none; width:var(--row-icon); height:var(--row-icon); color:color-mix(in srgb,var(--md-on-surface-variant) 75%,transparent); transition:opacity 150ms, transform 150ms; }
.explorer-row[data-selected="true"] .explorer-icon { color:var(--md-primary); }
/* Folders swap their icon for the disclosure chevron on hover, like project roots. */
.explorer-disclosure {
    display:grid; place-items:center; flex:none; width:calc(var(--row-icon) + 6px); height:calc(var(--row-icon) + 6px); margin-inline:-3px;
    border-radius:var(--md-border-radius-small,var(--md-border-radius)); cursor:pointer;
}
.explorer-disclosure > * { grid-area:1/1; }
.explorer-disclosure:hover { background:var(--md-surface-active,var(--md-surface-hover)); }
.explorer-disclosure .explorer-icon--hover { opacity:0; }
.explorer-row:is(:hover,:focus-within) .explorer-disclosure .explorer-icon--rest { opacity:0; }
.explorer-row:is(:hover,:focus-within) .explorer-disclosure .explorer-icon--hover { opacity:1; }
.tree-name { display:flex; flex:1; align-items:center; gap:var(--row-gap); min-width:0; height:100%; text-align:start; cursor:pointer; background:transparent; }
.tree-name--folder { padding-inline-start:var(--row-gap); }
.tree-label { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:14px; line-height:20px; }
.tree-path { flex:none; max-width:45%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:11px; color:var(--md-on-surface-variant); opacity:.8; }
.project-explorer button:focus-visible { outline:var(--app-focus-ring-width,2px) solid var(--md-focus-ring,var(--md-primary)); outline-offset:-2px; }
.tree-more { flex:none; margin-inline-start:4px; opacity:0; transition:opacity 150ms; }
.explorer-row:is(:hover,:focus-within) .tree-more, .tree-more[data-state="open"] { opacity:1; }
@media (hover:none) {
    .tree-more { opacity:1; }
    .explorer-row { height:40px; }
    .explorer-disclosure .explorer-icon--rest { opacity:0; }
    .explorer-disclosure .explorer-icon--hover { opacity:1; }
}
/* Drag and drop: the moving rows fade, and the destination reads as one block with an accent edge. */
.explorer-row[data-dragged] { opacity:.4; background:transparent; }
.project-explorer[data-explorer-dragging] .explorer-row:hover:not([data-drop]) { background:transparent; }
.project-explorer[data-explorer-dragging] .tree-more { opacity:0; }
.explorer-row[data-drop] {
    /* Folder and root targets share one drop zone: a rounded, softly filled outline around the rows.
       Fills and edges are opaque and overlap by 1px so zoomed, fractional row edges leave no seams. */
    --drop-fill:color-mix(in srgb,var(--md-primary) 5%,var(--md-surface));
    --drop-edge:color-mix(in srgb,var(--md-primary) 40%,var(--md-surface));
    --drop-radius:var(--md-border-radius-small,var(--md-border-radius));
    background:var(--drop-fill); box-shadow:0 1px 0 var(--drop-fill); border-radius:0;
}
.explorer-row[data-drop]::after {
    content:''; position:absolute; inset:0 0 -1px; pointer-events:none;
    border:1.5px solid var(--drop-edge); border-block-width:0;
    animation:explorer-drop-in 140ms var(--app-motion-easing-standard,ease-out);
}
.explorer-row:is([data-drop="first"],[data-drop="only"]) { border-start-start-radius:var(--drop-radius); border-start-end-radius:var(--drop-radius); }
.explorer-row:is([data-drop="first"],[data-drop="only"])::after { border-top-width:1.5px; border-start-start-radius:var(--drop-radius); border-start-end-radius:var(--drop-radius); }
.explorer-row:is([data-drop="last"],[data-drop="only"]) { box-shadow:none; border-end-start-radius:var(--drop-radius); border-end-end-radius:var(--drop-radius); }
.explorer-row:is([data-drop="last"],[data-drop="only"])::after { bottom:0; border-bottom-width:1.5px; border-end-start-radius:var(--drop-radius); border-end-end-radius:var(--drop-radius); }
.explorer-row[data-drop] .explorer-icon { color:var(--md-on-surface); }
@keyframes explorer-drop-in { from { opacity:0; } }
/* After a move, the rows glow briefly where they landed. */
.explorer-row[data-landed] { animation:explorer-landed 1.2s var(--app-motion-easing-standard,ease-out); }
@keyframes explorer-landed {
    0%, 35% { background:color-mix(in srgb,var(--md-primary) 12%,transparent); }
    100% { background:transparent; }
}
@media (prefers-reduced-motion: reduce) {
    .explorer-icon, .tree-more, .explorer-row, .explorer-view { transition:none; }
    .explorer-row[data-drop]::after, .explorer-row[data-landed] { animation:none; }
}
</style>
