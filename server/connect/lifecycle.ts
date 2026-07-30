import { randomUUID } from 'node:crypto';
import {
    createConnectRelayMetadataAuthenticator,
    decryptConnectCredential,
    encryptConnectCredential,
    hashConnectSecret,
    isLegacyConnectCredentialEnvelope,
    safeSecretEqual,
} from './crypto';
import { requireConnectRelay } from './relay/require';
import { requireConnectStore } from './store/require';
import {
    CONNECT_LIFECYCLE_CLAIM_MS,
    CONNECT_LIFECYCLE_RETRY_BASE_MS,
    CONNECT_LIFECYCLE_RETRY_MAX_MS,
    CONNECT_AUTHORIZATION_RETENTION_MS,
    CONNECT_REVOKED_ENVIRONMENT_RETENTION_MS,
    CONNECT_RETENTION_BATCH_SIZE,
} from './store/types';
import type {
    ConnectAccessCredential,
    ConnectCredential,
    ConnectEnvironmentRecord,
} from './types';

interface ConnectTunnelSecret {
    tunnelSecret: string;
}

export interface ConnectLifecycleDependencies {
    encryptionKey: string;
    store?: ReturnType<typeof requireConnectStore>;
    relay?: ReturnType<typeof requireConnectRelay>;
    now?: () => number;
}

/**
 * Reconciles one environment while holding its durable claim token.
 *
 * Every external step persists progress before the next step begins. A lost
 * response is recovered by the relay's deterministic lookup and a stale
 * process cannot commit after another worker takes the lease.
 */
