# Object Storage Layer

Authenticated storage writes (presign upload, commit, delete, and GC) require
JSON plus `x-or3-cloud-intent: mutation` from browser callers. The server
checks the exact origin against its effective request origin or
`OR3_ALLOWED_ORIGINS` before parsing the body. Originless API requests require
bearer authorization and no cookie.

Presign and commit are JSON control requests, not file-byte uploads. Their
declared and streamed bodies are bounded to 16 KiB before authentication or
provider work; oversized bodies return 413 and malformed JSON returns 400.

Physical deletion requires a storage adapter with deletion coordination version 1 matching the active sync backend. Canonical preflight reads alone do not authorize unlinking bytes. Uncoordinated adapters return 503 for deletion and report GC disabled with reason `deletion_coordination_required`.

The updated Convex scaffold records a private `storage_deletion_claims` barrier in the same transaction as physical deletion. Sync reference creation and metadata restoration honor that barrier. Only a hash-verified upload commit releases it; stale storage IDs remain invalid. These barriers are retained until verified re-upload or workspace purge, rather than expiring with sync history. The runtime probes `storage.deletionCapability` before cleanup, so older scaffolds fail closed. Deploy the matching schema, storage, sync and helper templates before enabling cleanup.

Filesystem physical cleanup is disabled until it can coordinate with canonical sync writes across instances. Files Trash and logical item removal remain available; operators should expect retained disk bytes.

The OR3 Storage Layer handles large binary assets (images, PDFs) separately from the main database sync. It uses a **local-first, hash-addressed** architecture with protected durable staging and a bounded reusable browser cache. Offline availability depends on whether a file is still cached.

---

## Architecture Overview

### 1. Hash-Addressed Storage (CAS)

All files are identified by their SHA-256 hash. This leads to several benefits:
*   **Deduplication**: Uploading the same file twice results in a single storage entry.
*   **Verification**: Content is verified against its hash on download.
*   **Immutability**: Files never change; they are only created or deleted.

### 2. Local-First Data Flow

*   **Metadata**: Stored in `db.file_meta` (synced via main DB sync).
*   **Binary Data**: Small originals stage in `db.file_blobs` until upload commits. Large selected files upload directly from the disk File. Downloaded originals are cached only within the current policy.
*   **Transfers**: Managed by `FileTransferQueue` (upload/download).

Cached original intake commits metadata, original bytes, and its upload job in
one IndexedDB transaction. Startup also repairs older originals missing a job in
bounded pages. Independent tabs atomically reuse active jobs. Each execution
uses a unique lease token; a worker that loses its claim aborts requests and
cannot publish progress, metadata, or completion for the replacement worker.
A local file deletion observed before native commit cancels that upload. A
verified replacement of physically deleted bytes preserves Trash state until
an explicit metadata restore.
Startup schedules unfinished work at both persisted retry times and future
lease expirations, including deadlines equal to the current millisecond.

While the browser is offline, transfers keep their retry budget and resume on
the online event. Network failures, timeouts, rate limits, and server outages
retain the original and defer work without consuming permanent-failure attempts.
Gateway control requests have a 60-second deadline; an entire byte transfer has
a five-minute deadline. Provider operations accept the caller's `AbortSignal`,
so cancellation and workspace changes also cancel control requests.

Transfer waiters observe durable state across tabs. When another tab completes
a download that policy excludes from the browser cache, the requesting tab
retrieves and verifies its own transient bytes. Such bytes are never persisted
outside the configured cache budget.

After this workspace's file settings have loaded in the current app session,
small originals can be saved locally while offline using those verified
settings. Connect once first if settings have not loaded. Reconnecting refreshes
the policy; the server enforces current upload limits before accepting bytes.

`file_meta.ref_count` is derived locally from reference edges in messages/posts;
it is never synced (sanitized out of sync payloads) and cannot be set remotely.

When a component needs an image:
1.  It checks `db.file_blobs` for the binary data.
2.  If missing, it requests a download via the Transfer Queue.
3.  Once downloaded, the blob URL is served locally.

---

## Browser cache and upload settings

In **Admin → Workspaces → select workspace → Cloud files and browser cache**, a deployment administrator can change the maximum cached original, browser cache budget, retention days, and maximum Cloud upload. Workspace owners can use **Admin → File settings**. Changes apply at the next file operation without a rebuild or restart. Values live in private workspace settings, outside client-writable sync KV.

