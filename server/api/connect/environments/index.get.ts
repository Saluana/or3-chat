import { createError, defineEventHandler } from 'h3';
import { requireWorkspaceSession } from '../../workspaces/_helpers';
import { getConnectServerConfig } from '../../../connect/config';
import { requireConnectStore } from '../../../connect/store/require';
import { decryptConnectCredential } from '../../../connect/crypto';
import { noStore } from '../../../connect/helpers';
import type { ConnectAccessCredential } from '../../../connect/types';

export default defineEventHandler(async (event) => {
    noStore(event);
    const config = getConnectServerConfig(event);
    const session = await requireWorkspaceSession(event);
    if (!session.user?.id) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
    }
    const environments = await requireConnectStore().listEnvironmentsForUser(
        session.user.id
    );
    return {
        environments: environments.map((environment) => ({
            id: environment.id,
            name: environment.name,
            hostname: environment.hostname,
            status: environment.status,
            baseUrl: `https://${environment.hostname}`,
            accessToken: decryptConnectCredential<ConnectAccessCredential>(
                environment.access_credential_ciphertext,
                config.encryptionKey
            ).controlToken,
        })),
    };
});
