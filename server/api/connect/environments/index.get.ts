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
import { noStore, normalizeConnectRuntimeMetadata } from '../../../connect/helpers';
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
            environments
                .filter((environment) => environment.status === 'active')
                .map(async (environment) => {
                    const context = {
                        purpose: 'environment-access' as const,
                        environmentId: environment.id,
                        userId,
                        workspaceId,
                    };
                    let access: ConnectAccessCredential;
                    let binding: NonNullable<
                        ReturnType<typeof normalizeConnectRuntimeMetadata>
                    >;
                    try {
                        access = decryptConnectCredential<ConnectAccessCredential>(
                            environment.access_credential_ciphertext,
                            config.encryptionKey,
                            context
                        );
                    } catch {
                        console.warn(
                            `[connect] skipping environment ${environment.id}: credential_decryption_failed`
                        );
                        return null;
                    }
                    if (
                        environment.control_token_hash &&
                        hashConnectSecret(access.controlToken) !==
                            environment.control_token_hash
                    ) {
                        console.warn(
                            `[connect] skipping environment ${environment.id}: credential_hash_mismatch`
                        );
                        return null;
                    }
                    // Treat the durable environment declaration as the
                    // authority. The encrypted envelope is checked too, but
                    // must never be allowed to relabel an old/corrupt record.
                    const environmentBinding = normalizeConnectRuntimeMetadata({
                        runtime: environment.runtime,
                        driver: environment.driver,
                        basePath: environment.base_path,
                    });
                    const accessBinding = normalizeConnectRuntimeMetadata(access);
                    if (
                        !environmentBinding ||
                        !accessBinding ||
                        environmentBinding.runtime !== accessBinding.runtime ||
                        environmentBinding.driver !== accessBinding.driver ||
                        environmentBinding.basePath !== accessBinding.basePath
                    ) {
                        console.warn(
                            `[connect] skipping environment ${environment.id}: runtime_binding_mismatch`
                        );
                        return null;
                    }
                    binding = environmentBinding;
                    // Rotate only after the full record has decrypted and
                    // passed its immutable runtime-binding checks. Store
                    // errors are operational failures and must reach callers.
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
                        baseUrl: `https://${environment.hostname}${binding.basePath}`,
                        accessToken: access.controlToken,
                        driver: binding.driver,
                        runtime: binding.runtime,
                        basePath: binding.basePath,
                    };
                })
        ).then((environments) => environments.filter(Boolean)),
    };
});