Defaults: 10 MiB per cached file, 250 MiB reusable cache across this browser origin, and 14 days since successful upload or use. The initial upload limit comes from `OR3_MAX_CLOUD_FILE_SIZE_BYTES` (100 MiB by default); a saved admin setting overrides it, up to 1 GiB. Provider limits and workspace/server storage quotas still apply. A workspace’s budget counts cache bytes in other workspaces too, but cleanup only touches authorized copies in the active workspace.

Cleanup runs in bounded passes at startup and after transfers. Each pass advances past protected or unavailable entries so they cannot permanently block later expired copies; the scan wraps after reaching the end. It considers old or over-budget copies, proves that a current matching original exists in the same workspace and provider, then rechecks eligibility atomically before removing **only local blob bytes**. It never deletes remote files, metadata, or references. Use refreshes the last-access time. IndexedDB quota failures do not discard protected data. If cross-tab locks or origin inventory are unavailable, downloads skip cache admission.

Concurrent cleanup requests share one pass per workspace database. Dexie v30
adds a metadata-only cache-size index, so budgeting avoids loading every Blob;
missing or invalid inventory remains fail-closed. Each transfer obtains one fresh
file-policy response and reuses it for download admission and cleanup.

Cleanup asks presign-download for `verify_content: true`. An optional
`verifiedContent: { hash, sizeBytes }` must match the exact canonical storage ID,
full SHA-256 and local byte length. Convex uses its actual storage system checksum,
S3 requests the actual object's SHA-256 on HEAD, and filesystem storage securely
opens and hashes the original on the server. This avoids downloading an original
merely to prove it is redundant. Missing or mismatched proofs retain full-byte
verification; failed verification keeps the local copy. Ordinary downloads still
verify their received bytes. Collapsed message attachment loading and prefetch
stop at the four visible thumbnails; opening the full list loads further files.
Assistant replies still load and prefetch every inline image.

Local-only originals, unknown legacy blobs, and files with unfinished uploads or metadata sync remain protected. Failed upload history stays until a successful retry resolves it. Protected staging can exceed the cache budget: cleanup cannot turn the budget into a reason to delete the only copy. Existing legacy bytes are retained conservatively. Static builds keep the configured 20 MiB default, impose a 50 MiB per-file ceiling on new intake/restore, preflight available storage, and never expire originals automatically.

Selected files above the cache threshold upload without IndexedDB staging; attachments appear only after commit. Keep the disk source until completion and reselect it after interruption. Large generated Blobs are refused until saved to disk and selected. Large downloads may use transient browser memory for display but never enter the persistent cache. See [workspace backup](/documentation/database/backup) for independent recovery of originals absent from the browser.

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
    The host also rereads current `workspace.write` membership after quota
    observations and after the signer returns. Removed or demoted writers
    receive no upload URL. Provider-owned intents and reservations retain
    their existing expiry and cleanup contract; the host does not cancel an
    intent already allocated by a signer.
5.  **Transfer**: The binary is uploaded directly to object storage.
6.  **Commit**: The server rechecks actual object metadata/checksum and atomically
    consumes the intent/reservation. Exact consumed-receipt replay can recover a
    failed commit-marker write within the original authorization lifetime. After
    expiry, transfer retries obtain a fresh presign and reservation; changed
    subjects, metadata, or storage IDs fail.

### Download Flow
1.  **Request**: UI components use `useObjectUrl(hash)` or explicit `queue.download(hash)`.
2.  **Queueing**: A transfer is created if the blob is missing locally.
3.  **Presigning**: Fetches a signed download URL (`/api/storage/presign-download`).
    The gateway only signs a canonical live `file_meta` row in the requested
    workspace that has a provider storage ID; pending uploads, soft-deleted
    rows, and hashes from another workspace return the same not-found response.
    The host rereads current workspace membership after canonical metadata and
    after the signer returns. Removal prevents signing or delivery; viewers
    retain read permission. An unavailable membership store returns 503. These
    checks add two membership reads per successful signing request. If host
    authorization invalidation occurs while a membership read is pending, the
    stale result is discarded and the read is retried up to three times;
    sustained contention returns 503. This fence uses the existing process-local
    invalidation revision and does not establish distributed revocation.
4.  **Stream**: The file is downloaded and verified against its hash.
5.  **Cache**: Eligible small blobs enter `file_blobs` within the browser budget. Larger downloads are returned to the active caller without persistent caching.

