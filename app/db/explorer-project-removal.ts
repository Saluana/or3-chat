import type { Or3DB } from './client';
import { chatFamilyIds, chatOwnerIn, moveChatProjectRows, notifyChatProjectMove, prepareProjectRecordRemoval } from './project-workspace';
import { getWriteTxTableNames, nextClock } from './util';
import { parseDocumentFileHashes } from '~/utils/documents/document-content';
import type { WorkspaceOperationScope } from '~/utils/chat/workspace-access';
import { assertProjectUnchanged, prepareWorkspaceProjectAssociation } from '~/utils/chat/workspace-projects';
import { projectEntryIdentity, preservedProjectEntries } from '~/utils/projects/normalizeProjectData';
import { workspaceRevision } from '~~/shared/posts/workspace-revision';
import { PROJECT_POST_TYPES, ProjectSourceSchema, readPersistedProjectRecord } from '~~/shared/projects/workspace';
import { EXPLORER_MAX_WRITES, type ExplorerItemRef } from '~~/shared/explorer/records';
import { assertExplorerQueueCapacity } from './explorer-admission';
import { clearProjectPlacement, readActiveProjectPlacement } from './explorer-placement-lifecycle';

async function readBinding(db: Or3DB, projectId: string, itemId: string) {
    return db.posts.where('[postType+title]').equals([PROJECT_POST_TYPES.source, projectId]).filter(row =>
        !row.deleted && readPersistedProjectRecord(ProjectSourceSchema, row.content)?.item_id === itemId,
    ).first();
}

async function contentCost(db: Or3DB, projectId: string, item: ExplorerItemRef) {
    const binding = await readBinding(db, projectId, item.item_id);
    const placement = await readActiveProjectPlacement(db, projectId, item);
    return 1 + Number(!!placement) + (binding ? 1 + new Set(parseDocumentFileHashes(binding.file_hashes)).size : 0);
}

async function estimate(db: Or3DB, projectId: string, item: ExplorerItemRef) {
    if (item.kind !== 'chat') return contentCost(db, projectId, item);
    const projects = (await db.projects.toArray()).filter(project => !project.deleted);
    const family = new Set<string>();
    for (const id of await chatFamilyIds(db, item.item_id)) {
        const row = await db.threads.get(id);
        if (row && !row.deleted && chatOwnerIn(row, projects) === projectId) family.add(id);
    }
    const changedProjects = projects.filter(project => preservedProjectEntries(project.data).some(entry => {
        const key = projectEntryIdentity(entry);
        return key?.startsWith('chat:') && family.has(key.slice(5));
    }));
    const placement = await readActiveProjectPlacement(db, projectId, item);
    return changedProjects.length + family.size + Number(!!placement);
}

function assertBudget(cost: number, remaining: number) {
    if (cost <= remaining) return;
    throw Object.assign(new Error(`Remove at most ${EXPLORER_MAX_WRITES} records at a time, including chat branches and Knowledge bindings.`),
        { code: 'explorer-budget' });
}

async function removeOne(origin: WorkspaceOperationScope, projectId: string, item: ExplorerItemRef, remaining: number) {
    const tables = getWriteTxTableNames(origin.db, ['projects', 'posts', 'threads', 'messages', 'file_meta', 'kv']);
    if (item.kind === 'chat') {
        const changed = await origin.db.transaction('rw', tables, async () => {
            origin.assertCurrent('write');
            const root = await origin.db.threads.get(item.item_id);
            if (!root || root.deleted || root.parent_thread_id || chatOwnerIn(root, await origin.db.projects.toArray()) !== projectId) {
                throw new Error('This chat family is no longer in the project.');
            }
            const estimated = await estimate(origin.db, projectId, item);
            assertBudget(estimated, remaining);
            await assertExplorerQueueCapacity(origin, estimated);
            const changed = await moveChatProjectRows(origin, root.id, null, { family: true });
            assertBudget(changed.threads.length + changed.projects.length + changed.placements, remaining);
            return changed;
        });
        await notifyChatProjectMove(changed);
        return changed.threads.length + changed.projects.length + changed.placements;
    }
    const project = await origin.db.projects.get(projectId);
    if (!project || project.deleted) throw new Error('This project is unavailable.');
    const association = await prepareWorkspaceProjectAssociation(origin,
        { id: projectId, revision: await workspaceRevision(project) },
        { kind: item.kind, id: item.item_id, title: '' }, true);
    const binding = await readBinding(origin.db, projectId, item.item_id);
    const removal = binding ? await prepareProjectRecordRemoval(origin, projectId, binding) : null;
    const saved = { ...association.prepared.row, clock: nextClock(association.base.clock) };
    if (preservedProjectEntries(saved.data).some(entry => projectEntryIdentity(entry) === `${item.kind}:${item.item_id}`)) {
        throw new Error('A project policy kept this association.');
    }
    const cost = await origin.db.transaction('rw', tables, async () => {
        origin.assertCurrent('write');
        assertProjectUnchanged(await origin.db.projects.get(projectId), association.base);
        const currentBinding = await readBinding(origin.db, projectId, item.item_id);
        if (currentBinding?.id !== binding?.id) throw new Error('Project Knowledge changed. Reload and try again.');
        const writes = await contentCost(origin.db, projectId, item);
        assertBudget(writes, remaining);
        await assertExplorerQueueCapacity(origin, writes);
        await origin.db.projects.put(saved);
        await clearProjectPlacement(origin.db, projectId, item);
        if (removal) await removal.commit();
        origin.assertCurrent('write');
        return writes;
    });
    try {
        await removal?.afterCommit();
        await association.prepared.afterCommit(saved);
    } catch (error) {
        console.warn('[explorer] Project removal committed; notification failed.', error);
    }
    return cost;
}

export async function removeExplorerProjectItems(origin: WorkspaceOperationScope, projectId: string,
    items: readonly ExplorerItemRef[]) {
    origin.assertCurrent('write');
    if (!origin.explorerLocal && !origin.explorerCloud) throw new Error('Project Explorer is unavailable.');
    let size = 0;
    for (const item of items) {
        size += await estimate(origin.db, projectId, item);
        assertBudget(size, EXPLORER_MAX_WRITES);
    }
    await assertExplorerQueueCapacity(origin, size);
    const completed = new Set<ExplorerItemRef>();
    const failed = new Map<ExplorerItemRef, string>();
    let remaining = EXPLORER_MAX_WRITES;
    for (const item of items) {
        try { origin.assertCurrent('write'); }
        catch { break; }
        try {
            remaining -= await removeOne(origin, projectId, item, remaining);
            completed.add(item);
        } catch (cause) {
            try { origin.assertCurrent('write'); }
            catch { break; }
            if ((cause instanceof DOMException && ['QuotaExceededError', 'AbortError'].includes(cause.name))
                || (cause && typeof cause === 'object' && 'code' in cause
                    && ['explorer-budget', 'explorer-queue-full'].includes(String(cause.code)))) break;
            failed.set(item, cause instanceof Error ? cause.message : 'Project removal failed.');
        }
    }
    return { completed, failed };
}
