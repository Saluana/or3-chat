import { db } from './client';
import { dbTry } from './dbTry';
import { useHooks } from '../composables/useHooks';
import { parseOrThrow } from './util';
import { ProjectSchema, type Project } from './schema';

export async function createProject(input: Project): Promise<Project> {
    const hooks = useHooks();
    const filtered = await hooks.applyFilters(
        'db.projects.create:filter:input',
        input
    );
    await hooks.doAction('db.projects.create:action:before', filtered);
    const value = parseOrThrow(ProjectSchema, filtered);
    await dbTry(
        () => db.projects.put(value),
        { op: 'write', entity: 'projects', action: 'create' },
        { rethrow: true }
    );
    await hooks.doAction('db.projects.create:action:after', value);
    return value;
}

export async function upsertProject(value: Project): Promise<void> {
    const hooks = useHooks();
    const filtered = await hooks.applyFilters(
        'db.projects.upsert:filter:input',
        value
    );
    await hooks.doAction('db.projects.upsert:action:before', filtered);
    parseOrThrow(ProjectSchema, filtered);
    await dbTry(
        () => db.projects.put(filtered),
        { op: 'write', entity: 'projects', action: 'upsert' },
        { rethrow: true }
    );
    await hooks.doAction('db.projects.upsert:action:after', filtered);
}

export async function softDeleteProject(id: string): Promise<void> {
    const hooks = useHooks();
    await db.transaction('rw', db.projects, async () => {
        const p = await dbTry(() => db.projects.get(id), {
            op: 'read',
            entity: 'projects',
            action: 'get',
        });
        if (!p) return;
        await hooks.doAction('db.projects.delete:action:soft:before', p);
        await db.projects.put({
            ...p,
            deleted: true,
            updated_at: Math.floor(Date.now() / 1000),
        });
        await hooks.doAction('db.projects.delete:action:soft:after', p);
    });
}

export async function hardDeleteProject(id: string): Promise<void> {
    const hooks = useHooks();
    const existing = await dbTry(() => db.projects.get(id), {
        op: 'read',
        entity: 'projects',
        action: 'get',
    });
    await hooks.doAction(
        'db.projects.delete:action:hard:before',
        existing ?? id
    );
    await db.projects.delete(id);
    await hooks.doAction('db.projects.delete:action:hard:after', id);
}

export async function getProject(id: string) {
    const hooks = useHooks();
    const res = await dbTry(() => db.projects.get(id), {
        op: 'read',
        entity: 'projects',
        action: 'get',
    });
    return hooks.applyFilters('db.projects.get:filter:output', res);
}
