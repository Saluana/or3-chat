import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';

const readBodyMock = vi.fn();
const getRouterParamMock = vi.fn();

vi.mock('h3', () => ({
    defineEventHandler: (handler: unknown) => handler,
    readBody: (...args: unknown[]) => readBodyMock(...args),
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
const updateWorkspaceMock = vi.fn();
vi.mock('../_helpers', () => ({
    requireWorkspaceSession: (...args: unknown[]) => requireWorkspaceSessionMock(...args),
    resolveWorkspaceStore: () => ({
        updateWorkspace: (...args: unknown[]) => updateWorkspaceMock(...args),
    }),
}));

function makeEvent(): H3Event {
    return { context: {} } as H3Event;
}

describe('PATCH /api/workspaces/:id', () => {
    beforeEach(() => {
        readBodyMock.mockReset();
        getRouterParamMock.mockReset().mockReturnValue('ws-2');
        requireWorkspaceSessionMock.mockReset().mockResolvedValue({
            authenticated: true,
            user: { id: 'user-1' },
            workspace: { id: 'ws-1' },
            role: 'owner',
        });
        updateWorkspaceMock.mockReset().mockResolvedValue(undefined);
    });

    it('validates workspace id extraction', async () => {
        const handler = (await import('../[id].patch')).default as (event: H3Event) => Promise<unknown>;
        getRouterParamMock.mockReturnValue(undefined);

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 400 });
    });

    it('validates name and description limits', async () => {
        const handler = (await import('../[id].patch')).default as (event: H3Event) => Promise<unknown>;

        readBodyMock.mockResolvedValue({ name: '   ' });
        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 400 });

        readBodyMock.mockResolvedValue({ name: 'n'.repeat(101) });
        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 400 });

        readBodyMock.mockResolvedValue({ name: 'ok', description: 'd'.repeat(1001) });
        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 400 });
    });

    it('uses session from helper (permissions/role enforced upstream)', async () => {
        const handler = (await import('../[id].patch')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue({ name: 'Name', description: 'Desc' });

        await handler(makeEvent());

        expect(requireWorkspaceSessionMock).toHaveBeenCalledTimes(1);
    });

    it('trims inputs and updates workspace with exact payload', async () => {
        const handler = (await import('../[id].patch')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue({ name: '  Name  ', description: '  Desc  ' });

        await expect(handler(makeEvent())).resolves.toEqual({ ok: true });

        expect(updateWorkspaceMock).toHaveBeenCalledWith({
            userId: 'user-1',
            workspaceId: 'ws-2',
            name: 'Name',
            description: 'Desc',
        });
    });

    it('returns 401 when helper session has no user', async () => {
        const handler = (await import('../[id].patch')).default as (event: H3Event) => Promise<unknown>;
        requireWorkspaceSessionMock.mockResolvedValue({ authenticated: true, user: undefined });
        readBodyMock.mockResolvedValue({ name: 'Name' });

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 401 });
    });

    it('propagates store errors', async () => {
        const handler = (await import('../[id].patch')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue({ name: 'Name' });
        updateWorkspaceMock.mockRejectedValue(new Error('update failed'));

        await expect(handler(makeEvent())).rejects.toThrow('update failed');
    });
});
