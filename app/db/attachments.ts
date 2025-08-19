import { db } from './client';
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
    const value = parseOrThrow<Attachment>(AttachmentCreateSchema, input);
    await db.attachments.put(value);
    return value;
}

export async function upsertAttachment(value: Attachment): Promise<void> {
    parseOrThrow<Attachment>(AttachmentSchema, value);
    await db.attachments.put(value);
}

export async function softDeleteAttachment(id: string): Promise<void> {
    await db.transaction('rw', db.attachments, async () => {
        const a = await db.attachments.get(id);
        if (!a) return;
        await db.attachments.put({
            ...a,
            deleted: true,
            updated_at: Math.floor(Date.now() / 1000),
        });
    });
}

export async function hardDeleteAttachment(id: string): Promise<void> {
    await db.attachments.delete(id);
}
