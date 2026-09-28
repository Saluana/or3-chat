import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    requireAdmin: vi.fn(), record: vi.fn(), candidate: vi.fn(), start: vi.fn(), page: vi.fn(),
}));
vi.mock('h3', () => ({
    defineEventHandler: (handler: unknown) => handler,
    getRouterParam: () => 'rol_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    setResponseHeader: vi.fn(),
    createError: (input: { statusCode: number; statusMessage: string; data?: unknown }) =>
        Object.assign(new Error(input.statusMessage), { statusCode: input.statusCode, data: input.data }),
}));
vi.mock('../../../../../utils/security/limited-json-body', () => ({ readLimitedJsonBody: async () => ({ expectedRevision: 1 }) }));
vi.mock('../../../../../admin/api', () => ({ requireAdminApiContext: mocks.requireAdmin }));
vi.mock('../../../../../admin/plugins/rollout-route-support', () => ({
    rolloutCandidateFor: mocks.candidate,
    rolloutCoordinatorFor: () => ({ deps: { records: { read: mocks.record, page: mocks.page } }, start: mocks.start }),
}));

const { default: route } = await import('../[operationId]/start.post');

beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.requireAdmin.mockResolvedValue({});
    mocks.record.mockResolvedValue({ id: 'rol_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', pluginId: 'acme.test', enabled: true });
    mocks.candidate.mockResolvedValue({ candidate: { requestedGrants: [] } });
});

describe('rollout start route', () => {
    it('returns a reviewable 409 when a preview has become stale', async () => {
        mocks.start.mockRejectedValue(Object.assign(new Error('The site approval changed.'), { code: 'rollout-preview-stale' }));
        await expect(route({ context: {} } as never)).rejects.toMatchObject({ statusCode: 409, data: { code: 'rollout-preview-stale' } });
    });
});
