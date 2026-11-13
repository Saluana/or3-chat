import { createError, type H3Event } from 'h3';
import { createHash } from 'node:crypto';
import type { SessionContext } from '~/core/hooks/hook-types';
import { getActiveSyncGatewayAdapter } from '../../sync/gateway/registry';
import { getActiveStorageGatewayAdapter } from '../../storage/gateway/registry';
import { requireStorageWorkspaceAccess } from '../storage/workspace-access';
import { MODEL_REQUEST_BODY_LIMIT_BYTES } from '../security/limited-json-body';
import type { CanonicalStorageMetadataRecord, SyncGatewayAdapter } from '../../sync/gateway/types';

export const MAX_CHAT_ATTACHMENT_REFERENCE_BYTES = 16 * 1024 * 1024;
const MAX_REFERENCES = 32;
const marker = (index: number) => `or3-cloud-attachment:${index}`;

export function cloudAttachmentsAvailable(): boolean {
    return Boolean(getActiveSyncGatewayAdapter()?.queryCanonicalStorage && getActiveStorageGatewayAdapter()?.readChatAttachment);
}

export async function findCloudAttachmentMetadata(event: H3Event, sync: SyncGatewayAdapter, workspaceId: string,
    hash: string, storageId: string, mime: string): Promise<CanonicalStorageMetadataRecord | undefined> {
    const page = await sync.queryCanonicalStorage!(event, { scope: { workspaceId }, kind: 'live_metadata', hash, limit: 2 });
    if (page.hasMore || page.items.length !== 1) return;
    const record = page.items[0];
    if (record?.kind !== 'metadata' || record.hash.replace(/^sha256:/, '') !== hash.slice(7) ||
        record.storageId !== storageId || (record as { deleted?: unknown }).deleted === true ||
        !Number.isSafeInteger(record.sizeBytes) || record.sizeBytes <= 0 || record.sizeBytes > MAX_CHAT_ATTACHMENT_REFERENCE_BYTES ||
        record.mimeType?.toLowerCase().split(';', 1)[0]?.trim() !== mime ||
        record.fileKind !== (mime.startsWith('image/') ? 'image' : 'pdf')) return;
    return record;
}

/** Resolve only explicitly negotiated references before admission or dispatch. */
export async function resolveCloudAttachments(event: H3Event, session: SessionContext | null, body: Record<string, unknown>): Promise<void> {
    if (!Object.hasOwn(body, '_cloudAttachments')) return;
    const refs = body._cloudAttachments;
    if (!session?.authenticated || !session.user?.id || !session.workspace?.id) throw createError({ statusCode: 401, statusMessage: 'Authentication required' });
    const workspaceId = session.workspace.id;
    const sync = getActiveSyncGatewayAdapter();
    const storage = getActiveStorageGatewayAdapter();
    if (!sync?.queryCanonicalStorage || !storage?.readChatAttachment) throw createError({ statusCode: 503, statusMessage: 'Cloud attachment references unavailable' });
    if (!Array.isArray(refs) || refs.length === 0 || refs.length > MAX_REFERENCES || !Array.isArray(body.messages))
        throw createError({ statusCode: 400, statusMessage: 'Invalid Cloud attachment references' });
    const messages = body.messages as Array<{ content?: unknown }>;
    // Reference metadata is removed before dispatch and is not part of the expanded request.
    const { _cloudAttachments: _references, ...expandedBody } = body;
    let outputBytes = Buffer.byteLength(JSON.stringify(expandedBody));
    const seen = new Set<string>();
    for (let index = 0; index < refs.length; index++) {
        const ref = refs[index] as Record<string, unknown> | null;
        if (!ref || typeof ref !== 'object' || !Number.isSafeInteger(ref.messageIndex) || !Number.isSafeInteger(ref.partIndex) ||
            typeof ref.hash !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(ref.hash) ||
            typeof ref.storageId !== 'string' || ref.storageId.length > 1024 ||
            typeof ref.prefix !== 'string' || !/^data:(image\/(?:png|jpeg|webp|gif)|application\/pdf);base64,$/.test(ref.prefix))
            throw createError({ statusCode: 400, statusMessage: 'Invalid Cloud attachment reference' });
        const key = `${ref.messageIndex}:${ref.partIndex}`;
        if (seen.has(key)) throw createError({ statusCode: 400, statusMessage: 'Duplicate Cloud attachment reference' });
        seen.add(key);
        const content = messages[ref.messageIndex as number]?.content;
        const part = (Array.isArray(content) ? content[ref.partIndex as number] : undefined) as
            | { type?: string; image_url?: Record<string, unknown>; file?: Record<string, unknown> }
            | undefined;
        const mime = ref.prefix.slice(5, ref.prefix.indexOf(';'));
        const target = part?.type === 'image_url' && mime.startsWith('image/') ? part.image_url
            : part?.type === 'file' && mime === 'application/pdf' ? part.file : undefined;
        const field = part?.type === 'image_url' ? 'url' : 'file_data';
        if (!target || typeof target !== 'object' || target[field] !== marker(index))
            throw createError({ statusCode: 400, statusMessage: 'Invalid Cloud attachment position' });
        await requireStorageWorkspaceAccess(event, session, workspaceId);
        const record = await findCloudAttachmentMetadata(event, sync, workspaceId, ref.hash, ref.storageId, mime);
        if (!record)
            throw createError({ statusCode: 404, statusMessage: 'Cloud attachment unavailable' });
        outputBytes += ref.prefix.length + 4 * Math.ceil(record.sizeBytes / 3) - marker(index).length;
        if (outputBytes > MODEL_REQUEST_BODY_LIMIT_BYTES) throw createError({ statusCode: 413, statusMessage: 'Chat request too large' });
        const response = await storage.readChatAttachment(event, { workspaceId, hash: ref.hash, storageId: ref.storageId });
        if (!response.ok || !response.body) throw createError({ statusCode: 404, statusMessage: 'Cloud attachment unavailable' });
        const reader = response.body.getReader();
        const chunks: Buffer[] = [];
        let length = 0;
        const digest = createHash('sha256');
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                length += value.byteLength;
                if (length > record.sizeBytes) { await reader.cancel(); throw createError({ statusCode: 409, statusMessage: 'Cloud attachment size mismatch' }); }
                digest.update(value);
                chunks.push(Buffer.from(value));
            }
        } finally { reader.releaseLock(); }
        if (length !== record.sizeBytes || digest.digest('hex') !== ref.hash.slice(7))
            throw createError({ statusCode: 409, statusMessage: 'Cloud attachment integrity mismatch' });
        await requireStorageWorkspaceAccess(event, session, workspaceId);
        const current = await findCloudAttachmentMetadata(event, sync, workspaceId, ref.hash, ref.storageId, mime);
        if (!current || current.sizeBytes !== length)
            throw createError({ statusCode: 404, statusMessage: 'Cloud attachment unavailable' });
        target[field] = `${ref.prefix}${Buffer.concat(chunks, length).toString('base64')}`;
    }
    delete body._cloudAttachments;
}
