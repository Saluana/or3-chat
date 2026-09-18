/**
 * @module server/api/plugins/library/link.post
 *
 * Start (or restart) pairing this server with the signed-in user's marketplace
 * account. The local server keeps the polling secret; the response carries the
 * comparison code and the canonical verification URL for the browser.
 */
import {
    createError,
    defineEventHandler,
    setResponseHeader,
    setResponseStatus,
} from 'h3';
import { requireCan, requireSession } from '../../../auth/can';
import { resolveSessionContext } from '../../../auth/session';
import { libraryLinkServiceFor } from '../../../admin/library/route-support';
import { checkRateLimit } from '../../../utils/rate-limit';
import {
    getProxyRequestHost,
    getProxyRequestProtocol,
    normalizeProxyTrustConfig,
} from '../../../utils/net/request-identity';
import { useRuntimeConfig } from '#imports';

export default defineEventHandler(async (event) => {
    const session = await resolveSessionContext(event);
    requireSession(session);
    const userId = session.user?.id;
    const workspaceId = session.workspace?.id;
    if (!userId || !workspaceId) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
    }
    requireCan(session, 'workspace.read', { kind: 'workspace', id: workspaceId });
    setResponseHeader(event, 'Cache-Control', 'no-store');

    const allowed = await checkRateLimit(`library-link:start:${userId}`, {
        window: 600,
        max: 6,
    });
    if (!allowed) {
        setResponseStatus(event, 429);
        throw createError({
            statusCode: 429,
            statusMessage: 'Too many pairing attempts. Wait a few minutes.',
        });
    }

    // The label and origin are this server's own identity as the browser sees
    // it. Central treats both as untrusted context, never as attestation.
    const proxyConfig = normalizeProxyTrustConfig(useRuntimeConfig(event).security.proxy);
    const host = getProxyRequestHost(event, proxyConfig);
    const protocol = getProxyRequestProtocol(event, proxyConfig);
    if (!host || !protocol) {
        throw createError({
            statusCode: 503,
            statusMessage: 'This server cannot determine its own public address.',
        });
    }

    const { service } = libraryLinkServiceFor(event);
    const result = await service.start(userId, {
        label: host,
        origin: `${protocol}://${host}`,
    });
    if (!result.ok) {
        setResponseStatus(event, result.failure.retryable ? 503 : 422);
        return { error: result.failure };
    }
    return result.value;
});
