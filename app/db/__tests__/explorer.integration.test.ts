import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Or3DB, physicalStoreName } from '../client';
import { createExplorerFolder, explorerRevision, moveExplorerRows, planExplorerFolderRemoval, readExplorerOrganization, removeExplorerFolder, renameExplorerFolder, undoExplorerChange, type ExplorerUndoReceipt } from '../explorer';
import { assertExplorerQueueCapacity } from '../explorer-admission';
import { removeExplorerProjectItems } from '../explorer-project-removal';
import { saveProjectSource } from '../project-workspace';
import { listExplorerItems } from '../explorer-items';
import { PostSchema } from '../schema';
import { explorerItemKey, explorerPlacementId, type ExplorerItemRef } from '~~/shared/explorer/records';
import { workspaceRevision } from '~~/shared/posts/workspace-revision';
import type { WorkspaceOperationScope } from '~/utils/chat/workspace-access';

vi.mock('~/core/hooks/useHooks', () => ({
    useHooks: () => ({
        applyFilters: async (_name: string, value: unknown) => value,
        doAction: async () => {},
    }),
}));

const files = { kind: 'files' } as const;
const project = { kind: 'project', project_id: 'project-a' } as const;
const document = (id: string) => PostSchema.parse({
    id, title: id, postType: 'doc', content: '{"type":"doc","content":[]}', created_at: 10, updated_at: 10,
});
const item = (id: string): ExplorerItemRef => ({ kind: 'document', item_id: id });
const selection = (id: string) => ({ row: { kind: 'item' as const, item: item(id) }, expected: null });

