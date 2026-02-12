/**
 * @module server/storage/gateway/types.ts
 *
 * Purpose:
 * Defines the server-side adapter interface for storage backends. This decouples
 * SSR storage endpoints from specific backend implementations (Convex, S3, LocalFS, etc.).
 *
 * Architecture:
 * - Core storage endpoints handle auth, validation, rate limiting
 * - Adapters handle backend-specific logic (presigned URLs, uploads, commits)
 * - Client storage provider always uses gateway mode (no SDK required)
 *
 * Example Flow:
 * 1. Client needs to upload file, requests presigned upload URL
 * 2. POST /api/storage/presign-upload receives request
 * 3. Endpoint resolves session, checks can('workspace.write')
 * 4. Endpoint gets active StorageGatewayAdapter from config
 * 5. Adapter generates presigned URL (S3 style, or internal endpoint + token)
 * 6. Endpoint returns presigned URL to client
 * 7. Client uploads directly to URL
 * 8. Client optionally calls commit endpoint to finalize
 */
import type { H3Event } from 'h3';

/**
 * Purpose:
 * Request to presign an upload URL.
 *
 * Fields:
 * - `workspaceId`: Workspace isolation scope
 * - `hash`: Content-addressable hash (e.g., SHA-256)
 * - `mimeType`: File MIME type
 * - `sizeBytes`: File size for validation
 */
export interface PresignUploadRequest {
    workspaceId: string;
    hash: string;
    mimeType: string;
    sizeBytes: number;
    /** Optional client-requested TTL (ms). Provider must clamp/bound. */
    expiresInMs?: number;
    /** Optional disposition hint (e.g. inline/attachment). Provider may honor. */
    disposition?: string;
}

/**
 * Purpose:
 * Response from presign upload request.
 *
 * Fields:
 * - `url`: Presigned URL or internal upload endpoint
 * - `expiresAt`: Unix timestamp when URL expires
 * - `headers`: Optional headers to include in upload request
 * - `method`: HTTP method (default: POST)
 * - `storageId`: Optional backend-specific storage identifier
 */
export interface PresignUploadResponse {
    url: string;
    expiresAt?: number;
    headers?: Record<string, string>;
    method?: string;
    storageId?: string;
}

/**
 * Purpose:
 * Request to presign a download URL.
 *
 * Fields:
 * - `workspaceId`: Workspace isolation scope
 * - `hash`: Content-addressable hash
 * - `storageId`: Optional backend-specific identifier (from upload response)
 */
export interface PresignDownloadRequest {
    workspaceId: string;
    hash: string;
    storageId?: string;
    /** Optional client-requested TTL (ms). Provider must clamp/bound. */
    expiresInMs?: number;
    /** Optional disposition hint (e.g. inline/attachment). Provider may honor. */
    disposition?: string;
}

/**
 * Purpose:
 * Response from presign download request.
 *
 * Fields:
 * - `url`: Presigned URL or internal download endpoint
 * - `expiresAt`: Unix timestamp when URL expires
 * - `headers`: Optional headers to include in download request
 * - `method`: HTTP method (default: GET)
 * - `storageId`: Optional backend-specific storage identifier
 */
export interface PresignDownloadResponse {
    url: string;
    expiresAt?: number;
    headers?: Record<string, string>;
    method?: string;
    storageId?: string;
}

/**
 * Purpose:
 * Server-side storage gateway adapter interface.
 *
 * Responsibilities:
 * - Generate presigned upload/download URLs or internal endpoints
 * - Handle backend-specific authentication and authorization
 * - Optionally handle commit/finalization logic
 * - Optionally implement GC for orphaned files
 *
 * Constraints:
 * - Must respect workspace isolation
 * - Should use short-lived presigned URLs (< 1 hour)
 * - Must ensure uploaded files are not publicly accessible
 */
export interface StorageGatewayAdapter {
    id: string;

    /**
     * Generate presigned upload URL.
     *
     * Behavior:
     * - Returns S3-style presigned URL, or internal upload endpoint with token
     * - URL should be short-lived (typically 5-60 minutes)
     * - May return storageId for tracking upload lifecycle
     *
     * @param event - Nitro request event (contains session)
     * @param input - Upload request with workspace, hash, mime type, size
     * @returns Presigned upload response with URL and metadata
     */
    presignUpload(
        event: H3Event,
        input: PresignUploadRequest
    ): Promise<PresignUploadResponse>;

    /**
     * Generate presigned download URL.
     *
     * Behavior:
     * - Returns S3-style presigned URL, or internal download endpoint with token
     * - URL should be short-lived (typically 5-60 minutes)
     * - Verifies file exists and user has access
     *
     * @param event - Nitro request event (contains session)
     * @param input - Download request with workspace, hash, optional storageId
     * @returns Presigned download response with URL and metadata
     */
    presignDownload(
        event: H3Event,
        input: PresignDownloadRequest
    ): Promise<PresignDownloadResponse>;

    /**
     * Optional: Commit/finalize an upload.
     *
     * Behavior:
     * - Records file metadata in database
     * - Transitions file from "pending" to "committed" state
     * - May be no-op for backends that don't need explicit commit
     *
     * @param event - Nitro request event (contains session)
     * @param input - Commit request (backend-specific structure)
     */
    commit?(event: H3Event, input: unknown): Promise<void>;

    /**
     * Optional: Garbage collect orphaned files.
     *
     * Behavior:
     * - Deletes files not referenced by any records
     * - May use reference counting or mark-and-sweep
     * - Backend-specific implementation
     *
     * @param event - Nitro request event (contains session)
     * @param input - GC request (backend-specific structure)
     */
    gc?(event: H3Event, input: unknown): Promise<unknown>;
}
