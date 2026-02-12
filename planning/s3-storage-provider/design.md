# design.md

artifact_id: 01d9d2bd-b076-40a2-93a8-93ddccac2d4c

## Overview

This design adds an S3-compatible storage backend to OR3 Cloud by implementing a **server-side** `StorageGatewayAdapter` in a new provider package, `or3-provider-s3`.

Principles:

- **Local-first stays unchanged**: client continues to hash files, store blobs locally, and queue transfers.
- **Server is the policy gate**: `can()` enforcement, rate limits, MIME allowlists, and size limits stay in core endpoints.
- **No secrets in the browser**: access keys never reach client bundles.
- **Compatibility-first**: explicit support for custom endpoints and path-style.

## Architecture

### High-level flow

```mermaid
sequenceDiagram
  participant UI as OR3 UI (client)
  participant API as OR3 SSR API (/api/storage/*)
  participant S3 as S3-compatible storage

  UI->>API: POST /api/storage/presign-upload {workspace_id, hash, mime_type, size_bytes, expires_in_ms, disposition}
  API->>API: resolveSessionContext + requireCan(workspace.write) + rate limit + size/MIME checks
  API->>API: S3StorageGatewayAdapter.presignUpload(...)
  API-->>UI: { url, method: PUT, headers, expiresAt, storageId }
  UI->>S3: PUT presignedUrl (Blob)
  UI->>API: POST /api/storage/commit {workspace_id, hash, storage_id, storage_provider_id, mime_type, size_bytes, ...}
  API->>API: requireCan(workspace.write) + rate limit
  API->>S3: HEAD object + (optional) put marker object
  API-->>UI: { ok: true }

  UI->>API: POST /api/storage/presign-download {workspace_id, hash, storage_id, expires_in_ms, disposition}
  API->>API: resolveSessionContext + requireCan(workspace.read) + rate limit
  API->>API: S3StorageGatewayAdapter.presignDownload(...)
  API-->>UI: { url, method: GET, expiresAt }
  UI->>S3: GET presignedUrl
  UI->>UI: verify sha256(blob) matches hash; cache blob
```

### Core vs provider responsibilities

- Core (OR3 Chat):
  - `/api/storage/presign-upload`, `/api/storage/presign-download`, `/api/storage/commit`, `/api/storage/gc/run`
  - `can()` authorization and rate limits
  - size and MIME allowlist enforcement
  - transfer queue and local hash verification on download

- `or3-provider-s3`:
  - registers `StorageGatewayAdapter` for ID `s3`
  - generates presigned PUT/GET URLs
  - performs `HEAD` verification and commit-marker write
  - implements safe GC for uncommitted objects

## Core contract adjustments (small but important)

### Problem

Core endpoints accept these fields but do not pass them into adapters:

- `expires_in_ms`
- `disposition`

This prevents providers like S3 from correctly:

- honoring caller TTL requests (bounded)
- signing `ResponseContentDisposition` on downloads

### Change

1. Update [server/storage/gateway/types.ts](server/storage/gateway/types.ts) request types:

- `PresignUploadRequest` add:
  - `expiresInMs?: number`
  - `disposition?: string`
- `PresignDownloadRequest` add:
  - `expiresInMs?: number`
  - `disposition?: string`

2. Update core routes to forward these fields to adapter methods:

- [server/api/storage/presign-upload.post.ts](server/api/storage/presign-upload.post.ts)
- [server/api/storage/presign-download.post.ts](server/api/storage/presign-download.post.ts)

3. Update existing adapters (`fs`, `convex`) to accept and ignore or honor them.

## `or3-provider-s3` package design

### Package layout (mirrors existing providers)

- `src/module.ts` — Nuxt module, adds Nitro plugin
- `src/runtime/server/plugins/register.ts` — validates config + calls `registerStorageGatewayAdapter({ id: 's3', ... })`
- `src/runtime/server/storage/s3-config.ts` — env + runtime config validation
- `src/runtime/server/storage/s3-keys.ts` — key derivation helpers
- `src/runtime/server/storage/s3-adapter.ts` — `S3StorageGatewayAdapter`
- `src/runtime/server/storage/s3-gc.ts` — GC implementation helper
- `src/runtime/server/storage/__tests__/*` — unit tests

### Configuration (env-first)

All values are **server-only**.

Required:

- `OR3_STORAGE_S3_ENDPOINT` (optional for AWS; required for most compat hosts)
- `OR3_STORAGE_S3_REGION`
- `OR3_STORAGE_S3_BUCKET`
- `OR3_STORAGE_S3_ACCESS_KEY_ID`
- `OR3_STORAGE_S3_SECRET_ACCESS_KEY`

Optional:

- `OR3_STORAGE_S3_SESSION_TOKEN`
- `OR3_STORAGE_S3_FORCE_PATH_STYLE=true|false`
- `OR3_STORAGE_S3_KEY_PREFIX` (e.g. `or3/`)
- `OR3_STORAGE_S3_URL_TTL_SECONDS` (default 900, max 86400)
- `OR3_STORAGE_S3_REQUIRE_CHECKSUM=true|false` (default false)
- `OR3_STORAGE_S3_SSE` (`none|AES256|aws:kms`)
- `OR3_STORAGE_S3_SSE_KMS_KEY_ID` (if SSE is `aws:kms`)

