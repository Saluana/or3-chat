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
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    // A storage control request is part of the caller's cancellation scope,
    // including response parsing; hanging gateways must also have a deadline.
    it.each(['presign-upload', 'presign-download', 'commit', 'delete'] as const)('cancels an in-flight %s control operation', async operation => {
        let requestSignal: AbortSignal | undefined;
        vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
            requestSignal = init.signal ?? undefined;
            return new Promise((_resolve, reject) => requestSignal?.addEventListener('abort',
                () => reject(requestSignal?.reason), { once: true }));
        }));
        const provider = createGatewayStorageProvider();
        const controller = new AbortController();
        const input = { workspaceId: 'ws', hash: 'sha256:abc', mimeType: 'text/plain', sizeBytes: 3,
            storageId: 'object', meta: { name: 'a.txt', mimeType: 'text/plain', sizeBytes: 3, kind: 'file' as const },
            signal: controller.signal };
        const result = (operation === 'presign-upload' ? provider.getPresignedUploadUrl(input)
            : operation === 'presign-download' ? provider.getPresignedDownloadUrl(input)
            : operation === 'commit' ? provider.commitUpload!(input) : provider.deleteObject!(input))
            .then(() => 'resolved', () => 'aborted');
        controller.abort();
        expect(await Promise.race([result, new Promise(resolve => setTimeout(() => resolve('hung'), 100))])).toBe('aborted');
        expect(requestSignal?.aborted).toBe(true);
    });

    it.each(['headers', 'body'] as const)('bounds an uncooperative gateway %s wait without caller cancellation', async phase => {
        vi.useFakeTimers();
        let requestSignal: AbortSignal | undefined;
        const stalled = new Promise<never>(() => {});
        const readBody = vi.fn(() => stalled);
        vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
            requestSignal = init.signal ?? undefined;
            return phase === 'headers' ? stalled : Promise.resolve({ ok: true, json: readBody });
        }));
        const result = createGatewayStorageProvider().getPresignedUploadUrl({ workspaceId: 'ws',
            hash: 'sha256:abc', mimeType: 'text/plain', sizeBytes: 3 }).then(() => 'resolved', () => 'aborted');
        let outcome = 'pending';
        void result.then(value => { outcome = value; });
        await vi.advanceTimersByTimeAsync(60_001);
        expect(requestSignal?.aborted).toBe(true);
        expect(outcome).toBe('aborted');
        if (phase === 'body') expect(readBody).toHaveBeenCalledOnce();
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
                intentId: 'intent-1',
            }))
            .mockResolvedValueOnce(okJson({
                url: 'u2',
                expiresAt: 2,
                method: 'GET',
                headers: { 'x-download': '1' },
                storageId: 'sid-2',
            }))
            .mockResolvedValueOnce(okJson({ ok: true }))
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
            intentId: 'intent-1',
            meta: {
                name: 'a.png',
                mimeType: 'image/png',
                sizeBytes: 100,
                kind: 'image',
            },
        });
        await provider.deleteObject!({
            workspaceId: 'ws-1',
            hash: 'sha256:abc',
            storageId: 's1',
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
        expect(fetchMock).toHaveBeenNthCalledWith(
            4,
            'https://gateway.example/api/storage/delete',
            expect.objectContaining({
                method: 'POST',
                credentials: 'include',
            })
        );

        const commitBody = JSON.parse((fetchMock.mock.calls[2]?.[1] as RequestInit).body as string);
        expect(commitBody.storage_provider_id).toBe('custom-gateway');
        expect(commitBody.intent_id).toBe('intent-1');
        expect(JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string).file_kind_capability).toBe('v1');
        expect(JSON.parse((fetchMock.mock.calls[1]?.[1] as RequestInit).body as string).file_kind_capability).toBe('v1');
        expect(commitBody.file_kind_capability).toBe('v1');
        const deleteBody = JSON.parse((fetchMock.mock.calls[3]?.[1] as RequestInit).body as string);
        expect(deleteBody).toEqual({
            workspace_id: 'ws-1',
            hash: 'sha256:abc',
            storage_id: 's1',
        });
        expect(uploadResult).toEqual({
            url: 'u1',
            expiresAt: 1,
            method: 'PUT',
            headers: { 'x-upload': '1' },
            storageId: 'sid-1',
            intentId: 'intent-1',
        });
        expect(downloadResult).toEqual({
            url: 'u2',
            expiresAt: 2,
            method: 'GET',
            headers: { 'x-download': '1' },
            storageId: 'sid-2',
        });
    });

    it('preserves status while excluding gateway response text', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => ({
                ok: false,
                status: 500,
                headers: new Headers(),
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
        ).rejects.toMatchObject({ status: 500, source: 'storage', retryable: true, message: 'The service could not complete the request. Please try again later.' });
    });

    it('isolates a transient S3/R2 gateway outage to one request', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce({
                ok: false,
                status: 503,
                headers: new Headers(),
                text: vi.fn(async () => 'object storage unavailable'),
            } as unknown as Response)
            .mockResolvedValueOnce(okJson({
                url: 'https://storage.test/download',
                expiresAt: 42,
                method: 'GET',
                storageId: 'storage-1',
            }));
        vi.stubGlobal('fetch', fetchMock);
        const provider = createGatewayStorageProvider({
            id: 's3-compatible',
        });

        await expect(
            provider.getPresignedUploadUrl({
                workspaceId: 'ws-1',
                hash: 'sha256:abc',
                mimeType: 'image/png',
                sizeBytes: 3,
            })
        ).rejects.toMatchObject({ status: 503, source: 'storage', retryable: true });

        await expect(
            provider.getPresignedDownloadUrl({
                workspaceId: 'ws-1',
                hash: 'sha256:abc',
                storageId: 'storage-1',
            })
        ).resolves.toMatchObject({
            url: 'https://storage.test/download',
            storageId: 'storage-1',
        });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});
