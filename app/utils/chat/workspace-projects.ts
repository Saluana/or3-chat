import type { Project } from '~/db/schema';
import { prepareProjectWrite } from '~/db/projects';
import { getWriteTxTableNames, nextClock, nowSec } from '~/db/util';
import { captureWorkspaceOperation, type WorkspaceOperationScope } from './workspace-access';
import { readWorkspaceItem, workspaceRevision, type WorkspaceItemRef } from './workspace-items';
import type { ToolExecutionContext } from './types';
import { FILE_CATALOG_POST_TYPE, isVisibleWorkspaceItem } from '~~/shared/posts/workspace-item';
import { parseFileHashes } from '~/db/files-util';

import { preservedProjectEntries, projectEntryIdentity } from '~/utils/projects/normalizeProjectData';
export { preservedProjectEntries, projectEntryIdentity } from '~/utils/projects/normalizeProjectData';

export async function prepareWorkspaceProjectAssociation(scope: WorkspaceOperationScope,
    target: { id: string; revision: string }, item: WorkspaceItemRef & { title: string }, remove = false) {
    const base = await scope.db.projects.get(target.id);
    scope.assertCurrent('write');
    if (!base || base.deleted) throw new Error('That project is unavailable.');
    if (await workspaceRevision(base) !== target.revision) throw new Error('This project changed. Read it again before updating.');
    scope.assertCurrent('write');
    const key = `${item.kind}:${item.id}`;
    let entries = preservedProjectEntries(base.data);
    if (remove) entries = entries.filter((entry) => projectEntryIdentity(entry) !== key);
    else if (!entries.some((entry) => projectEntryIdentity(entry) === key)) {
        entries = [...entries, { kind: item.kind === 'document' ? 'doc' : item.kind, id: item.id, name: item.title }];
    }
    const prepared = await prepareProjectWrite({ ...base, data: entries, updated_at: nowSec() }, 'upsert');
    if (prepared.row.id !== base.id || prepared.row.deleted) throw new Error('A project hook changed the operation target.');
    scope.assertCurrent('write');
    return { base, prepared };
}

/** Canonical core associations and supported legacy pointers share one visible membership read. */
export async function readVisibleWorkspaceProjectEntries(scope: WorkspaceOperationScope, base: Project): Promise<WorkspaceItemRef[]> {
    scope.assertCurrent();
    const entries = await scope.db.transaction('r', ['projects', 'threads', 'posts', 'file_meta'], async () => {
        assertProjectUnchanged(await scope.db.projects.get(base.id), base);
        scope.assertCurrent();
        const identities = new Set(preservedProjectEntries(base.data).map(projectEntryIdentity).filter((key): key is string => key !== null));
        for (const chat of await scope.db.threads.where('project_id').equals(base.id).toArray()) {
            if (!chat.deleted) identities.add(`chat:${chat.id}`);
        }
        scope.assertCurrent();
        const visible: WorkspaceItemRef[] = [];
        for (const identity of identities) {
            const separator = identity.indexOf(':');
            const kind = identity.slice(0, separator) as WorkspaceItemRef['kind'];
            const id = identity.slice(separator + 1);
            const row = kind === 'chat' ? await scope.db.threads.get(id) : kind === 'document' || kind === 'file' ? await scope.db.posts.get(id) : undefined;
            scope.assertCurrent();
            if (kind === 'chat' && row && 'project_id' in row && row.project_id && row.project_id !== base.id) continue;
            if (row && isVisibleWorkspaceItem(row)
                && (kind === 'chat' || 'postType' in row && row.postType === (kind === 'file' ? FILE_CATALOG_POST_TYPE : 'doc'))) {
                if (kind === 'file') {
                    const hashes = parseFileHashes('file_hashes' in row ? row.file_hashes : undefined);
                    const meta = hashes.length === 1 ? await scope.db.file_meta.get(hashes[0]!) : undefined;
                    scope.assertCurrent();
                    if (!meta || meta.deleted) continue;
                }
                visible.push({ kind, id });
            }
        }
        return visible;
    });
    scope.assertCurrent();
    return entries;
}

/** Compare the observed row again inside the write transaction, without crypto awaits. */
export function assertProjectUnchanged(current: Project | undefined, base: Project): void {
    if (!current || current.deleted || JSON.stringify(current) !== JSON.stringify(base)) {
        throw new Error('This project changed. Read it again before updating.');
    }
}

