import { createError } from 'h3';
import type { StorageGatewayAdapter } from '~~/server/storage/gateway/types';
import { api } from '~~/convex/_generated/api';
import type { Id } from '~~/convex/_generated/dataModel';
import { getProviderToken, getConvexGatewayClient } from '../utils/convex-gateway';
import { CONVEX_JWT_TEMPLATE, CONVEX_STORAGE_PROVIDER_ID } from '~~/shared/cloud/provider-ids';
import { resolvePresignExpiresAt } from '~~/server/utils/storage/presign-expiry';

export const convexStorageGatewayAdapter: StorageGatewayAdapter = {
    id: CONVEX_STORAGE_PROVIDER_ID,
    async presignUpload(event, input) {
        const token = await getProviderToken(event, CONVEX_JWT_TEMPLATE);
        if (!token) {
            throw createError({ statusCode: 401, statusMessage: 'Missing provider token' });
        }
        const client = getConvexGatewayClient(event, token);
        const result = await client.mutation(api.storage.generateUploadUrl, {
            workspace_id: input.workspaceId as Id<'workspaces'>,
            hash: input.hash,
            mime_type: input.mimeType,
            size_bytes: input.sizeBytes,
        });
        const expiresAt = resolvePresignExpiresAt(result, input.expiresInMs);
        return {
            url: result.uploadUrl,
            expiresAt,
            method: 'POST',
            storageId: result.storageId,
        };
    },
    async presignDownload(event, input) {
        const token = await getProviderToken(event, CONVEX_JWT_TEMPLATE);
        if (!token) {
            throw createError({ statusCode: 401, statusMessage: 'Missing provider token' });
        }
        const client = getConvexGatewayClient(event, token);
        const result = await client.query(api.storage.getFileUrl, {
            workspace_id: input.workspaceId as Id<'workspaces'>,
            hash: input.hash,
        });
        if (!result?.url) {
            throw createError({ statusCode: 404, statusMessage: 'File not found' });
        }
        const expiresAt = resolvePresignExpiresAt(result, input.expiresInMs);
        return {
            url: result.url,
            expiresAt,
            method: 'GET',
        };
    },
    async commit(event, input) {
        const token = await getProviderToken(event, CONVEX_JWT_TEMPLATE);
        if (!token) {
            throw createError({ statusCode: 401, statusMessage: 'Missing provider token' });
        }
        const client = getConvexGatewayClient(event, token);
        await client.mutation(api.storage.commitUpload, {
            workspace_id: input.workspaceId as Id<'workspaces'>,
            hash: input.hash,
            storage_id: input.storageId as Id<'_storage'>,
            storage_provider_id: input.storageProviderId,
            mime_type: input.meta.mimeType,
            size_bytes: input.meta.sizeBytes,
            name: input.meta.name,
            kind: input.meta.kind,
            width: input.meta.width,
            height: input.meta.height,
            page_count: input.meta.pageCount,
        });
    },
    async gc(event, input) {
        const token = await getProviderToken(event, CONVEX_JWT_TEMPLATE);
        if (!token) {
            throw createError({ statusCode: 401, statusMessage: 'Missing provider token' });
        }
        const client = getConvexGatewayClient(event, token);
        return await client.mutation(api.storage.gcDeletedFiles, {
            retention_seconds: input.retentionSeconds,
        });
    },
};
