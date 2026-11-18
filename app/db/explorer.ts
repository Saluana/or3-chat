import { explorerKvRow, explorerPrefix, explorerFromKv } from './explorer-storage';
import { MAX_PENDING_OPS, countQueuedSyncOperations } from '~/core/sync/outbox-queue';
import { admitExplorerWrite, assertExplorerQueueCapacity } from './explorer-admission';
import type { Or3DB } from './client';
import { PostSchema, type Post } from './schema';
import { computeExplorerItemKey } from './derived-indexes';
import { getWriteTxTableNames, newId, nextClock, nowSec } from './util';
import { resolveChatProject } from './project-workspace';
import type { WorkspaceOperationScope } from '~/utils/chat/workspace-access';
import { normalizeProjectData } from '~/utils/projects/normalizeProjectData';
import { FILE_CATALOG_POST_TYPE, isVisibleWorkspaceItem } from '~~/shared/posts/workspace-item';
import {
    compareFolderName, EXPLORER_FOLDER_POST_TYPE, EXPLORER_MAX_WRITES,
    EXPLORER_PLACEMENT_POST_TYPE, explorerFolderNameSchema, explorerItemKey, explorerPlacementId,
    explorerScopeKey, parseExplorerRecord, type ExplorerItemRef, type ExplorerRowRef, type ExplorerScope,
} from '~~/shared/explorer/records';
import { projectExplorerTree, type ExplorerOrganization } from '~~/shared/explorer/tree';
import { PROJECT_POST_TYPES, ProjectSourceSchema, readPersistedProjectRecord } from '~~/shared/projects/workspace';

export type ExplorerRevision = Pick<Post, 'clock' | 'hlc' | 'content' | 'title' | 'deleted'>;
export type ExplorerMoveRow = { row: ExplorerRowRef; expected: ExplorerRevision | null };
export type ExplorerUndoReceipt = Readonly<{
    scope: string;
    entries: readonly { id: string; before: Post | undefined; expected: ExplorerRevision }[];
}>;
type ScopedRecords = Awaited<ReturnType<typeof loadScopedRecords>>;

function previewPosts(db: Or3DB, key: string) {
    return db.posts.where('[postType+title]').anyOf([
        [EXPLORER_FOLDER_POST_TYPE, key], [EXPLORER_PLACEMENT_POST_TYPE, key],
    ]);
}

// Preview workspaces may already have organization posts. Leave their history
// readable and copy only keys that have never been written in the new format.
export async function importPreviewExplorerRecords(origin: WorkspaceOperationScope, scope: ExplorerScope) {
    if (!origin.writable) return;
    const key = explorerScopeKey(scope);
    const { db } = origin;
    if (!await previewPosts(db, key).first()) return;
    await db.transaction('rw', getWriteTxTableNames(db, ['posts', 'kv', 'projects']), async () => {
        origin.assertCurrent('write');
        await assertProject(db, scope);
        const rows = (await previewPosts(db, key).toArray()).filter(row => parseExplorerRecord(row)).map(explorerKvRow);
        const existing = await db.kv.bulkGet(rows.map(row => row.id));
        const room = origin.explorerCloud ? MAX_PENDING_OPS - 1 - await countQueuedSyncOperations(db) : rows.length;
        const missing = rows.filter((_, i) => !existing[i]).slice(0, Math.max(room, 0));
        if (missing.length) await db.kv.bulkAdd(missing);
        origin.assertCurrent('write');
    });
}

async function loadScopedRecords(db: Or3DB, scope: ExplorerScope) {
    const key = explorerScopeKey(scope);
    const [posts, values] = await Promise.all([
        previewPosts(db, key).toArray(), db.kv.where('name').startsWith(explorerPrefix(key)).toArray(),
    ]);
    const canonical = new Map(posts.map(post => [post.id, post]));
    for (const value of values) {
        const row = explorerFromKv(value, key);
        canonical.set(row.id, row);
    }
    const records: ExplorerOrganization[] = [];
    for (const post of canonical.values()) {
        const record = parseExplorerRecord(post);
        if (record) records.push({ ...record, deleted: post.deleted, updatedAt: post.updated_at });
    }
    return { canonical, records, tree: projectExplorerTree(records) };
}

async function assertProject(db: Or3DB, scope: ExplorerScope) {
    if (scope.kind === 'files') return;
    const project = await db.projects.get(scope.project_id);
    if (!project || project.deleted) throw new Error('This project is unavailable.');
    return project;
}

export function explorerRevision(post: Post | undefined): ExplorerRevision | null {
    if (!post) return null;
    const { clock, hlc, content, title, deleted } = post;
    return { clock, hlc, content, title, deleted };
}

