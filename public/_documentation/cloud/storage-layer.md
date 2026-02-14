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

#### Correct approach (SSR gateway adapter)

Do **not** put S3 credentials in any client-side plugin or `runtimeConfig.public`.

In OR3, S3-compatible backends are implemented as a **server-side** `StorageGatewayAdapter` registered by a provider package (example: `or3-provider-s3`). The client only talks to OR3’s SSR endpoints:

- `POST /api/storage/presign-upload`
- `POST /api/storage/presign-download`
- `POST /api/storage/commit`

Those endpoints enforce `can()` authorization + rate limits and then delegate to the registered adapter to generate short-lived presigned URLs.

To set up S3 storage:

```bash
SSR_AUTH_ENABLED=true
OR3_STORAGE_ENABLED=true
NUXT_PUBLIC_STORAGE_PROVIDER=s3

# server-only S3 config (never exposed to the browser)
OR3_STORAGE_S3_ENDPOINT=https://s3.us-east-1.amazonaws.com   # optional for AWS
OR3_STORAGE_S3_REGION=us-east-1
OR3_STORAGE_S3_BUCKET=my-or3-bucket
OR3_STORAGE_S3_ACCESS_KEY_ID=...
OR3_STORAGE_S3_SECRET_ACCESS_KEY=...
OR3_STORAGE_S3_FORCE_PATH_STYLE=false
OR3_STORAGE_S3_URL_TTL_SECONDS=900
```

See the dedicated setup guide:

- [cloud/provider-s3](./provider-s3)

### Provider Comparison

| Provider | Best For | Setup Complexity | Cost |
|----------|----------|------------------|------|
| **Convex** | Default, simple setup | Low | Included with OR3 Cloud |
| **S3** | Enterprise, large files | Medium | Pay per GB |
| **Cloudflare R2** | No egress fees | Medium | Pay per GB stored |
| **Backblaze B2** | Budget option | Medium | Very low cost |

---

## Security & Validation

*   **MIME Types**: Strict allowlist (images, PDFs, text).
*   **Size Limits**: Enforced at the Gateway level (default 100MB).
*   **Permissions**: `requireCan(session, 'workspace.write')` checks on all operations.
*   **Rate Limiting**: Per-user limits on upload/download generation endpoints.
*   **Hash Verification**: Files verified against SHA-256 hash after download.
*   **Presigned URLs**: Short-lived URLs (1 hour default) prevent unauthorized access.
