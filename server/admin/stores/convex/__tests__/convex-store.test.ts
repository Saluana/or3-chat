import { describe, it, expect, vi, beforeEach } from 'vitest';

const getClerkProviderToken = vi.fn<() => Promise<string | null>>();
const getConvexGatewayClient = vi.fn();
const getConvexAdminGatewayClient = vi.fn();
const useRuntimeConfig = vi.fn();

vi.mock('../../../../utils/sync/convex-gateway', () => ({
    getClerkProviderToken: () => getClerkProviderToken(),
    getConvexGatewayClient: (...args: any[]) => getConvexGatewayClient(...args),
    getConvexAdminGatewayClient: (...args: any[]) => getConvexAdminGatewayClient(...args),
}));

vi.mock('#imports', () => ({
    useRuntimeConfig: (...args: unknown[]) => useRuntimeConfig(...args),
}));

describe('createConvexWorkspaceAccessStore', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getClerkProviderToken.mockReset();
        getConvexGatewayClient.mockReset();
        getConvexAdminGatewayClient.mockReset();
        useRuntimeConfig.mockReset();
    });

    it('uses admin key for super_admin without Clerk', async () => {
        useRuntimeConfig.mockReturnValue({
            auth: { provider: 'clerk' },
            sync: { convexAdminKey: 'admin-key', convexUrl: 'https://example.convex.cloud' },
        });
        getConvexAdminGatewayClient.mockReturnValue({
            query: vi.fn().mockResolvedValue([]),
        });
        getClerkProviderToken.mockResolvedValue('clerk-token');

        const { createConvexWorkspaceAccessStore } = await import('../convex-store');
        const event = {
            context: {
                admin: { principal: { kind: 'super_admin', username: 'root' } },
            },
        } as any;

        const store = createConvexWorkspaceAccessStore(event);
        await store.listMembers({ workspaceId: 'workspaces:123' });

        expect(getConvexAdminGatewayClient).toHaveBeenCalledTimes(1);
        expect(getClerkProviderToken).not.toHaveBeenCalled();
    });
});