function assertExpected(post: Post | undefined, expected: ExplorerRevision | null) {
    const current = explorerRevision(post);
    if ((!current && expected) || (current && (!expected || current.clock !== expected.clock
        || current.hlc !== expected.hlc || current.content !== expected.content
        || current.title !== expected.title || current.deleted !== expected.deleted))) {
        throw new Error('This location changed. Select the item again.');
    }
}

export async function readExplorerOrganization(origin: WorkspaceOperationScope, scope: ExplorerScope) {
    origin.assertCurrent();
    await assertProject(origin.db, scope);
    const result = await loadScopedRecords(origin.db, scope);
    origin.assertCurrent();
    return result;
}

async function withOrganizationWrite<T>(origin: WorkspaceOperationScope, scope: ExplorerScope,
    write: (records: ScopedRecords) => Promise<T>) {
    await admitExplorerWrite(origin);
    const { db } = origin;
    const tables = getWriteTxTableNames(db, ['kv', 'posts', 'projects', 'threads', 'file_meta']);
    return db.transaction('rw', tables, async () => {
        origin.assertCurrent('write');
        await assertProject(db, scope);
        const records = await loadScopedRecords(db, scope);
        const result = await write(records);
        origin.assertCurrent('write');
        return result;
    });
}

function checkParent({ tree }: ScopedRecords, parentId: string | null) {
    if (parentId !== null && tree.folders.get(parentId)?.deleted !== false) {
        throw new Error('The destination folder is no longer available.');
    }
}

function checkName({ tree }: ScopedRecords, parentId: string | null, name: string, exclude?: string) {
    const normalized = compareFolderName(name);
    if (tree.children.get(parentId)?.some(row => row.id !== exclude
        && compareFolderName(row.payload.name) === normalized)) {
        throw new Error('A folder with that name already exists here.');
    }
}

function organizationPost(scope: ExplorerScope, id: string, postType: string, payload: object,
    previous?: Post, deleted = false): Post {
    const now = nowSec();
    const row = PostSchema.parse({
        ...previous, id, postType, content: JSON.stringify(payload), title: explorerScopeKey(scope),
        clock: nextClock(previous?.clock), created_at: previous?.created_at ?? now, updated_at: now, deleted,
    });
    if (!parseExplorerRecord(row)) throw new Error('This folder or placement cannot be saved.');
    return row;
}

export async function createExplorerFolder(origin: WorkspaceOperationScope, scope: ExplorerScope,
    parentId: string | null, name: string): Promise<string> {
    const parsedName = explorerFolderNameSchema.parse(name);
    const id = 'explorer-folder-' + newId();
    await withOrganizationWrite(origin, scope, async records => {
        checkParent(records, parentId);
        checkName(records, parentId, parsedName);
        await assertExplorerQueueCapacity(origin, 1);
        await origin.db.kv.add(explorerKvRow(organizationPost(scope, id, EXPLORER_FOLDER_POST_TYPE,
            { version: 1, scope, parent_id: parentId, name: parsedName })));
    });
    return id;
}

export async function renameExplorerFolder(origin: WorkspaceOperationScope, scope: ExplorerScope,
    id: string, name: string, expected: ExplorerRevision | null): Promise<ExplorerUndoReceipt | undefined> {
    const parsedName = explorerFolderNameSchema.parse(name);
    return withOrganizationWrite(origin, scope, async records => {
        const current = records.canonical.get(id);
        assertExpected(current, expected);
        const folder = records.tree.folders.get(id);
        if (!folder || folder.deleted) throw new Error('This folder is unavailable.');
        checkName(records, records.tree.folderLocations.get(id)!.parentId, parsedName, id);
        if (parsedName === folder.payload.name) return;
        await assertExplorerQueueCapacity(origin, 1);
        await origin.db.kv.put(explorerKvRow(organizationPost(scope, id, EXPLORER_FOLDER_POST_TYPE,
            { ...folder.payload, name: parsedName }, current)));
        return readUndoReceipt(origin.db, scope, [id], records.canonical);
    });
}

async function readUndoReceipt(db: Or3DB, scope: ExplorerScope, ids: string[],
    before: ReadonlyMap<string, Post>): Promise<ExplorerUndoReceipt> {
    const key = explorerScopeKey(scope);
    const prefix = 'kv:' + explorerPrefix(key);
    const committed = await db.kv.bulkGet(ids.map(id => prefix + id));
    const entries = committed.map((row, i) => {
        const expected = explorerRevision(row && explorerFromKv(row, key));
        if (!expected) throw new Error('Could not read the saved folder location.');
        const id = ids[i]!;
        return { id, before: before.get(id), expected };
    });
    return { scope: key, entries };
}

