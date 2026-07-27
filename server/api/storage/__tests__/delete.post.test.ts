import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';

const readBodyMock = vi.fn();
vi.mock('h3', () => ({
    defineEventHandler: (handler: unknown) => handler,
    readBody: readBodyMock,
    createError: (opts: { statusCode: number; statusMessage?: string }) =>
        Object.assign(new Error(opts.statusMessage), { statusCode: opts.statusCode }),
}));

const resolveSessionContextMock = vi.fn();
vi.mock('../../../auth/session', () => ({
    resolveSessionContext: resolveSessionContextMock,
}));

const requireCanMock = vi.fn();
vi.mock('../../../auth/can', () => ({ requireCan: requireCanMock }));

const isSsrAuthEnabledMock = vi.fn();
vi.mock('../../../utils/auth/is-ssr-auth-enabled', () => ({
    isSsrAuthEnabled: isSsrAuthEnabledMock,
}));

const isStorageEnabledMock = vi.fn();
vi.mock('../../../utils/storage/is-storage-enabled', () => ({
    isStorageEnabled: isStorageEnabledMock,
}));

const deleteObjectMock = vi.fn();
const getActiveStorageGatewayAdapterMock = vi.fn();
vi.mock('../../../storage/gateway/registry', () => ({
    getActiveStorageGatewayAdapter: getActiveStorageGatewayAdapterMock,
}));

const event = { context: {}, node: { req: { headers: {} } } } as H3Event;

async function handler() {
    return (await import('../delete.post')).default as (event: H3Event) => Promise<unknown>;
}

describe('POST /api/storage/delete', () => {
    beforeEach(() => {
        vi.resetModules();
        readBodyMock.mockReset().mockResolvedValue({
            workspace_id: 'ws-1',
            hash: 'sha256:abc',
            storage_id: 'ws-1/sha256:abc',
        });
        resolveSessionContextMock.mockReset().mockResolvedValue({
            authenticated: true,
            user: { id: 'user-1' },
            workspace: { id: 'ws-1' },
        });
        requireCanMock.mockReset();
        isSsrAuthEnabledMock.mockReset().mockReturnValue(true);
        isStorageEnabledMock.mockReset().mockReturnValue(true);
        deleteObjectMock.mockReset().mockResolvedValue(undefined);
        getActiveStorageGatewayAdapterMock.mockReset().mockReturnValue({
            id: 'test',
            deleteObject: deleteObjectMock,
        });
    });

    it('requires workspace.write for the requested workspace before dispatch', async () => {
        const route = await handler();
        await expect(route(event)).resolves.toEqual({ ok: true });

        expect(requireCanMock).toHaveBeenCalledWith(
            expect.objectContaining({ authenticated: true }),
            'workspace.write',
            { kind: 'workspace', id: 'ws-1' },
        );
        expect(deleteObjectMock).toHaveBeenCalledWith(event, {
            workspaceId: 'ws-1',
            hash: 'sha256:abc',
            storageId: 'ws-1/sha256:abc',
        });
        expect(requireCanMock.mock.invocationCallOrder[0]).toBeLessThan(
            deleteObjectMock.mock.invocationCallOrder[0]!,
        );
    });

    it('does not dispatch when authorization denies cross-workspace access', async () => {
        requireCanMock.mockImplementation(() => {
            throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
        });
        const route = await handler();

        await expect(route(event)).rejects.toMatchObject({ statusCode: 403 });
        expect(deleteObjectMock).not.toHaveBeenCalled();
    });

    it('returns 401 for an unauthenticated session', async () => {
        resolveSessionContextMock.mockResolvedValue({ authenticated: false });
        const route = await handler();

        await expect(route(event)).rejects.toMatchObject({ statusCode: 401 });
        expect(requireCanMock).not.toHaveBeenCalled();
        expect(deleteObjectMock).not.toHaveBeenCalled();
    });

    it('rejects malformed or over-posted input', async () => {
        readBodyMock.mockResolvedValue({
            workspace_id: 'ws-1',
            hash: '',
            unexpected: true,
        });
        const route = await handler();

        await expect(route(event)).rejects.toMatchObject({ statusCode: 400 });
        expect(deleteObjectMock).not.toHaveBeenCalled();
    });

    it('returns 501 when the active provider cannot delete objects', async () => {
        getActiveStorageGatewayAdapterMock.mockReturnValue({ id: 'readonly' });
        const route = await handler();

        await expect(route(event)).rejects.toMatchObject({ statusCode: 501 });
    });

    it('is repeatable when the adapter implements idempotent deletion', async () => {
        const route = await handler();

        await expect(route(event)).resolves.toEqual({ ok: true });
        await expect(route(event)).resolves.toEqual({ ok: true });
        expect(deleteObjectMock).toHaveBeenCalledTimes(2);
    });
});
