import {
    createError,
    defineEventHandler,
    getRequestIP,
    setResponseHeader,
} from 'h3';
import { getConnectServerConfig } from '../../../connect/config';
import { requireConnectStore } from '../../../connect/store/require';
import { CONNECT_CREDENTIAL_REDELIVERY_MS } from '../../../connect/store/types';
import {
    decryptConnectCredential,
    encryptConnectCredential,
    hashConnectSecret,
    isLegacyConnectCredentialEnvelope,
} from '../../../connect/crypto';
import { noStore, parseConnectHost } from '../../../connect/helpers';
import type { ConnectCredential } from '../../../connect/types';
import { readLimitedJsonBody } from '../../../utils/security/limited-json-body';
import { getConnectRateLimitProvider } from '../../../connect/rate-limit';

export default defineEventHandler(async (event) => {
    noStore(event);
    const config = getConnectServerConfig(event);
    const rateLimits = getConnectRateLimitProvider(config);
    const ipHash = hashConnectSecret(getRequestIP(event) || 'unknown');
    const ipLimit = await rateLimits.checkAndRecord(
        `connect:token:ip:${ipHash}`,
        { windowMs: 60_000, maxRequests: 60 }
    );
    if (!ipLimit.allowed) return slowDown(event, ipLimit.retryAfterMs);

    const body = await readLimitedJsonBody<{
        deviceCode?: unknown;
        host?: unknown;
    }>(event);
    const deviceCode =
        typeof body?.deviceCode === 'string' ? body.deviceCode.trim() : '';
    if (deviceCode.length < 32 || deviceCode.length > 200) {
        throw createError({
            statusCode: 400,
            statusMessage: 'The connection request is invalid.',
        });
    }
    parseConnectHost(body.host);
    const deviceCodeHash = hashConnectSecret(deviceCode);
    const deviceLimit = await rateLimits.checkAndRecord(
        `connect:token:device:${deviceCodeHash}`,
        { windowMs: 60_000, maxRequests: 30 }
    );
    if (!deviceLimit.allowed) {
        return slowDown(event, deviceLimit.retryAfterMs);
    }
    const store = requireConnectStore();
    const authorization =
        await store.getAuthorizationByDeviceHash(
            deviceCodeHash,
            Date.now(),
            CONNECT_CREDENTIAL_REDELIVERY_MS
        );
    if (!authorization) {
        const invalidLimit = await rateLimits.checkAndRecord(
            'connect:token:invalid:global',
            { windowMs: 60_000, maxRequests: 300 }
        );
        if (!invalidLimit.allowed) {
            return slowDown(event, invalidLimit.retryAfterMs);
        }
        return { status: 'expired' };
    }
    if (
        authorization.status === 'approved' ||
        authorization.status === 'delivering'
    ) {
        if (!authorization.credential_ciphertext) {
            throw createError({
                statusCode: 503,
                statusMessage: 'The computer connection is not ready yet.',
            });
        }
        const context = {
            purpose: 'authorization-delivery' as const,
            authorizationId: authorization._id,
            environmentId: authorization.environment_id ?? '',
            userId: authorization.approved_user_id ?? '',
            workspaceId: authorization.approved_workspace_id ?? '',
        };
        const credential = decryptConnectCredential<ConnectCredential>(
            authorization.credential_ciphertext,
            config.encryptionKey,
            context
        );
        if (
            credential.accountId !== context.userId ||
            credential.workspaceId !== context.workspaceId ||
            credential.environmentId !== context.environmentId
        ) {
            throw createError({
                statusCode: 404,
                statusMessage:
                    'The approved computer is no longer available.',
            });
        }
        if (
            isLegacyConnectCredentialEnvelope(
                authorization.credential_ciphertext
            )
        ) {
            await store.rotateAuthorizationCredential(
                authorization._id,
                authorization.credential_ciphertext,
                encryptConnectCredential(
                    credential,
                    config.encryptionKey,
                    context
                ),
                Date.now()
            );
        }
        return {
            status: 'approved',
            credential,
        };
    }
    if (authorization.status === 'denied') return { status: 'denied' };
    if (
        authorization.status === 'expired' ||
        authorization.status === 'consumed'
    ) {
        return { status: 'expired' };
    }
    return { status: 'pending', retryAfter: 3 };
});

function slowDown(
    event: Parameters<typeof setResponseHeader>[0],
    retryAfterMs = 3_000
) {
    const retryAfter = Math.max(3, Math.ceil(retryAfterMs / 1_000));
    setResponseHeader(event, 'Retry-After', retryAfter);
    return {
        status: 'slow_down' as const,
        error: 'slow_down',
        retryAfter,
    };
}