Filesystem download tokens also bind the issuing user and workspace. The
download route rechecks `workspace.read` on each request: another user, a
different active workspace, or a removed member cannot use an issued token.
Filesystem authorization applies when each download request starts. A request
that passed this check can finish after membership removal; cancellation of an
already-authorized stream is not part of this contract. Its file path remains
bound to the verified token, and a subsequent request must pass authorization
again. Host signing checks do not promise cancellation of in-flight downloads.
Viewers retain read access after a role downgrade. Tokens expire; deleting a
canonical metadata row prevents new signing, but an already-issued filesystem
token can still serve retained bytes until it expires or the object is removed.

Convex downloads use user-bound host URLs with a five-minute default and a
fifteen-minute maximum. Each retrieval rechecks the session, workspace
membership, and live canonical storage identity before streaming bytes with
canonical response headers. Native Convex URLs remain server-only. Like
filesystem downloads, a stream already authorized can finish after access is
revoked.
For server archives, storage gateways may implement `readBackupFile(event,
{ workspaceId, hash, storageId })` to stream the exact retained original as a
`Response`. Sync gateways may implement `backupSnapshot` with the existing
snapshot request/response contract to preserve retained file metadata. These
are server-only capabilities; ordinary presign and sync requests cannot select
them. Convex requires both capabilities and matching deployed templates.
Membership and object identity are rechecked after opening the stream; source
files and upload intents are never modified. Other providers continue through
their authorized snapshot and download paths. Archive size/hash verification
still applies to every original, including Trash.

Previously exposed native Convex URLs remain bearer links until the underlying
file is deleted; the new host route does not revoke historical links.

S3 downloads use provider URLs directly. An issued URL does not pass
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

First-party updated adapters enforce retained quota atomically: distinct committed
hashes remain charged after Trash, metadata deletion and upload-intent expiry,
plus the maximum unexpired reservation for each new hash. Re-uploading the same
retained hash does not double-charge; an upload larger than the retained size
reserves the difference, including when old metadata understated its size.
SQLite migration 026 backfills a retained
hash ledger and indexed usage total, including consumed receipts, and maintains
it transactionally for native SQLite and D1. Convex backfills metadata in
200-row mutation pages before issuing upload authority, then uses indexed totals
and active-intent expiry ranges. A large unfinished backfill returns retryable
503 instead of bypassing the budget. Quota exhaustion returns non-retryable
HTTP 413. Coordinated Convex physical deletion and GC release a
charge only when no metadata alias remains for that hash, including legacy hash
casing and metadata synced directly into Trash.

The server skips its full metadata quota scan only when the adapter advertises
`atomicUploadQuota: 'retained-v1'`; other adapters retain the existing host
preflight and must still reserve atomically. Deploy the matching Convex schema,
`storageUsage.ts`, storage and sync authoring helpers together. With a configured
quota, stale Convex templates fail closed until upgraded.

Set `OR3_STORAGE_WORKSPACE_QUOTA_BYTES` to an explicit positive byte budget in
production. Its existing default remains unlimited; the per-file upload limit
is not a total storage cap. Retained quota is conservative admission accounting,
not an exact physical inventory or a provider billing cap: incomplete uploads,
unclassified objects, database history, egress and function usage can still cost
money. Use the provider's own spend controls and usage alerts as well.

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
- `canonical.reservedUploadBytes` represents unexpired pending upload charges, not
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

Usage observations remain read-only and distinct from retained admission totals.
Deleting logical metadata does not release a retained charge on SQLite or the
filesystem/S3 pairing. The generic legacy quota traversal rejects malformed
pages, repeated cursors, conflicting aliases/identities and unsafe integer totals.
It does not replace the provider's transactional admission check.

### Physical cleanup remains incomplete

The accounting changes do **not** implement or activate filesystem reclamation.
The provider still returns `deletion_coordination_required`. Existing
restore/reference/hash-reuse tests verify this refusal only, not a deleting
collector. See [the coordination design](https://github.com/Saluana/or3-chat/blob/or3-cloud/docs/storage-cleanup-coordination.md)
for the remaining implementation and acceptance gates.

## Restart maintenance

An announced 503 maintenance response with retry metadata defers queued blob transfer without spending permanent-failure attempts. Pending bytes remain local, and the next attempt requests a fresh presigned URL. Authentication and validation errors retain their existing semantics. See [server restarts](/documentation/cloud/operations).