export async function reconcileClaimedConnectEnvironment(
    initial: ConnectEnvironmentRecord,
    claimToken: string,
    dependencies: ConnectLifecycleDependencies
): Promise<'active' | 'revoked'> {
    const store = dependencies.store ?? requireConnectStore();
    const relay = dependencies.relay ?? requireConnectRelay();
    const now = dependencies.now ?? Date.now;
    let environment = initial;

    try {
        if (
            environment.status === 'provisioning' &&
            environment.provisioning_deadline_at !== undefined &&
            environment.provisioning_deadline_at <= now()
        ) {
            const abandoned =
                await store.abandonEnvironmentProvisioning(
                    environment.id,
                    claimToken,
                    now()
                );
            if (!abandoned) {
                throw new Error(
                    'The Connect provisioning claim was superseded.'
                );
            }
            environment = abandoned;
        }

        if (environment.status === 'provisioning') {
            const tunnelCiphertext = requireValue(
                environment.tunnel_secret_ciphertext,
                'tunnel secret'
            );
            const accessCiphertext = requireValue(
                environment.access_credential_ciphertext,
                'access credential'
            );
            const tunnelEnvelope =
                decryptConnectCredential<ConnectTunnelSecret>(
                    tunnelCiphertext,
                    dependencies.encryptionKey,
                    environmentCredentialContext(
                        environment,
                        'environment-tunnel'
                    )
                );
            const access =
                decryptConnectCredential<ConnectAccessCredential>(
                    accessCiphertext,
                    dependencies.encryptionKey,
                    environmentCredentialContext(
                        environment,
                        'environment-access'
                    )
                );
            if (
                environment.control_token_hash &&
                hashConnectSecret(access.controlToken) !==
                    environment.control_token_hash
            ) {
                throw new Error(
                    'Connect access credential binding failed.'
                );
            }
            if (isLegacyConnectCredentialEnvelope(tunnelCiphertext)) {
                await store.rotateEnvironmentCredential(
                    environment.id,
                    'tunnel',
                    tunnelCiphertext,
                    encryptConnectCredential(
                        tunnelEnvelope,
                        dependencies.encryptionKey,
                        environmentCredentialContext(
                            environment,
                            'environment-tunnel'
                        )
                    ),
                    now()
                );
            }
            if (isLegacyConnectCredentialEnvelope(accessCiphertext)) {
                await store.rotateEnvironmentCredential(
                    environment.id,
                    'access',
                    accessCiphertext,
                    encryptConnectCredential(
                        access,
                        dependencies.encryptionKey,
                        environmentCredentialContext(
                            environment,
                            'environment-access'
                        )
                    ),
                    now()
                );
            }
            const tunnel = await relay.provision(
                {
                    environmentId: environment.id,
                    tunnelSecret: tunnelEnvelope.tunnelSecret,
                    hostname: environment.hostname || undefined,
                    tunnelId: environment.tunnel_id || undefined,
                    dnsRecordId: environment.dns_record_id || undefined,
                },
                async (progress) => {
                    const nextEnvironment = {
                        ...environment,
                        hostname:
                            progress.hostname ?? environment.hostname,
                        tunnel_id:
                            progress.tunnelId ?? environment.tunnel_id,
                        dns_record_id:
                            progress.dnsRecordId ??
                            environment.dns_record_id,
                    };
                    const relayAuthenticator =
                        relayMetadataAuthenticator(
                            nextEnvironment,
                            dependencies.encryptionKey
                        );
                    const saved = await store.saveEnvironmentRelayProgress(
                        environment.id,
                        'provisioning',
                        claimToken,
                        { ...progress, relayAuthenticator },
                        now()
                    );
                    if (!saved) {
                        throw new Error(
                            'The Connect provisioning claim was superseded.'
                        );
                    }
                    environment = {
                        ...nextEnvironment,
                        relay_authenticator: relayAuthenticator,
                    };
                }
            );
            const userId = requireValue(
                environment.user_id,
                'environment account'
            );
            const workspaceId = requireValue(
                environment.workspace_id,
                'environment workspace'
            );
            const credential: ConnectCredential = {
                accountId: userId,
                workspaceId,
                environmentId: environment.id,
                environmentName: environment.name,
                namespace: `or3-chat:${workspaceId}:`,
                controlToken: access.controlToken,
                tunnel: {
                    accountTag: tunnel.accountTag,
                    tunnelId: tunnel.tunnelId,
                    tunnelSecret: tunnel.tunnelSecret,
                    hostname: tunnel.hostname,
                },
            };
            const activated =
                await store.completeEnvironmentProvisioning(
                    environment.id,
                    claimToken,
                    encryptConnectCredential(
                        credential,
                        dependencies.encryptionKey,
                        {
                            purpose: 'authorization-delivery',
                            authorizationId: requireValue(
                                environment.authorization_id,
                                'authorization'
                            ),
                            environmentId: environment.id,
                            userId,
                            workspaceId,
                        }
                    ),
                    now()
                );
            if (!activated) {
                throw new Error(
                    'The Connect provisioning claim was superseded.'
                );
            }
            return 'active';
        }

        if (environment.status !== 'revoking') {
            throw new Error(
                `Unsupported Connect lifecycle status: ${environment.status}`
            );
        }
        if (
            environment.relay_authenticator &&
            !safeSecretEqual(
                environment.relay_authenticator,
                relayMetadataAuthenticator(
                    environment,
                    dependencies.encryptionKey
                )
            )
        ) {
            throw new Error(
                'Connect relay metadata authentication failed.'
            );
        }
        if (environment.tunnel_id || environment.dns_record_id) {
            await relay.revoke(
                {
                    tunnelId: environment.tunnel_id,
                    dnsRecordId:
                        environment.dns_record_id || undefined,
                },
                async (progress) => {
                    const nextEnvironment = {
                        ...environment,
                        dns_record_id: progress.dnsDeleted
                            ? ''
                            : environment.dns_record_id,
                        tunnel_id: progress.tunnelDeleted
                            ? ''
                            : environment.tunnel_id,
                    };
                    const relayAuthenticator =
                        relayMetadataAuthenticator(
                            nextEnvironment,
                            dependencies.encryptionKey
                        );
                    const relayProgress = {
                        ...(progress.dnsDeleted
                            ? { dnsRecordId: '' }
                            : {}),
                        ...(progress.tunnelDeleted
                            ? { tunnelId: '' }
                            : {}),
                        relayAuthenticator,
                    };
                    const saved =
                        await store.saveEnvironmentRelayProgress(
                            environment.id,
                            'revoking',
                            claimToken,
                            relayProgress,
                            now()
                        );
                    if (!saved) {
                        throw new Error(
                            'The Connect revocation claim was superseded.'
                        );
                    }
                    environment = {
                        ...nextEnvironment,
                        relay_authenticator: relayAuthenticator,
                    };
                }
            );
        }
        const revoked = await store.completeEnvironmentRevocation(
            environment.id,
            claimToken,
            now()
        );
        if (!revoked) {
            throw new Error(
                'The Connect revocation claim was superseded.'
            );
        }
        return 'revoked';
    } catch (error) {
        const status =
            environment.status === 'revoking'
                ? 'revoking'
                : 'provisioning';
        const attempts = environment.lifecycle_attempts ?? 0;
        const retryDelay = Math.min(
            CONNECT_LIFECYCLE_RETRY_MAX_MS,
            CONNECT_LIFECYCLE_RETRY_BASE_MS *
                2 ** Math.min(attempts, 6)
        );
        await store.recordEnvironmentLifecycleFailure(
            environment.id,
            status,
            claimToken,
            safeLifecycleError(error),
            now() + retryDelay,
            now()
        );
        throw error;
    }
}

