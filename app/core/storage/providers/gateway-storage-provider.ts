/**
 * @module app/core/storage/providers/gateway-storage-provider
 *
 * Purpose:
 * Implements `ObjectStorageProvider` using SSR gateway endpoints for
 * presign and commit operations. Suitable for providers that cannot
 * be accessed directly from the client (e.g., S3-compatible backends
 * behind auth).
 *
 * Behavior:
 * - All operations are POST requests to `/api/storage/*` endpoints
 * - Configurable base URL for custom gateway deployments
 * - Mode is always `'gateway'` (SSR-proxied)
 *
 * Constraints:
 * - Requires SSR endpoints to be deployed
 * - Does not support `deleteObject` (not implemented)
 * - Auth is handled by the SSR layer (cookies/session); no client-side tokens needed
 *
 * @see core/storage/types for ObjectStorageProvider interface
 * @see core/storage/providers/convex-storage-provider for the Convex-specific variant
 */
import type { ObjectStorageProvider, PresignedUrlResult } from '../types';

/**
 * Purpose:
 * Configuration for a gateway (SSR-proxied) storage provider.
 *
 * Constraints:
 * - `baseUrl` should be same-origin for cookie auth, unless your gateway
 *   explicitly supports cross-origin credentials.
 */
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
        credentials: 'include',
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

/**
 * Purpose:
 * Create an ObjectStorageProvider that proxies all operations through SSR
 * endpoints (a gateway).
 *
 * Behavior:
 * - Calls `/api/storage/presign-upload`, `/api/storage/presign-download`, and
 *   `/api/storage/commit` using POST JSON
 * - Does not require client-managed auth tokens (relies on SSR cookies/session)
 *
 * Constraints:
 * - Requires SSR endpoints; not available in static-only builds
 */
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
                headers?: Record<string, string>;
                method?: string;
                storageId?: string;
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
                headers: result.headers,
                method: result.method,
                storageId: result.storageId,
            };
        },

        async getPresignedDownloadUrl(input): Promise<PresignedUrlResult> {
            const result = await requestJson<{
                url: string;
                expiresAt: number;
                headers?: Record<string, string>;
                method?: string;
                storageId?: string;
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
                headers: result.headers,
                method: result.method,
                storageId: result.storageId,
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
