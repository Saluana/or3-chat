# Object Storage Layer

Authenticated storage writes (presign upload, commit, delete, and GC) require
JSON plus `x-or3-cloud-intent: mutation` from browser callers. The server
checks the exact origin against its effective request origin or
`OR3_ALLOWED_ORIGINS` before parsing the body. Originless API requests require
bearer authorization and no cookie.

Physical deletion requires a storage adapter with deletion coordination version 1 matching the active sync backend. Canonical preflight reads alone do not authorize unlinking bytes. Uncoordinated adapters return 503 for deletion and report GC disabled with reason `deletion_coordination_required`.

The updated Convex scaffold records a private `storage_deletion_claims` barrier in the same transaction as physical deletion. Sync reference creation and metadata restoration honor that barrier. Only a hash-verified upload commit releases it; stale storage IDs remain invalid. These barriers are retained until verified re-upload or workspace purge, rather than expiring with sync history. The runtime probes `storage.deletionCapability` before cleanup, so older scaffolds fail closed. Deploy the matching schema, storage, sync and helper templates before enabling cleanup.

Filesystem physical cleanup is disabled until it can coordinate with canonical sync writes across instances. Files Trash and logical item removal remain available; operators should expect retained disk bytes.

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
    The gateway only signs a canonical live `file_meta` row in the requested
    workspace that has a provider storage ID; pending uploads, soft-deleted
    rows, and hashes from another workspace return the same not-found response.
4.  **Stream**: The file is downloaded and verified against its hash.
5.  **Cache**: The blob is stored in `file_blobs` for future offline use.

Filesystem download tokens also bind the issuing user and workspace. The
download route rechecks `workspace.read` on each request: another user, a
different active workspace, or a removed member cannot use an issued token.
Viewers retain read access after a role downgrade. Tokens expire; deleting a
canonical metadata row prevents new signing, but an already-issued filesystem
token can still serve retained bytes until it expires or the object is removed.

S3 and Convex downloads use provider URLs directly. An issued URL does not pass
through the application authorization check again, so membership changes alone
do not revoke it immediately. Treat these URLs as sensitive and account for the
provider's URL lifetime. Downloaded offline copies and exported files are also
outside server-side revocation.

---

## Storage Providers

The system supports pluggable backends via the `ObjectStorageProvider` interface.

### First-party backends

Managed Cloud uses [filesystem storage](/documentation/cloud/provider-fs). Source deployments can use [Convex](/documentation/cloud/provider-convex) or [S3-compatible storage](/documentation/cloud/provider-s3). The canonical workspace/sync backend still supplies authorized file metadata; selecting an object store does not create an independent workspace database.

Honor the upload method returned by presign metadata. The filesystem token endpoint `/api/storage/fs/upload?token=…` is **PUT-only**; default to PUT for that endpoint when method metadata is absent. A successful byte upload is not a committed file until the authorized commit step verifies the declared hash, size, and upload intent.

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

- [cloud/provider-s3](/documentation/cloud/provider-s3)

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

For backend-specific credentials, persistence, URL lifetime, and limitations, use the provider guides above rather than assuming a pricing or compatibility guarantee for any S3-compatible service.

---

## Security & Validation

*   **MIME Types**: Uploads use the built-in image/PDF/text allowlist unless an
    administrator explicitly enables `storage.allowAnyFileType`.
*   **Generic files**: Generic and active-content files download as
    `application/octet-stream` attachments with `nosniff`; only supported raster
    images and PDFs retain inline serving.
*   **Reader compatibility**: Gateway sync and storage requests advertise the
    typed file-kind `v1` capability. If a generic file record would cross an
    older reader or writer boundary, the host rejects the complete operation
    with HTTP 426 and directs the client to update OR3 Chat before applying or
    committing the record.
