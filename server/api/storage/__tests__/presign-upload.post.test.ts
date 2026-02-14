import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';

const readBodyMock = vi.fn();
const setResponseHeaderMock = vi.fn();
const setHeaderMock = vi.fn();
const useRuntimeConfigMock = vi.fn();

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

vi.mock('#imports', () => ({
    useRuntimeConfig: useRuntimeConfigMock as any,
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

const getWorkspaceStorageUsageSnapshotMock = vi.fn();
vi.mock('../../../utils/storage/quota', () => ({
    getWorkspaceStorageUsageSnapshot: getWorkspaceStorageUsageSnapshotMock as any,
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
        expires_in_ms: 12_345,
        disposition: 'inline',
    };
}

describe('POST /api/storage/presign-upload', () => {
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
        recordUploadStartMock.mockReset();
        useRuntimeConfigMock.mockReset().mockReturnValue({
            storage: {
                allowedMimeTypes: undefined,
                workspaceQuotaBytes: undefined,
            },
        });
        getWorkspaceStorageUsageSnapshotMock.mockReset().mockResolvedValue({
            usedBytes: 0,
            filesByHash: new Map<string, number>(),
        });
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

    it('returns 400 for invalid expires_in_ms bounds/type', async () => {
        const handler = (await import('../presign-upload.post')).default as (event: H3Event) => Promise<unknown>;

        readBodyMock.mockResolvedValue({ ...makeValidBody(), expires_in_ms: 0 });
        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 400 });

        readBodyMock.mockResolvedValue({ ...makeValidBody(), expires_in_ms: 1.5 });
        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 400 });

        readBodyMock.mockResolvedValue({ ...makeValidBody(), expires_in_ms: 86_400_001 });
        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 400 });
    });

    it('returns 400 for invalid disposition values', async () => {
        const handler = (await import('../presign-upload.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue({ ...makeValidBody(), disposition: 'attachment; filename="x"' });

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

    it('uses runtime-config MIME allowlist when provided', async () => {
        const handler = (await import('../presign-upload.post')).default as (event: H3Event) => Promise<unknown>;
        useRuntimeConfigMock.mockReturnValue({
            storage: {
                allowedMimeTypes: ['application/json'],
            },
        });
        readBodyMock.mockResolvedValue({
            ...makeValidBody(),
            mime_type: 'application/json',
        });

        await expect(handler(makeEvent())).resolves.toMatchObject({
            url: 'https://upload.example',
        });
    });

    it('returns 413 when workspace quota would be exceeded', async () => {
        const handler = (await import('../presign-upload.post')).default as (event: H3Event) => Promise<unknown>;
        useRuntimeConfigMock.mockReturnValue({
            storage: {
                allowedMimeTypes: ['image/png'],
                workspaceQuotaBytes: 1_500,
            },
        });
        getWorkspaceStorageUsageSnapshotMock.mockResolvedValue({
            usedBytes: 1_000,
            filesByHash: new Map<string, number>(),
        });
        readBodyMock.mockResolvedValue({
            ...makeValidBody(),
            size_bytes: 600,
        });

        await expect(handler(makeEvent())).rejects.toMatchObject({
            statusCode: 413,
        });
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
            expiresInMs: 12_345,
            disposition: 'inline',
        });
        expect(recordSyncRequestMock).toHaveBeenCalledWith('user-1', 'storage:upload');
        expect(recordUploadStartMock).toHaveBeenCalledTimes(1);
    });

    it('passes through upload method/headers/storageId from adapter response', async () => {
        const handler = (await import('../presign-upload.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue(makeValidBody());
        presignUploadMock.mockResolvedValue({
            url: '/api/storage/fs/upload?token=abc',
            expiresAt: 456,
            method: 'PUT',
            headers: { 'x-upload': '1' },
            storageId: 'ws-1:sha256:abc',
        });

        await expect(handler(makeEvent())).resolves.toEqual({
            url: '/api/storage/fs/upload?token=abc',
            expiresAt: 456,
            disposition: 'inline',
            method: 'PUT',
            headers: { 'x-upload': '1' },
            storageId: 'ws-1:sha256:abc',
        });
    });
});
