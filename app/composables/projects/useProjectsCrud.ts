import { create, db, del, upsert, type Project } from '~/db';
import { nowSec, newId } from '~/db/util';
import {
    normalizeProjectData,
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
        await create.project(payload);
        return id;
    }

    async function renameProject(id: string, name: string): Promise<void> {
        const trimmed = name.trim();
        if (!trimmed) throw new Error('Project name required');
        const existing = await db.projects.get(id);
        if (!existing) throw new Error('Project not found');
        await upsert.project({
            ...existing,
            name: trimmed,
            updated_at: nowSec(),
        });
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
        const project = await db.projects.get(projectId);
        if (!project) return null;
        const now = nowSec();
        const threadId = newId();
        const title = 'New Thread';
        await create.thread({
            id: threadId,
            title,
            forked: false,
            created_at: now,
            updated_at: now,
            deleted: false,
            clock: 0,
        });
        const entries = normalizeProjectData(project.data);
        entries.push({ id: threadId, name: title, kind: 'chat' });
        await upsert.project({
            ...project,
            data: entries,
            updated_at: now,
        });
        return { id: threadId, name: title };
    }

    async function createDocumentEntry(
        projectId: string
    ): Promise<{ id: string; title: string } | null> {
        const project = await db.projects.get(projectId);
        if (!project) return null;
        const doc = await create.document({ title: 'Untitled' });
        const entries = normalizeProjectData(project.data);
        entries.push({
            id: doc.id,
            name: doc.title || 'Untitled',
            kind: 'doc',
        });
        await upsert.project({
            ...project,
            data: entries,
            updated_at: nowSec(),
        });
        return { id: doc.id, title: doc.title };
    }

    async function updateProjectEntries(
        id: string,
        entries: ProjectEntry[]
    ): Promise<void> {
        const existing = await db.projects.get(id);
        if (!existing) throw new Error('Project not found');
        const normalized = entries.map((entry) => ({ ...entry }));
        await upsert.project({
            ...existing,
            data: normalized,
            updated_at: nowSec(),
        });
    }

    async function syncProjectEntryTitle(
        entryId: string,
        kind: ProjectEntryKind,
        title: string
    ): Promise<number> {
        const projects = await db.projects.toArray();
        if (!projects.length) return 0;
        const updates: Project[] = [];
        const now = nowSec();
        for (const project of projects) {
            const entries = normalizeProjectData(project.data);
            const hasChange = entries.some(
                (entry) => entry.id === entryId && entry.name !== title
            );
            if (hasChange) {
                const nextEntries = entries.map((entry) => {
                    if (entry.id === entryId && entry.name !== title) {
                        return {
                            ...entry,
                            name: title,
                            kind: entry.kind,
                        };
                    }
                    return entry;
                });
                updates.push({
                    ...project,
                    data: nextEntries,
                    updated_at: now,
                });
            }
        }
        if (updates.length) {
            const tableNames = Array.isArray(
                (db as { tables?: Array<{ name: string }> }).tables
            )
                ? (db as { tables: Array<{ name: string }> }).tables.map(
                      (table) => table.name
                  )
                : [];
            const txTables = ['projects'];
            if (tableNames.includes('pending_ops')) {
                txTables.push('pending_ops');
            }
            await db.transaction('rw', txTables, async () => {
                await db.projects.bulkPut(updates);
            });
        }
        return updates.length;
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
