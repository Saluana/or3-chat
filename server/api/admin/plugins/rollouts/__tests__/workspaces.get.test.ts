import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ list: vi.fn(), query: vi.fn() }));
vi.mock('h3', () => ({
    defineEventHandler: (handler: unknown) => handler,
    getQuery: mocks.query,
    setResponseHeader: vi.fn(),
}));
vi.mock('../../../../../admin/api', () => ({ requireAdminApiContext: async () => ({}) }));
vi.mock('../../../../../admin/stores/registry', () => ({ getWorkspaceAccessStore: () => ({ listWorkspaces: mocks.list }) }));

const { default: route } = await import('../workspaces.get');

describe('rollout workspace picker', () => {
    it('can page beyond the first 2,500 workspaces', async () => {
        mocks.query.mockReturnValue({ page: '101' });
        mocks.list.mockResolvedValue({ items: [], total: 3000 });
        await route({} as never);
        expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ page: 101 }));
    });
});