export async function undoExplorerChange(origin: WorkspaceOperationScope, scope: ExplorerScope, receipt: ExplorerUndoReceipt) {
    if (receipt.scope !== explorerScopeKey(scope)) throw new Error('The original location is in a different scope.');
    await withOrganizationWrite(origin, scope, async records => {
        const changes: Post[] = [];
        const projectItems = scope.kind === 'project' ? await readExplorerProjectItems(origin.db, scope.project_id) : undefined;
        for (const entry of receipt.entries) {
            const current = records.canonical.get(entry.id);
            assertExpected(current, entry.expected);
            const previous = (entry.before ?? current) && parseExplorerRecord((entry.before ?? current)!);
            if (!current || !previous) throw new Error('The original location is no longer available.');
            const deleted = entry.before?.deleted ?? true;
            if (!deleted) {
                const parent = previous.payload.parent_id;
                checkParent(records, parent);
                if (previous.kind === 'folder') {
                    if (records.tree.path(parent).some(folder => folder.id === entry.id)) {
                        throw new Error('The original move would now create a folder cycle.');
                    }
                    checkName(records, parent, previous.payload.name, entry.id);
                }
            }
            if (previous.kind === 'placement') await assertEligible(origin.db, scope, previous.payload.item, projectItems);
            changes.push(organizationPost(scope, entry.id, current.postType, previous.payload, current, deleted));
        }
        await assertExplorerQueueCapacity(origin, changes.length);
        await origin.db.kv.bulkPut(changes.map(explorerKvRow));
    });
}

export async function readExplorerProjectItems(db: Or3DB, id: string): Promise<Set<string>> {
    const project = await db.projects.get(id);
    const keys = new Set<string>();
    if (!project || project.deleted) return keys;
    for (const member of normalizeProjectData(project.data)) {
        if (member.kind === 'chat') continue;
        keys.add(explorerItemKey({ kind: member.kind === 'doc' ? 'document' : 'file', item_id: member.id }));
    }
    for (const row of await db.posts.where('[postType+title]').equals([PROJECT_POST_TYPES.source, id]).toArray()) {
        const source = row.deleted ? null : readPersistedProjectRecord(ProjectSourceSchema, row.content);
        if (source?.kind !== 'document' && source?.kind !== 'file') continue;
        keys.add(explorerItemKey({ kind: source.kind, item_id: source.item_id }));
    }
    return keys;
}

async function isEligible(db: Or3DB, scope: ExplorerScope, item: ExplorerItemRef, projectItems?: Set<string>) {
    if (item.kind === 'chat' && scope.kind === 'project') {
        const thread = await db.threads.get(item.item_id);
        return !!thread && !thread.deleted && !thread.parent_thread_id
            && (!thread.root_thread_id || thread.root_thread_id === thread.id)
            && await resolveChatProject(db, thread.id) === scope.project_id;
    } else if (item.kind !== 'chat') {
        const row = await db.posts.get(item.item_id);
        const type = item.kind === 'file' ? FILE_CATALOG_POST_TYPE : 'doc';
        if (row?.postType === type && isVisibleWorkspaceItem(row) && (scope.kind === 'files'
            || (projectItems ?? await readExplorerProjectItems(db, scope.project_id)).has(explorerItemKey(item)))) {
            if (item.kind === 'document') return true;
            const hash = computeExplorerItemKey(row)?.[5];
            const file = hash ? await db.file_meta.get(hash) : undefined;
            return !!file && !file.deleted;
        }
    }
    return false;
}

async function assertEligible(db: Or3DB, scope: ExplorerScope, item: ExplorerItemRef, projectItems?: Set<string>) {
    if (!await isEligible(db, scope, item, projectItems)) throw new Error('One of the selected items is no longer available here.');
}

