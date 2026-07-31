import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';

vi.mock('h3', () => ({
    defineEventHandler: (handler: unknown) => handler,
    createError: (opts: { statusCode: number; statusMessage?: string }) => {
        const err = new Error(opts.statusMessage ?? 'Error') as Error & {
            statusCode: number;
        };
        err.statusCode = opts.statusCode;
        return err;
    },
}));

const requireWorkspaceSessionMock = vi.fn();
const listUserWorkspacesMock = vi.fn();
vi.mock('../_helpers', () => ({
    requireWorkspaceSession: (...args: unknown[]) => requireWorkspaceSessionMock(...args),
    resolveWorkspaceStore: () => ({
        listUserWorkspaces: (...args: unknown[]) => listUserWorkspacesMock(...args),
    }),
}));

function makeEvent(): H3Event {
    return { context: {} } as H3Event;
}

describe('GET /api/workspaces', () => {
    beforeEach(() => {
        requireWorkspaceSessionMock.mockReset().mockResolvedValue({
            authenticated: true,
            user: { id: 'user-1' },
            workspace: { id: 'ws-active' },
        });
        listUserWorkspacesMock.mockReset().mockResolvedValue([]);
    });

    it('returns 401 when user id is missing', async () => {
        const handler = (await import('../index.get')).default as (event: H3Event) => Promise<unknown>;
        requireWorkspaceSessionMock.mockResolvedValue({ authenticated: true, user: undefined });

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 401 });
    });

    it('normalizes workspace fields with defaults', async () => {
        const handler = (await import('../index.get')).default as (event: H3Event) => Promise<unknown>;
        listUserWorkspacesMock.mockResolvedValue([
            { id: 'ws-1', name: 'A', role: 'editor' },
        ]);

        await expect(handler(makeEvent())).resolves.toEqual({
            workspaces: [
                {
                    id: 'ws-1',
                    name: 'A',
                    description: null,
                    role: 'editor',
                    createdAt: 0,
                    isActive: false,
                },
            ],
        });
    });

    it('sorts workspaces by createdAt descending', async () => {
        const handler = (await import('../index.get')).default as (event: H3Event) => Promise<unknown>;
        listUserWorkspacesMock.mockResolvedValue([
            { id: 'ws-older', name: 'Older', role: 'viewer', createdAt: 1 },
            { id: 'ws-newer', name: 'Newer', role: 'owner', createdAt: 5 },
        ]);

        await expect(handler(makeEvent())).resolves.toEqual({
            workspaces: [
                {
                    id: 'ws-newer',
                    name: 'Newer',
                    description: null,
                    role: 'owner',
                    createdAt: 5,
                    isActive: false,
                },
                {
                    id: 'ws-older',
                    name: 'Older',
                    description: null,
                    role: 'viewer',
                    createdAt: 1,
                    isActive: false,
                },
            ],
        });
    });

    it('returns empty list when no workspaces found', async () => {
        const handler = (await import('../index.get')).default as (event: H3Event) => Promise<unknown>;
        listUserWorkspacesMock.mockResolvedValue([]);

        await expect(handler(makeEvent())).resolves.toEqual({ workspaces: [] });
    });

    it('propagates store failure', async () => {
        const handler = (await import('../index.get')).default as (event: H3Event) => Promise<unknown>;
        listUserWorkspacesMock.mockRejectedValue(new Error('store failure'));

        await expect(handler(makeEvent())).rejects.toThrow('store failure');
    });
});
