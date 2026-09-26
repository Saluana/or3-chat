/** A signed-in buyer asks a host administrator to install one exact acquired release. */
import { createError, defineEventHandler, setResponseHeader } from 'h3';
import { z } from 'zod';
import { requireCan, requireSession } from '../../../auth/can';
import { resolveSessionContext } from '../../../auth/session';
import { readLimitedJsonBody } from '../../../utils/security/limited-json-body';
import { requireCloudMutation } from '../../../utils/security/cloud-mutation';
import { checkRateLimit } from '../../../utils/rate-limit';
import { libraryLinkServiceFor } from '../../../admin/library/route-support';
import { LibraryInstallRequestStore } from '../../../admin/library/install-requests';

const Body = z.object({
    releaseId: z.string().regex(/^rel_[A-Za-z0-9._:-]{1,100}$/),
    pluginId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/),
    version: z.string().regex(/^[0-9A-Za-z.+-]{1,64}$/),
});

export default defineEventHandler(async (event) => {
    requireCloudMutation(event);
    const session = await resolveSessionContext(event);
    requireSession(session);
    const userId = session.user?.id;
    const workspaceId = session.workspace?.id;
    if (!userId || !workspaceId) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
    requireCan(session, 'workspace.read', { kind: 'workspace', id: workspaceId });
    setResponseHeader(event, 'Cache-Control', 'no-store');
    const body = Body.safeParse(await readLimitedJsonBody(event));
    if (!body.success) throw createError({ statusCode: 400, statusMessage: 'Invalid release request' });
    if (!(await checkRateLimit(`library-install-request:${userId}`, { max: 10, window: 3600 }))) {
        throw createError({ statusCode: 429, statusMessage: 'Too many install requests. Try again later.' });
    }

    const { service } = await libraryLinkServiceFor(event);
    const link = await service.status(userId);
    if (link.state !== 'linked' || !link.link?.id || !link.link.accountId) {
        throw createError({ statusCode: 409, statusMessage: 'Connect your marketplace account first.' });
    }
    const entitlements = await service.entitlements(userId);
    if (!entitlements.linked || entitlements.accountId !== link.link.accountId) {
        throw createError({ statusCode: 409, statusMessage: 'The linked marketplace account changed. Refresh Library and retry.' });
    }
    const release = entitlements.acquired?.find((item) => item.releaseId === body.data.releaseId &&
        item.pluginId === body.data.pluginId && item.version === body.data.version);
    if (!release) throw createError({ statusCode: 403, statusMessage: 'That release is not in your acquired Library.' });

    const store = new LibraryInstallRequestStore();
    const previous = (await store.list()).find((item) => item.buyerUserId === userId &&
        item.workspaceId === workspaceId && item.linkId === link.link!.id &&
        item.releaseId === release.releaseId && item.expiresAt > Date.now());
    const request = previous ?? await store.create({
        buyerUserId: userId,
        workspaceId,
        linkId: link.link.id,
        accountId: link.link.accountId,
        releaseId: release.releaseId,
        pluginId: release.pluginId,
        version: release.version,
        archiveSha256: release.archiveSha256,
    });
    return { ok: true, request: { id: request.id, pluginId: request.pluginId, version: request.version, workspaceId: request.workspaceId, expiresAt: request.expiresAt } };
});