export async function updateWorkspaceProject(args: Record<string, unknown>, context: ToolExecutionContext): Promise<string> {
    const scope = captureWorkspaceOperation(context);
    scope.assertCurrent('write');
    const operation = String(args.operation);
    let base: Project | undefined;
    let proposed: Project;
    let item: WorkspaceItemRef | undefined;
    if (operation === 'create') {
        if (typeof args.name !== 'string' || !args.name.trim()) throw new Error('Enter a project name.');
        const id = `workspace-project-${await workspaceRevision({ requestId: context.requestId, callId: context.callId })}`;
        scope.assertCurrent('write');
        const prior = await scope.db.projects.get(id);
        if (prior) {
            if (prior.deleted || prior.name !== args.name.trim() || (prior.description ?? '') !== (args.description ?? '')) {
                throw new Error('This execution already saved a different project.');
            }
            const loaded = await readWorkspaceItem(scope, { kind: 'project', id });
            return JSON.stringify({ version: 1, workspaceId: scope.workspaceId, source: loaded.source, status: 'saved', replay: true });
        }
        proposed = { id, name: args.name.trim(), description: typeof args.description === 'string' ? args.description : '',
            data: [], created_at: nowSec(), updated_at: nowSec(), deleted: false, clock: 0 };
    } else {
        if (typeof args.projectId !== 'string' || typeof args.revision !== 'string') throw new Error('Read the identified project first.');
        base = await scope.db.projects.get(args.projectId);
        if (!base || base.deleted) throw new Error('That project is unavailable.');
        if (await workspaceRevision(base) !== args.revision) throw new Error('This project changed. Read it again before updating.');
        scope.assertCurrent('write');
        proposed = { ...base, updated_at: nowSec() };
        if (operation === 'rename') {
            if (typeof args.name !== 'string' || !args.name.trim()) throw new Error('Enter a project name.');
            proposed.name = args.name.trim();
        } else if (operation === 'set_description') {
            if (typeof args.description !== 'string') throw new Error('Supply the requested project description.');
            proposed.description = args.description;
        } else if (operation === 'add_item' || operation === 'remove_item') {
            const candidate = args.item;
            if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)
                || !('kind' in candidate) || !('id' in candidate) || typeof candidate.kind !== 'string'
                || typeof candidate.id !== 'string' || !['chat', 'document', 'file'].includes(candidate.kind)) {
                throw new Error('Choose a chat, document or saved file.');
            }
            item = { kind: candidate.kind as 'chat' | 'document' | 'file', id: candidate.id };
            const loaded = await readWorkspaceItem(scope, item);
            const entries = preservedProjectEntries(base.data);
            const identity = `${item.kind}:${item.id}`;
            proposed.data = operation === 'remove_item' ? entries.filter((entry) => projectEntryIdentity(entry) !== identity)
                : entries.some((entry) => projectEntryIdentity(entry) === identity) ? entries
                : [...entries, { kind: item.kind === 'document' ? 'doc' : item.kind, id: item.id, name: loaded.source.title }];
        } else throw new Error('Unsupported project operation.');
    }
    const prepared = await prepareProjectWrite(proposed, base ? 'upsert' : 'create');
    if (prepared.row.id !== proposed.id || prepared.row.deleted) throw new Error('A project hook changed the operation target.');
    scope.assertCurrent('write');
    let saved = prepared.row;
    await scope.db.transaction('rw', getWriteTxTableNames(scope.db, 'projects', { include: ['posts', 'threads', 'file_meta'] }), async () => {
        scope.assertCurrent('write');
        await context.assertToolAuthorized?.();
        const current = await scope.db.projects.get(proposed.id);
        scope.assertCurrent('write');
        if (base) assertProjectUnchanged(current, base);
        else if (current) throw new Error('This project execution was already committed. Retry to read its receipt.');
        if (item) {
            const currentItem = item.kind === 'chat' ? await scope.db.threads.get(item.id) : await scope.db.posts.get(item.id);
            scope.assertCurrent('write');
            if (!currentItem || !isVisibleWorkspaceItem(currentItem)
                || item.kind !== 'chat' && (!('postType' in currentItem) || currentItem.postType !== (item.kind === 'file' ? FILE_CATALOG_POST_TYPE : 'doc'))) throw new Error('That item is unavailable.');
            if (item.kind === 'file') {
                const hashes = parseFileHashes('file_hashes' in currentItem ? currentItem.file_hashes : undefined);
                const meta = hashes.length === 1 ? await scope.db.file_meta.get(hashes[0]!) : undefined;
                scope.assertCurrent('write');
                if (!meta || meta.deleted) throw new Error('That file is unavailable.');
            }
            if (item.kind === 'chat' && operation === 'add_item') {
                const chat = await scope.db.threads.get(item.id);
                if (chat) {
                    for (const other of await scope.db.projects.toArray()) {
                        if (other.deleted || other.id === proposed.id) continue;
                        const entries = preservedProjectEntries(other.data);
                        const next = entries.filter(entry => projectEntryIdentity(entry) !== `chat:${item!.id}`);
                        if (next.length !== entries.length) await scope.db.projects.put({ ...other, data: next, updated_at: nowSec(), clock: nextClock(other.clock) });
                    }
                    await scope.db.threads.put({ ...chat, project_id: proposed.id, clock: nextClock(chat.clock), updated_at: nowSec() });
                }
            }
            // Remove the supported legacy pointer as well, so filtering doesn't resurrect the association.
            if (item.kind === 'chat' && operation === 'remove_item') {
                const chat = await scope.db.threads.get(item.id);
                scope.assertCurrent('write');
                if (chat?.project_id === proposed.id) await scope.db.threads.put({ ...chat, project_id: null, clock: nextClock(chat.clock), updated_at: nowSec() });
            }
        }
        scope.assertCurrent('write');
        saved = { ...prepared.row, clock: base ? nextClock(base.clock) : prepared.row.clock };
        await scope.db.projects.put(saved);
        scope.assertCurrent('write');
    });
    try { await prepared.afterCommit(saved); } catch (error) { console.warn('Project saved; after-write hook failed.', error); }
    const loaded = await readWorkspaceItem(scope, { kind: 'project', id: saved.id });
    return JSON.stringify({ version: 1, workspaceId: scope.workspaceId, source: loaded.source, status: 'saved', operation });
}
