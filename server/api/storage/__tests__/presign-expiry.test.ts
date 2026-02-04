import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';
import {
    DEFAULT_PRESIGN_EXPIRY_MS,
    MAX_PRESIGN_EXPIRY_MS,
    clampPresignExpiryMs,
} from '../../../utils/storage/presign-expiry';

const readBodyMock = vi.fn();
const setResponseHeaderMock = vi.fn();

vi.mock('h3', async () => ({
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

vi.mock('../../../auth/session', () => ({
    resolveSessionContext: vi.fn().mockResolvedValue({
        authenticated: true,
        user: { id: 'user-1' },
    }),
}));

vi.mock('../../../auth/can', () => ({
    requireCan: vi.fn(),
}));

vi.mock('../../../utils/auth/is-ssr-auth-enabled', () => ({
    isSsrAuthEnabled: () => true,
}));

vi.mock('../../../utils/storage/is-storage-enabled', () => ({
    isStorageEnabled: () => true,
}));

vi.mock('../../../utils/sync/rate-limiter', () => ({
    checkSyncRateLimit: () => ({ allowed: true, remaining: 10 }),
    recordSyncRequest: vi.fn(),
}));

const presignUploadMock = vi.fn();
const presignDownloadMock = vi.fn();
vi.mock('../../../storage/gateway/resolve', () => ({
    getActiveStorageGatewayAdapterOrThrow: () => ({
        presignUpload: presignUploadMock,
        presignDownload: presignDownloadMock,
    }),
}));

vi.mock('~~/config.or3', () => ({
    or3Config: {
        limits: { maxCloudFileSizeBytes: 10_000_000 },
    },
}));

vi.mock('../../../utils/storage/metrics', () => ({
    recordUploadStart: vi.fn(),
    recordDownloadStart: vi.fn(),
}));

const baseBody = {
    workspace_id: 'ws-1',
    hash: 'hash-1',
    mime_type: 'image/png',
    size_bytes: 1024,
    disposition: 'inline',
};

function makeEvent(): H3Event {
    return { context: {}, node: { req: { headers: {} } } } as H3Event;
}

describe('presign expiry handling', () => {
    beforeEach(() => {
        readBodyMock.mockReset();
        setResponseHeaderMock.mockReset();
        presignUploadMock.mockReset();
        presignDownloadMock.mockReset();
    });

    it('clamps expires_in_ms to server max', () => {
        expect(clampPresignExpiryMs(MAX_PRESIGN_EXPIRY_MS * 2)).toBe(
            MAX_PRESIGN_EXPIRY_MS
        );
    });

    it('uses provider expiry when available (upload)', async () => {
        const handler = (await import('../presign-upload.post')).default as (
            event: H3Event
        ) => Promise<{ expiresAt: number }>;

        const providerExpiry = new Date('2025-01-01T00:00:00.000Z');
        presignUploadMock.mockResolvedValue({
            url: 'https://upload.example.com',
            expiresAt: providerExpiry.getTime(),
        });

        readBodyMock.mockResolvedValue(baseBody);

        const result = await handler(makeEvent());

        expect(result.expiresAt).toBe(providerExpiry.getTime());
    });

    it('uses server default when provider has no expiry (download)', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));

        const handler = (await import('../presign-download.post')).default as (
            event: H3Event
        ) => Promise<{ expiresAt: number }>;

        presignDownloadMock.mockResolvedValue({
            url: 'https://download.example.com',
            expiresAt:
                new Date('2025-01-01T00:00:00.000Z').getTime() +
                DEFAULT_PRESIGN_EXPIRY_MS,
        });

        readBodyMock.mockResolvedValue({
            ...baseBody,
            storage_id: 'storage-1',
        });

        const result = await handler(makeEvent());

        expect(result.expiresAt).toBe(
            new Date('2025-01-01T00:00:00.000Z').getTime() +
                DEFAULT_PRESIGN_EXPIRY_MS
        );

        vi.useRealTimers();
    });
});
