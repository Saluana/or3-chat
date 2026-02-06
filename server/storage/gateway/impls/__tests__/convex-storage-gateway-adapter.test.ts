import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';
import { ConvexStorageGatewayAdapter } from 'or3-provider-convex/src/runtime/server/storage/convex-storage-gateway-adapter';

vi.mock('~~/convex/_generated/api', () => ({
    api: {
        storage: {
            generateUploadUrl: 'storage.generateUploadUrl',
            getFileUrl: 'storage.getFileUrl',
            commitUpload: 'storage.commitUpload',
            gcDeletedFiles: 'storage.gcDeletedFiles',
        },
    },
}));

const resolveProviderTokenMock = vi.hoisted(() => vi.fn());
vi.mock('~~/server/auth/token-broker/resolve', () => ({
    resolveProviderToken: resolveProviderTokenMock as any,
}));

const resolvePresignExpiresAtMock = vi.hoisted(() => vi.fn(() => 111_111));
vi.mock('~~/server/utils/storage/presign-expiry', () => ({
    resolvePresignExpiresAt: resolvePresignExpiresAtMock as any,
}));

const queryMock = vi.hoisted(() => vi.fn());
const mutationMock = vi.hoisted(() => vi.fn());
vi.mock('or3-provider-convex/src/runtime/server/utils/convex-gateway', () => ({
    getConvexGatewayClient: () => ({
        query: queryMock as any,
        mutation: mutationMock as any,
    }),
}));

function makeEvent(): H3Event {
    return { context: {}, node: { req: { headers: {} } } } as H3Event;
}

describe('ConvexStorageGatewayAdapter', () => {
    beforeEach(() => {
        resolveProviderTokenMock.mockReset().mockResolvedValue('provider-jwt');
        resolvePresignExpiresAtMock.mockReset().mockReturnValue(111_111);
        queryMock.mockReset();
        mutationMock.mockReset();
    });

    it('requires token and returns 401 when missing', async () => {
        const adapter = new ConvexStorageGatewayAdapter();
        resolveProviderTokenMock.mockResolvedValue(null);

        await expect(
            adapter.presignUpload(makeEvent(), {
                workspaceId: 'ws-1',
                hash: 'sha256:abc',
                mimeType: 'image/png',
                sizeBytes: 100,
            })
        ).rejects.toMatchObject({ statusCode: 401 });

        await expect(
            adapter.presignDownload(makeEvent(), {
                workspaceId: 'ws-1',
                hash: 'sha256:abc',
            })
        ).rejects.toMatchObject({ statusCode: 401 });

        await expect(adapter.commit(makeEvent(), {})).rejects.toMatchObject({ statusCode: 401 });
        await expect(adapter.gc(makeEvent(), {})).rejects.toMatchObject({ statusCode: 401 });
    });

    it('maps presign upload/download and resolves expiry', async () => {
        const adapter = new ConvexStorageGatewayAdapter();
        mutationMock.mockResolvedValueOnce({ uploadUrl: 'https://upload.example', expiresAt: '2026-02-06T12:00:00Z' });
        queryMock.mockResolvedValueOnce({ url: 'https://download.example', expiresAt: 123 });

        await expect(
            adapter.presignUpload(makeEvent(), {
                workspaceId: 'ws-1',
                hash: 'sha256:abc',
                mimeType: 'image/png',
                sizeBytes: 100,
            })
        ).resolves.toEqual({ url: 'https://upload.example', expiresAt: 111_111 });

        await expect(
            adapter.presignDownload(makeEvent(), {
                workspaceId: 'ws-1',
                hash: 'sha256:abc',
            })
        ).resolves.toEqual({ url: 'https://download.example', expiresAt: 111_111 });

        expect(mutationMock).toHaveBeenCalledWith('storage.generateUploadUrl', {
            workspace_id: 'ws-1',
            hash: 'sha256:abc',
            mime_type: 'image/png',
            size_bytes: 100,
        });

        expect(queryMock).toHaveBeenCalledWith('storage.getFileUrl', {
            workspace_id: 'ws-1',
            hash: 'sha256:abc',
        });
    });

    it('returns 404 when download URL is absent', async () => {
        const adapter = new ConvexStorageGatewayAdapter();
        queryMock.mockResolvedValue({ url: undefined });

        await expect(
            adapter.presignDownload(makeEvent(), {
                workspaceId: 'ws-1',
                hash: 'sha256:abc',
            })
        ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('maps commit payload including storage_id cast and metadata fields', async () => {
        const adapter = new ConvexStorageGatewayAdapter();

        await adapter.commit(makeEvent(), {
            workspace_id: 'ws-1',
            hash: 'sha256:abc',
            storage_id: 'st_1',
            storage_provider_id: 'convex',
            mime_type: 'image/png',
            size_bytes: 100,
            name: 'a.png',
            kind: 'image',
            width: 10,
            height: 20,
            page_count: 1,
        });

        expect(mutationMock).toHaveBeenCalledWith('storage.commitUpload', {
            workspace_id: 'ws-1',
            hash: 'sha256:abc',
            storage_id: 'st_1',
            storage_provider_id: 'convex',
            mime_type: 'image/png',
            size_bytes: 100,
            name: 'a.png',
            kind: 'image',
            width: 10,
            height: 20,
            page_count: 1,
        });
    });

    it('maps GC response to deleted_count shape', async () => {
        const adapter = new ConvexStorageGatewayAdapter();
        mutationMock.mockResolvedValue({ deletedCount: 7 });

        await expect(
            adapter.gc(makeEvent(), {
                workspace_id: 'ws-1',
                retention_seconds: 3600,
                limit: 50,
            })
        ).resolves.toEqual({ deleted_count: 7 });

        expect(mutationMock).toHaveBeenCalledWith('storage.gcDeletedFiles', {
            workspace_id: 'ws-1',
            retention_seconds: 3600,
            limit: 50,
        });
    });
});
