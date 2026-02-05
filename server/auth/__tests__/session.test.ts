import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';
import { registerAuthProvider } from '../registry';
import { resolveSessionContext } from '../session';
import { testRuntimeConfig } from '../../../tests/setup';

const getConvexClientMock = vi.hoisted(() => vi.fn());
const adminCheckerMock = vi.hoisted(() => ({
    checkDeploymentAdmin: vi.fn().mockResolvedValue(false),
}));

// Hoisted mock for AuthWorkspaceStore so tests can control its behavior
const authWorkspaceStoreMock = vi.hoisted(() => ({
    getOrCreateUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
    getOrCreateDefaultWorkspace: vi.fn().mockResolvedValue({ id: 'ws-1', name: 'Default', role: 'owner' }),
    getWorkspaceRole: vi.fn().mockResolvedValue('owner'),
}));

vi.mock('../../utils/convex-client', () => ({
    getConvexClient: getConvexClientMock,
}));

vi.mock('~~/convex/_generated/api', () => ({
    api: {
        workspaces: {
            resolveSession: 'workspaces.resolveSession',
            ensure: 'workspaces.ensure',
        },
    },
}));

vi.mock('../deployment-admin', () => ({
    getDeploymentAdminChecker: () => adminCheckerMock,
}));

// Mock AuthWorkspaceStore registry with controllable mock
vi.mock('../store/registry', () => ({
    getAuthWorkspaceStore: () => authWorkspaceStoreMock,
}));

const PROVIDER_ID = 'test-provider';

registerAuthProvider({
    id: PROVIDER_ID,
    create: () => ({
        name: PROVIDER_ID,
        getSession: async () => ({
            provider: PROVIDER_ID,
            user: { id: 'user-1', email: 'user@test.com', displayName: 'User' },
            expiresAt: new Date(Date.now() + 60_000),
            claims: { exp: Math.floor(Date.now() / 1000) + 60 },
        }),
    }),
});

function makeEvent(): H3Event {
    return {
        context: {},
        node: { req: { socket: { remoteAddress: '127.0.0.1' } } },
    } as H3Event;
}

describe('resolveSessionContext provisioning failure modes', () => {
    beforeEach(() => {
        getConvexClientMock.mockReset();
        // Reset store mock to success defaults
        authWorkspaceStoreMock.getOrCreateUser.mockReset().mockResolvedValue({ id: 'user-1' });
        authWorkspaceStoreMock.getOrCreateDefaultWorkspace.mockReset().mockResolvedValue({ id: 'ws-1', name: 'Default', role: 'owner' });
        authWorkspaceStoreMock.getWorkspaceRole.mockReset().mockResolvedValue('owner');
        
        testRuntimeConfig.value = {
            ...testRuntimeConfig.value,
            auth: {
                ...testRuntimeConfig.value.auth,
                enabled: true,
                provider: PROVIDER_ID,
            },
        };
    });

    it('returns unauthenticated when sessionProvisioningFailure=unauthenticated', async () => {
        testRuntimeConfig.value = {
            ...testRuntimeConfig.value,
            auth: {
                ...testRuntimeConfig.value.auth,
                sessionProvisioningFailure: 'unauthenticated',
            },
        };

        // Make the store throw to simulate provisioning failure
        authWorkspaceStoreMock.getOrCreateDefaultWorkspace.mockRejectedValueOnce(new Error('boom'));

        const session = await resolveSessionContext(makeEvent());

        expect(session.authenticated).toBe(false);
    });

    it('throws 503 when sessionProvisioningFailure=service-unavailable', async () => {
        testRuntimeConfig.value = {
            ...testRuntimeConfig.value,
            auth: {
                ...testRuntimeConfig.value.auth,
                sessionProvisioningFailure: 'service-unavailable',
            },
        };

        // Make the store throw to simulate provisioning failure
        authWorkspaceStoreMock.getOrCreateDefaultWorkspace.mockRejectedValueOnce(new Error('boom'));

        await expect(resolveSessionContext(makeEvent())).rejects.toMatchObject({
            statusCode: 503,
        });
    });

    it('throws original error when sessionProvisioningFailure=throw', async () => {
        testRuntimeConfig.value = {
            ...testRuntimeConfig.value,
            auth: {
                ...testRuntimeConfig.value.auth,
                sessionProvisioningFailure: 'throw',
            },
        };

        // Make the store throw to simulate provisioning failure
        authWorkspaceStoreMock.getOrCreateDefaultWorkspace.mockRejectedValueOnce(new Error('boom'));

        await expect(resolveSessionContext(makeEvent())).rejects.toThrow('boom');
    });
});
