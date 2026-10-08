import { del, type Project } from '~/db';
import { chatFamilyIds, chatOwnerIn, moveChatProjectRows, notifyChatProjectMove } from '~/db/project-workspace';
import { prepareProjectWrite } from '~/db/projects';
import { prepareDocumentCreate } from '~/db/documents';
import { createThreadInDb } from '~/db/threads';
import { captureProjectOperation } from '~/utils/projects/context';
import { nowSec, newId, nextClock, getWriteTxTableNames } from '~/db/util';
import {
    normalizeProjectData,
    mergeProjectEntries,
    type ProjectEntry,
    type ProjectEntryKind,
} from '~/utils/projects/normalizeProjectData';

export interface CreateProjectInput {
    name: string;
    description?: string | null;
    id?: string;
}

export interface DeleteProjectOptions {
    soft?: boolean;
}

export function useProjectsCrud() {
    async function createProject(input: CreateProjectInput): Promise<string> {
        const scope = captureProjectOperation();
        scope.assertCurrent('write');
        const name = input.name.trim();
        if (!name) throw new Error('Project name required');
        const now = nowSec();
        const id = input.id ?? newId();
        const payload: Project = {
            id,
            name,
            description: input.description?.trim() || null,
            data: [],
            created_at: now,
            updated_at: now,
            deleted: false,
            clock: 0,
        };
        const prepared = await prepareProjectWrite(payload, 'create');
        if (prepared.row.id !== id || prepared.row.deleted) throw new Error('A project hook changed the operation target.');
        await scope.db.transaction('rw', getWriteTxTableNames(scope.db, 'projects'), async () => {
            scope.assertCurrent('write');
            if (await scope.db.projects.get(id)) throw new Error('Project already exists.');
            await scope.db.projects.put(prepared.row);
        });
        try { await prepared.afterCommit(prepared.row); }
        catch (error) { console.warn('Project saved; after-create hook failed.', error); }
        return id;
    }

    async function renameProject(id: string, name: string): Promise<void> {
        const trimmed = name.trim();
        if (!trimmed) throw new Error('Project name required');
        const scope = captureProjectOperation();
        scope.assertCurrent('write');
        const db = scope.db;
        const existing = await db.projects.get(id);
        if (!existing || existing.deleted) throw new Error('Project not found');
        const prepared = await prepareProjectWrite({
            ...existing,
            name: trimmed,
            updated_at: nowSec(),
        }, 'upsert');
        if (prepared.row.id !== id || prepared.row.deleted) throw new Error('A project hook changed the operation target.');
        const saved = await db.transaction('rw', getWriteTxTableNames(db, 'projects'), async () => {
            scope.assertCurrent('write');
            const current = await db.projects.get(id);
            if (!current || current.deleted || current.name !== existing.name)
                throw new Error('Project name changed. Reload before renaming.');
            const next = { ...current, name: prepared.row.name, updated_at: nowSec(), clock: nextClock(current.clock) };
            await db.projects.put(next);
            return next;
        });
        try { await prepared.afterCommit(saved); }
        catch (error) { console.warn('Project renamed; after-update hook failed.', error); }
    }

    async function deleteProject(
        id: string,
        options: DeleteProjectOptions = {}
    ): Promise<void> {
        if (options.soft === false) {
            await del.hard.project(id);
        } else {
            await del.soft.project(id);
        }
    }

    async function createThreadEntry(
        projectId: string
    ): Promise<{ id: string; name: string } | null> {
        const scope = captureProjectOperation();
        scope.assertCurrent('write');
        const db = scope.db;
        const project = await db.projects.get(projectId);
        if (!project || project.deleted) return null;
        const title = 'New Thread';
        const thread = await createThreadInDb(db, {
            title,
            project_id: projectId,
        }, { assertCurrent: () => scope.assertCurrent('write') });
        return { id: thread.id, name: thread.title || title };
    }

    async function createDocumentEntry(
        projectId: string
    ): Promise<{ id: string; title: string } | null> {
        const scope = captureProjectOperation();
        scope.assertCurrent('write');
        const db = scope.db;
        const initial = await db.projects.get(projectId);
        if (!initial || initial.deleted) return null;
        const document = await prepareDocumentCreate({ title: 'Untitled' });
        scope.assertCurrent('write');
        const project = await db.projects.get(projectId);
        if (!project || project.deleted) throw new Error('Project unavailable.');
        const entries = normalizeProjectData(project.data);
        entries.push({
            id: document.row.id,
            name: document.row.title || 'Untitled',
            kind: 'doc',
        });
        const prepared = await prepareProjectWrite({
            ...project,
            data: mergeProjectEntries(project.data, entries),
            updated_at: nowSec(),
        }, 'upsert');
        if (prepared.row.id !== projectId || prepared.row.deleted) throw new Error('A project hook changed the operation target.');
        const saved = await db.transaction('rw', getWriteTxTableNames(db, ['projects', 'posts', 'file_meta']), async () => {
            scope.assertCurrent('write');
            const current = await db.projects.get(projectId);
            if (!current || current.deleted || current.clock !== project.clock)
                throw new Error('Project changed. Reload before adding a document.');
            const next = { ...prepared.row, clock: nextClock(current.clock) };
            await db.posts.put(document.row);
            await db.projects.put(next);
            return next;
        });
        try { await document.afterCommit(); await prepared.afterCommit(saved); }
        catch (error) { console.warn('Project document saved; after-create hook failed.', error); }
        return { id: document.row.id, title: document.row.title };
    }

    /** Resolves to how many related chats (branch family members) moved along with the edited ones. */
    async function updateProjectEntries(
        id: string,
        entries: ProjectEntry[]
    ): Promise<number> {
        const scope = captureProjectOperation();
        scope.assertCurrent('write');
        const db = scope.db;
        const existing = await db.projects.get(id);
        if (!existing || existing.deleted) throw new Error('Project not found');
        const normalized = entries.map((entry) => ({ ...entry }));
        const previous = normalizeProjectData(existing.data);
        const prepared = await prepareProjectWrite({ ...existing,
            data: mergeProjectEntries(existing.data, normalized), updated_at: nowSec() }, 'upsert');
        if (prepared.row.id !== id || prepared.row.deleted) throw new Error('A project hook changed the operation target.');
        const requested = normalizeProjectData(prepared.row.data);
        const changes: Awaited<ReturnType<typeof moveChatProjectRows>>[] = [];
        let related = 0;
        const saved = await db.transaction('rw', getWriteTxTableNames(db, ['projects', 'threads']), async () => {
            scope.assertCurrent('write');
            if ((await db.projects.get(id))?.clock !== existing.clock)
                throw new Error('Project changed. Reload before editing membership.');
            // Branch families move with the chat they belong to, so relatives keep a readable shared history.
            const ownership = await db.projects.toArray();
            const familyIn = new Set<string>();
            const detached = new Set<string>();
            for (const entry of requested.filter(entry => entry.kind === 'chat' &&
                !previous.some(prior => prior.kind === 'chat' && prior.id === entry.id))) {
                for (const relative of await chatFamilyIds(db, entry.id)) familyIn.add(relative);
                const change = await moveChatProjectRows(scope, entry.id, id, { family: true });
                changes.push(change);
                related += change.threads.filter(thread => thread.id !== entry.id).length;
            }
            for (const entry of previous.filter(entry => entry.kind === 'chat' && !requested.some(next => next.kind === 'chat' && next.id === entry.id))) {
                const chat = await db.threads.get(entry.id);
                if (!chat || chatOwnerIn(chat, ownership) !== id) continue;
                const change = await moveChatProjectRows(scope, entry.id, null, { family: true });
                changes.push(change);
                for (const thread of change.threads) detached.add(thread.id);
                related += change.threads.filter(thread => thread.id !== entry.id).length;
            }
            const current = await db.projects.get(id);
            if (!current || current.deleted) throw new Error('Project unavailable.');
            const relatives = normalizeProjectData(current.data).filter(entry => entry.kind === 'chat'
                && familyIn.has(entry.id) && !requested.some(next => next.kind === 'chat' && next.id === entry.id));
            const next = {
                ...current,
                data: mergeProjectEntries(current.data, [...requested.filter(entry =>
                    entry.kind !== 'chat' || !detached.has(entry.id)), ...relatives]),
                updated_at: nowSec(),
                clock: nextClock(current.clock),
            };
            await db.projects.put(next);
            scope.assertCurrent('write');
            return next;
        });
        for (const change of changes) await notifyChatProjectMove(change);
        try { await prepared.afterCommit(saved); }
        catch (error) { console.warn('Project membership saved; after-update hook failed.', error); }
        return related;
    }

    async function syncProjectEntryTitle(
        entryId: string,
        kind: ProjectEntryKind,
        title: string
    ): Promise<number> {
        const scope = captureProjectOperation();
        scope.assertCurrent('write');
        const db = scope.db;
        return db.transaction('rw', getWriteTxTableNames(db, 'projects'), async () => {
            scope.assertCurrent('write');
            const updates: Project[] = [];
            const now = nowSec();
            for (const project of await db.projects.toArray()) {
                if (project.deleted) continue;
                const entries = normalizeProjectData(project.data);
                const needsUpdate = (entry: ProjectEntry) => entry.id === entryId
                    && (entry.name !== title || entry.kind !== kind);
                if (!entries.some(needsUpdate)) continue;
                updates.push({
                    ...project,
                    data: mergeProjectEntries(project.data, entries.map(entry => needsUpdate(entry)
                        ? { ...entry, name: title, kind } : entry)),
                    updated_at: now,
                    clock: nextClock(project.clock),
                });
            }
            scope.assertCurrent('write');
            if (updates.length) await db.projects.bulkPut(updates);
            return updates.length;
        });
    }

    return {
        createProject,
        renameProject,
        deleteProject,
        createThreadEntry,
        createDocumentEntry,
        updateProjectEntries,
        syncProjectEntryTitle,
    };
}
