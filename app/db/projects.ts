import { db } from './client';
import { parseOrThrow } from './util';
import { ProjectSchema, type Project } from './schema';

export async function createProject(input: Project): Promise<Project> {
    const value = parseOrThrow(ProjectSchema, input);
    await db.projects.put(value);
    return value;
}

export async function upsertProject(value: Project): Promise<void> {
    parseOrThrow(ProjectSchema, value);
    await db.projects.put(value);
}

export async function softDeleteProject(id: string): Promise<void> {
    await db.transaction('rw', db.projects, async () => {
        const p = await db.projects.get(id);
        if (!p) return;
        await db.projects.put({
            ...p,
            deleted: true,
            updated_at: Math.floor(Date.now() / 1000),
        });
    });
}

export async function hardDeleteProject(id: string): Promise<void> {
    await db.projects.delete(id);
}

export function getProject(id: string) {
    return db.projects.get(id);
}
