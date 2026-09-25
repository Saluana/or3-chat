import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    guard: vi.fn(),
    session: vi.fn(),
    body: vi.fn(),
    rate: vi.fn(),
    status: vi.fn(),
    entitlements: vi.fn(),
    list: vi.fn(),
    create: vi.fn(),
}));

vi.mock('h3', () => ({
    defineEventHandler: (handler: unknown) => handler,
    setResponseHeader: vi.fn(),
    createError: (options: { statusCode: number; statusMessage: string }) =>
        Object.assign(new Error(options.statusMessage), { statusCode: options.statusCode }),
}));
vi.mock('../../../../utils/security/cloud-mutation', () => ({ requireCloudMutation: mocks.guard }));
vi.mock('../../../../auth/session', () => ({ resolveSessionContext: mocks.session }));
vi.mock('../../../../auth/can', () => ({ requireSession: vi.fn(), requireCan: vi.fn() }));
vi.mock('../../../../utils/security/limited-json-body', () => ({ readLimitedJsonBody: mocks.body }));
vi.mock('../../../../utils/rate-limit', () => ({ checkRateLimit: mocks.rate }));
vi.mock('../../../../admin/library/route-support', () => ({
    libraryLinkServiceFor: () => Promise.resolve({ service: { status: mocks.status, entitlements: mocks.entitlements } }),
}));
vi.mock('../../../../admin/library/install-requests', () => ({
    LibraryInstallRequestStore: class {
        list() { return mocks.list(); }
        create(input: unknown) { return mocks.create(input); }
    },
}));

const { default: route } = await import('../install-requests.post');
const requestBody = { releaseId: 'rel_fixture_1', pluginId: 'sample.plugin', version: '1.0.0' };
const acquired = { ...requestBody, archiveSha256: `sha256-${'a'.repeat(64)}`, coverageKind: 'update-pass', coverageUntil: '2027-01-01T00:00:00Z', acquiredAt: '2026-09-01T00:00:00Z' };

beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.session.mockResolvedValue({ user: { id: 'buyer-local' }, workspace: { id: 'ws-1' } });
    mocks.body.mockResolvedValue(requestBody);
    mocks.rate.mockResolvedValue(true);
    mocks.status.mockResolvedValue({ state: 'linked', link: { id: 'link-1', accountId: 'buyer-central' } });
    mocks.entitlements.mockResolvedValue({ linked: true, accountId: 'buyer-central', acquired: [acquired] });
    mocks.list.mockResolvedValue([]);
    mocks.create.mockImplementation(async (input) => ({ ...input, id: 'lir_1234567890abcdef1234567890abcdef', expiresAt: Date.now() + 1_000 }));
});

describe('buyer Library install request', () => {
    it('checks same-origin mutation before auth/body and binds the exact acquired release to the current workspace', async () => {
        const result = await route({ context: {} } as never);
        expect(mocks.guard).toHaveBeenCalledOnce();
        expect(mocks.guard.mock.invocationCallOrder[0]).toBeLessThan(mocks.body.mock.invocationCallOrder[0]!);
        expect(mocks.create).toHaveBeenCalledWith({
            buyerUserId: 'buyer-local', workspaceId: 'ws-1', linkId: 'link-1',
            accountId: 'buyer-central', releaseId: 'rel_fixture_1', pluginId: 'sample.plugin',
            version: '1.0.0', archiveSha256: acquired.archiveSha256,
        });
        expect(result).toMatchObject({ request: { id: 'lir_1234567890abcdef1234567890abcdef' } });
    });

    it('rejects an origin guard refusal before reading buyer data', async () => {
        mocks.guard.mockImplementation(() => { throw Object.assign(new Error('Forbidden'), { statusCode: 403 }); });
        await expect(route({ context: {} } as never)).rejects.toMatchObject({ statusCode: 403 });
        expect(mocks.session).not.toHaveBeenCalled();
        expect(mocks.body).not.toHaveBeenCalled();
    });

    it('refuses another marketplace account or an unacquired version', async () => {
        mocks.entitlements.mockResolvedValueOnce({ linked: true, accountId: 'other', acquired: [acquired] });
        await expect(route({ context: {} } as never)).rejects.toMatchObject({ statusCode: 409 });
        mocks.entitlements.mockResolvedValueOnce({ linked: true, accountId: 'buyer-central', acquired: [] });
        await expect(route({ context: {} } as never)).rejects.toMatchObject({ statusCode: 403 });
        expect(mocks.create).not.toHaveBeenCalled();
    });
});
