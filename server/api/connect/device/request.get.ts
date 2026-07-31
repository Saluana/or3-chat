import { createError, defineEventHandler, getQuery, getRequestIP } from 'h3';
import { requireWorkspaceSession } from '../../workspaces/_helpers';
import { getConnectServerConfig } from '../../../connect/config';
import { requireConnectStore } from '../../../connect/store/require';
import { createConnectUserCodeLookup } from '../../../connect/crypto';
import {
    noStore,
    normalizeUserCode,
} from '../../../connect/helpers';
import { getRateLimitProvider } from '../../../utils/rate-limit/store';

export default defineEventHandler(async (event) => {
    noStore(event);
    const config = getConnectServerConfig(event);
    const session = await requireWorkspaceSession(event);
    const lookupLimit = await getRateLimitProvider().checkAndRecord(
        `connect:lookup:${session.user?.id ?? 'anonymous'}:${getRequestIP(event) || 'unknown'}`,
        { windowMs: 60_000, maxRequests: 10 }
    );
    if (!lookupLimit.allowed) {
        throw createError({
            statusCode: 429,
            statusMessage: 'Too many connection attempts. Try again shortly.',
        });
    }
    const code = normalizeUserCode(getQuery(event).code);
    if (!code) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Enter the code shown on your computer.',
        });
    }
    const authorization = await requireConnectStore().getAuthorizationByUserHash(
        createConnectUserCodeLookup(code, config.encryptionKey),
        Date.now()
    );
    if (!authorization || authorization.status !== 'pending') {
        throw createError({
            statusCode: 404,
            statusMessage: 'This connection request expired or was already used.',
        });
    }
    return {
        code,
        computer: {
            name: authorization.host.name,
            platform: authorization.host.platform,
            architecture: authorization.host.architecture,
        },
        expiresAt: authorization.expires_at,
    };
});
