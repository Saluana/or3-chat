import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    readBody: vi.fn(),
    runAction: vi.fn(),
    getWorkspace: vi.fn(),
    session: { authenticated: true, provider: 'admin', role: 'owner', user: { id: 'operator' } },
}));
vi.mock('h3', async (importOriginal) => ({
    ...await importOriginal<typeof import('h3')>(),
    defineEventHandler: (handler: unknown) => handler,
    readBody: mocks.readBody,
}));
vi.mock('../../../../admin/api', () => ({
    requireAdminApi: async () => mocks.session,
    getAdminContext: () => ({ principal: { kind: 'super_admin', username: 'operator' } }),
}));
vi.mock('../../../../admin/providers/registry', () => ({
    getProviderAdminAdapter: () => ({ runAction: mocks.runAction }),
}));
vi.mock('../../../../admin/stores/registry', () => ({
    getWorkspaceAccessStore: () => ({ getWorkspace: mocks.getWorkspace }),
}));

const { default: route } = await import('../provider-action.post');

describe('workspace storage usage action', () => {
    // Failure modes: a deployment administrator has no workspace session; an
    // absent, unknown, or deleted target reaches the provider; scope leaks into
    // the administrator session or an unrelated maintenance action.
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('useRuntimeConfig', () => ({
            auth: { provider: 'basic-auth', enabled: true },
            sync: { provider: 'sqlite', enabled: true },
            storage: { provider: 'fs', enabled: true },
        }));
        mocks.runAction.mockResolvedValue({ filesystem: { complete: true } });
        mocks.getWorkspace.mockImplementation(async ({ workspaceId }) => workspaceId === 'missing' ? null : {
            id: workspaceId, name: 'Selected workspace', deleted: workspaceId === 'deleted',
        });
    });
    afterEach(() => { vi.unstubAllGlobals(); });

    it('observes the selected workspace without changing the deployment admin session', async () => {
        mocks.readBody.mockResolvedValue({ kind: 'storage', actionId: 'storage.usage', workspaceId: 'selected', payload: { limit: 50 } });
        await expect(route({} as never)).resolves.toMatchObject({ ok: true });
        expect(mocks.runAction).toHaveBeenCalledWith({}, 'storage.usage', { limit: 50 }, expect.objectContaining({
            session: expect.objectContaining({ workspace: { id: 'selected', name: 'Selected workspace' } }),
        }));
        expect(mocks.session).not.toHaveProperty('workspace');
    });

    it.each([
        [undefined, 400], [' ', 400], ['missing', 404], ['deleted', 404],
    ])('rejects unavailable workspace %s before reading storage', async (workspaceId, statusCode) => {
        mocks.readBody.mockResolvedValue({ kind: 'storage', actionId: 'storage.usage', workspaceId });
        await expect(route({} as never)).rejects.toMatchObject({ statusCode });
        expect(mocks.runAction).not.toHaveBeenCalled();
    });

    it('keeps unrelated maintenance actions independent of workspace selection', async () => {
        mocks.readBody.mockResolvedValue({ kind: 'auth', actionId: 'auth.inspect' });
        await route({} as never);
        expect(mocks.getWorkspace).not.toHaveBeenCalled();
        expect(mocks.runAction).toHaveBeenCalledWith({}, 'auth.inspect', undefined, expect.objectContaining({ session: mocks.session }));
    });
});
