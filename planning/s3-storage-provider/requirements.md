# requirements.md

artifact_id: 7d7d3b3c-5d9a-4da7-90a8-64ebf1f6a64d

## Overview

Implement an **S3-compatible object storage provider** for OR3 Cloud that works with any S3 host (AWS S3, MinIO, Cloudflare R2, Backblaze B2 S3, Wasabi, etc.) while preserving OR3’s **local-first** storage model:

- Local metadata + blobs in Dexie (`file_meta`, `file_blobs`, `file_transfers`)
- Network transfers via `FileTransferQueue`
- SSR gateway endpoints (`/api/storage/*`) enforcing `can()` and rate limits

The provider will be shipped as a new Nuxt module package: **`or3-provider-s3`**, registering a `StorageGatewayAdapter` with ID `s3`.

### Key findings from existing implementations/docs

- `or3-provider-fs` and `or3-provider-convex` both implement **server-side** `StorageGatewayAdapter` registration; the client uses a gateway provider.
- Core already registers a **generic gateway client provider** when no provider-specific client plugin exists (see `app/plugins/storage-transfer.client.ts`).
- Current docs in [public/_documentation/cloud/storage-layer.md](public/_documentation/cloud/storage-layer.md) include an example that puts S3 credentials in client config. The S3 provider plan **must not** do this.
- Core presign endpoints accept `expires_in_ms` / `disposition` but do not pass them into adapters. To support S3 download UX and consistent TTL control, the plan includes a small core change to thread these options through.

## Roles

- End User: uploads and downloads attachments via OR3 UI.
- Instance Operator: configures S3 credentials, bucket, endpoint, and CORS.
- OR3 Maintainer: ensures provider follows SSR boundaries, security, and storage invariants.

## Requirements

### 1. Package and Provider Registration

1.1 As a Maintainer, I want an installable provider package, so that OR3 can enable S3 storage by configuration.

- Provider SHALL be published as `or3-provider-s3` and expose `or3-provider-s3/nuxt`.
- Provider SHALL register a `StorageGatewayAdapter` with ID `s3` from a Nitro server plugin.
- Provider SHALL only activate when `runtimeConfig.public.storage.enabled === true` and `runtimeConfig.public.storage.provider === 's3'`.
- Provider SHALL not import AWS SDK code into any client bundle.

1.2 As an Operator, I want clear boot-time diagnostics, so that misconfiguration is detected early.

- In strict mode, missing required S3 config SHALL fail startup with actionable errors.
- In non-strict mode, provider SHALL log warnings and remain idle.

### 2. Compatibility With Any S3 Host

2.1 As an Operator, I want endpoint flexibility, so that the provider works with non-AWS S3.

- Provider SHALL support a custom S3 endpoint URL.
- Provider SHALL support `forcePathStyle` for MinIO/older hosts.
- Provider SHALL support arbitrary regions (including `us-east-1`).

2.2 As a Maintainer, I want minimal assumptions, so that the same code works across AWS/R2/MinIO.

- Provider SHALL default to SigV4 signing using AWS SDK v3.
- Provider SHALL not rely on host-specific APIs.

### 3. Presigned Upload and Download

3.1 As a User, I want uploads to succeed reliably, so that attachments are stored without server proxying bytes.

- `presignUpload` SHALL return a short-lived presigned URL for direct `PUT` upload.
- Response SHALL include any required headers (at minimum `Content-Type`).
- The S3 object key SHALL be workspace-scoped to prevent cross-workspace collisions.

3.2 As a User, I want downloads to succeed reliably, so that attachments can be displayed and re-downloaded.

- `presignDownload` SHALL return a short-lived presigned URL for direct `GET` download.
- Download URLs SHALL reference the same workspace-scoped key naming used on upload.

3.3 As a Security Reviewer, I want TTL and response options controlled, so that URLs are not long-lived and UX options are consistent.

- Presigned TTL SHALL be bounded (default 15 minutes; max 24 hours).
- Core endpoints SHALL thread optional `expires_in_ms` and `disposition` through to adapters.

### 4. Integrity and Abuse Resistance

4.1 As a Security Reviewer, I want uploads verified on commit, so that clients cannot silently upload wrong content-type or oversized payloads.

- `commit` SHALL perform `HEAD` validation on the uploaded object:
  - content length MUST match the expected size (or be within a strictly-defined acceptable range if host quirks require it).
  - content type MUST match the expected MIME type (normalized).
- If validation fails, provider SHOULD delete the object and SHALL return an error.

4.2 As a Maintainer, I want optional checksum enforcement, so that correctness can be hardened for hosts that support it.

- Provider SHALL support an optional mode that requires checksum headers (`x-amz-checksum-sha256`) on upload.
- If enabled, `presignUpload` SHALL include the required checksum header and signing constraints.

### 5. Workspace Isolation and Keying

5.1 As a Security Reviewer, I want workspace isolation in object keys, so that one workspace cannot read another workspace’s blobs.

- Object key scheme SHALL include workspace ID as a prefix.
- Adapter SHALL validate workspace IDs and hashes before building keys.

5.2 As a Maintainer, I want stable key derivation, so that downloads do not depend on provider-specific storage IDs.

- Key derivation SHALL be deterministic from `(workspaceId, hash)` with an optional operator-configured prefix.
- `storageId` MAY be returned but SHALL be treated as an optimization/alias, not the source of truth.

### 6. Garbage Collection (Safe, Minimal)

6.1 As an Operator, I want safe cleanup of abandoned uploads, so that failed/aborted uploads do not accumulate forever.

- Provider SHALL implement `gc` that removes **uncommitted** objects older than a retention window.
- Provider SHALL define “committed” via a lightweight marker strategy compatible with S3 (e.g., `<blobKey>.meta.json`).
- GC SHALL respect `retention_seconds` and `limit` inputs.

### 7. Install Wizard Integration

7.1 As an Operator, I want S3 to be selectable in the install wizard, so that setup is guided and correct.

- Wizard provider catalog SHALL list storage provider `s3` as implemented.
- Wizard SHALL prompt for required S3 fields (endpoint, region, bucket, access key, secret key, path-style).
- Wizard SHALL write only wizard-owned env keys and preserve unrelated `.env` lines.

Env vars written for S3 storage SHALL use the `OR3_STORAGE_S3_*` namespace for consistency with existing providers (e.g. `OR3_STORAGE_FS_*`).

7.2 As a Maintainer, I want wizard validation to prevent broken setups.

- Wizard field-level validation SHALL enforce required fields when `storageProvider === 's3'`.
- Wizard authoritative validation SHALL continue to pass (`buildOr3CloudConfigFromEnv`).

### 8. Documentation

8.1 As an Operator, I want accurate docs, so that I don’t accidentally leak credentials or misconfigure CORS.

- Docs SHALL describe S3 provider as **server-signed presign via SSR gateway**, never client-side credentials.
- Docs SHALL include required bucket CORS settings and example policies.

### 9. Testing Strategy

9.1 As a Maintainer, I want strong automated test coverage, so that the provider behaves correctly across hosts.

- Provider package SHALL include unit tests for config validation, key derivation, and presign/commit behavior.
- OR3 core SHALL include integration tests verifying `/api/storage/*` with the S3 adapter registered.
- A host-compatibility integration test suite SHOULD run against MinIO.
