# tasks.md

artifact_id: 4c8dc8c7-fd67-4080-b8de-2ddc0393a4e9

## Implementation Checklist

### 1. Core storage gateway option threading

- [x] **1.1 Update gateway request types** (Requirements: 3.3)
  - [x] Extend `PresignUploadRequest` / `PresignDownloadRequest` with `expiresInMs?: number` and `disposition?: string` in [server/storage/gateway/types.ts](server/storage/gateway/types.ts).
  - [x] Ensure existing adapters compile (fs/convex).

- [x] **1.2 Forward options into adapters** (Requirements: 3.3)
  - [x] Forward `expires_in_ms` and `disposition` from [server/api/storage/presign-upload.post.ts](server/api/storage/presign-upload.post.ts) into `adapter.presignUpload(...)`.
  - [x] Forward `expires_in_ms` and `disposition` from [server/api/storage/presign-download.post.ts](server/api/storage/presign-download.post.ts) into `adapter.presignDownload(...)`.
  - [x] Add/adjust core tests under [server/api/storage/__tests__](server/api/storage/__tests__) to cover the new forwarding behavior.

### 2. Wizard integration (make `s3` selectable)

- [x] **2.1 Extend wizard answer types** (Requirements: 7.1, 7.2)
  - [x] Add `s3Endpoint`, `s3Region`, `s3Bucket`, `s3AccessKeyId`, `s3SecretAccessKey`, `s3SessionToken?`, `s3ForcePathStyle`, `s3KeyPrefix?`, `s3UrlTtlSeconds`, `s3RequireChecksum` to `WizardAnswers` in [shared/cloud/wizard/types.ts](shared/cloud/wizard/types.ts).

- [x] **2.2 Add S3 provider to catalog** (Requirements: 7.1)
  - [x] Add a `storage` descriptor with `id: 's3'`, `implemented: true`, docs URL, dependencies (`or3-provider-s3`) in [shared/cloud/wizard/catalog.ts](shared/cloud/wizard/catalog.ts).
  - [x] Define wizard fields with defaults and help text emphasizing CORS + endpoint/path-style.
  - [x] Add the new secret keys to `SECRET_ANSWER_KEYS` (access key, secret key, session token).
  - [x] Add env keys to `WIZARD_OWNED_ENV_KEYS` (see 2.3).

- [x] **2.3 Derive env outputs for S3** (Requirements: 7.1)
  - [x] Map wizard answers to env keys in [shared/cloud/wizard/derive.ts](shared/cloud/wizard/derive.ts):
    - `OR3_STORAGE_S3_ENDPOINT`
    - `OR3_STORAGE_S3_REGION`
    - `OR3_STORAGE_S3_BUCKET`
    - `OR3_STORAGE_S3_ACCESS_KEY_ID`
    - `OR3_STORAGE_S3_SECRET_ACCESS_KEY`
    - `OR3_STORAGE_S3_SESSION_TOKEN` (optional)
    - `OR3_STORAGE_S3_FORCE_PATH_STYLE`
    - `OR3_STORAGE_S3_KEY_PREFIX` (optional)
    - `OR3_STORAGE_S3_URL_TTL_SECONDS`
    - `OR3_STORAGE_S3_REQUIRE_CHECKSUM`
    - optional SSE keys if implemented

- [x] **2.4 Wizard validation rules** (Requirements: 7.2)
  - [x] Add field-level validation for S3 when `storageProvider === 's3'` in [shared/cloud/wizard/validation.ts](shared/cloud/wizard/validation.ts).
  - [x] Ensure secrets remain redacted in summaries.

### 3. Create the `or3-provider-s3` package (new repo folder)

- [x] **3.1 Scaffold provider package** (Requirements: 1.1)
  - [x] Create sibling package `or3-provider-s3/` mirroring `or3-provider-fs` structure (`src/module.ts`, `src/runtime/server/plugins/register.ts`, `shims/`, `vitest.config.ts`, etc.).
  - [x] Add dependencies:
    - `@aws-sdk/client-s3`
    - `@aws-sdk/s3-request-presigner`
  - [x] Ensure all S3 logic is in `runtime/server/**`.

