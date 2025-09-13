import { db } from './client';
import { dbTry } from './dbTry';
import { useHooks } from '../composables/useHooks';
import { parseOrThrow } from './util';
import {
    AttachmentCreateSchema,
    AttachmentSchema,
    type Attachment,
    type AttachmentCreate,
} from './schema';

export async function createAttachment(
    input: AttachmentCreate
): Promise<Attachment> {
    const hooks = useHooks();
    const filtered = await hooks.applyFilters(
        'db.attachments.create:filter:input',
        input
    );
    await hooks.doAction('db.attachments.create:action:before', filtered);
    const value = parseOrThrow(AttachmentCreateSchema, filtered);
    await dbTry(
        () => db.attachments.put(value),
        { op: 'write', entity: 'attachments', action: 'create' },
        { rethrow: true }
    );
    await hooks.doAction('db.attachments.create:action:after', value);
    return value;
}

export async function upsertAttachment(value: Attachment): Promise<void> {
    const hooks = useHooks();
    const filtered = await hooks.applyFilters(
        'db.attachments.upsert:filter:input',
        value
    );
    await hooks.doAction('db.attachments.upsert:action:before', filtered);
    parseOrThrow(AttachmentSchema, filtered);
    await dbTry(
        () => db.attachments.put(filtered),
        { op: 'write', entity: 'attachments', action: 'upsert' },
        { rethrow: true }
    );
    await hooks.doAction('db.attachments.upsert:action:after', filtered);
}

export async function softDeleteAttachment(id: string): Promise<void> {
    const hooks = useHooks();
    await db.transaction('rw', db.attachments, async () => {
        const a = await dbTry(() => db.attachments.get(id), {
            op: 'read',
            entity: 'attachments',
            action: 'get',
        });
        if (!a) return;
        await hooks.doAction('db.attachments.delete:action:soft:before', a);
        await db.attachments.put({
            ...a,
            deleted: true,
            updated_at: Math.floor(Date.now() / 1000),
        });
        await hooks.doAction('db.attachments.delete:action:soft:after', a);
    });
}

export async function hardDeleteAttachment(id: string): Promise<void> {
    const hooks = useHooks();
    const existing = await dbTry(() => db.attachments.get(id), {
        op: 'read',
        entity: 'attachments',
        action: 'get',
    });
    await hooks.doAction(
        'db.attachments.delete:action:hard:before',
        existing ?? id
    );
    await db.attachments.delete(id);
    await hooks.doAction('db.attachments.delete:action:hard:after', id);
}

export async function getAttachment(id: string) {
    const hooks = useHooks();
    const res = await dbTry(() => db.attachments.get(id), {
        op: 'read',
        entity: 'attachments',
        action: 'get',
    });
    return hooks.applyFilters('db.attachments.get:filter:output', res);
}
