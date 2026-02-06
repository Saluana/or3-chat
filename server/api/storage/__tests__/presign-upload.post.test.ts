import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';

const readBodyMock = vi.fn();
const setResponseHeaderMock = vi.fn();

vi.mock('h3', () => ({
    defineEventHandler: (handler: unknown) => handler,
    readBody: readBodyMock,
    setResponseHeader: setResponseHeaderMock,
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

const recordUploadStartMock = vi.fn();
vi.mock('../../../utils/storage/metrics', () => ({
    recordUploadStart: recordUploadStartMock as any,
}));

const presignUploadMock = vi.fn();
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
        mime_type: 'image/png',
        size_bytes: 1024,
        disposition: 'inline',
    };
}

describe('POST /api/storage/presign-upload', () => {
    beforeEach(() => {
        readBodyMock.mockReset();
        setResponseHeaderMock.mockReset();
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
        recordUploadStartMock.mockReset();
        presignUploadMock.mockReset().mockResolvedValue({
            url: 'https://upload.example',
            expiresAt: 123,
        });
        getActiveStorageGatewayAdapterMock.mockReset().mockReturnValue({
            id: 'adapter-1',
            presignUpload: presignUploadMock as any,
        });
    });

    it('returns 404 when auth or storage is disabled', async () => {
        const handler = (await import('../presign-upload.post')).default as (event: H3Event) => Promise<unknown>;

        isSsrAuthEnabledMock.mockReturnValue(false);
        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 404 });

        isSsrAuthEnabledMock.mockReturnValue(true);
        isStorageEnabledMock.mockReturnValue(false);
        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 404 });
    });

    it('returns 400 for body schema failures', async () => {
        const handler = (await import('../presign-upload.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue({ workspace_id: 'ws-1', hash: 'h' });

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 400 });
    });

    it('returns 401 for unauthenticated session', async () => {
        const handler = (await import('../presign-upload.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue(makeValidBody());
        resolveSessionContextMock.mockResolvedValue({ authenticated: false });

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 401 });
    });

    it('returns 403 on workspace.write denial', async () => {
        const handler = (await import('../presign-upload.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue(makeValidBody());
        requireCanMock.mockImplementation(() => {
            const err = new Error('Forbidden') as Error & { statusCode: number };
            err.statusCode = 403;
            throw err;
        });

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 403 });
    });

    it('returns 429 with Retry-After when rate limited', async () => {
        const handler = (await import('../presign-upload.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue(makeValidBody());
        checkSyncRateLimitMock.mockReturnValue({ allowed: false, retryAfterMs: 2001 });

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 429 });
        expect(setResponseHeaderMock).toHaveBeenCalledWith(expect.anything(), 'Retry-After', 3);
    });

    it('returns 413 when file size exceeds configured max', async () => {
        const handler = (await import('../presign-upload.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue({ ...makeValidBody(), size_bytes: Number.MAX_SAFE_INTEGER });

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 413 });
    });

    it('returns 415 when MIME type is not allowlisted', async () => {
        const handler = (await import('../presign-upload.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue({ ...makeValidBody(), mime_type: 'application/zip' });

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 415 });
    });

    it('returns 500 when adapter is missing', async () => {
        const handler = (await import('../presign-upload.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue(makeValidBody());
        getActiveStorageGatewayAdapterMock.mockReturnValue(null);

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 500 });
    });

    it('maps payload to adapter, records metrics/rate limit, and preserves disposition', async () => {
        const handler = (await import('../presign-upload.post')).default as (event: H3Event) => Promise<unknown>;
        const body = makeValidBody();
        readBodyMock.mockResolvedValue(body);

        await expect(handler(makeEvent())).resolves.toEqual({
            url: 'https://upload.example',
            expiresAt: 123,
            disposition: 'inline',
        });

        expect(presignUploadMock).toHaveBeenCalledWith(expect.anything(), {
            workspaceId: 'ws-1',
            hash: 'sha256:abc',
            mimeType: 'image/png',
            sizeBytes: 1024,
        });
        expect(recordSyncRequestMock).toHaveBeenCalledWith('user-1', 'storage:upload');
        expect(recordUploadStartMock).toHaveBeenCalledTimes(1);
    });
});
