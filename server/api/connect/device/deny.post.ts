import { createError, defineEventHandler, getRequestIP, readBody } from 'h3';
import { requireWorkspaceSession } from '../../workspaces/_helpers';
import { getConnectServerConfig } from '../../../connect/config';
import { ConnectStore } from '../../../connect/convex-store';
import { hashConnectSecret } from '../../../connect/crypto';
import {
    noStore,
    normalizeUserCode,
} from '../../../connect/helpers';
import { getRateLimitProvider } from '../../../utils/rate-limit/store';

export default defineEventHandler(async (event) => {
    noStore(event);
    getConnectServerConfig(event);
    const session = await requireWorkspaceSession(event);
    const denialLimit = await getRateLimitProvider().checkAndRecord(
        `connect:deny:${session.user?.id ?? 'anonymous'}:${getRequestIP(event) || 'unknown'}`,
        { windowMs: 60_000, maxRequests: 10 }
    );
    if (!denialLimit.allowed) {
        throw createError({
            statusCode: 429,
            statusMessage: 'Too many connection attempts. Try again shortly.',
        });
    }
    const body = (await readBody(event)) as { code?: unknown };
    const code = normalizeUserCode(body?.code);
    const store = new ConnectStore();
    const authorization = await store.getAuthorizationByUserHash(
        hashConnectSecret(code),
        Date.now()
    );
    if (!authorization) {
        throw createError({
            statusCode: 404,
            statusMessage: 'This connection request is no longer available.',
        });
    }
    await store.denyAuthorization(authorization._id, Date.now());
    return { denied: true };
});
