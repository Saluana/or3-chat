/**
 * Gateway Storage Provider
 *
 * Uses SSR endpoints for presign and commit operations.
 * Suitable for providers that cannot be accessed directly from the client.
 */
import type { ObjectStorageProvider, PresignedUrlResult } from '../types';

export interface GatewayStorageProviderConfig {
    id?: string;
    baseUrl?: string;
    displayName?: string;
}

async function requestJson<T>(
    path: string,
    body: Record<string, unknown>,
    baseUrl: string
): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`[gateway-storage] ${path} failed: ${res.status} ${text}`);
    }

    return (await res.json()) as T;
}

export function createGatewayStorageProvider(
    config: GatewayStorageProviderConfig = {}
): ObjectStorageProvider {
    const baseUrl = config.baseUrl ?? '';
    const id = config.id ?? 'gateway';
    const displayName = config.displayName ?? 'Gateway Storage';

    return {
        id,
        displayName,
        mode: 'gateway',
        supports: {
            presignedUpload: true,
            presignedDownload: true,
        },

        async getPresignedUploadUrl(input): Promise<PresignedUrlResult> {
            const result = await requestJson<{
                url: string;
                expiresAt: number;
            }>('/api/storage/presign-upload', {
                workspace_id: input.workspaceId,
                hash: input.hash,
                mime_type: input.mimeType,
                size_bytes: input.sizeBytes,
                expires_in_ms: input.expiresInMs,
                disposition: input.disposition,
            }, baseUrl);

            return {
                url: result.url,
                expiresAt: result.expiresAt,
            };
        },

        async getPresignedDownloadUrl(input): Promise<PresignedUrlResult> {
            const result = await requestJson<{
                url: string;
                expiresAt: number;
            }>('/api/storage/presign-download', {
                workspace_id: input.workspaceId,
                hash: input.hash,
                storage_id: input.storageId,
                expires_in_ms: input.expiresInMs,
                disposition: input.disposition,
            }, baseUrl);

            return {
                url: result.url,
                expiresAt: result.expiresAt,
            };
        },

        async commitUpload(input): Promise<void> {
            await requestJson<{ ok: boolean }>('/api/storage/commit', {
                workspace_id: input.workspaceId,
                hash: input.hash,
                storage_id: input.storageId,
                storage_provider_id: input.storageProviderId ?? id,
                mime_type: input.meta.mimeType,
                size_bytes: input.meta.sizeBytes,
                name: input.meta.name,
                kind: input.meta.kind,
                width: input.meta.width,
                height: input.meta.height,
                page_count: input.meta.pageCount,
            }, baseUrl);
        },
    };
}
