import { z } from 'zod';
import type { ObjectStorageProvider, PresignedUrlResult } from '../types';

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

export function createGatewayStorageProvider(id = 'gateway'): ObjectStorageProvider {
    return {
        id,
        displayName: 'Gateway Storage',
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
                    storage_provider_id: input.storageProviderId ?? id,
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
