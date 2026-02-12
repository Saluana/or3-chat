import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';

const readBodyMock = vi.fn();
const setResponseHeaderMock = vi.fn();
const setHeaderMock = vi.fn();

vi.mock('h3', () => ({
    defineEventHandler: (handler: unknown) => handler,
    readBody: readBodyMock,
    setResponseHeader: setResponseHeaderMock,
    setHeader: setHeaderMock,
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

const isStorageEnabledMock = vi.fn(() => true);
vi.mock('../../../utils/storage/is-storage-enabled', () => ({
    isStorageEnabled: isStorageEnabledMock as any,
}));

const checkSyncRateLimitMock = vi.fn();
const recordSyncRequestMock = vi.fn();
vi.mock('../../../utils/sync/rate-limiter', () => ({
    checkSyncRateLimit: checkSyncRateLimitMock as any,
    recordSyncRequest: recordSyncRequestMock as any,
}));

const recordUploadCompleteMock = vi.fn();
vi.mock('../../../utils/storage/metrics', () => ({
    recordUploadComplete: recordUploadCompleteMock as any,
}));

const commitMock = vi.fn();
const getActiveStorageGatewayAdapterMock = vi.fn();
vi.mock('../../../storage/gateway/registry', () => ({
    getActiveStorageGatewayAdapter: getActiveStorageGatewayAdapterMock as any,
}));

function makeEvent(): H3Event {
    return { context: {}, node: { req: { headers: {} } } } as H3Event;
}

function makeValidBody() {
    return {
        workspace_id: 'ws-1',
        hash: 'sha256:abc',
        storage_id: 'storage-1',
        storage_provider_id: 'convex',
        mime_type: 'image/png',
        size_bytes: 100,
        name: 'file.png',
        kind: 'image',
        width: 100,
        height: 100,
    };
}

describe('POST /api/storage/commit', () => {
    beforeEach(() => {
        readBodyMock.mockReset();
        setResponseHeaderMock.mockReset();
        setHeaderMock.mockReset();
        resolveSessionContextMock.mockReset().mockResolvedValue({
            authenticated: true,
            user: { id: 'user-1' },
            workspace: { id: 'ws-1' },
        });
        requireCanMock.mockReset();
        isSsrAuthEnabledMock.mockReset().mockReturnValue(true);
        isStorageEnabledMock.mockReset().mockReturnValue(true);
        checkSyncRateLimitMock.mockReset().mockReturnValue({ allowed: true, remaining: 10 });
        recordSyncRequestMock.mockReset();
        recordUploadCompleteMock.mockReset();
        commitMock.mockReset().mockResolvedValue(undefined);
        getActiveStorageGatewayAdapterMock.mockReset().mockReturnValue({
            id: 'adapter-1',
            commit: commitMock as any,
        });
    });

    it('returns 404 when auth or storage is disabled', async () => {
        const handler = (await import('../commit.post')).default as (event: H3Event) => Promise<unknown>;

        isSsrAuthEnabledMock.mockReturnValue(false);
        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 404 });

        isSsrAuthEnabledMock.mockReturnValue(true);
        isStorageEnabledMock.mockReturnValue(false);
        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 404 });
    });

    it('returns 400 for invalid request body', async () => {
        const handler = (await import('../commit.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue({ workspace_id: 'ws-1' });

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 400 });
    });

    it('returns 401 when user id is missing', async () => {
        const handler = (await import('../commit.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue(makeValidBody());
        resolveSessionContextMock.mockResolvedValue({ authenticated: true, workspace: { id: 'ws-1' } });

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 401 });
    });

    it('returns 403 when workspace.write permission fails', async () => {
        const handler = (await import('../commit.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue(makeValidBody());
        requireCanMock.mockImplementation(() => {
            const err = new Error('Forbidden') as Error & { statusCode: number };
            err.statusCode = 403;
            throw err;
        });

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 403 });
    });

    it('returns 429 when rate limit is exceeded', async () => {
        const handler = (await import('../commit.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue(makeValidBody());
        checkSyncRateLimitMock.mockReturnValue({
            allowed: false,
            remaining: 0,
            retryAfterMs: 2000,
        });

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 429 });
        expect(setResponseHeaderMock).toHaveBeenCalledWith(expect.anything(), 'Retry-After', 2);
    });

    it('returns 500 when adapter is missing', async () => {
        const handler = (await import('../commit.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue(makeValidBody());
        getActiveStorageGatewayAdapterMock.mockReturnValue(null);

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 500 });
    });

    it('does not call adapter commit when capability is missing (no-op)', async () => {
        const handler = (await import('../commit.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue(makeValidBody());
        getActiveStorageGatewayAdapterMock.mockReturnValue({ id: 'adapter-1' });

        await expect(handler(makeEvent())).resolves.toEqual({ ok: true });
        expect(commitMock).not.toHaveBeenCalled();
    });

    it('calls adapter commit when available', async () => {
        const handler = (await import('../commit.post')).default as (event: H3Event) => Promise<unknown>;
        const body = makeValidBody();
        readBodyMock.mockResolvedValue(body);

        await expect(handler(makeEvent())).resolves.toEqual({ ok: true });
        expect(commitMock).toHaveBeenCalledWith(expect.anything(), body);
    });

    it('records metrics and sync accounting only on success', async () => {
        const handler = (await import('../commit.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue(makeValidBody());

        await handler(makeEvent());

        expect(recordSyncRequestMock).toHaveBeenCalledWith('user-1', 'storage:commit');
        expect(recordUploadCompleteMock).toHaveBeenCalledWith(100);

        recordSyncRequestMock.mockClear();
        recordUploadCompleteMock.mockClear();
        checkSyncRateLimitMock.mockReturnValue({ allowed: false, retryAfterMs: 1000 });

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 429 });
        expect(recordSyncRequestMock).not.toHaveBeenCalled();
        expect(recordUploadCompleteMock).not.toHaveBeenCalled();
    });
});
