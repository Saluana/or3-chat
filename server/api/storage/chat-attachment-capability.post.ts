import { createError, defineEventHandler } from 'h3';
import { z } from 'zod';
import { resolveSessionContext } from '../../auth/session';
import { requireCloudMutation } from '../../utils/security/cloud-mutation';
import { readLimitedJsonBody, STORAGE_CONTROL_BODY_LIMIT_BYTES } from '../../utils/security/limited-json-body';
import { isSsrAuthEnabled } from '../../utils/auth/is-ssr-auth-enabled';
import { isStorageEnabled } from '../../utils/storage/is-storage-enabled';
import { requireStorageWorkspaceAccess } from '../../utils/storage/workspace-access';
import { cloudAttachmentsAvailable, findCloudAttachmentMetadata } from '../../utils/chat/cloud-attachments';
import { getActiveSyncGatewayAdapter } from '../../sync/gateway/registry';
import { getActiveStorageGatewayAdapter } from '../../storage/gateway/registry';
import { setNoCacheHeaders } from '../../utils/headers';
import { enforceRateLimit } from '../../utils/rate-limit/enforce';
import { checkSyncRateLimit, recordSyncRequest } from '../../utils/sync/rate-limiter';

const schema = z.object({ files: z.array(z.object({ hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    storageId: z.string().min(1).max(1024), mime: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf']),
    size: z.number().int().positive().max(16 * 1024 * 1024) })).max(32) });

export default defineEventHandler(async event => {
    setNoCacheHeaders(event);
    if (!isSsrAuthEnabled(event) || !isStorageEnabled(event)) throw createError({ statusCode: 404 });
    requireCloudMutation(event);
    const parsed = schema.safeParse(await readLimitedJsonBody(event, STORAGE_CONTROL_BODY_LIMIT_BYTES));
    if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid Cloud attachment preflight' });
    const session = await resolveSessionContext(event);
    if (!session.authenticated || !session.user?.id || !session.workspace?.id) throw createError({ statusCode: 401 });
    const workspaceId = session.workspace.id;
    await requireStorageWorkspaceAccess(event, session, workspaceId);
    enforceRateLimit(event, checkSyncRateLimit(session.user.id, 'storage:download'));
    recordSyncRequest(session.user.id, 'storage:download');
    const sync = getActiveSyncGatewayAdapter();
    const storage = getActiveStorageGatewayAdapter();
    if (!cloudAttachmentsAvailable() || !sync?.queryCanonicalStorage || !storage) return { version: 0, workspaceId, eligible: [] };
    const eligible: number[] = [];
    for (const [index, file] of parsed.data.files.entries()) {
        const metadata = await findCloudAttachmentMetadata(event, sync, workspaceId, file.hash, file.storageId, file.mime);
        if (!metadata || metadata.sizeBytes !== file.size) continue;
        try {
            const grant = await storage.presignDownload(event, { workspaceId, hash: file.hash, storageId: file.storageId, mimeType: file.mime });
            if (grant.storageId === file.storageId) eligible.push(index);
        } catch { /* Pending or unavailable files remain inline. */ }
    }
    await requireStorageWorkspaceAccess(event, session, workspaceId);
    return { version: 1, workspaceId, eligible };
});
