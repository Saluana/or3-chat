import {
    createError,
    defineEventHandler,
    getHeader,
} from 'h3';
import { getConnectServerConfig } from '../../../connect/config';
import { requireConnectRelay } from '../../../connect/relay/require';
import { requireConnectStore } from '../../../connect/store/require';
import { hashConnectSecret } from '../../../connect/crypto';
import { noStore } from '../../../connect/helpers';

export default defineEventHandler(async (event) => {
    noStore(event);
    getConnectServerConfig(event);
    const authorization = getHeader(event, 'authorization') ?? '';
    const token = authorization.startsWith('Bearer ')
        ? authorization.slice(7).trim()
        : '';
    if (token.length < 32) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
    }
    const store = requireConnectStore();
    const environment = await store.getEnvironmentByControlTokenHash(
        hashConnectSecret(token)
    );
    if (!environment || environment.status !== 'active') {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }
    await requireConnectRelay().revoke({
        tunnelId: environment.tunnel_id,
        dnsRecordId: environment.dns_record_id,
    });
    await store.revokeEnvironment(environment.id, Date.now());
    return { revoked: true };
});
