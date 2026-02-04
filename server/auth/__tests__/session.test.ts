import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';
import { registerAuthProvider } from '../registry';
import { registerAuthWorkspaceStore } from '../store/registry';
import { resolveSessionContext } from '../session';
import { testRuntimeConfig } from '../../../tests/setup';

const adminCheckerMock = vi.hoisted(() => ({
    checkDeploymentAdmin: vi.fn().mockResolvedValue(false),
}));

vi.mock('../deployment-admin', () => ({
    getDeploymentAdminChecker: () => adminCheckerMock,
}));

const PROVIDER_ID = 'test-provider';
const STORE_ID = 'test-store';

const workspaceStoreMock = {
    getOrCreateUser: vi.fn().mockResolvedValue({ userId: 'user-1' }),
    getOrCreateDefaultWorkspace: vi.fn().mockResolvedValue({ workspaceId: 'ws-1' }),
    getWorkspaceRole: vi.fn().mockResolvedValue('owner'),
    listUserWorkspaces: vi.fn().mockResolvedValue([]),
    getWorkspace: vi.fn().mockResolvedValue({ id: 'ws-1', name: 'Workspace' }),
    createWorkspace: vi.fn().mockResolvedValue({ id: 'ws-1' }),
    updateWorkspace: vi.fn().mockResolvedValue(undefined),
    removeWorkspace: vi.fn().mockResolvedValue(undefined),
    setActiveWorkspace: vi.fn().mockResolvedValue(undefined),
};

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

registerAuthWorkspaceStore({
    id: STORE_ID,
    create: () => workspaceStoreMock,
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
        testRuntimeConfig.value = {
            ...testRuntimeConfig.value,
            auth: {
                ...testRuntimeConfig.value.auth,
                enabled: true,
                provider: PROVIDER_ID,
            },
            sync: {
                ...testRuntimeConfig.value.sync,
                provider: STORE_ID,
            },
        };
        workspaceStoreMock.getOrCreateUser.mockReset();
        workspaceStoreMock.getOrCreateDefaultWorkspace.mockReset();
    });

    it('returns unauthenticated when sessionProvisioningFailure=unauthenticated', async () => {
        testRuntimeConfig.value = {
            ...testRuntimeConfig.value,
            auth: {
                ...testRuntimeConfig.value.auth,
                sessionProvisioningFailure: 'unauthenticated',
            },
        };

        workspaceStoreMock.getOrCreateUser.mockRejectedValueOnce(new Error('boom'));

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

        workspaceStoreMock.getOrCreateUser.mockRejectedValueOnce(new Error('boom'));

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

        workspaceStoreMock.getOrCreateUser.mockRejectedValueOnce(new Error('boom'));

        await expect(resolveSessionContext(makeEvent())).rejects.toThrow('boom');
    });
});
