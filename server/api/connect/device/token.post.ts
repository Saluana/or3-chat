import { createError, defineEventHandler, readBody } from 'h3';
import { getConnectServerConfig } from '../../../connect/config';
import { requireConnectStore } from '../../../connect/store/require';
import {
    decryptConnectCredential,
    hashConnectSecret,
} from '../../../connect/crypto';
import { noStore, parseConnectHost } from '../../../connect/helpers';
import type { ConnectCredential } from '../../../connect/types';

export default defineEventHandler(async (event) => {
    noStore(event);
    const config = getConnectServerConfig(event);
    const body = (await readBody(event)) as {
        deviceCode?: unknown;
        host?: unknown;
    };
    const deviceCode =
        typeof body?.deviceCode === 'string' ? body.deviceCode.trim() : '';
    if (deviceCode.length < 32 || deviceCode.length > 200) {
        throw createError({
            statusCode: 400,
            statusMessage: 'The connection request is invalid.',
        });
    }
    parseConnectHost(body.host);
    const authorization =
        await requireConnectStore().getAuthorizationByDeviceHash(
            hashConnectSecret(deviceCode),
            Date.now()
        );
    if (!authorization) {
        return { status: 'expired' };
    }
    if (authorization.status === 'approved') {
        if (!authorization.credential_ciphertext) {
            throw createError({
                statusCode: 503,
                statusMessage: 'The computer connection is not ready yet.',
            });
        }
        return {
            status: 'approved',
            credential: decryptConnectCredential<ConnectCredential>(
                authorization.credential_ciphertext,
                config.encryptionKey
            ),
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
