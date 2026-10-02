import type { Project } from '~/db/schema';
import { prepareProjectWrite } from '~/db/projects';
import { getWriteTxTableNames, nextClock, nowSec } from '~/db/util';
import { captureWorkspaceOperation, type WorkspaceOperationScope } from './workspace-access';
import { readWorkspaceItem, workspaceRevision, type WorkspaceItemRef } from './workspace-items';
import type { ToolExecutionContext } from './types';

/** Keep unrecognized extension entries verbatim when editing known memberships. */
export function preservedProjectEntries(data: unknown): unknown[] {
    if (data === null || data === undefined) return [];
    const entries: unknown = typeof data === 'string' ? JSON.parse(data) : data;
    if (!Array.isArray(entries)) throw new Error('This project has an unsupported membership format.');
    return entries as unknown[];
}

export function projectEntryIdentity(value: unknown): string | null {
    if (typeof value === 'string') return `chat:${value}`;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const entry = value as Record<string, unknown>;
    if (typeof entry.id !== 'string') return null;
    const kind = entry.kind === 'doc' || entry.kind === 'document' ? 'document'
        : entry.kind === 'chat' || entry.kind === undefined ? 'chat' : entry.kind === 'file' ? 'file' : null;
    return kind ? `${kind}:${entry.id}` : null;
}

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
        const id = `workspace-project-${await workspaceRevision({ requestId: context.requestId, callId: context.callId })}`;
        scope.assertCurrent('write');
        const prior = await scope.db.projects.get(id);
        if (prior) {
            if (prior.deleted || prior.name !== args.name || (prior.description ?? '') !== (args.description ?? '')) {
                throw new Error('This execution already saved a different project.');
            }
            const loaded = await readWorkspaceItem(scope, { kind: 'project', id });
            return JSON.stringify({ version: 1, workspaceId: scope.workspaceId, source: loaded.source, status: 'saved', replay: true });
        }
        proposed = { id, name: String(args.name), description: typeof args.description === 'string' ? args.description : '',
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
            item = args.item as WorkspaceItemRef;
            if (!item || item.kind === 'project') throw new Error('Choose a chat, document or saved file.');
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
    await scope.db.transaction('rw', getWriteTxTableNames(scope.db, 'projects', { include: ['posts', 'threads'] }), async () => {
        scope.assertCurrent('write');
        const current = await scope.db.projects.get(proposed.id);
        if (base) assertProjectUnchanged(current, base);
        else if (current) throw new Error('This project execution was already committed. Retry to read its receipt.');
        if (item) {
            const currentItem = item.kind === 'chat' ? await scope.db.threads.get(item.id) : await scope.db.posts.get(item.id);
            if (!currentItem || currentItem.deleted) throw new Error('That item is unavailable.');
            // Remove the supported legacy pointer as well, so filtering doesn't resurrect the association.
            if (item.kind === 'chat' && operation === 'remove_item') {
                const chat = await scope.db.threads.get(item.id);
                if (chat?.project_id === proposed.id) await scope.db.threads.put({ ...chat, project_id: null, clock: nextClock(chat.clock), updated_at: nowSec() });
            }
        }
        saved = { ...prepared.row, clock: base ? nextClock(base.clock) : prepared.row.clock };
        await scope.db.projects.put(saved);
    });
    try { await prepared.afterCommit(saved); } catch (error) { console.warn('Project saved; after-write hook failed.', error); }
    const loaded = await readWorkspaceItem(scope, { kind: 'project', id: saved.id });
    return JSON.stringify({ version: 1, workspaceId: scope.workspaceId, source: loaded.source, status: 'saved', operation });
}
