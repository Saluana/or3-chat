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

`file_meta.ref_count` is derived locally from reference edges in messages/posts;
it is never synced (sanitized out of sync payloads) and cannot be set remotely.

When a component needs an image:
1.  It checks `db.file_blobs` for the binary data.
2.  If missing, it requests a download via the Transfer Queue.
3.  Once downloaded, the blob URL is served locally.

---

## Transfer Queue

The `FileTransferQueue` (`core/storage/transfer-queue.ts`) manages all network activity.

*   **Concurrency**: Limits parallel uploads/downloads based on network type (4G vs 3G).
*   **Retries**: Exponential backoff for transient failures.
*   **Resumability**: Tracks transfer state in `db.file_transfers` with an owner,
    expiring lease, heartbeat, persisted retry time, and stale-running recovery.
    A claim is transactional, so tabs cannot execute the same transfer concurrently.

### Upload Flow
1.  **Drafting**: File is computed locally, hash generated, blob stored in `file_blobs`.
2.  **Queueing**: A `file_transfer` record is created (status: `queued`).
3.  **Reservation**: The backend atomically reserves quota and creates an
    expiring, subject/workspace-bound, one-time upload intent.
4.  **Presigning**: The queue receives a short-lived URL bound to the intent,
    object ID, SHA-256, byte length, and MIME type.
5.  **Transfer**: The binary is uploaded directly to object storage.
6.  **Commit**: The server rechecks actual object metadata/checksum and atomically
    consumes the intent/reservation. Replays and mismatched subjects or metadata fail.

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
- `POST /api/storage/delete`

Those endpoints enforce `can()` authorization + rate limits and then delegate to the registered adapter to generate short-lived presigned URLs.
Deletion requires `workspace.write`; adapters derive the backend key from the
authorized workspace and content hash, reject mismatched provider storage IDs,
and treat an already-absent object as a successful retry.

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

### Provider registry API (client/runtime wiring)

Storage providers are selected through the storage provider registry:

- `registerStorageProvider({ id, order?, create })`
- `unregisterStorageProvider(id)`
- `useStorageProviders()` (reactive sorted list)
- `listStorageProviderIds()` (snapshot IDs)
- `getActiveStorageProvider()` (returns active provider instance or `null`)

`getActiveStorageProvider()` resolves the provider ID from `runtimeConfig.public.storage.provider` (fallback: Convex), then memoizes the instance per provider ID.

Typical gateway wiring pattern (used by `app/plugins/storage-transfer.client.ts`):

```ts
import { registerStorageProvider, useStorageProviders } from '~/core/storage/provider-registry';
import { createGatewayStorageProvider } from '~/core/storage/providers/gateway-storage-provider';

export default defineNuxtPlugin(() => {
    const providerId = useRuntimeConfig().public.storage?.provider;
    if (!providerId) return;

    const exists = useStorageProviders().value.some((item) => item.id === providerId);
    if (exists) return;

    registerStorageProvider({
        id: providerId,
        create: () =>
            createGatewayStorageProvider({
                id: providerId,
                displayName: `Gateway (${providerId})`,
            }),
    });
});
```

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
*   **Presigned URLs**: Upload and download URLs are capped at one hour; provider
    defaults are shorter. Commit authorization never relies on URL possession alone.

## Canonical metadata, quota, and garbage collection

Storage lifecycle decisions use the sync provider's materialized workspace state;
they never replay the retained sync change log. A sync gateway may expose bounded,
opaque-cursor pages for three views:

- live `file_meta` rows (`hash`, `sizeBytes`, optional `storageId`);
- live reference edges from `messages.file_hashes` and `posts.file_hashes`;
- unexpired upload quota reservations.

Quota is the sum of canonical live metadata plus active reservations. If the active
sync provider does not implement this query, quota enforcement fails closed instead
of undercounting from incomplete history.

Filesystem and S3 GC are available only with the same canonical query capability. They scan
a bounded number of retained objects, keeps an object when either live metadata or a
live reference edge exists, and rechecks both immediately before deleting the blob
and its commit sidecar/marker. Providers without canonical queries continue to report GC as
disabled. SQLite and Convex implement the same bounded canonical query contract;
there is no fallback to `pull()`.
