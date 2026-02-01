import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';
import { registerAuthProvider } from '../registry';
import { resolveSessionContext } from '../session';
import { testRuntimeConfig } from '../../../tests/setup';

const getConvexClientMock = vi.hoisted(() => vi.fn());
const adminCheckerMock = vi.hoisted(() => ({
    checkDeploymentAdmin: vi.fn().mockResolvedValue(false),
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

        getConvexClientMock.mockReturnValue({
            query: vi.fn().mockRejectedValueOnce(new Error('boom')),
            mutation: vi.fn(),
        });

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

        getConvexClientMock.mockReturnValue({
            query: vi.fn().mockRejectedValueOnce(new Error('boom')),
            mutation: vi.fn(),
        });

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

        getConvexClientMock.mockReturnValue({
            query: vi.fn().mockRejectedValueOnce(new Error('boom')),
            mutation: vi.fn(),
        });

        await expect(resolveSessionContext(makeEvent())).rejects.toThrow('boom');
    });
});