### Key scheme

We store by content hash but scope by workspace:

- blob key: `${prefix}${workspaceId}/${hash}`
- marker key: `${blobKey}.meta.json`

Notes:

- `hash` is the OR3 CAS string (e.g. `sha256:<hex>`).
- The marker object is used only for “commit state” and safe GC of abandoned uploads (same safety level as FS provider GC).

### Adapter: `S3StorageGatewayAdapter`

#### `presignUpload(event, input)`

- Validations:
  - `workspaceId` matches safe pattern (same as FS provider: `^[a-zA-Z0-9_-]+$`)
  - `hash` matches OR3 `sha256:<hex>`
- Build `key = blobKey(workspaceId, hash)`
- Create `PutObjectCommand` with:
  - `Bucket`, `Key`, `ContentType`
  - `Metadata: { 'or3-hash': hash, 'or3-workspace': workspaceId }`
  - Optional checksum: `ChecksumSHA256` derived from hash hex → base64
  - Optional SSE headers
- Presign URL with bounded TTL.
- Return:
  - `url`
  - `method: 'PUT'`
  - `headers`:
    - `Content-Type: <mime>`
    - `x-amz-meta-or3-hash: <hash>` (only if required by signer/SDK behavior)
    - `x-amz-checksum-sha256: <base64>` (only if checksum mode enabled)
  - `storageId: key`
  - `expiresAt`

#### `presignDownload(event, input)`

- Resolve key from `input.storageId` when present, else derive from `(workspaceId, hash)`.
- Create `GetObjectCommand` with:
  - `Bucket`, `Key`
  - If `disposition` is provided (after core threading change), set `ResponseContentDisposition`.
- Presign and return URL + `expiresAt`.

#### `commit(event, input)`

- Parse and validate commit payload (Zod schema matching core commit shape).
- Determine key:
  - prefer `storage_id` but verify it matches derived workspace prefix
- `HeadObject`:
  - verify `ContentLength === size_bytes`
  - verify normalized `ContentType` matches `mime_type`
  - if checksum mode enabled and host returns checksum, verify checksum where possible
- Write marker:
  - `PutObject` to marker key with small JSON body:
    - `workspace_id`, `hash`, `committed_at`, `size_bytes`, `mime_type`, `etag`
- Failure behavior:
  - If HEAD fails with `NotFound` → 404
  - If validation fails → 400 and best-effort delete of blob key

#### `gc(event, input)`

- List objects with prefix `${prefix}${workspaceId}/`.
- Compute committed set by detecting marker keys (`.meta.json`).
- Delete candidates (bounded by `limit`):
  - blob objects older than cutoff **without** marker
  - marker objects older than cutoff **without** blob
- Delete using `DeleteObjects` batch ops.

## Error handling

- Use `createError({ statusCode, statusMessage })`.
- Map AWS SDK errors to:
  - 400 for invalid inputs
  - 401/403 are handled by core `can()` gates (adapter should not re-check)
  - 404 when object not found
  - 502/503 for upstream S3 failures/timeouts

## CORS requirements (operator-facing)

Because uploads/downloads are direct from browser to S3 host:

- Bucket CORS must allow:
  - Methods: `GET`, `PUT`, `HEAD`
  - Headers: `Content-Type`, `x-amz-*` (including checksum + metadata)
  - Origins: OR3 site origin(s)
  - Expose headers: `ETag`, `Content-Length`

The provider docs will include a minimal CORS JSON example for AWS and MinIO.

## Security considerations

- Credentials are **server-only** and never appear under `runtimeConfig.public`.
- Presigned URLs are short-lived and protected by core auth (`can()`), rate limits, and size/MIME gates.
- Commit step closes the “browser cannot enforce content-length” gap by verifying object size.
- Optional checksum enforcement provides stronger upload integrity where supported.

## Testing strategy (design-level)

### Unit tests (fast)

- config validation: required fields, strict vs non-strict behavior
- key derivation: prefix rules, workspace + hash validation
- presign behavior: calls to `getSignedUrl` with correct command inputs
- commit behavior: HEAD validations + marker writes + delete-on-failure
- GC behavior: object listing classification + deletion batching and limits

### Integration tests (no network)

- OR3 core route tests that register the adapter and verify:
  - `/api/storage/presign-upload` forwards TTL/disposition correctly
  - `/api/storage/commit` dispatches to adapter

### Compatibility tests (real S3 via MinIO)

- Start MinIO in CI (Docker) for a dedicated test suite.
- Execute:
  - presign upload → PUT bytes via fetch → commit → presign download → GET → verify bytes
  - aborted upload without commit → run GC with small retention → verify deletion

### E2E (Playwright, optional)

- Using SSR dev server + MinIO:
  - attach file in UI → ensure preview displays → reload → ensure it re-downloads and verifies
