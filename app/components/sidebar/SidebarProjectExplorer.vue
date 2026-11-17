<script setup lang="ts">
import { computed, nextTick, onScopeDispose, ref, shallowRef, useId, watch } from 'vue';
import { useLocalStorage } from '@vueuse/core';
import { liveQuery } from 'dexie';
import AppModal from '~/components/ui/AppModal.vue';
import ExplorerMoveDialog from '~/components/files/ExplorerMoveDialog.vue';
import { useExplorerDrag } from '~/composables/explorer/useExplorerDrag';
import { useExplorerSelection } from '~/composables/explorer/useExplorerSelection';
import { useExplorerUndo } from '~/composables/explorer/useExplorerUndo';
import { useFilesExplorerReveal, useProjectExplorerReveal } from '~/composables/explorer/useExplorerReveal';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { useProjectTreeActions, type ProjectTreeChild, type ProjectTreeRoot } from '~/composables/projects/useProjectTreeActions';
import { getPaletteHostContext } from '~/composables/search/useCommandPalette';
import {
    createExplorerFolder, explorerRevision, moveExplorerRows, planExplorerFolderRemoval,
    readExplorerOrganization, readExplorerProjectItems, removeExplorerFolder, renameExplorerFolder, type ExplorerRevision,
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
const props = defineProps<{ projectId: string; projectName: string; query?: string; documentsEnabled: boolean; compact?: boolean }>();
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
const revealedQuery = ref<string>();
const activeQuery = computed(() => props.query === revealedQuery.value ? '' : props.query);
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
const plusIcon = useIcon('ui.plus');
const warningIcon = useIcon('ui.warning');
const rowButtons = useThemeOverrides({
    component: 'button', context: 'sidebar', identifier: 'sidebar.project-content.action', isNuxtUI: true,
});
const extensionActions = useProjectTreeActions();
const scopeLabel = computed(() => 'project ' + props.projectName);
const explorer = computed(() => props.compact || view.value === 'explorer'
    || (view.value === 'automatic' && [...(organization.value?.tree.folders.values() ?? [])].some(folder => !folder.deleted)));
watch(explorer, active => emit('view', active), { immediate: true });
watch(explorer, () => clearSelection());
watch(() => props.query, () => clearSelection());

const sub = liveQuery(async () => {
    const [organization, members, metadata, families] = await Promise.all([
        readExplorerOrganization(origin, scope), readExplorerProjectItems(origin.db, props.projectId),
        listExplorerItems(origin.db, 'active'),
        readFamilyPage(origin.db, { limit: Number.MAX_SAFE_INTEGER, type: 'thread', filter: { projectId: props.projectId } }),
    ]);
    origin.assertCurrent();
    const content = metadata.flatMap((row): Node[] => {
        if (row.kind === 'document' && !props.documentsEnabled) return [];
        const item: ExplorerItemRef = { kind: row.kind, item_id: row.id };
        const key = explorerItemKey(item);
        if (!members.has(key)) return [];
        return [{ key, item, label: row.title, icon: row.kind === 'document' ? noteIcon.value : fileIcon.value, path: '' }];
    });
    for (const thread of families.items) {
        if (thread.type !== 'thread') continue;
        const id = thread.family?.rootId ?? thread.id;
        const item: ExplorerItemRef = { kind: 'chat', item_id: id };
        content.push({ key: explorerItemKey(item), label: thread.title, item, openId: thread.family?.originalId ?? thread.id,
            icon: chatIcon.value, path: '' });
    }
    return { organization, content };
}).subscribe({
    next(value) { organization.value = value.organization; items.value = value.content; },
    error(cause: unknown) { if (!controller.signal.aborted) error.value = cause instanceof Error ? cause.message : 'Project Explorer could not load.'; },
});
onScopeDispose(() => { controller.abort(); sub.unsubscribe(); });

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
watch(() => props.query, () => { revealedQuery.value = undefined; });
async function focusNode(node: Node) {
    await nextTick();
    const root = viewport.value?.querySelector<HTMLElement>('.project-explorer-tree');
    if (!root) return;
    const selector = `[data-project-row="${CSS.escape(node.key)}"] .project-explorer-activate`;
    const position = visible.value.findIndex(item => item.key === node.key);
    if (!root.querySelector(selector) && position >= 0) {
        root.scrollTop = position * 44;
        await new Promise(requestAnimationFrame);
        await nextTick();
    }
    root.querySelector<HTMLElement>(selector)?.focus();
}
async function revealInTree(node: Node) {
    const projection = organization.value?.tree;
    if (!projection) return;
    revealedQuery.value = props.query;
    emit('clearSearch');
    view.value = 'explorer';
    for (const folder of projection.path(projection.placements.get(node.key)?.parentId ?? null)) expand(folder.id);
    await focusNode(node);
}
watch([revealRequest, items], ([request, content]) => {
    if (props.compact || !request || request.projectId !== props.projectId || request.generation !== origin.generation) return;
    const item = content.find(row => row.key === request.key);
    if (!item) return;
    revealRequest.value = null;
    void revealInTree(item);
}, { immediate: true, flush: 'post' });
const destinations = computed(() => {
    const tree = organization.value?.tree;
    if (!tree) return [];
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
        status.value = 'Project locations updated.';
    });
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
        const request = { itemId: item.item_id, generation: origin.generation };
        filesReveal.value = request;
        const result = await host.openPaneApp('or3-files', undefined, 'active');
        if (!result.ok) {
            if (filesReveal.value === request) filesReveal.value = null;
            throw new Error(result.error.message);
        }
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
const toolbarBeforeDrag = ref(false);
const { directive: vExplorerDrag, announcement, dragging } = useExplorerDrag({
    enabled: computed(() => explorer.value && !busy.value && origin.writable),
    viewport: computed(() => visible.value.length ? viewport.value?.querySelector<HTMLElement>('.project-explorer-tree') ?? null : null),
    start: key => {
        toolbarBeforeDrag.value = selected.value.size > 0 || selectMode.value;
        if (!selected.value.has(key)) { clearSelection(); choose(key); }
    },
    move: parent => { void move(parent); },
    reject: message => { error.value = message; },
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
function menu(node: Node) {
    const items: { label: string; icon?: string; onSelect: () => void }[] = [{ label: 'Move to…', onSelect: () => openMove(node) }];
    if (node.item && activeQuery.value && selected.value.size <= 1) {
        items.push({ label: 'Show in ' + scopeLabel.value, onSelect: () => revealInTree(node) });
    }
    if (node.item && (!selected.value.has(node.key) || selected.value.size === 1)) {
        if (node.item.kind !== 'chat') items.push({ label: 'Show in Files', onSelect: () => showInFiles(node.item!) });
        items.push({ label: 'Rename', onSelect: () => requestRename(node) });
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
        items.push({ label: 'Remove from ' + scopeLabel.value, onSelect: () => {
            if (!selected.value.has(node.key)) { clearSelection(); choose(node.key); }
            removeContents.value = true;
        } });
    }
    if (node.folder && (!selected.value.has(node.key) || selected.value.size < 2)) {
        const folder = node.folder;
        items.push(
            { label: 'New folder in ' + node.label, onSelect: () => openFolderDialog(folder) },
            { label: 'New chat in ' + node.label, onSelect: () => emit('create', 'chat', folder) },
            ...(!props.compact ? [{ label: 'Add file in ' + node.label, onSelect: () => emit('addFile', folder) }] : []),
            ...(props.documentsEnabled ? [{ label: 'New document in ' + node.label,
                onSelect: () => emit('create', 'document', folder) }] : []),
            { label: 'Rename folder', onSelect: () => openFolderDialog(folder, 'rename') },
            { label: 'Remove folder, keep contents', onSelect: () => requestRemoval(folder) },
        );
    }
    return [items];
}
function recoveredLocation(node: Node) {
    const projection = organization.value?.tree;
    const resolved = node.folder ? projection?.folderLocations.get(node.key) : projection?.placements.get(node.key);
    const shownIn = node.path ? scopeLabel.value + ' / ' + node.path : scopeLabel.value + ' root';
    return explorerRecoveryLabel(resolved, shownIn);
}
</script>

<template>
    <div v-if="!compact" aria-label="Project content view" class="flex flex-wrap items-center gap-1">
        <UButton v-bind="rowButtons" size="sm" color="neutral" :variant="explorer ? 'ghost' : 'soft'" label="Recent activity"
            :aria-pressed="!explorer" @click="view = 'recent'" />
        <UButton v-bind="rowButtons" size="sm" color="neutral" :variant="explorer ? 'soft' : 'ghost'" label="Explorer"
            :aria-pressed="explorer" @click="view = 'explorer'" />
    </div>
    <section v-if="explorer" :aria-label="compact ? 'Project shortcuts for ' + projectName : 'Project Explorer'" class="space-y-2"
        @dragover="blockExternal" @drop="blockExternal" @keydown.capture="explorerKey">
        <header v-explorer-drag="{ destination: null, label: scopeLabel + ' root' }" class="project-explorer-header flex flex-wrap items-center gap-1">
            <UButton v-bind="rowButtons" size="sm" color="neutral" variant="ghost" :icon="plusIcon"
                :label="'New folder in ' + projectName" :disabled="busy || !origin.writable" @click="openFolderDialog()" />
            <UButton v-bind="rowButtons" size="sm" color="neutral" variant="ghost" :label="selectMode ? 'Done' : 'Select'"
                :aria-pressed="selectMode" @click="selectMode = !selectMode" />
            <UDropdownMenu v-if="rootExtensions.length && selected.size <= 1" :items="rootExtensions">
                <UButton v-bind="rowButtons" size="sm" color="neutral" variant="ghost" :icon="moreIcon" square aria-label="Project Explorer actions" />
            </UDropdownMenu>
        </header>
        <div v-if="dragging ? toolbarBeforeDrag : selected.size || selectMode" class="flex flex-wrap items-center gap-1 text-xs text-muted">
            <span role="status">{{ selected.size }} selected</span>
            <UButton v-bind="rowButtons" size="sm" color="neutral" variant="ghost" label="Select all results" @click="all" />
            <UButton v-bind="rowButtons" size="sm" color="neutral" variant="ghost" label="Clear" @click="clearSelection" />
            <UButton v-bind="rowButtons" size="sm" label="Move to…" :disabled="!selected.size || selected.size > EXPLORER_MAX_WRITES || busy || !origin.writable" @click="openMove()" />
            <UButton v-bind="rowButtons" size="sm" color="neutral" variant="outline" :label="'Remove ' + selected.size + ' items'"
                :disabled="selectionHasFolders || !selected.size || selected.size > EXPLORER_MAX_WRITES || busy || !origin.writable" @click="removeContents = true" />
            <p v-if="selectionHasFolders">Select project contents only to remove them from this project.</p>
        </div>
        <p role="status" class="sr-only">{{ announcement }}</p>
        <p v-if="status" role="status" class="text-xs text-muted">{{ status }}</p>
        <UAlert v-if="error && !folderDialog && !titleDialog && !removal" role="alert" :description="error" color="error" variant="soft" />
        <div ref="viewport">
            <UTree v-if="tree.length" v-model:expanded="expanded" :items="tree" :get-key="item => item.key"
                :virtualize="{ estimateSize: 44, overscan: 8 }" :as="{ link: 'div' }" aria-label="Project contents"
                class="project-explorer-tree max-h-[min(45vh,32rem)] overflow-auto sidebar-scroll">
                <template #item-wrapper="{ item, level, expanded: open }">
                    <div v-explorer-drag="item.folder ? { source: item.key, destination: item.key,
                        label: item.path, hover: () => expand(item.key) } : { source: item.key }"
                        class="project-explorer-row flex min-h-11 min-w-0 items-center gap-1.5 rounded-md pe-1"
                        :style="{ paddingInlineStart: Math.min((level - 1) * 12, 48) + 'px' }"
                        :data-project-row="item.key"
                        :aria-selected="selected.has(item.key)" :data-selected="selected.has(item.key)"
                        :title="item.path ? item.path + (item.folder ? '' : ' / ' + item.label) : item.label"
                        @keydown.enter.stop.prevent="activate(item, $event)" @keydown.space.stop.prevent="choose(item.key, $event, true)">
                        <input type="checkbox" :aria-label="'Select ' + item.label" :checked="selected.has(item.key)"
                            class="accent-(--ui-primary)" @click.stop="choose(item.key, $event, true)" @keydown.stop>
                        <UButton v-if="item.folder" v-bind="rowButtons" size="sm" color="neutral" variant="ghost" square
                            :icon="open ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                            :aria-label="(open ? 'Collapse ' : 'Expand ') + item.label" :aria-expanded="open"
                            @click.stop="expand(item.key, true)" @keydown.enter.stop @keydown.space.stop />
                        <UButton v-bind="rowButtons" :icon="item.icon" :label="item.label" :title="item.label"
                            color="neutral" variant="ghost" size="sm" class="project-explorer-activate min-w-0 flex-1 text-start"
                            :ui="{ label: 'truncate' }" @click.stop="activate(item, $event)"
                            @keydown.enter.stop @keydown.space.stop />
                        <span v-if="activeQuery" class="min-w-0 truncate text-xs text-muted" :title="item.path">{{ item.path || projectName + ' root' }}</span>
                        <UTooltip v-if="recoveredLocation(item)" :text="recoveredLocation(item)">
                            <UButton v-bind="rowButtons" size="sm" :icon="warningIcon" color="neutral" variant="ghost" square :aria-label="recoveredLocation(item)" />
                        </UTooltip>
                        <UDropdownMenu v-if="origin.writable" :items="menu(item)" :content="{ align: 'end' }"
                            @update:open="open => { if (open) selectForMenu(item); }">
                            <UButton v-bind="rowButtons" :icon="moreIcon" :aria-label="'More actions for ' + item.label"
                                color="neutral" variant="ghost" size="sm" square
                                @click.stop @keydown.stop />
                        </UDropdownMenu>
                    </div>
                </template>
            </UTree>
            <p v-else class="px-2 py-3 text-xs text-muted">{{ activeQuery ? 'No matching contents in ' + scopeLabel : 'No project contents yet' }}</p>
        </div>
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
.project-explorer-row:hover { background: var(--md-surface-hover); }
.project-explorer-row[data-selected='true'] { background: color-mix(in srgb, var(--md-primary) 8%, var(--md-surface)); }
.project-explorer-row[data-explorer-drop='true'], .project-explorer-header[data-explorer-drop='true'] {
    outline: var(--md-border-width, 1px) solid var(--md-primary);
    outline-offset: -2px;
}
</style>
