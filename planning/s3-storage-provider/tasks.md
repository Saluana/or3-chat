# tasks.md

artifact_id: 4c8dc8c7-fd67-4080-b8de-2ddc0393a4e9

## Implementation Checklist

### 1. Core storage gateway option threading

- [ ] **1.1 Update gateway request types** (Requirements: 3.3)
  - [ ] Extend `PresignUploadRequest` / `PresignDownloadRequest` with `expiresInMs?: number` and `disposition?: string` in [server/storage/gateway/types.ts](server/storage/gateway/types.ts).
  - [ ] Ensure existing adapters compile (fs/convex).

- [ ] **1.2 Forward options into adapters** (Requirements: 3.3)
  - [ ] Forward `expires_in_ms` and `disposition` from [server/api/storage/presign-upload.post.ts](server/api/storage/presign-upload.post.ts) into `adapter.presignUpload(...)`.
  - [ ] Forward `expires_in_ms` and `disposition` from [server/api/storage/presign-download.post.ts](server/api/storage/presign-download.post.ts) into `adapter.presignDownload(...)`.
  - [ ] Add/adjust core tests under [server/api/storage/__tests__](server/api/storage/__tests__) to cover the new forwarding behavior.

### 2. Wizard integration (make `s3` selectable)

- [ ] **2.1 Extend wizard answer types** (Requirements: 7.1, 7.2)
  - [ ] Add `s3Endpoint`, `s3Region`, `s3Bucket`, `s3AccessKeyId`, `s3SecretAccessKey`, `s3SessionToken?`, `s3ForcePathStyle`, `s3KeyPrefix?`, `s3UrlTtlSeconds`, `s3RequireChecksum` to `WizardAnswers` in [shared/cloud/wizard/types.ts](shared/cloud/wizard/types.ts).

- [ ] **2.2 Add S3 provider to catalog** (Requirements: 7.1)
  - [ ] Add a `storage` descriptor with `id: 's3'`, `implemented: true`, docs URL, dependencies (`or3-provider-s3`) in [shared/cloud/wizard/catalog.ts](shared/cloud/wizard/catalog.ts).
  - [ ] Define wizard fields with defaults and help text emphasizing CORS + endpoint/path-style.
  - [ ] Add the new secret keys to `SECRET_ANSWER_KEYS` (access key, secret key, session token).
  - [ ] Add env keys to `WIZARD_OWNED_ENV_KEYS` (see 2.3).

- [ ] **2.3 Derive env outputs for S3** (Requirements: 7.1)
  - [ ] Map wizard answers to env keys in [shared/cloud/wizard/derive.ts](shared/cloud/wizard/derive.ts):
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

- [ ] **2.4 Wizard validation rules** (Requirements: 7.2)
  - [ ] Add field-level validation for S3 when `storageProvider === 's3'` in [shared/cloud/wizard/validation.ts](shared/cloud/wizard/validation.ts).
  - [ ] Ensure secrets remain redacted in summaries.

### 3. Create the `or3-provider-s3` package (new repo folder)

- [ ] **3.1 Scaffold provider package** (Requirements: 1.1)
  - [ ] Create sibling package `or3-provider-s3/` mirroring `or3-provider-fs` structure (`src/module.ts`, `src/runtime/server/plugins/register.ts`, `shims/`, `vitest.config.ts`, etc.).
  - [ ] Add dependencies:
    - `@aws-sdk/client-s3`
    - `@aws-sdk/s3-request-presigner`
  - [ ] Ensure all S3 logic is in `runtime/server/**`.

- [ ] **3.2 Implement config validation** (Requirements: 1.2, 2.1)
  - [ ] Add `s3-config.ts` with strict/non-strict diagnostics (endpoint/region/bucket/creds/path-style/ttl/checksum).
  - [ ] Bound TTL (default 900s; max 86400s).

