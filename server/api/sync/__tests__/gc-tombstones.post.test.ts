import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';

const readBodyMock = vi.fn();

vi.mock('h3', () => ({
    defineEventHandler: (handler: unknown) => handler,
    readBody: readBodyMock,
    createError: (opts: { statusCode: number; statusMessage?: string }) => {
        const err = new Error(opts.statusMessage ?? 'Error') as Error & {
            statusCode: number;
        };
        err.statusCode = opts.statusCode;
        return err;
    },
}));

const resolveSessionContextMock = vi.fn();
vi.mock('../../../auth/session', () => ({
    resolveSessionContext: resolveSessionContextMock as any,
}));

const requireCanMock = vi.fn();
vi.mock('../../../auth/can', () => ({
    requireCan: requireCanMock as any,
}));

const isSsrAuthEnabledMock = vi.fn(() => true);
vi.mock('../../../utils/auth/is-ssr-auth-enabled', () => ({
    isSsrAuthEnabled: isSsrAuthEnabledMock as any,
}));

const isSyncEnabledMock = vi.fn(() => true);
vi.mock('../../../utils/sync/is-sync-enabled', () => ({
    isSyncEnabled: isSyncEnabledMock as any,
}));

const gcTombstonesMock = vi.fn();
const getActiveSyncGatewayAdapterMock = vi.fn();
vi.mock('../../../sync/gateway/registry', () => ({
    getActiveSyncGatewayAdapter: getActiveSyncGatewayAdapterMock as any,
}));

function makeEvent(): H3Event {
    return { context: {}, node: { req: { headers: {} } } } as H3Event;
}

function makeValidBody() {
    return {
        scope: { workspaceId: 'ws-1' },
        retentionSeconds: 3600,
    };
}

describe('POST /api/sync/gc-tombstones', () => {
    beforeEach(() => {
        readBodyMock.mockReset();
        resolveSessionContextMock.mockReset().mockResolvedValue({
            authenticated: true,
            user: { id: 'user-1' },
            workspace: { id: 'ws-1' },
        });
        requireCanMock.mockReset();
        isSsrAuthEnabledMock.mockReset().mockReturnValue(true);
        isSyncEnabledMock.mockReset().mockReturnValue(true);
        gcTombstonesMock.mockReset().mockResolvedValue({ deletedCount: 3 });
        getActiveSyncGatewayAdapterMock.mockReset().mockReturnValue({
            id: 'adapter-1',
            gcTombstones: gcTombstonesMock as any,
        });
    });

    it('returns 400 for invalid schema (retentionSeconds <= 0)', async () => {
        const handler = (await import('../gc-tombstones.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue({ scope: { workspaceId: 'ws-1' }, retentionSeconds: 0 });

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 400 });
    });

    it('enforces permission and returns 403 when denied', async () => {
        const handler = (await import('../gc-tombstones.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue(makeValidBody());
        requireCanMock.mockImplementation(() => {
            const err = new Error('Forbidden') as Error & { statusCode: number };
            err.statusCode = 403;
            throw err;
        });

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 403 });
    });

    it('returns 500 when adapter is missing', async () => {
        const handler = (await import('../gc-tombstones.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue(makeValidBody());
        getActiveSyncGatewayAdapterMock.mockReturnValue(null);

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 500 });
    });

    it('returns 501 when adapter does not support gcTombstones', async () => {
        const handler = (await import('../gc-tombstones.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue(makeValidBody());
        getActiveSyncGatewayAdapterMock.mockReturnValue({ id: 'adapter-1' });

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 501 });
    });

    it('passes through successful adapter result', async () => {
        const handler = (await import('../gc-tombstones.post')).default as (event: H3Event) => Promise<unknown>;
        const body = makeValidBody();
        readBodyMock.mockResolvedValue(body);

        await expect(handler(makeEvent())).resolves.toEqual({ deletedCount: 3 });
        expect(gcTombstonesMock).toHaveBeenCalledWith(expect.anything(), body);
    });
});
