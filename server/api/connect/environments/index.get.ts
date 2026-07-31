import { createError, defineEventHandler } from 'h3';
import { requireWorkspaceSession } from '../../workspaces/_helpers';
import { getConnectServerConfig } from '../../../connect/config';
import { requireConnectStore } from '../../../connect/store/require';
import {
    decryptConnectCredential,
    encryptConnectCredential,
    hashConnectSecret,
    isLegacyConnectCredentialEnvelope,
} from '../../../connect/crypto';
import { noStore } from '../../../connect/helpers';
import type { ConnectAccessCredential } from '../../../connect/types';

export default defineEventHandler(async (event) => {
    noStore(event);
    const config = getConnectServerConfig(event);
    const session = await requireWorkspaceSession(event);
    if (!session.user?.id || !session.workspace?.id) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
    }
    const userId = session.user.id;
    const workspaceId = session.workspace.id;
    const store = requireConnectStore();
    const environments = await store.listEnvironments({
        userId,
        workspaceId,
    });
    return {
        workspaceId,
        environments: await Promise.all(
            environments.map(async (environment) => {
                const context = {
                    purpose: 'environment-access' as const,
                    environmentId: environment.id,
                    userId,
                    workspaceId,
                };
                const access = decryptConnectCredential<ConnectAccessCredential>(
                    environment.access_credential_ciphertext,
                    config.encryptionKey,
                    context
                );
                if (
                    environment.control_token_hash &&
                    hashConnectSecret(access.controlToken) !==
                        environment.control_token_hash
                ) {
                    throw createError({
                        statusCode: 503,
                        statusMessage:
                            'A stored computer credential failed validation.',
                    });
                }
                if (
                    isLegacyConnectCredentialEnvelope(
                        environment.access_credential_ciphertext
                    )
                ) {
                    await store.rotateEnvironmentCredential(
                        environment.id,
                        'access',
                        environment.access_credential_ciphertext,
                        encryptConnectCredential(
                            access,
                            config.encryptionKey,
                            context
                        ),
                        Date.now()
                    );
                }
                return {
                    id: environment.id,
                    name: environment.name,
                    hostname: environment.hostname,
                    status: environment.status,
                    baseUrl: `https://${environment.hostname}`,
                    accessToken: access.controlToken,
                };
            })
        ),
    };
});