*   **Empty files**: Zero-byte generic files are valid and remain hash checked.
*   **Size Limits**: Enforced at the Gateway level (default 100MB).
*   **Permissions**: `requireCan(session, 'workspace.write')` checks on all operations.
*   **Rate Limiting**: Existing per-user operation limits reserve each admitted
    presign or commit request before asynchronous provider work. Parallel calls
    share the configured allowance, including provider attempts that later fail;
    denied rate checks do not consume another slot. HTTP 429 includes
    `Retry-After`. Cache expiry respects operator-configured rate windows.
*   **Hash Verification**: Files verified against SHA-256 hash after download.
*   **Presigned URLs**: Upload and download URLs are capped at one hour; provider
    defaults are shorter. Download signing also checks the provider's commit
    marker/sidecar, so a raw hash or uncommitted object is never sufficient.
    Commit authorization never relies on URL possession alone.

## Canonical metadata, quota, and garbage collection

Storage lifecycle decisions use the sync provider's materialized workspace state;
they never replay the retained sync change log. A sync gateway may expose bounded,
opaque-cursor pages for these views:

- live `file_meta` rows (`hash`, `sizeBytes`, optional `storageId`);
- live reference edges from `messages.file_hashes` and `posts.file_hashes`;
- unexpired upload quota reservations;
- deleted materialized metadata when the provider advertises
  `capabilities.retainedStorageMetadata: 'v1'` (read-only accounting).

Quota is the sum of canonical live metadata plus active reservations. If the active
sync provider does not implement this query, quota enforcement fails closed instead
of undercounting from incomplete history.

Filesystem and S3 destructive GC remain disabled until they own deletion coordination
with the canonical backend. Canonical queries and pre-delete rechecks alone cannot
prevent concurrent restores or new reference writes. They return
`deletion_coordination_required` without scanning or deleting objects. SQLite and
Convex implement the bounded canonical query contract; there is no fallback to `pull()`.

### Read-only filesystem usage observation

With the matching filesystem provider, **Admin → System → Provider actions →
Observe Storage Usage** returns a bounded observation. It does not reclaim bytes
or supply GC candidates. Each result includes start/end timestamps, warnings,
completion flags, and `consistency: "non_atomic_observation"`.

- `canonical.activeMetadataBytes` is logical live metadata, not disk allocation.
- `canonical.retainedDeletedMetadataBytes` covers deleted materialized rows.
  An older provider or a delete-before-put row with unknown size yields unknown
  accounting (`null`), never an invented zero. Log pruning does not erase it.
- `canonical.reservedUploadBytes` represents active upload reservations, not
  bytes proven present on disk.
- Filesystem categories distinguish observed active blobs, retained deleted
  blobs, incomplete transfers, sidecars, and unclassified files.
- `apparentFileBytes` sums observed file lengths. `allocatedFileBytes` counts
  observed filesystem blocks and deduplicates hard-linked inodes; it excludes
  directory/DB/other workspace overhead. Neither is a promise of reclaimable space.
- Volume totals describe the containing filesystem, not a workspace quota.

Scans and canonical pages can change during observation. Partial, unavailable,
ambiguous, unsupported, and malformed results stay explicit. A bounded scan may
leave files unclassified; unknown is not zero. An observation is not an atomic
inventory and must never authorize deletion.

Quota policy remains logical live metadata plus reservations. Deleting metadata
can release logical quota while the bytes remain on disk. Quota traversal rejects
malformed pages, repeated cursors, conflicting aliases/identities, and unsafe
integer totals instead of returning an understated value. It does not introduce a
cross-provider transactional snapshot or replace provider-owned atomic admission.

### Physical cleanup remains incomplete

The accounting changes do **not** implement or activate filesystem reclamation.
The provider still returns `deletion_coordination_required`. Existing
restore/reference/hash-reuse tests verify this refusal only, not a deleting
collector. See [the coordination design](https://github.com/Saluana/or3-chat/blob/or3-cloud/docs/storage-cleanup-coordination.md)
for the remaining implementation and acceptance gates.