- [ ] **3.3 Implement key helpers** (Requirements: 5.1, 5.2)
  - [ ] Add deterministic key derivation helper (`blobKey`, `markerKey`).
  - [ ] Validate workspace ID and hash format.

### 4. Implement `S3StorageGatewayAdapter`

- [ ] **4.1 Presign upload** (Requirements: 3.1, 4.2, 5.1)
  - [ ] Implement `presignUpload` returning `PUT` URL + required headers and `storageId`.
  - [ ] Include `ContentType` and optional checksum requirement.
  - [ ] Ensure `Metadata` includes `or3-hash` and `or3-workspace`.

- [ ] **4.2 Presign download** (Requirements: 3.2, 3.3)
  - [ ] Implement `presignDownload` returning `GET` URL.
  - [ ] Use `disposition` to set `ResponseContentDisposition` after core threading change.

- [ ] **4.3 Commit verification + marker write** (Requirements: 4.1, 6.1)
  - [ ] `HEAD` the object and verify size/content-type.
  - [ ] On success, `PUT` marker JSON object at `<blobKey>.meta.json`.
  - [ ] On mismatch, best-effort delete of blob object and return error.

- [ ] **4.4 GC** (Requirements: 6.1)
  - [ ] Implement `gc` via `ListObjectsV2` prefix scan + marker detection.
  - [ ] Batch delete with `DeleteObjects` respecting `limit`.

- [ ] **4.5 Nitro registration plugin** (Requirements: 1.1)
  - [ ] Register adapter only when config selects `storage.provider === 's3'`.

### 5. Provider tests (vitest)

- [ ] **5.1 Unit tests for config + keys** (Requirements: 1.2, 5.1)
  - [ ] strict/non-strict behavior
  - [ ] path-style + endpoint parsing
  - [ ] key prefix normalization

- [ ] **5.2 Adapter unit tests (mock AWS SDK)** (Requirements: 3.1–3.3, 4.1–4.2, 6.1)
  - [ ] `presignUpload` passes correct `PutObjectCommand` inputs
  - [ ] checksum mode includes checksum header/signing
  - [ ] `commit` validates HEAD result and writes marker
  - [ ] `gc` deletes only uncommitted objects older than cutoff

### 6. OR3 core integration tests

- [ ] **6.1 Route tests with adapter registered** (Requirements: 3.3, 7.2)
  - [ ] Add tests confirming `expires_in_ms` and `disposition` are forwarded.
  - [ ] Add a lightweight stub adapter used by tests to capture inputs.

### 7. MinIO compatibility test suite (recommended)

- [ ] **7.1 Add an opt-in integration suite** (Requirements: 2.1, 9.1)
  - [ ] Provide a `MINIO_*` env-based test runner that:
    - boots MinIO (Docker) or connects to a running instance
    - creates bucket + CORS config
    - runs presign → PUT → commit → presign → GET flows

### 8. Documentation updates

- [ ] **8.1 Add provider docs page** (Requirements: 8.1)
  - [ ] Create a new doc page: `public/_documentation/cloud/provider-s3.md` describing setup, env vars, and CORS.
  - [ ] Add to doc map (`public/_documentation/docmap.json`) under Cloud.

- [ ] **8.2 Fix unsafe S3 example** (Requirements: 8.1)
  - [ ] Update [public/_documentation/cloud/storage-layer.md](public/_documentation/cloud/storage-layer.md) to remove client-credential example and describe gateway-signed presign.

### 9. Final verification

- [ ] **9.1 Manual smoke test** (Requirements: 3.1, 3.2)
  - [ ] Run SSR dev server with S3/MinIO configured.
  - [ ] Upload image, preview, reload, ensure download + hash verify succeeds.

- [ ] **9.2 Wizard flow validation** (Requirements: 7.1)
  - [ ] Run `bun run or3-cloud:init`, select Storage = S3, verify env outputs and generated provider modules include `or3-provider-s3/nuxt`.
