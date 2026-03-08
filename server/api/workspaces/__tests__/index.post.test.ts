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
const createWorkspaceMock = vi.fn();
const provisionWorkspaceDefaultsMock = vi.fn();
vi.mock('../_helpers', () => ({
    requireWorkspaceSession: (...args: unknown[]) => requireWorkspaceSessionMock(...args),
    resolveWorkspaceStore: () => ({
        createWorkspace: (...args: unknown[]) => createWorkspaceMock(...args),
    }),
}));
vi.mock('../../../workspaces/provisioning', () => ({
    provisionWorkspaceDefaults: (...args: unknown[]) => provisionWorkspaceDefaultsMock(...args),
}));

function makeEvent(): H3Event {
    return { context: {} } as H3Event;
}

describe('POST /api/workspaces', () => {
    beforeEach(() => {
        readBodyMock.mockReset();
        requireWorkspaceSessionMock.mockReset().mockResolvedValue({
            authenticated: true,
            user: { id: 'user-1' },
            workspace: { id: 'ws-1' },
        });
        createWorkspaceMock.mockReset().mockResolvedValue({ workspaceId: 'ws-created' });
        provisionWorkspaceDefaultsMock.mockReset().mockResolvedValue(undefined);
    });

    it('returns 400 for missing/blank name', async () => {
        const handler = (await import('../index.post')).default as (event: H3Event) => Promise<unknown>;

        readBodyMock.mockResolvedValue({ name: '' });
        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 400 });

        readBodyMock.mockResolvedValue({ name: '   ' });
        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 400 });
    });

    it('returns 400 for overlong name and description', async () => {
        const handler = (await import('../index.post')).default as (event: H3Event) => Promise<unknown>;

        readBodyMock.mockResolvedValue({ name: 'a'.repeat(101) });
        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 400 });

        readBodyMock.mockResolvedValue({ name: 'ok', description: 'd'.repeat(1001) });
        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 400 });
    });

    it('trims whitespace and passes normalized payload to store', async () => {
        const handler = (await import('../index.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue({
            name: '  New Workspace  ',
            description: '  Desc  ',
        });

        await expect(handler(makeEvent())).resolves.toEqual({ id: 'ws-created' });

        expect(createWorkspaceMock).toHaveBeenCalledWith({
            userId: 'user-1',
            name: 'New Workspace',
            description: 'Desc',
        });
        expect(provisionWorkspaceDefaultsMock).toHaveBeenCalledWith(
            expect.any(Object),
            'ws-created'
        );
    });

    it('returns 401 when session user is missing', async () => {
        const handler = (await import('../index.post')).default as (event: H3Event) => Promise<unknown>;
        requireWorkspaceSessionMock.mockResolvedValue({ authenticated: true, user: undefined });
        readBodyMock.mockResolvedValue({ name: 'Valid Name' });

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 401 });
    });

    it('surfaces store errors predictably', async () => {
        const handler = (await import('../index.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue({ name: 'Valid Name' });
        createWorkspaceMock.mockRejectedValue(new Error('store failed'));

        await expect(handler(makeEvent())).rejects.toThrow('store failed');
    });

    it('surfaces provisioning errors predictably', async () => {
        const handler = (await import('../index.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue({ name: 'Valid Name' });
        provisionWorkspaceDefaultsMock.mockRejectedValue(new Error('provision failed'));

        await expect(handler(makeEvent())).rejects.toThrow('provision failed');
    });
});
