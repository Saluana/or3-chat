import {
    createError,
    defineEventHandler,
    getRequestIP,
    setResponseStatus,
} from 'h3';
import { getConnectServerConfig } from '../../../connect/config';
import { requireConnectRelay } from '../../../connect/relay/require';
import { requireConnectStore } from '../../../connect/store/require';
import { ConnectStoreError } from '../../../connect/store/types';
import {
    createConnectUserCodeLookup,
    hashConnectSecret,
    randomURLSecret,
} from '../../../connect/crypto';
import {
    createUserCode,
    noStore,
    parseConnectHost,
    storeConnectHost,
} from '../../../connect/helpers';
import { readLimitedJsonBody } from '../../../utils/security/limited-json-body';
import { getConnectRateLimitProvider } from '../../../connect/rate-limit';

const AUTHORIZATION_TTL_MS = 10 * 60 * 1000;
const USER_CODE_ATTEMPTS = 5;

export default defineEventHandler(async (event) => {
    noStore(event);
    const config = getConnectServerConfig(event);
    requireConnectRelay();
    const ip = getRequestIP(event) || 'unknown';
    const rateLimit = await getConnectRateLimitProvider(config).checkAndRecord(
        `connect:start:${ip}`,
        { windowMs: 60_000, maxRequests: 10 }
    );
    if (!rateLimit.allowed) {
        throw createError({
            statusCode: 429,
            statusMessage: 'Too many connection attempts. Try again shortly.',
        });
    }
    const body = await readLimitedJsonBody<{ host?: unknown }>(event);
    const host = parseConnectHost(body?.host);
    const deviceCode = randomURLSecret(32);
    const now = Date.now();
    const store = requireConnectStore();
    let userCode = '';
    for (let attempt = 0; attempt < USER_CODE_ATTEMPTS; attempt++) {
        userCode = createUserCode();
        try {
            await store.createAuthorization({
                deviceCodeHash: hashConnectSecret(deviceCode),
                userCodeHash: createConnectUserCodeLookup(
                    userCode,
                    config.encryptionKey
                ),
                host: storeConnectHost(host),
                expiresAt: now + AUTHORIZATION_TTL_MS,
                now,
            });
            break;
        } catch (error) {
            if (
                !(error instanceof ConnectStoreError) ||
                error.code !== 'conflict' ||
                attempt === USER_CODE_ATTEMPTS - 1
            ) {
                throw error;
            }
        }
    }
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
