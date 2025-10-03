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
            let changed = false;
            const nextEntries = entries.map((entry) => {
                if (entry.id === entryId) {
                    if (entry.name !== title) {
                        changed = true;
                        return {
                            ...entry,
                            name: title,
                            kind: entry.kind ?? kind,
                        };
                    }
                    if (!entry.kind) {
                        changed = true;
                        return { ...entry, kind };
                    }
                }
                return entry;
            });
            if (changed) {
                updates.push({
                    ...project,
                    data: nextEntries,
                    updated_at: now,
                });
            }
        }
        if (updates.length) {
            await db.projects.bulkPut(updates);
        }
        return updates.length;
    }

    return {
        createProject,
        renameProject,
        deleteProject,
        updateProjectEntries,
        syncProjectEntryTitle,
    };
}
