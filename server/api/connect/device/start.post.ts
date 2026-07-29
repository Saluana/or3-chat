import {
    createError,
    defineEventHandler,
    getRequestIP,
    readBody,
    setResponseStatus,
} from 'h3';
import { getConnectServerConfig } from '../../../connect/config';
import { ConnectStore } from '../../../connect/convex-store';
import {
    hashConnectSecret,
    randomURLSecret,
} from '../../../connect/crypto';
import {
    createUserCode,
    noStore,
    parseConnectHost,
    storeConnectHost,
} from '../../../connect/helpers';
import { getRateLimitProvider } from '../../../utils/rate-limit/store';

const AUTHORIZATION_TTL_MS = 10 * 60 * 1000;

export default defineEventHandler(async (event) => {
    noStore(event);
    const config = getConnectServerConfig(event);
    const ip = getRequestIP(event) || 'unknown';
    const rateLimit = await getRateLimitProvider().checkAndRecord(
        `connect:start:${ip}`,
        { windowMs: 60_000, maxRequests: 10 }
    );
    if (!rateLimit.allowed) {
        throw createError({
            statusCode: 429,
            statusMessage: 'Too many connection attempts. Try again shortly.',
        });
    }
    const body = (await readBody(event)) as { host?: unknown };
    const host = parseConnectHost(body?.host);
    const deviceCode = randomURLSecret(32);
    const userCode = createUserCode();
    const now = Date.now();
    const store = new ConnectStore();
    await store.createAuthorization({
        deviceCodeHash: hashConnectSecret(deviceCode),
        userCodeHash: hashConnectSecret(userCode),
        userCodeDisplay: userCode,
        host: storeConnectHost(host),
        expiresAt: now + AUTHORIZATION_TTL_MS,
        now,
    });
    const verificationUri = `${config.publicURL.replace(/\/$/, '')}/connect`;
    setResponseStatus(event, 201);
    return {
        deviceCode,
        userCode,
        verificationUri,
        verificationUriComplete: `${verificationUri}?code=${encodeURIComponent(userCode)}`,
        expiresIn: AUTHORIZATION_TTL_MS / 1000,
        interval: 3,
    };
});
