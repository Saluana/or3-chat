import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';

const readBodyMock = vi.fn();

vi.mock('h3', () => ({
    defineEventHandler: (handler: unknown) => handler,
    readBody: (...args: unknown[]) => readBodyMock(...args),
    createError: (opts: { statusCode: number; statusMessage?: string }) => {
        const err = new Error(opts.statusMessage ?? 'Error') as Error & {
            statusCode: number;
        };
        err.statusCode = opts.statusCode;
        return err;
    },
}));

const requireWorkspaceSessionMock = vi.fn();
const setActiveWorkspaceMock = vi.fn();
const listUserWorkspacesMock = vi.fn();
const invalidateSharedSessionCacheForIdentityMock = vi.fn();
vi.mock('../_helpers', () => ({
    requireWorkspaceSession: (...args: unknown[]) => requireWorkspaceSessionMock(...args),
    resolveWorkspaceStore: () => ({
        setActiveWorkspace: (...args: unknown[]) => setActiveWorkspaceMock(...args),
        listUserWorkspaces: (...args: unknown[]) => listUserWorkspacesMock(...args),
    }),
}));
vi.mock('../../../auth/session', () => ({
    invalidateSharedSessionCacheForIdentity: (...args: unknown[]) =>
        invalidateSharedSessionCacheForIdentityMock(...args),
}));
vi.mock('#imports', () => ({
    useRuntimeConfig: () => ({ sync: { provider: 'test-sync' }, public: { sync: { provider: 'test-sync' } } }),
}));

function makeEvent(): H3Event {
    return { context: {} } as H3Event;
}

describe('POST /api/workspaces/active', () => {
    beforeEach(() => {
        readBodyMock.mockReset();
        requireWorkspaceSessionMock.mockReset().mockResolvedValue({
            authenticated: true,
            user: { id: 'user-1' },
            workspace: { id: 'ws-1' },
            role: 'owner',
            provider: 'test-provider',
            providerUserId: 'provider-user-1',
        });
        setActiveWorkspaceMock.mockReset().mockResolvedValue(undefined);
        listUserWorkspacesMock.mockReset().mockResolvedValue([
            { id: 'ws-1', name: 'Workspace 1', role: 'owner' },
            { id: 'ws-2', name: 'Workspace 2', role: 'viewer' },
        ]);
        invalidateSharedSessionCacheForIdentityMock.mockReset();
    });

    it('returns 400 when workspace id is missing', async () => {
        const handler = (await import('../active.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue({});

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 400 });
    });

    it('returns 401 when user is missing', async () => {
        const handler = (await import('../active.post')).default as (event: H3Event) => Promise<unknown>;
        requireWorkspaceSessionMock.mockResolvedValue({ authenticated: true, user: undefined });
        readBodyMock.mockResolvedValue({ id: 'ws-2' });

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 401 });
    });

    it('invokes store with exact user/workspace IDs and returns success shape', async () => {
        const handler = (await import('../active.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue({ id: 'ws-2' });

        await expect(handler(makeEvent())).resolves.toEqual({ ok: true });
        expect(listUserWorkspacesMock).toHaveBeenCalledWith('user-1');
        expect(setActiveWorkspaceMock).toHaveBeenCalledWith({
            userId: 'user-1',
            workspaceId: 'ws-2',
        });
        expect(invalidateSharedSessionCacheForIdentityMock).toHaveBeenCalledWith({
            provider: 'test-provider',
            providerUserId: 'provider-user-1',
            storeId: 'test-sync',
        });
    });

    it('rejects a target workspace where the user has no membership', async () => {
        const handler = (await import('../active.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue({ id: 'ws-other' });

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 403 });
        expect(setActiveWorkspaceMock).not.toHaveBeenCalled();
    });

    it('surfaces store rejection', async () => {
        const handler = (await import('../active.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue({ id: 'ws-2' });
        setActiveWorkspaceMock.mockRejectedValue(new Error('failed'));

        await expect(handler(makeEvent())).rejects.toThrow('failed');
    });
});
