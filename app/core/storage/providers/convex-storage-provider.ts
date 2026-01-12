import type { ObjectStorageProvider, PresignedUrlResult } from '../types';

async function postJson<T>(
    url: string,
    body: Record<string, unknown>
): Promise<T> {
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        throw new Error(`Storage request failed: ${response.status}`);
    }
    return (await response.json()) as T;
}

export function createConvexStorageProvider(): ObjectStorageProvider {
    return {
        id: 'convex',
        displayName: 'Convex Storage',
        supports: {
            presignedUpload: true,
            presignedDownload: true,
            multipart: false,
        },

        async getPresignedUploadUrl(input): Promise<PresignedUrlResult> {
            return postJson<PresignedUrlResult>('/api/storage/presign-upload', {
                workspace_id: input.workspaceId,
                hash: input.hash,
                mime_type: input.mimeType,
                size_bytes: input.sizeBytes,
                expires_in_ms: input.expiresInMs,
                disposition: input.disposition,
            });
        },

        async getPresignedDownloadUrl(input): Promise<PresignedUrlResult> {
            return postJson<PresignedUrlResult>('/api/storage/presign-download', {
                workspace_id: input.workspaceId,
                hash: input.hash,
                storage_id: input.storageId,
                expires_in_ms: input.expiresInMs,
                disposition: input.disposition,
            });
        },

        async commitUpload(input): Promise<void> {
            await postJson<void>('/api/storage/commit', {
                workspace_id: input.workspaceId,
                hash: input.hash,
                storage_id: input.storageId,
                storage_provider_id: input.storageProviderId ?? 'convex',
                name: input.meta.name,
                mime_type: input.meta.mimeType,
                size_bytes: input.meta.sizeBytes,
                kind: input.meta.kind,
                width: input.meta.width,
                height: input.meta.height,
                page_count: input.meta.pageCount,
            });
        },
    };
}
