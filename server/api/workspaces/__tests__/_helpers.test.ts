import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';

vi.mock('h3', () => ({
    createError: (opts: { statusCode: number; statusMessage?: string }) => {
        const err = new Error(opts.statusMessage ?? 'Error') as Error & {
            statusCode: number;
        };
        err.statusCode = opts.statusCode;
        return err;
    },
}));

const isSsrAuthEnabledMock = vi.fn(() => true);
vi.mock('../../../utils/auth/is-ssr-auth-enabled', () => ({
    isSsrAuthEnabled: isSsrAuthEnabledMock as any,
}));

const resolveSessionContextMock = vi.fn();
vi.mock('../../../auth/session', () => ({
    resolveSessionContext: resolveSessionContextMock as any,
}));

const requireCanMock = vi.fn();
vi.mock('../../../auth/can', () => ({
    requireCan: requireCanMock as any,
}));

const getAuthWorkspaceStoreMock = vi.fn();
vi.mock('../../../auth/store/registry', () => ({
    getAuthWorkspaceStore: getAuthWorkspaceStoreMock as any,
}));

const useRuntimeConfigMock = vi.fn();
vi.mock('#imports', () => ({
    useRuntimeConfig: useRuntimeConfigMock as any,
}));

function makeEvent(): H3Event {
    return { context: {} } as H3Event;
}

describe('workspace helpers', () => {
    beforeEach(() => {
        isSsrAuthEnabledMock.mockReset().mockReturnValue(true);
        resolveSessionContextMock.mockReset().mockResolvedValue({
            authenticated: true,
            user: { id: 'user-1' },
            workspace: { id: 'ws-1' },
        });
        requireCanMock.mockReset();
        getAuthWorkspaceStoreMock.mockReset().mockReturnValue({ id: 'store' });
        useRuntimeConfigMock.mockReset().mockReturnValue({
            public: { sync: { provider: 'convex' } },
            sync: { provider: 'convex' },
        });
    });

    it('requireWorkspaceSession returns 404 when SSR auth is disabled', async () => {
        const { requireWorkspaceSession } = await import('../_helpers');
        isSsrAuthEnabledMock.mockReturnValue(false);

        await expect(requireWorkspaceSession(makeEvent())).rejects.toMatchObject({ statusCode: 404 });
    });

    it('requireWorkspaceSession enforces workspace.read', async () => {
        const { requireWorkspaceSession } = await import('../_helpers');

        await requireWorkspaceSession(makeEvent());

        expect(requireCanMock).toHaveBeenCalledWith(
            expect.objectContaining({ authenticated: true }),
            'workspace.read',
            { kind: 'workspace', id: 'ws-1' }
        );
    });

    it('resolveWorkspaceStore prefers config.public.sync.provider', async () => {
        const { resolveWorkspaceStore } = await import('../_helpers');
        useRuntimeConfigMock.mockReturnValue({
            public: { sync: { provider: 'public-provider' } },
            sync: { provider: 'server-provider' },
        });
        getAuthWorkspaceStoreMock.mockReturnValue({ id: 'public-store' });

        const store = resolveWorkspaceStore(makeEvent());

        expect(getAuthWorkspaceStoreMock).toHaveBeenCalledWith('public-provider');
        expect(store).toEqual({ id: 'public-store' });
    });

    it('resolveWorkspaceStore falls back to config.sync.provider then default convex', async () => {
        const { resolveWorkspaceStore } = await import('../_helpers');

        useRuntimeConfigMock.mockReturnValue({ public: {}, sync: { provider: 'server-provider' } });
        resolveWorkspaceStore(makeEvent());
        expect(getAuthWorkspaceStoreMock).toHaveBeenCalledWith('server-provider');

        getAuthWorkspaceStoreMock.mockReset().mockReturnValue({ id: 'convex-store' });
        useRuntimeConfigMock.mockReturnValue({ public: {}, sync: {} });
        resolveWorkspaceStore(makeEvent());
        expect(getAuthWorkspaceStoreMock).toHaveBeenCalledWith('convex');
    });

    it('throws when provider store is missing and includes provider id in message', async () => {
        const { resolveWorkspaceStore } = await import('../_helpers');
        useRuntimeConfigMock.mockReturnValue({
            public: { sync: { provider: 'missing-provider' } },
            sync: {},
        });
        getAuthWorkspaceStoreMock.mockReturnValue(null);

        await expect(async () => resolveWorkspaceStore(makeEvent())).rejects.toMatchObject({
            statusCode: 500,
            message: expect.stringContaining('missing-provider'),
        });
    });
});
