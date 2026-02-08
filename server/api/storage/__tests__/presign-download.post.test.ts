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

const recordDownloadStartMock = vi.fn();
vi.mock('../../../utils/storage/metrics', () => ({
    recordDownloadStart: recordDownloadStartMock as any,
}));

vi.mock('../../../utils/storage/presign-expiry', () => ({
    DEFAULT_PRESIGN_EXPIRY_MS: 60_000,
}));

const presignDownloadMock = vi.fn();
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
        disposition: 'attachment',
    };
}

describe('POST /api/storage/presign-download', () => {
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
        recordDownloadStartMock.mockReset();
        presignDownloadMock.mockReset().mockResolvedValue({
            url: 'https://download.example',
            expiresAt: 9_999,
        });
        getActiveStorageGatewayAdapterMock.mockReset().mockReturnValue({
            id: 'adapter-1',
            presignDownload: presignDownloadMock as any,
        });
    });

    it('returns 404 when auth or storage flags are disabled', async () => {
        const handler = (await import('../presign-download.post')).default as (event: H3Event) => Promise<unknown>;

        isSsrAuthEnabledMock.mockReturnValue(false);
        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 404 });

        isSsrAuthEnabledMock.mockReturnValue(true);
        isStorageEnabledMock.mockReturnValue(false);
        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 404 });
    });

    it('returns 400 for body schema failures', async () => {
        const handler = (await import('../presign-download.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue({ workspace_id: 'ws-1' });

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 400 });
    });

    it('returns 401 when session is unauthenticated', async () => {
        const handler = (await import('../presign-download.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue(makeValidBody());
        resolveSessionContextMock.mockResolvedValue({ authenticated: false });

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 401 });
    });

    it('returns 403 when workspace.read fails', async () => {
        const handler = (await import('../presign-download.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue(makeValidBody());
        requireCanMock.mockImplementation(() => {
            const err = new Error('Forbidden') as Error & { statusCode: number };
            err.statusCode = 403;
            throw err;
        });

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 403 });
    });

    it('returns 429 and Retry-After when rate limited', async () => {
        const handler = (await import('../presign-download.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue(makeValidBody());
        checkSyncRateLimitMock.mockReturnValue({ allowed: false, retryAfterMs: 1900 });

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 429 });
        expect(setResponseHeaderMock).toHaveBeenCalledWith(expect.anything(), 'Retry-After', 2);
    });

    it('returns 500 when adapter is missing', async () => {
        const handler = (await import('../presign-download.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue(makeValidBody());
        getActiveStorageGatewayAdapterMock.mockReturnValue(null);

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 500 });
    });

    it('uses provider expiresAt when provided', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-02-06T12:00:00.000Z'));
        const handler = (await import('../presign-download.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue(makeValidBody());
        presignDownloadMock.mockResolvedValue({
            url: 'https://download.example',
            expiresAt: 777_777,
        });

        await expect(handler(makeEvent())).resolves.toEqual({
            url: 'https://download.example',
            expiresAt: 777_777,
            disposition: 'attachment',
        });

        vi.useRealTimers();
    });

    it('falls back to default expiry when provider omits expiresAt', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-02-06T12:00:00.000Z'));
        const handler = (await import('../presign-download.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue(makeValidBody());
        presignDownloadMock.mockResolvedValue({
            url: 'https://download.example',
            expiresAt: undefined,
        });

        await expect(handler(makeEvent())).resolves.toEqual({
            url: 'https://download.example',
            expiresAt: Date.now() + 60_000,
            disposition: 'attachment',
        });

        vi.useRealTimers();
    });

    it('records metrics and rate limit accounting on success', async () => {
        const handler = (await import('../presign-download.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue(makeValidBody());

        await handler(makeEvent());

        expect(recordSyncRequestMock).toHaveBeenCalledWith('user-1', 'storage:download');
        expect(recordDownloadStartMock).toHaveBeenCalledTimes(1);
    });

    it('passes through download method/headers/storageId from adapter response', async () => {
        const handler = (await import('../presign-download.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue(makeValidBody());
        presignDownloadMock.mockResolvedValue({
            url: '/api/storage/fs/download?token=abc',
            expiresAt: 321,
            method: 'GET',
            headers: { 'x-download': '1' },
            storageId: 'ws-1:sha256:abc',
        });

        await expect(handler(makeEvent())).resolves.toEqual({
            url: '/api/storage/fs/download?token=abc',
            expiresAt: 321,
            disposition: 'attachment',
            method: 'GET',
            headers: { 'x-download': '1' },
            storageId: 'ws-1:sha256:abc',
        });
    });
});