describe('local explorer storage', () => {
    let db: Or3DB;
    let origin: WorkspaceOperationScope;
    beforeEach(async () => {
        db = new Or3DB('explorer-test-' + crypto.randomUUID());
        await db.open();
        origin = { db, workspaceId: 'local', generation: 0, subject: null, writable: true, explorerLocal: true,
            signal: new AbortController().signal, assertCurrent() {} };
    });
    afterEach(async () => { await db.delete(); });

    it('undoes a move atomically and declines an inverse after a revision change', async () => {
        await db.posts.bulkAdd([document('alpha'), document('beta')]);
        const folder = await createExplorerFolder(origin, files, null, 'Research');
        let receipt: ExplorerUndoReceipt | undefined;
        const capture = (value: ExplorerUndoReceipt) => { receipt = value; };
        await moveExplorerRows(origin, files, [selection('alpha'), selection('beta')], folder, capture);
        await undoExplorerChange(origin, files, receipt!);
        expect((await readExplorerOrganization(origin, files)).tree.placements.size).toBe(0);
        const rename = await renameExplorerFolder(origin, files, folder, 'Archive', explorerRevision(await db.posts.get(folder)));
        const nested = await createExplorerFolder(origin, files, folder, 'Nested');
        await renameExplorerFolder(origin, files, folder, 'Updated elsewhere', explorerRevision(await db.posts.get(folder)));
        await expect(undoExplorerChange(origin, files, rename!)).rejects.toThrow('changed');
        expect((await readExplorerOrganization(origin, files)).tree.path(nested).map(row => row.payload.name))
            .toEqual(['Updated elsewhere', 'Nested']);
    });

    it('admits projected 499 queued operations and refuses 500', async () => {
        for (const [status, count] of [['pending', 300], ['retry_wait', 198], ['failed', 1]] as const) {
            await db.pending_ops.bulkAdd(Array.from({ length: count }, (_, index) => ({
                id: status + index, status, tableName: 'posts', operation: 'put', pk: String(index), payload: {},
                attempts: 0, createdAt: 0, stamp: { clock: 1, hlc: '1:0:a', deviceId: 'a', opId: status + index },
            })));
        }
        const cloud = { ...origin, explorerLocal: false, explorerCloud: true };
        await expect(assertExplorerQueueCapacity(cloud, 1)).resolves.toBeUndefined();
        await expect(assertExplorerQueueCapacity(cloud, 2)).rejects.toMatchObject({ code: 'explorer-queue-full' });
    });

    it('refuses removal of a folder with 2,000 direct children without writes', async () => {
        const parent = await createExplorerFolder(origin, files, null, 'Large folder');
        const ancestor = (await db.posts.get(parent))!;
        await new Promise<void>((resolve, reject) => {
            const table = physicalStoreName('posts');
            const transaction = db.backendDB().transaction(table, 'readwrite');
            transaction.oncomplete = () => resolve();
            transaction.onabort = () => reject(transaction.error);
            const posts = transaction.objectStore(table);
            for (let i = 0; i < 2000; i++) {
                posts.put({ ...ancestor, id: 'explorer-folder-00000000-0000-4000-8000-' + String(i).padStart(12, '0'),
                    content: JSON.stringify({ version: 1, scope: files, parent_id: parent, name: 'Child ' + i }) });
            }
        });
        const plan = await planExplorerFolderRemoval(origin, files, parent);
        expect(plan.counts.folder).toBe(2000);
        await expect(removeExplorerFolder(origin, files, parent, plan)).rejects.toThrow(/2000 direct entries/);
        expect(await db.posts.get(parent)).toMatchObject(ancestor);
        expect(await db.posts.count()).toBe(2001);
    }, 120_000);

    it('keeps stable nested folder IDs and independent Files and project placements', async () => {
        await db.posts.add(document('doc-a'));
        await db.projects.add({ id: project.project_id, name: 'Project A', data: [{ kind: 'doc', id: 'doc-a' }],
            created_at: 10, updated_at: 10, clock: 1, deleted: false });
        const root = await createExplorerFolder(origin, files, null, 'Research');
        const sub = await createExplorerFolder(origin, files, root, 'Notes');
        const projectFolder = await createExplorerFolder(origin, project, null, 'Project notes');
        expect((await readExplorerOrganization(origin, files)).tree.placements.size).toBe(0);
        expect(await moveExplorerRows(origin, files, [selection('doc-a')], sub)).toBe(1);
        expect(await moveExplorerRows(origin, project, [selection('doc-a')], projectFolder)).toBe(1);
        const before = await db.posts.get(root);
        await renameExplorerFolder(origin, files, root, 'Archive', explorerRevision(before));
        const filesData = await readExplorerOrganization(origin, files);
        const projectData = await readExplorerOrganization(origin, project);
        const key = explorerItemKey(item('doc-a'));
        expect(filesData.tree.placements.get(key)?.parentId).toBe(sub);
        expect(projectData.tree.placements.get(key)?.parentId).toBe(projectFolder);
        expect(filesData.tree.path(sub).map(folder => folder.payload.name)).toEqual(['Archive', 'Notes']);
        expect(await db.posts.get('doc-a')).toMatchObject(document('doc-a'));
        expect((await listExplorerItems(db, 'active')).map(row => row.id)).toEqual(['doc-a']);
        await expect(renameExplorerFolder(origin, files, root, 'Stale', explorerRevision(before))).rejects.toThrow('changed');
        await expect(moveExplorerRows(origin, files,
            [{ row: { kind: 'folder', id: root }, expected: explorerRevision(await db.posts.get(root)) }], sub))
            .rejects.toThrow('descendants');
    });

    it('refuses any writes beyond budget and rolls back on access loss inside the transaction', async () => {
        const ids = Array.from({ length: 101 }, (_, index) => `doc-${index}`);
        await db.posts.bulkAdd(ids.map(document));
        const folder = await createExplorerFolder(origin, files, null, 'Destination');
        await expect(moveExplorerRows(origin, files, ids.map(selection), folder)).rejects.toThrow('at most 100');
        expect((await readExplorerOrganization(origin, files)).tree.placements.size).toBe(0);
        let checks = 0;
        const revoked = { ...origin, assertCurrent() { if (++checks === 3) throw new Error('Access revoked'); } };
        await expect(moveExplorerRows(revoked, files, [selection(ids[0]!)], folder)).rejects.toThrow('Access revoked');
        expect((await readExplorerOrganization(origin, files)).tree.placements.size).toBe(0);
        expect(await moveExplorerRows(origin, files, ids.slice(0, 100).map(selection), folder)).toBe(100);
        const placement = await db.posts.get(await explorerPlacementId(files, item(ids[0]!)));
        expect(placement?.deleted).toBe(false);
        expect((await readExplorerOrganization(origin, files)).tree.placements.size).toBe(100);
    });

    it('promotes placements and child folders while preserving content and its Trash state', async () => {
        const parent = await createExplorerFolder(origin, files, null, 'Parent');
        const removed = await createExplorerFolder(origin, files, parent, 'Removed');
        const child = await createExplorerFolder(origin, files, removed, 'Child');
        await db.posts.add(document('doc-hidden'));
        await moveExplorerRows(origin, files, [selection('doc-hidden')], removed);
        const meta = JSON.stringify({ 'or3.workspace-item': { version: 1, trashed_at: 10 } });
        await db.posts.update('doc-hidden', { meta });
        const plan = await planExplorerFolderRemoval(origin, files, removed);
        expect(plan.counts).toEqual({ folder: 1, file: 0, document: 1, chat: 0, hidden: 1 });
        expect(plan.destination).toBe('Parent');
        await removeExplorerFolder(origin, files, removed, plan);
        const { tree } = await readExplorerOrganization(origin, files);
        expect(tree.folders.get(removed)?.deleted).toBe(true);
        expect(tree.folderLocations.get(child)?.parentId).toBe(parent);
        expect(tree.placements.get(explorerItemKey(item('doc-hidden')))?.parentId).toBe(parent);
        expect(await db.posts.get('doc-hidden')).toMatchObject({ meta, deleted: false, content: document('doc-hidden').content });
    });

    it('removes project Knowledge and membership without moving the underlying Files item', async () => {
        const doc = document('doc-linked');
        await db.posts.add(doc);
        await db.projects.add({ id: project.project_id, name: 'Project A', data: [],
            created_at: 10, updated_at: 10, clock: 1, deleted: false });
        const revision = await workspaceRevision(doc);
        const source = {
            kind: 'document', item_id: doc.id, title: doc.title, mode: 'relevant',
            current_revision_id: revision, revisions: [{ id: revision, status: 'ready', coverage: 'full', created_at: 10 }],
        } as const;
        const binding = await saveProjectSource(origin, project.project_id, { ...source, revisions: [...source.revisions] });
        const folder = await createExplorerFolder(origin, files, null, 'Files copy');
        const projectFolder = await createExplorerFolder(origin, project, null, 'Project organization');
        await moveExplorerRows(origin, files, [selection(doc.id)], folder);
        await moveExplorerRows(origin, project, [selection(doc.id)], projectFolder);
        const entry = item(doc.id);
        const result = await removeExplorerProjectItems(origin, project.project_id, [entry]);
        expect(result.completed.has(entry)).toBe(true);
        expect(result.failed.size).toBe(0);
        expect((await db.projects.get(project.project_id))?.data).toEqual([]);
        expect((await db.posts.get(binding.row.id))?.deleted).toBe(true);
        const { tree } = await readExplorerOrganization(origin, files);
        expect(tree.placements.get(explorerItemKey(entry))?.parentId).toBe(folder);
        await saveProjectSource(origin, project.project_id, { ...source, revisions: [...source.revisions] });
        expect((await readExplorerOrganization(origin, project)).tree.placements.has(explorerItemKey(entry))).toBe(false);
        expect(await db.posts.get(doc.id)).toMatchObject(doc);
    });

    it('enumerates the complete result vector without fetching post values', async () => {
        const ids = Array.from({ length: 300 }, (_, index) => `scale-${index}`);
        await db.posts.bulkAdd(ids.map(id => document(id)));
        let valuesRead = 0;
        db.use({ stack: 'dbcore', name: 'explorer-test-read-probe', create(core) {
            return { ...core, table(name) {
                const table = core.table(name);
                if (name !== db.posts.name) return table;
                return { ...table,
                    get(req) { valuesRead++; return table.get(req); },
                    getMany(req) { valuesRead += req.keys.length; return table.getMany(req); },
                    query(req) { if (req.values) valuesRead++; return table.query(req); },
                    openCursor(req) { if (req.values) valuesRead++; return table.openCursor(req); },
                };
            } };
        } });
        db.close();
        await db.open();
        const results = await listExplorerItems(db, 'active');
        expect(new Set(results.map(row => row.id))).toEqual(new Set(ids));
        expect(valuesRead).toBe(0);
    });

    it('refuses local normalized duplicates and requires the local capability', async () => {
        const folder = await createExplorerFolder(origin, files, null, 'École');
        await expect(createExplorerFolder(origin, files, null, ' ÉCOLE ')).rejects.toThrow('already exists');
        await expect(createExplorerFolder({ ...origin, explorerLocal: false }, files, folder, 'Cloud')).rejects.toThrow('unavailable');
    });
});
