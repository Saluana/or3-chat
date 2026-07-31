import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';

const readBodyMock = vi.fn();
vi.mock('h3', () => ({
    defineEventHandler: (handler: unknown) => handler,
    readBody: (...args: unknown[]) => readBodyMock(...args),
    getRequestIP: () => '127.0.0.1',
    createError: (options: {
        statusCode: number;
        statusMessage?: string;
    }) =>
        Object.assign(new Error(options.statusMessage), {
            statusCode: options.statusCode,
        }),
}));

vi.mock('../../workspaces/_helpers', () => ({
    requireWorkspaceSession: () => ({
        user: { id: 'user-one' },
        workspace: { id: 'workspace-one' },
    }),
}));

const getAuthorizationMock = vi.fn();
const reserveAuthorizationMock = vi.fn();
vi.mock('../../../connect/store/require', () => ({
    requireConnectStore: () => ({
        getAuthorizationByUserHash: getAuthorizationMock,
        reserveAuthorization: reserveAuthorizationMock,
    }),
}));

const reconcileMock = vi.fn();
vi.mock('../../../connect/lifecycle', () => ({
    reconcileClaimedConnectEnvironment: (...args: unknown[]) =>
        reconcileMock(...args),
}));

vi.mock('../../../connect/config', () => ({
    getConnectServerConfig: () => ({
        encryptionKey:
            'approval-lifecycle-test-key-with-32-characters',
        maxComputers: 3,
    }),
}));

vi.mock('../../../connect/crypto', () => ({
    createConnectUserCodeLookup: (code: string) => `lookup:${code}`,
    encryptConnectCredential: (value: unknown) =>
        `encrypted:${JSON.stringify(value)}`,
    hashConnectSecret: (value: string) => `hash:${value}`,
    randomURLSecret: (bytes: number) =>
        bytes === 12 ? 'environmentidentifier' : `secret-${bytes}`,
}));

vi.mock('../../../connect/helpers', () => ({
    noStore: vi.fn(),
    normalizeUserCode: (value: unknown) => String(value),
}));

vi.mock('../../../utils/rate-limit/store', () => ({
    getRateLimitProvider: () => ({
        checkAndRecord: () => ({ allowed: true }),
    }),
}));

vi.mock('../../../utils/security/mutation-guard', () => ({
    requireSameOriginMutation: vi.fn(),
}));

const event = { context: {} } as H3Event;

describe('Connect approval lifecycle', () => {
    beforeEach(() => {
        vi.resetModules();
        readBodyMock.mockReset().mockResolvedValue({
            code: 'PAIR-CODE',
            name: 'Workstation',
        });
        getAuthorizationMock.mockReset().mockResolvedValue({
            _id: 'authorization-one',
            status: 'pending',
            host: {
                name: 'Computer',
                platform: 'darwin',
                architecture: 'arm64',
                intern_version: '1.0.0',
            },
            expires_at: Date.now() + 60_000,
        });
        reserveAuthorizationMock
            .mockReset()
            .mockImplementation(async (input) => ({
                id: input.environment.id,
                user_id: input.userId,
                workspace_id: input.workspaceId,
                name: input.environment.name,
                hostname: '',
                tunnel_id: '',
                dns_record_id: '',
                access_credential_ciphertext:
                    input.environment.access_credential_ciphertext,
                tunnel_secret_ciphertext:
                    input.environment.tunnel_secret_ciphertext,
                status: 'provisioning',
            }));
        reconcileMock.mockReset().mockResolvedValue('active');
    });

    it('reserves authorization and quota before starting relay work', async () => {
        const handler = (await import('../device/approve.post')).default as (
            event: H3Event
        ) => Promise<unknown>;

        await expect(handler(event)).resolves.toMatchObject({
            connected: true,
            environment: { name: 'Workstation' },
        });
        expect(reserveAuthorizationMock).toHaveBeenCalledTimes(1);
        const reservation =
            reserveAuthorizationMock.mock.calls[0]?.[0];
        expect(reservation).toMatchObject({
            authorizationId: 'authorization-one',
            userId: 'user-one',
            workspaceId: 'workspace-one',
            environment: {
                name: 'Workstation',
                control_token_hash: expect.any(String),
                access_credential_ciphertext: expect.any(String),
                tunnel_secret_ciphertext: expect.any(String),
            },
            limitPolicy: {
                scope: 'account',
                maxActiveEnvironments: 3,
            },
            claimToken: 'secret-24',
        });
        expect(reservation.authorizationExpiresAt).toBeGreaterThan(
            reservation.provisioningDeadlineAt
        );
        expect(reconcileMock).toHaveBeenCalledAfter(
            reserveAuthorizationMock
        );
    });

    it('rejects quota before any relay reconciliation starts', async () => {
        const handler = (await import('../device/approve.post')).default as (
            event: H3Event
        ) => Promise<unknown>;
        const { ConnectStoreError } = await import(
            '../../../connect/store/types'
        );
        reserveAuthorizationMock.mockRejectedValue(
            new ConnectStoreError(
                'environment_limit_reached',
                'This account already has 3 connected computers.'
            )
        );

        await expect(handler(event)).rejects.toMatchObject({
            statusCode: 409,
        });
        expect(reconcileMock).not.toHaveBeenCalled();
    });

    it('returns the same reservation after an approval response is lost', async () => {
        getAuthorizationMock.mockResolvedValue({
            _id: 'authorization-one',
            status: 'provisioning',
            host: {
                name: 'Original computer',
                platform: 'darwin',
                architecture: 'arm64',
                intern_version: '1.0.0',
            },
            approved_user_id: 'user-one',
            approved_workspace_id: 'workspace-one',
            environment_id: 'env-existing123',
            expires_at: Date.now() + 60_000,
        });
        const handler = (await import('../device/approve.post')).default as (
            event: H3Event
        ) => Promise<unknown>;

        await expect(handler(event)).resolves.toEqual({
            connected: true,
            environment: {
                id: 'env-existing123',
                name: 'Original computer',
            },
        });
        expect(reserveAuthorizationMock).not.toHaveBeenCalled();
        expect(reconcileMock).not.toHaveBeenCalled();
    });
});
