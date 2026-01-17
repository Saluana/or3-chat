# Object Storage Layer

The OR3 Storage Layer handles large binary assets (images, PDFs) separately from the main database sync. It uses a **local-first, hash-addressed** architecture to ensure assets are always available offline once downloaded.

---

## Architecture Overview

### 1. Hash-Addressed Storage (CAS)

All files are identified by their SHA-256 hash. This leads to several benefits:
*   **Deduplication**: Uploading the same file twice results in a single storage entry.
*   **Verification**: Content is verified against its hash on download.
*   **Immutability**: Files never change; they are only created or deleted.

### 2. Local-First Data Flow

*   **Metadata**: Stored in `db.file_meta` (synced via main DB sync).
*   **Binary Data**: Stored in `db.file_blobs` (IndexedDB).
*   **Transfers**: Managed by `FileTransferQueue` (upload/download).

When a component needs an image:
1.  It checks `db.file_blobs` for the binary data.
2.  If missing, it requests a download via the Transfer Queue.
3.  Once downloaded, the blob URL is served locally.

---

## Transfer Queue

The `FileTransferQueue` (`core/storage/transfer-queue.ts`) manages all network activity.

*   **Concurrency**: Limits parallel uploads/downloads based on network type (4G vs 3G).
*   **Retries**: Exponential backoff for transient failures.
*   **Resumability**: Tracks transfer state in `db.file_transfers` to survive page reloads.

### Upload Flow
1.  **Drafting**: File is computed locally, hash generated, blob stored in `file_blobs`.
2.  **Queueing**: A `file_transfer` record is created (status: `queued`).
3.  **Presigning**: The queue requests a presigned URL from the backend (`/api/storage/presign-upload`).
4.  **Transfer**: The binary is POSTed directly to the object storage (S3/R2/Convex).
5.  **Commit**: On success, the backend is notified to link the upload to the metadata.

### Download Flow
1.  **Request**: UI components use `useObjectUrl(hash)` or explicit `queue.download(hash)`.
2.  **Queueing**: A transfer is created if the blob is missing locally.
3.  **Presigning**: Fetches a signed download URL (`/api/storage/presign-download`).
4.  **Stream**: The file is downloaded and verified against its hash.
5.  **Cache**: The blob is stored in `file_blobs` for future offline use.

---

## Storage Providers

The system supports pluggable backends via the `ObjectStorageProvider` interface.

### Default: Convex Storage
Matches the default architecture.
*   **Uploads**: Uses standard Convex `generateUploadUrl` flow.
*   **Downloads**: Uses `storage.get` to generate temporary signed URLs.
*   **Proxy**: All requests go through the Nuxt server (`/api/storage/*`) to handle rate limiting and session validation before hitting Convex.

### Custom Providers
To implement S3, Cloudflare R2, or others:
1.  Implement `ObjectStorageProvider` (`core/storage/types.ts`).
2.  Register via `registerStorageProvider`.
3.  Update `nuxt.config.ts` or runtime config to select it.

```typescript
export interface ObjectStorageProvider {
    id: string;
    getPresignedUploadUrl(input): Promise<PresignedUrlResult>;
    getPresignedDownloadUrl(input): Promise<PresignedUrlResult>;
    commitUpload?(input): Promise<void>;
}
```

---

## Security & Validation

*   **MIME Types**: Strict allowlist (images, PDFs, text).
*   **Size Limits**: Enforced at the Gateway level (default 100MB).
*   **Permissions**: `requireCan(session, 'workspace.write')` checks on all operations.
*   **Rate Limiting**: Per-user limits on upload/download generation endpoints.
