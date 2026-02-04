import type { StorageGatewayAdapter } from '~~/server/storage/gateway/types';
import { createLocalFsToken } from '../utils/localfs-token';

const DEFAULT_EXPIRY_MS = 60_000;

export const localFsStorageGatewayAdapter: StorageGatewayAdapter = {
    id: 'localfs',
    async presignUpload(_event, input) {
        const expiresInMs = input.expiresInMs ?? DEFAULT_EXPIRY_MS;
        const expiresAt = Date.now() + expiresInMs;
        const token = createLocalFsToken({
            workspaceId: input.workspaceId,
            hash: input.hash,
            mimeType: input.mimeType,
            sizeBytes: input.sizeBytes,
            exp: expiresAt,
        });

        return {
            url: `/api/storage/localfs/upload?token=${encodeURIComponent(token)}`,
            expiresAt,
            method: 'PUT',
            storageId: input.hash,
        };
    },
    async presignDownload(_event, input) {
        const expiresInMs = input.expiresInMs ?? DEFAULT_EXPIRY_MS;
        const expiresAt = Date.now() + expiresInMs;
        const token = createLocalFsToken({
            workspaceId: input.workspaceId,
            hash: input.hash,
            exp: expiresAt,
            disposition: input.disposition,
        });

        return {
            url: `/api/storage/localfs/download?token=${encodeURIComponent(token)}`,
            expiresAt,
            method: 'GET',
            storageId: input.storageId ?? input.hash,
        };
    },
};
