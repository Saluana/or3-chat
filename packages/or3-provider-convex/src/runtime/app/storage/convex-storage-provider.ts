/**
 * @module app/core/storage/providers/convex-storage-provider
 *
 * Purpose:
 * Implements `ObjectStorageProvider` for Convex storage. Makes HTTP
 * calls to SSR endpoints (`/api/storage/*`) that proxy to Convex
 * storage APIs. Validates responses with Zod schemas.
 *
 * Behavior:
 * - `getPresignedUploadUrl`: Calls `/api/storage/presign-upload`
 * - `getPresignedDownloadUrl`: Calls `/api/storage/presign-download`
 * - `commitUpload`: Calls `/api/storage/commit` to register the upload
 *   with the Convex file metadata table
 *
 * Constraints:
 * - Requires SSR endpoints to be deployed (not available in static builds)
 * - Convex uploads require `Content-Type` header set to the file's MIME type
 *
 * @see core/storage/types for ObjectStorageProvider interface
 * @see server/api/storage/ for the SSR endpoint implementations
 */
import { z } from 'zod';
import type {
    ObjectStorageProvider,
    PresignedUrlResult,
} from '~/core/storage/types';
import { CONVEX_STORAGE_PROVIDER_ID } from '~~/shared/cloud/provider-ids';

const PresignedUrlResponseSchema = z
    .object({
        url: z.string(),
        expiresAt: z.number(),
        headers: z.record(z.string(), z.string()).optional(),
        storageId: z.string().optional(),
        method: z.string().optional(),
    })
    .passthrough();

const CommitResponseSchema = z.object({ ok: z.boolean() }).passthrough();

async function postJson<T extends z.ZodTypeAny>(
    url: string,
    body: Record<string, unknown>,
    schema: T
): Promise<z.infer<T>> {
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        throw new Error(`Storage request failed: ${response.status}`);
    }
    const json: unknown = await response.json();
    return schema.parse(json);
}

/**
 * Purpose:
 * Create an ObjectStorageProvider implementation backed by Convex Storage.
 *
 * Behavior:
 * - Uses SSR endpoints under `/api/storage/*` for presign and commit
 * - Returns a provider with id `CONVEX_STORAGE_PROVIDER_ID`
 *
 * Constraints:
 * - Requires SSR endpoints to be deployed and reachable from the client
 * - Not suitable for static-only deployments
 */
export function createConvexStorageProvider(): ObjectStorageProvider {
    return {
        id: CONVEX_STORAGE_PROVIDER_ID,
        displayName: 'Convex Storage',
        supports: {
            presignedUpload: true,
            presignedDownload: true,
            multipart: false,
        },

        async getPresignedUploadUrl(input): Promise<PresignedUrlResult> {
            return postJson(
                '/api/storage/presign-upload',
                {
                    workspace_id: input.workspaceId,
                    hash: input.hash,
                    mime_type: input.mimeType,
                    size_bytes: input.sizeBytes,
                    expires_in_ms: input.expiresInMs,
                    disposition: input.disposition,
                },
                PresignedUrlResponseSchema
            );
        },

        async getPresignedDownloadUrl(input): Promise<PresignedUrlResult> {
            return postJson(
                '/api/storage/presign-download',
                {
                    workspace_id: input.workspaceId,
                    hash: input.hash,
                    storage_id: input.storageId,
                    expires_in_ms: input.expiresInMs,
                    disposition: input.disposition,
                },
                PresignedUrlResponseSchema
            );
        },

        async commitUpload(input): Promise<void> {
            await postJson(
                '/api/storage/commit',
                {
                    workspace_id: input.workspaceId,
                    hash: input.hash,
                    storage_id: input.storageId,
                    storage_provider_id: input.storageProviderId ?? CONVEX_STORAGE_PROVIDER_ID,
                    name: input.meta.name,
                    mime_type: input.meta.mimeType,
                    size_bytes: input.meta.sizeBytes,
                    kind: input.meta.kind,
                    width: input.meta.width,
                    height: input.meta.height,
                    page_count: input.meta.pageCount,
                },
                CommitResponseSchema
            );
        },
    };
}
