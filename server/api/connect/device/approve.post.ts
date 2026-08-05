import { randomBytes } from 'node:crypto';
import { createError, defineEventHandler, getRequestIP, readBody } from 'h3';
import { requireWorkspaceSession } from '../../workspaces/_helpers';
import { getConnectServerConfig } from '../../../connect/config';
import { requireConnectStore } from '../../../connect/store/require';
import {
    CONNECT_ENVIRONMENT_LIMIT_SCOPE,
    CONNECT_ACTIVATION_DEADLINE_MS,
    CONNECT_CREDENTIAL_REDELIVERY_MS,
    CONNECT_LIFECYCLE_CLAIM_MS,
    CONNECT_PROVISIONING_DEADLINE_MS,
    ConnectStoreError,
} from '../../../connect/store/types';
import {
    createConnectUserCodeLookup,
    encryptConnectCredential,
    hashConnectSecret,
    randomURLSecret,
} from '../../../connect/crypto';
import { noStore, normalizeUserCode } from '../../../connect/helpers';
import { reconcileClaimedConnectEnvironment } from '../../../connect/lifecycle';
import type { ConnectEnvironmentRecord } from '../../../connect/types';
import { getRateLimitProvider } from '../../../utils/rate-limit/store';
import { requireSameOriginMutation } from '../../../utils/security/mutation-guard';

export default defineEventHandler(async (event) => {
    noStore(event);
    requireSameOriginMutation(event, {
        intentHeader: 'x-or3-connect-intent',
        intentValue: 'approve',
        requireJson: true,
    });
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
    const store = requireConnectStore();
    const authorization = await store.getAuthorizationByUserHash(
        createConnectUserCodeLookup(code, config.encryptionKey),
        Date.now()
    );
    if (
        authorization &&
        authorization.status !== 'pending' &&
        authorization.approved_user_id === session.user.id &&
        authorization.approved_workspace_id === session.workspace.id &&
        authorization.environment_id &&
        ['provisioning', 'approved', 'delivering', 'consumed'].includes(
            authorization.status
        )
    ) {
        return {
            connected: true,
            environment: {
                id: authorization.environment_id,
                name: authorization.host.name,
            },
        };
    }
    if (!authorization || authorization.status !== 'pending') {
        throw createError({
            statusCode: 404,
            statusMessage: 'This connection request expired or was already used.',
        });
    }
    const environmentId = `env-${randomURLSecret(12).toLowerCase()}`;
    const controlToken = randomURLSecret(32);
    const tunnelSecret = randomBytes(32).toString('base64');
    const claimToken = randomURLSecret(24);
    const now = Date.now();
    const provisioningDeadlineAt =
        now + CONNECT_PROVISIONING_DEADLINE_MS;
    let environment: ConnectEnvironmentRecord;
    try {
        environment = await store.reserveAuthorization({
            authorizationId: authorization._id,
            userId: session.user.id,
            workspaceId: session.workspace.id,
            environment: {
                id: environmentId,
                name: name || authorization.host.name,
                platform: authorization.host.platform,
                architecture: authorization.host.architecture,
                driver: authorization.host.driver,
                runtime: authorization.host.runtime,
                base_path: authorization.host.base_path,
                host_id: authorization.host.host_id,
                signing_public_key: authorization.host.signing_public_key,
                noise_public_key: authorization.host.noise_public_key,
                control_token_hash: hashConnectSecret(controlToken),
                access_credential_ciphertext: encryptConnectCredential(
                    {
                        controlToken,
                        driver: authorization.host.driver,
                        runtime: authorization.host.runtime,
                        basePath: authorization.host.base_path,
                    },
                    config.encryptionKey,
                    {
                        purpose: 'environment-access',
                        environmentId,
                        userId: session.user.id,
                        workspaceId: session.workspace.id,
                    }
                ),
                tunnel_secret_ciphertext: encryptConnectCredential(
                    { tunnelSecret },
                    config.encryptionKey,
                    {
                        purpose: 'environment-tunnel',
                        environmentId,
                        userId: session.user.id,
                        workspaceId: session.workspace.id,
                    }
                ),
            },
            limitPolicy: {
                scope: CONNECT_ENVIRONMENT_LIMIT_SCOPE,
                maxActiveEnvironments: config.maxComputers,
            },
            claimToken,
            claimUntil: now + CONNECT_LIFECYCLE_CLAIM_MS,
            provisioningDeadlineAt,
            activationDeadlineAt:
                provisioningDeadlineAt +
                CONNECT_ACTIVATION_DEADLINE_MS,
            authorizationExpiresAt:
                provisioningDeadlineAt +
                CONNECT_CREDENTIAL_REDELIVERY_MS,
            now,
        });
    } catch (error) {
        if (error instanceof ConnectStoreError) {
            throw createError({
                statusCode:
                    error.code === 'environment_limit_reached' ? 409 : 404,
                statusMessage: error.message,
            });
        }
        throw error;
    }
    // Approval is durable at this point. Start immediately for a fast path;
    // the lifecycle worker resumes it after the claim lease if this process
    // exits or any relay response is lost.
    void reconcileClaimedConnectEnvironment(environment, claimToken, {
        encryptionKey: config.encryptionKey,
        store,
    }).catch(() => undefined);
    return {
        connected: true,
        environment: {
            id: environmentId,
            name: environment.name,
        },
    };
});
