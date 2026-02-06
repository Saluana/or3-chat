import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConvexStorageProvider } from '../convex-storage-provider';

function okJson(body: unknown) {
    return {
        ok: true,
        status: 200,
        json: vi.fn(async () => body),
    } as unknown as Response;
}

describe('createConvexStorageProvider', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('maps upload/download/commit payloads to endpoints', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(okJson({ url: 'u1', expiresAt: 1 }))
            .mockResolvedValueOnce(okJson({ url: 'u2', expiresAt: 2 }))
            .mockResolvedValueOnce(okJson({ ok: true }));
        vi.stubGlobal('fetch', fetchMock);

        const provider = createConvexStorageProvider();

        await expect(
            provider.getPresignedUploadUrl({
                workspaceId: 'ws-1',
                hash: 'sha256:abc',
                mimeType: 'image/png',
                sizeBytes: 100,
                expiresInMs: 500,
                disposition: 'inline',
            })
        ).resolves.toEqual({ url: 'u1', expiresAt: 1 });

        await expect(
            provider.getPresignedDownloadUrl({
                workspaceId: 'ws-1',
                hash: 'sha256:abc',
                storageId: 's1',
                expiresInMs: 500,
                disposition: 'attachment',
            })
        ).resolves.toEqual({ url: 'u2', expiresAt: 2 });

        await provider.commitUpload!({
            workspaceId: 'ws-1',
            hash: 'sha256:abc',
            storageId: 's1',
            meta: {
                name: 'a.png',
                mimeType: 'image/png',
                sizeBytes: 100,
                kind: 'image',
            },
        });

        expect(fetchMock).toHaveBeenNthCalledWith(
            1,
            '/api/storage/presign-upload',
            expect.objectContaining({ method: 'POST' })
        );
        expect(fetchMock).toHaveBeenNthCalledWith(
            2,
            '/api/storage/presign-download',
            expect.objectContaining({ method: 'POST' })
        );
        expect(fetchMock).toHaveBeenNthCalledWith(
            3,
            '/api/storage/commit',
            expect.objectContaining({ method: 'POST' })
        );

        const commitBody = JSON.parse((fetchMock.mock.calls[2]?.[1] as RequestInit).body as string);
        expect(commitBody.storage_provider_id).toBe('convex');
    });

    it('throws when endpoint returns non-OK status', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })));

        const provider = createConvexStorageProvider();

        await expect(
            provider.getPresignedUploadUrl({
                workspaceId: 'ws-1',
                hash: 'sha256:abc',
                mimeType: 'image/png',
                sizeBytes: 100,
            })
        ).rejects.toThrow('Storage request failed: 503');
    });

    it('throws on malformed endpoint responses (zod parse failure)', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => okJson({ bad: true })));

        const provider = createConvexStorageProvider();

        await expect(
            provider.getPresignedDownloadUrl({
                workspaceId: 'ws-1',
                hash: 'sha256:abc',
            })
        ).rejects.toThrow();
    });
});
