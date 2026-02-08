/**
 * @module app/core/storage/types
 *
 * Purpose:
 * Defines the provider-agnostic interface for object storage operations.
 * Any storage backend (Convex, S3, R2, gateway) must implement
 * `ObjectStorageProvider` to be usable by the transfer queue.
 *
 * Architecture:
 * - Providers expose presigned URL generation for upload and download
 * - The transfer queue handles the actual HTTP transfer using these URLs
 * - `commitUpload` is optional and used by backends that need a
 *   post-upload metadata step (e.g., Convex storage)
 * - `deleteObject` is optional for backends that support client-initiated deletion
 *
 * Wire format:
 * - All provider inputs/outputs use snake_case field names
 * - Provider IDs are string constants defined in shared/cloud/provider-ids
 *
 * @see core/storage/provider-registry for provider registration
 * @see core/storage/transfer-queue for the upload/download queue
 */

/** Result of generating a presigned URL for upload or download. */
export interface PresignedUrlResult {
    url: string;
    headers?: Record<string, string>;
    expiresAt: number;
    storageId?: string;
    method?: string;
}

/**
 * Purpose:
 * Provider-agnostic interface for object storage operations.
 * Implementations handle presigned URL generation and optional
 * post-upload commit steps.
 *
 * Constraints:
 * - `getPresignedUploadUrl` and `getPresignedDownloadUrl` are required
 * - `commitUpload` is optional (needed by Convex to associate storage ID with metadata)
 * - `deleteObject` is optional
 * - Providers declare their capabilities via `supports`
 *
 * @see core/storage/providers/convex-storage-provider for Convex implementation
 * @see core/storage/providers/gateway-storage-provider for gateway implementation
 */
export interface ObjectStorageProvider {
    id: string;
    displayName: string;
    mode?: 'gateway';
    supports: {
        presignedUpload: boolean;
        presignedDownload: boolean;
        multipart?: boolean;
    };

    getPresignedUploadUrl(input: {
        workspaceId: string;
        hash: string;
        mimeType: string;
        sizeBytes: number;
        expiresInMs?: number;
        disposition?: string;
    }): Promise<PresignedUrlResult>;

    getPresignedDownloadUrl(input: {
        workspaceId: string;
        hash: string;
        storageId?: string;
        expiresInMs?: number;
        disposition?: string;
    }): Promise<PresignedUrlResult>;

    commitUpload?(input: {
        workspaceId: string;
        hash: string;
        storageId: string;
        meta: {
            name: string;
            mimeType: string;
            sizeBytes: number;
            kind: 'image' | 'pdf';
            width?: number;
            height?: number;
            pageCount?: number;
        };
        storageProviderId?: string;
    }): Promise<void>;

    deleteObject?(input: {
        workspaceId: string;
        hash: string;
        storageId?: string;
    }): Promise<void>;
}
