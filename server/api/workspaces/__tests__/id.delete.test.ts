import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';

const getRouterParamMock = vi.fn();

vi.mock('h3', () => ({
    defineEventHandler: (handler: unknown) => handler,
    getRouterParam: (...args: unknown[]) => getRouterParamMock(...args),
    createError: (opts: { statusCode: number; statusMessage?: string }) => {
        const err = new Error(opts.statusMessage ?? 'Error') as Error & {
            statusCode: number;
        };
        err.statusCode = opts.statusCode;
        return err;
    },
}));

const requireWorkspaceSessionMock = vi.fn();
const removeWorkspaceMock = vi.fn();
vi.mock('../_helpers', () => ({
    requireWorkspaceSession: (...args: unknown[]) => requireWorkspaceSessionMock(...args),
    resolveWorkspaceStore: () => ({
        removeWorkspace: (...args: unknown[]) => removeWorkspaceMock(...args),
    }),
}));

function makeEvent(): H3Event {
    return { context: {} } as H3Event;
}

describe('DELETE /api/workspaces/:id', () => {
    beforeEach(() => {
        getRouterParamMock.mockReset().mockReturnValue('ws-2');
        requireWorkspaceSessionMock.mockReset().mockResolvedValue({
            authenticated: true,
            user: { id: 'user-1' },
            workspace: { id: 'ws-1' },
            role: 'owner',
        });
        removeWorkspaceMock.mockReset().mockResolvedValue(undefined);
    });

    it('requires workspace id', async () => {
        const handler = (await import('../[id].delete')).default as (event: H3Event) => Promise<unknown>;
        getRouterParamMock.mockReturnValue(undefined);

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 400 });
    });

    it('uses permission-validated helper session', async () => {
        const handler = (await import('../[id].delete')).default as (event: H3Event) => Promise<unknown>;

        await handler(makeEvent());

        expect(requireWorkspaceSessionMock).toHaveBeenCalledTimes(1);
    });

    it('returns 401 when user is missing', async () => {
        const handler = (await import('../[id].delete')).default as (event: H3Event) => Promise<unknown>;
        requireWorkspaceSessionMock.mockResolvedValue({ authenticated: true, user: undefined });

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 401 });
    });

    it('invokes store and returns success contract', async () => {
        const handler = (await import('../[id].delete')).default as (event: H3Event) => Promise<unknown>;

        await expect(handler(makeEvent())).resolves.toEqual({ ok: true });
        expect(removeWorkspaceMock).toHaveBeenCalledWith({
            userId: 'user-1',
            workspaceId: 'ws-2',
        });
    });

    it('surfaces delete restriction/store errors', async () => {
        const handler = (await import('../[id].delete')).default as (event: H3Event) => Promise<unknown>;
        removeWorkspaceMock.mockRejectedValue(new Error('cannot delete default workspace'));

        await expect(handler(makeEvent())).rejects.toThrow('cannot delete default workspace');
    });
});