- [x] **3.2 Implement config validation** (Requirements: 1.2, 2.1)
  - [x] Add `s3-config.ts` with strict/non-strict diagnostics (endpoint/region/bucket/creds/path-style/ttl/checksum).
  - [x] Bound TTL (default 900s; max 86400s).

- [x] **3.3 Implement key helpers** (Requirements: 5.1, 5.2)
  - [x] Add deterministic key derivation helper (`blobKey`, `markerKey`).
  - [x] Validate workspace ID and hash format.

### 4. Implement `S3StorageGatewayAdapter`

- [x] **4.1 Presign upload** (Requirements: 3.1, 4.2, 5.1)
  - [x] Implement `presignUpload` returning `PUT` URL + required headers and `storageId`.
  - [x] Include `ContentType` and optional checksum requirement.
  - [x] Ensure `Metadata` includes `or3-hash` and `or3-workspace`.

- [x] **4.2 Presign download** (Requirements: 3.2, 3.3)
  - [x] Implement `presignDownload` returning `GET` URL.
  - [x] Use `disposition` to set `ResponseContentDisposition` after core threading change.

- [x] **4.3 Commit verification + marker write** (Requirements: 4.1, 6.1)
  - [x] `HEAD` the object and verify size/content-type.
  - [x] On success, `PUT` marker JSON object at `<blobKey>.meta.json`.
  - [x] On mismatch, best-effort delete of blob object and return error.

- [x] **4.4 GC** (Requirements: 6.1)
  - [x] Implement `gc` via `ListObjectsV2` prefix scan + marker detection.
  - [x] Batch delete with `DeleteObjects` respecting `limit`.

- [x] **4.5 Nitro registration plugin** (Requirements: 1.1)
  - [x] Register adapter only when config selects `storage.provider === 's3'`.

### 5. Provider tests (vitest)

- [x] **5.1 Unit tests for config + keys** (Requirements: 1.2, 5.1)
  - [x] strict/non-strict behavior
  - [x] path-style + endpoint parsing
  - [x] key prefix normalization

- [x] **5.2 Adapter unit tests (mock AWS SDK)** (Requirements: 3.1–3.3, 4.1–4.2, 6.1)
  - [x] `presignUpload` passes correct `PutObjectCommand` inputs
  - [x] checksum mode includes checksum header/signing
  - [x] `commit` validates HEAD result and writes marker
  - [x] `gc` deletes only uncommitted objects older than cutoff

### 6. OR3 core integration tests

- [x] **6.1 Route tests with adapter registered** (Requirements: 3.3, 7.2)
  - [x] Add tests confirming `expires_in_ms` and `disposition` are forwarded.
  - [x] Add a lightweight stub adapter used by tests to capture inputs.

### 7. MinIO compatibility test suite (recommended)

- [x] **7.1 Add an opt-in integration suite** (Requirements: 2.1, 9.1)
  - [x] Provide an opt-in env-based integration test (`OR3_S3_INTEGRATION_TESTS=true`) that can run against MinIO/S3-compatible hosts.

### 8. Documentation updates

- [x] **8.1 Add provider docs page** (Requirements: 8.1)
  - [x] Create a new doc page: `public/_documentation/cloud/provider-s3.md` describing setup, env vars, and CORS.
  - [x] Add to doc map (`public/_documentation/docmap.json`) under Cloud.

- [x] **8.2 Fix unsafe S3 example** (Requirements: 8.1)
  - [x] Update [public/_documentation/cloud/storage-layer.md](public/_documentation/cloud/storage-layer.md) to remove client-credential example and describe gateway-signed presign.

### 9. Final verification

- [ ] **9.1 Manual smoke test** (Requirements: 3.1, 3.2)
  - [ ] Run SSR dev server with S3/MinIO configured.
  - [ ] Upload image, preview, reload, ensure download + hash verify succeeds.

- [ ] **9.2 Wizard flow validation** (Requirements: 7.1)
  - [ ] Run `bun run or3-cloud:init`, select Storage = S3, verify env outputs and generated provider modules include `or3-provider-s3/nuxt`.

Note: Wizard integration is covered by unit tests; the interactive CLI run above is still recommended as a manual sanity check.
