import { describe, expect, it, vi } from 'vitest';
import {
    decryptConnectCredential,
    encryptConnectCredential,
} from '../crypto';
import { reconcileClaimedConnectEnvironment } from '../lifecycle';
import type { ConnectRelay } from '../relay/types';
import type { ConnectStore } from '../store/types';
import type {
    ConnectCredential,
    ConnectEnvironmentRecord,
} from '../types';

const encryptionKey = 'lifecycle-test-key-that-is-at-least-32-characters';

describe('Connect environment lifecycle reconciler', () => {
    it('persists every relay step before atomically activating the authorization', async () => {
        const saveProgress = vi.fn().mockResolvedValue(true);
        const complete = vi.fn().mockResolvedValue(true);
        const recordFailure = vi.fn().mockResolvedValue(true);
        const store = {
            saveEnvironmentRelayProgress: saveProgress,
            completeEnvironmentProvisioning: complete,
            recordEnvironmentLifecycleFailure: recordFailure,
        } as unknown as ConnectStore;
        const relay: ConnectRelay = {
            async provision(input, onProgress) {
                expect(input).toMatchObject({
                    environmentId: 'environment-one',
                    tunnelSecret: 'persisted-secret',
                });
                await onProgress?.({
                    hostname: 'environment-one.connect.example.test',
                    tunnelId: 'tunnel-one',
                });
                await onProgress?.({
                    hostname: 'environment-one.connect.example.test',
                    tunnelId: 'tunnel-one',
                    dnsRecordId: 'dns-one',
                });
                return {
                    accountTag: 'account-one',
                    tunnelId: 'tunnel-one',
                    tunnelSecret: input.tunnelSecret,
                    hostname: 'environment-one.connect.example.test',
                    dnsRecordId: 'dns-one',
                };
            },
            revoke: vi.fn(),
        };

        await expect(
            reconcileClaimedConnectEnvironment(
                provisioningEnvironment(),
                'claim-one',
                {
                    encryptionKey,
                    store,
                    relay,
                    now: () => 100,
                }
            )
        ).resolves.toBe('active');

        expect(saveProgress.mock.calls).toEqual([
            [
                'environment-one',
                'provisioning',
                'claim-one',
                {
                    hostname:
                        'environment-one.connect.example.test',
                    tunnelId: 'tunnel-one',
                    relayAuthenticator: expect.any(String),
                },
                100,
            ],
            [
                'environment-one',
                'provisioning',
                'claim-one',
                {
                    hostname:
                        'environment-one.connect.example.test',
                    tunnelId: 'tunnel-one',
                    dnsRecordId: 'dns-one',
                    relayAuthenticator: expect.any(String),
                },
                100,
            ],
        ]);
        const credentialCiphertext = complete.mock.calls[0]?.[2] as string;
        expect(
            decryptConnectCredential<ConnectCredential>(
                credentialCiphertext,
                encryptionKey,
                {
                    purpose: 'authorization-delivery',
                    authorizationId: 'authorization-one',
                    environmentId: 'environment-one',
                    userId: 'user-one',
                    workspaceId: 'workspace-one',
                }
            )
        ).toMatchObject({
            accountId: 'user-one',
            workspaceId: 'workspace-one',
            environmentId: 'environment-one',
            controlToken: 'control-token',
            tunnel: {
                tunnelId: 'tunnel-one',
                tunnelSecret: 'persisted-secret',
            },
        });
        expect(recordFailure).not.toHaveBeenCalled();
    });

    it('records partial revocation progress and resumes without repeating it', async () => {
        const saveProgress = vi.fn().mockResolvedValue(true);
        const complete = vi.fn().mockResolvedValue(true);
        const recordFailure = vi.fn().mockResolvedValue(true);
        const store = {
            saveEnvironmentRelayProgress: saveProgress,
            completeEnvironmentRevocation: complete,
            recordEnvironmentLifecycleFailure: recordFailure,
        } as unknown as ConnectStore;
        const firstRelay: ConnectRelay = {
            provision: vi.fn(),
            async revoke(_input, onProgress) {
                await onProgress?.({ dnsDeleted: true });
                throw new Error('tunnel temporarily unavailable');
            },
        };
        const revoking = {
            ...provisioningEnvironment(),
            status: 'revoking' as const,
            hostname: 'environment-one.connect.example.test',
            tunnel_id: 'tunnel-one',
            dns_record_id: 'dns-one',
            lifecycle_attempts: 2,
        };

        await expect(
            reconcileClaimedConnectEnvironment(
                revoking,
                'claim-one',
                {
                    encryptionKey,
                    store,
                    relay: firstRelay,
                    now: () => 200,
                }
            )
        ).rejects.toThrow('tunnel temporarily unavailable');
        expect(saveProgress).toHaveBeenCalledWith(
            'environment-one',
            'revoking',
            'claim-one',
            {
                dnsRecordId: '',
                relayAuthenticator: expect.any(String),
            },
            200
        );
        expect(recordFailure).toHaveBeenCalledWith(
            'environment-one',
            'revoking',
            'claim-one',
            'tunnel temporarily unavailable',
            20_200,
            200
        );
        expect(complete).not.toHaveBeenCalled();

        const secondRelay: ConnectRelay = {
            provision: vi.fn(),
            async revoke(input, onProgress) {
                expect(input).toEqual({
                    tunnelId: 'tunnel-one',
                    dnsRecordId: undefined,
                });
                await onProgress?.({ tunnelDeleted: true });
            },
        };
        await expect(
            reconcileClaimedConnectEnvironment(
                {
                    ...revoking,
                    dns_record_id: '',
                    lifecycle_attempts: 3,
                },
                'claim-two',
                {
                    encryptionKey,
                    store,
                    relay: secondRelay,
                    now: () => 300,
                }
            )
        ).resolves.toBe('revoked');
        expect(complete).toHaveBeenCalledWith(
            'environment-one',
            'claim-two',
            300
        );
    });

    it('turns an abandoned provisioning reservation into cleanup work', async () => {
        const abandoned = {
            ...provisioningEnvironment(),
            status: 'revoking' as const,
        };
        const abandon = vi.fn().mockResolvedValue(abandoned);
        const complete = vi.fn().mockResolvedValue(true);
        const store = {
            abandonEnvironmentProvisioning: abandon,
            completeEnvironmentRevocation: complete,
            recordEnvironmentLifecycleFailure: vi
                .fn()
                .mockResolvedValue(true),
        } as unknown as ConnectStore;
        const relay: ConnectRelay = {
            provision: vi.fn(),
            revoke: vi.fn().mockResolvedValue(undefined),
        };

        await expect(
            reconcileClaimedConnectEnvironment(
                {
                    ...provisioningEnvironment(),
                    provisioning_deadline_at: 99,
                },
                'claim-one',
                {
                    encryptionKey,
                    store,
                    relay,
                    now: () => 100,
                }
            )
        ).resolves.toBe('revoked');
        expect(abandon).toHaveBeenCalledWith(
            'environment-one',
            'claim-one',
            100
        );
        expect(relay.provision).not.toHaveBeenCalled();
        expect(complete).toHaveBeenCalled();
    });

    it('refuses to revoke relay identifiers whose authenticated metadata was swapped', async () => {
        const recordFailure = vi.fn().mockResolvedValue(true);
        const relay: ConnectRelay = {
            provision: vi.fn(),
            revoke: vi.fn(),
        };
        await expect(
            reconcileClaimedConnectEnvironment(
                {
                    ...provisioningEnvironment(),
                    status: 'revoking',
                    hostname: 'swapped.connect.example.test',
                    tunnel_id: 'swapped-tunnel',
                    dns_record_id: 'swapped-dns',
                    relay_authenticator: 'invalid-authenticator',
                },
                'claim-one',
                {
                    encryptionKey,
                    relay,
                    store: {
                        recordEnvironmentLifecycleFailure: recordFailure,
                    } as unknown as ConnectStore,
                    now: () => 500,
                }
            )
        ).rejects.toThrow('metadata authentication failed');
        expect(relay.revoke).not.toHaveBeenCalled();
        expect(recordFailure).toHaveBeenCalled();
    });
});

function provisioningEnvironment(): ConnectEnvironmentRecord {
    return {
        id: 'environment-one',
        user_id: 'user-one',
        workspace_id: 'workspace-one',
        name: 'Computer',
        platform: 'darwin',
        architecture: 'arm64',
        hostname: '',
        tunnel_id: '',
        dns_record_id: '',
        access_credential_ciphertext: encryptConnectCredential(
            { controlToken: 'control-token' },
            encryptionKey,
            {
                purpose: 'environment-access',
                environmentId: 'environment-one',
                userId: 'user-one',
                workspaceId: 'workspace-one',
            }
        ),
        tunnel_secret_ciphertext: encryptConnectCredential(
            { tunnelSecret: 'persisted-secret' },
            encryptionKey,
            {
                purpose: 'environment-tunnel',
                environmentId: 'environment-one',
                userId: 'user-one',
                workspaceId: 'workspace-one',
            }
        ),
        authorization_id: 'authorization-one',
        status: 'provisioning',
        lifecycle_attempts: 0,
        provisioning_deadline_at: 1_000,
    };
}
