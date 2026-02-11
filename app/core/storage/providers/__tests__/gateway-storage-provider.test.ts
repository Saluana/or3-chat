import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGatewayStorageProvider } from '../gateway-storage-provider';

function okJson(body: unknown) {
    return {
        ok: true,
        status: 200,
        json: vi.fn(async () => body),
    } as unknown as Response;
}

describe('createGatewayStorageProvider', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('joins base URL and maps upload/download/commit payloads', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(okJson({
                url: 'u1',
                expiresAt: 1,
                method: 'PUT',
                headers: { 'x-upload': '1' },
                storageId: 'sid-1',
            }))
            .mockResolvedValueOnce(okJson({
                url: 'u2',
                expiresAt: 2,
                method: 'GET',
                headers: { 'x-download': '1' },
                storageId: 'sid-2',
            }))
            .mockResolvedValueOnce(okJson({ ok: true }));
        vi.stubGlobal('fetch', fetchMock);

        const provider = createGatewayStorageProvider({
            baseUrl: 'https://gateway.example',
            id: 'custom-gateway',
            displayName: 'Custom Gateway',
        });

        expect(provider.id).toBe('custom-gateway');
        expect(provider.displayName).toBe('Custom Gateway');

        const uploadResult = await provider.getPresignedUploadUrl({
            workspaceId: 'ws-1',
            hash: 'sha256:abc',
            mimeType: 'image/png',
            sizeBytes: 100,
            expiresInMs: 123,
            disposition: 'inline',
        });
        const downloadResult = await provider.getPresignedDownloadUrl({
            workspaceId: 'ws-1',
            hash: 'sha256:abc',
            storageId: 's1',
            expiresInMs: 321,
            disposition: 'attachment',
        });
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
            'https://gateway.example/api/storage/presign-upload',
            expect.objectContaining({
                method: 'POST',
                credentials: 'include',
            })
        );
        expect(fetchMock).toHaveBeenNthCalledWith(
            2,
            'https://gateway.example/api/storage/presign-download',
            expect.objectContaining({
                method: 'POST',
                credentials: 'include',
            })
        );
        expect(fetchMock).toHaveBeenNthCalledWith(
            3,
            'https://gateway.example/api/storage/commit',
            expect.objectContaining({
                method: 'POST',
                credentials: 'include',
            })
        );

        const commitBody = JSON.parse((fetchMock.mock.calls[2]?.[1] as RequestInit).body as string);
        expect(commitBody.storage_provider_id).toBe('custom-gateway');
        expect(uploadResult).toEqual({
            url: 'u1',
            expiresAt: 1,
            method: 'PUT',
            headers: { 'x-upload': '1' },
            storageId: 'sid-1',
        });
        expect(downloadResult).toEqual({
            url: 'u2',
            expiresAt: 2,
            method: 'GET',
            headers: { 'x-download': '1' },
            storageId: 'sid-2',
        });
    });

    it('includes endpoint and status text in error message', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => ({
                ok: false,
                status: 500,
                text: vi.fn(async () => 'Boom'),
            }))
        );

        const provider = createGatewayStorageProvider({ baseUrl: '' });

        await expect(
            provider.getPresignedUploadUrl({
                workspaceId: 'ws-1',
                hash: 'sha256:abc',
                mimeType: 'image/png',
                sizeBytes: 100,
            })
        ).rejects.toThrow('[gateway-storage] /api/storage/presign-upload failed: 500 Boom');
    });
});
