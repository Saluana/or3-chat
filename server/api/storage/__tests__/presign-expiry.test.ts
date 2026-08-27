import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';
import {
    DEFAULT_PRESIGN_EXPIRY_MS,
    MAX_PRESIGN_EXPIRY_MS,
    clampPresignExpiryMs,
    resolvePresignExpiresAt,
} from '../../../utils/storage/presign-expiry';

const readBodyMock = vi.fn();
const setResponseHeaderMock = vi.fn();
const setHeaderMock = vi.fn();

vi.mock('h3', async () => ({
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

// Note: convex-gateway mock removed - now using storage adapter registry mock

vi.mock('~~/convex/_generated/api', () => ({
    api: {
        storage: {
            generateUploadUrl: 'storage.generateUploadUrl',
            getFileUrl: 'storage.getFileUrl',
        },
    },
}));

// Mock storage gateway registry (added during provider decoupling)
const mockStorageAdapter = {
    presignUpload: vi.fn(),
    presignDownload: vi.fn(),
};
vi.mock('../../../storage/gateway/registry', () => ({
    getActiveStorageGatewayAdapter: () => mockStorageAdapter,
}));

vi.mock('../../../sync/gateway/registry', () => ({
    getActiveSyncGatewayAdapter: () => ({
        queryCanonicalStorage: vi.fn().mockResolvedValue({
            items: [{
                kind: 'metadata',
                hash: 'sha256:' + 'a'.repeat(64),
                sizeBytes: 1024,
                storageId: 'storage-1',
                updatedAt: 1,
            }],
            hasMore: false,
        }),
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
    hash: 'sha256:' + 'a'.repeat(64),
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
        setHeaderMock.mockReset();
        mockStorageAdapter.presignUpload.mockReset();
        mockStorageAdapter.presignDownload.mockReset();
    });

    it('clamps expires_in_ms to server max', () => {
        expect(clampPresignExpiryMs(MAX_PRESIGN_EXPIRY_MS * 2)).toBe(
            MAX_PRESIGN_EXPIRY_MS
        );
    });

    it('prefers a provider expiry, including the legacy snake_case field', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));

        expect(
            resolvePresignExpiresAt({ expiresAt: 1_234 }, MAX_PRESIGN_EXPIRY_MS)
        ).toBe(1_234);
        expect(
            resolvePresignExpiresAt({ expires_at: '2025-01-01T00:10:00.000Z' })
        ).toBe(new Date('2025-01-01T00:10:00.000Z').getTime());
        expect(
            resolvePresignExpiresAt({
                expiresAt: Date.now() + MAX_PRESIGN_EXPIRY_MS * 2,
            })
        ).toBe(Date.now() + MAX_PRESIGN_EXPIRY_MS);

        vi.useRealTimers();
    });

    it('uses provider expiry when available (upload)', async () => {
        const handler = (await import('../presign-upload.post')).default as (
            event: H3Event
        ) => Promise<{ expiresAt: number }>;

        const providerExpiry = new Date('2025-01-01T00:00:00.000Z');
        mockStorageAdapter.presignUpload.mockResolvedValue({
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

        mockStorageAdapter.presignDownload.mockResolvedValue({
            url: 'https://download.example.com',
            // No expiresAt - should use server default
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