function environmentCredentialContext(
    environment: ConnectEnvironmentRecord,
    purpose: 'environment-access' | 'environment-tunnel'
) {
    return {
        purpose,
        environmentId: environment.id,
        userId: requireValue(environment.user_id, 'environment account'),
        workspaceId: requireValue(
            environment.workspace_id,
            'environment workspace'
        ),
    } as const;
}

function relayMetadataAuthenticator(
    environment: ConnectEnvironmentRecord,
    encryptionKey: string
): string {
    return createConnectRelayMetadataAuthenticator(
        {
            environmentId: environment.id,
            userId: requireValue(
                environment.user_id,
                'environment account'
            ),
            workspaceId: requireValue(
                environment.workspace_id,
                'environment workspace'
            ),
            hostname: environment.hostname,
            tunnelId: environment.tunnel_id,
            dnsRecordId: environment.dns_record_id,
        },
        encryptionKey
    );
}

export async function reconcileDueConnectEnvironments(
    dependencies: ConnectLifecycleDependencies,
    maxItems = 10
): Promise<number> {
    const store = dependencies.store ?? requireConnectStore();
    const now = dependencies.now ?? Date.now;
    const retentionNow = now();
    await store.purgeConnectRecords({
        authorizationUpdatedBefore:
            retentionNow - CONNECT_AUTHORIZATION_RETENTION_MS,
        revokedEnvironmentUpdatedBefore:
            retentionNow - CONNECT_REVOKED_ENVIRONMENT_RETENTION_MS,
        batchSize: CONNECT_RETENTION_BATCH_SIZE,
    });
    let processed = 0;
    for (; processed < maxItems; processed += 1) {
        const claimedAt = now();
        const claimToken = randomUUID();
        const environment = await store.claimNextEnvironmentLifecycle(
            claimToken,
            claimedAt,
            claimedAt + CONNECT_LIFECYCLE_CLAIM_MS
        );
        if (!environment) break;
        await reconcileClaimedConnectEnvironment(
            environment,
            claimToken,
            { ...dependencies, store, now }
        ).catch((error) => {
            console.warn('[connect:lifecycle] Reconciliation deferred:', {
                environmentId: environment.id,
                status: environment.status,
                error: safeLifecycleError(error),
            });
        });
    }
    return processed;
}

function requireValue(value: string | undefined, label: string): string {
    if (!value) {
        throw new Error(`The Connect ${label} is missing.`);
    }
    return value;
}

function safeLifecycleError(error: unknown): string {
    const message =
        error instanceof Error ? error.message : 'Unknown lifecycle failure';
    return message.replace(/[\r\n]+/g, ' ').slice(0, 500);
}