export async function moveExplorerRows(origin: WorkspaceOperationScope, scope: ExplorerScope,
    selection: readonly ExplorerMoveRow[], parentId: string | null,
    onUndo?: (receipt: ExplorerUndoReceipt) => void): Promise<number> {
    const prepared = new Map(await Promise.all(selection.map(async entry => {
        const id = entry.row.kind === 'folder' ? entry.row.id : await explorerPlacementId(scope, entry.row.item);
        return [id, entry] as const;
    })));
    const result = await withOrganizationWrite(origin, scope, async records => {
        const { canonical, tree } = records;
        checkParent(records, parentId);
        const selectedFolders = new Set(selection.flatMap(entry => entry.row.kind === 'folder' ? [entry.row.id] : []));
        const destinationPath = tree.path(parentId);
        const names = new Set<string>();
        const changes: Post[] = [];
        const projectItems = scope.kind === 'project' ? await readExplorerProjectItems(origin.db, scope.project_id) : undefined;
        for (const [id, { row, expected }] of prepared) {
            const previous = canonical.get(id);
            assertExpected(previous, expected);
            const record = previous && parseExplorerRecord(previous);
            if (previous && !previous.deleted && !record) throw new Error('This location requires a newer version of OR3.');
            const location = row.kind === 'folder' ? tree.folderLocations.get(id)
                : tree.placements.get(explorerItemKey(row.item));
            if (tree.path(location?.parentId ?? null).some(folder => selectedFolders.has(folder.id))) continue;

            if (row.kind === 'folder') {
                const folder = tree.folders.get(id);
                if (!folder || folder.deleted) throw new Error('One of the selected folders is unavailable.');
                if (destinationPath.some(part => part.id === id)) throw new Error('A folder cannot move into itself or its descendants.');
                if (folder.payload.parent_id === parentId) continue;
                const key = compareFolderName(folder.payload.name);
                checkName(records, parentId, folder.payload.name, id);
                if (names.has(key)) throw new Error('The selected folders include matching names.');
                names.add(key);
                changes.push(organizationPost(scope, id, EXPLORER_FOLDER_POST_TYPE,
                    { ...folder.payload, parent_id: parentId }, previous));
            } else {
                if (record && (record.kind !== 'placement'
                    || explorerItemKey(record.payload.item) !== explorerItemKey(row.item))) {
                    throw new Error('This location no longer matches the selected item.');
                }
                await assertEligible(origin.db, scope, row.item, projectItems);
                if ((!record && parentId === null)
                    || (record?.kind === 'placement' && !previous?.deleted && record.payload.parent_id === parentId)) continue;
                const payload = record?.kind === 'placement' ? record.payload : {
                    version: 1, scope, item: row.item,
                };
                changes.push(organizationPost(scope, id, EXPLORER_PLACEMENT_POST_TYPE,
                    { ...payload, parent_id: parentId }, previous));
            }
            if (changes.length > EXPLORER_MAX_WRITES) {
                throw new Error(`Move at most ${EXPLORER_MAX_WRITES} records at a time. Reduce the selection and try again.`);
            }
        }
        await assertExplorerQueueCapacity(origin, changes.length);
        await origin.db.kv.bulkPut(changes.map(explorerKvRow));
        const undo = onUndo && changes.length
            ? await readUndoReceipt(origin.db, scope, changes.map(row => row.id), canonical) : undefined;
        return { count: changes.length, undo };
    });
    if (result.undo) onUndo?.(result.undo);
    return result.count;
}

function removalPlan(records: ScopedRecords, id: string) {
    const folder = records.tree.folders.get(id);
    if (!folder || folder.deleted) throw new Error('This folder is unavailable.');
    const parentId = records.tree.folderLocations.get(id)!.parentId;
    const children = records.records.flatMap(row => {
        if (row.deleted) return [];
        const location = row.kind === 'folder' ? records.tree.folderLocations.get(row.id)
            : records.tree.placements.get(explorerItemKey(row.payload.item));
        return location?.parentId === id ? [{ row, post: records.canonical.get(row.id)! }] : [];
    });
    const counts = { folder: 0, file: 0, document: 0, chat: 0, hidden: 0 };
    for (const { row } of children) {
        if (row.kind === 'folder') counts.folder++;
        else counts[row.payload.item.kind]++;
    }
    return { folder, parentId, children, counts };
}

export async function planExplorerFolderRemoval(origin: WorkspaceOperationScope, scope: ExplorerScope, id: string) {
    const records = await readExplorerOrganization(origin, scope);
    const plan = removalPlan(records, id);
    const members = scope.kind === 'project' && (plan.counts.file || plan.counts.document)
        ? await readExplorerProjectItems(origin.db, scope.project_id) : undefined;
    for (const { row } of plan.children) {
        if (row.kind === 'placement' && !await isEligible(origin.db, scope, row.payload.item, members)) plan.counts.hidden++;
    }
    origin.assertCurrent();
    return { ...plan, expected: explorerRevision(records.canonical.get(id)),
        destination: records.tree.path(plan.parentId).map(records.tree.label).join(' / ') };
}

export async function removeExplorerFolder(origin: WorkspaceOperationScope, scope: ExplorerScope, id: string,
    expected: Awaited<ReturnType<typeof planExplorerFolderRemoval>>) {
    await withOrganizationWrite(origin, scope, async records => {
        const current = records.canonical.get(id);
        assertExpected(current, expected.expected);
        const { folder, parentId, children } = removalPlan(records, id);
        const revisions = new Map(expected.children.map(({ post }) => [post.id, explorerRevision(post)]));
        if (parentId !== expected.parentId || revisions.size !== children.length) {
            throw new Error('This folder changed. Review its contents and try again.');
        }
        for (const { post } of children) assertExpected(post, revisions.get(post.id) ?? null);
        await assertExplorerQueueCapacity(origin, 1);
        await origin.db.kv.put(explorerKvRow(organizationPost(scope, id, EXPLORER_FOLDER_POST_TYPE,
            folder.payload, current, true)));
    });
}
