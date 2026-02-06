import { describe, it, expect, vi, beforeEach } from 'vitest';

const getConvexGatewayClient = vi.fn();
const getConvexAdminGatewayClient = vi.fn();
const useRuntimeConfig = vi.fn();
const resolveProviderToken = vi.fn<(...args: unknown[]) => Promise<string | null>>();
const listProviderTokenBrokerIds = vi.fn<() => string[]>();

vi.mock('~~/packages/or3-provider-convex/src/runtime/server/utils/convex-gateway', () => ({
    getConvexGatewayClient: (...args: any[]) => getConvexGatewayClient(...args),
    getConvexAdminGatewayClient: (...args: any[]) => getConvexAdminGatewayClient(...args),
}));

vi.mock('~~/server/auth/token-broker/resolve', () => ({
    resolveProviderToken: (...args: unknown[]) => resolveProviderToken(...args),
}));

vi.mock('~~/server/auth/token-broker/registry', () => ({
    listProviderTokenBrokerIds: () => listProviderTokenBrokerIds(),
}));

vi.mock('#imports', () => ({
    useRuntimeConfig: (...args: unknown[]) => useRuntimeConfig(...args),
}));

describe('createConvexWorkspaceAccessStore', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getConvexGatewayClient.mockReset();
        getConvexAdminGatewayClient.mockReset();
        useRuntimeConfig.mockReset();
        resolveProviderToken.mockReset();
        listProviderTokenBrokerIds.mockReset();
    });

    it('uses admin key for super_admin without Clerk', async () => {
        useRuntimeConfig.mockReturnValue({
            auth: { provider: 'clerk' },
            sync: { convexAdminKey: 'admin-key', convexUrl: 'https://example.convex.cloud' },
        });
        getConvexAdminGatewayClient.mockReturnValue({
            query: vi.fn().mockResolvedValue([]),
        });
        resolveProviderToken.mockResolvedValue('clerk-token');
        listProviderTokenBrokerIds.mockReturnValue(['clerk']);

        const { createConvexWorkspaceAccessStore } = await import('~~/packages/or3-provider-convex/src/runtime/server/admin/stores/convex-store');
        const event = {
            context: {
                admin: { principal: { kind: 'super_admin', username: 'root' } },
            },
        } as any;

        const store = createConvexWorkspaceAccessStore(event);
        await store.listMembers({ workspaceId: 'workspaces:123' });

        expect(getConvexAdminGatewayClient).toHaveBeenCalledTimes(1);
        expect(resolveProviderToken).not.toHaveBeenCalled();
    });
});
