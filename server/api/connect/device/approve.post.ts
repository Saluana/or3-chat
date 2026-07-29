import { createError, defineEventHandler, getRequestIP, readBody } from 'h3';
import { requireWorkspaceSession } from '../../workspaces/_helpers';
import {
    getConnectServerConfig,
    getTunnelProvisioner,
} from '../../../connect/config';
import { ConnectStore } from '../../../connect/convex-store';
import {
    encryptConnectCredential,
    hashConnectSecret,
    randomURLSecret,
} from '../../../connect/crypto';
import {
    noStore,
    normalizeUserCode,
} from '../../../connect/helpers';
import type { ConnectCredential } from '../../../connect/types';
import { getRateLimitProvider } from '../../../utils/rate-limit/store';

export default defineEventHandler(async (event) => {
    noStore(event);
    const config = getConnectServerConfig(event);
    const session = await requireWorkspaceSession(event);
    if (!session.user?.id || !session.workspace?.id) {
        throw createError({ statusCode: 401, statusMessage: 'Sign in to continue.' });
    }
    const approvalLimit = await getRateLimitProvider().checkAndRecord(
        `connect:approve:${session.user.id}:${getRequestIP(event) || 'unknown'}`,
        { windowMs: 60_000, maxRequests: 10 }
    );
    if (!approvalLimit.allowed) {
        throw createError({
            statusCode: 429,
            statusMessage: 'Too many connection attempts. Try again shortly.',
        });
    }
    const body = (await readBody(event)) as { code?: unknown; name?: unknown };
    const code = normalizeUserCode(body?.code);
    const name =
        typeof body?.name === 'string' ? body.name.trim().slice(0, 80) : '';
    const store = new ConnectStore();
    const authorization = await store.getAuthorizationByUserHash(
        hashConnectSecret(code),
        Date.now()
    );
    if (!authorization || authorization.status !== 'pending') {
        throw createError({
            statusCode: 404,
            statusMessage: 'This connection request expired or was already used.',
        });
    }
    const environmentId = `env-${randomURLSecret(12).toLowerCase()}`;
    const controlToken = randomURLSecret(32);
    const provisioner = getTunnelProvisioner(config);
    const tunnel = await provisioner.provision(environmentId);
    const credential: ConnectCredential = {
        accountId: session.user.id,
        environmentId,
        environmentName: name || authorization.host.name,
        controlToken,
        tunnel: {
            token: tunnel.tunnelToken,
            hostname: tunnel.hostname,
        },
    };
    try {
        await store.approveAuthorization({
            authorizationId: authorization._id,
            userId: session.user.id,
            workspaceId: session.workspace.id,
            environment: {
                id: environmentId,
                name: credential.environmentName,
                platform: authorization.host.platform,
                architecture: authorization.host.architecture,
                host_id: authorization.host.host_id,
                signing_public_key: authorization.host.signing_public_key,
                noise_public_key: authorization.host.noise_public_key,
                hostname: tunnel.hostname,
                tunnel_id: tunnel.tunnelId,
                dns_record_id: tunnel.dnsRecordId,
                control_token_hash: hashConnectSecret(controlToken),
                access_credential_ciphertext: encryptConnectCredential(
                    { controlToken },
                    config.encryptionKey
                ),
            },
            credentialCiphertext: encryptConnectCredential(
                credential,
                config.encryptionKey
            ),
            maxActiveEnvironments: config.maxComputers,
            now: Date.now(),
        });
    } catch (error) {
        await provisioner
            .revoke({
                tunnelId: tunnel.tunnelId,
                dnsRecordId: tunnel.dnsRecordId,
            })
            .catch(() => undefined);
        throw error;
    }
    return {
        connected: true,
        environment: {
            id: environmentId,
            name: credential.environmentName,
        },
    };
});
