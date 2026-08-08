# S3 Provider (`or3-provider-s3`)

S3-compatible storage provider for OR3 Cloud.

This provider:

- registers a server-side `StorageGatewayAdapter` with ID `s3`
- generates short-lived presigned upload/download URLs
- binds uploads to the declared SHA-256 checksum and exact content length
- keeps S3 credentials **server-only** (never shipped to the browser)

## Install

```bash
bun add or3-provider-s3
```

Local sibling package (dev):

```bash
bun add or3-provider-s3@link:../or3-provider-s3
```

## Required config

```bash
SSR_AUTH_ENABLED=true
OR3_STORAGE_ENABLED=true
NUXT_PUBLIC_STORAGE_PROVIDER=s3

# server-only S3 config
OR3_STORAGE_S3_REGION=us-east-1
OR3_STORAGE_S3_BUCKET=my-or3-bucket
OR3_STORAGE_S3_ACCESS_KEY_ID=...
OR3_STORAGE_S3_SECRET_ACCESS_KEY=...
```

### S3-compatible hosts (R2 / MinIO / B2)

Set an endpoint and (often) path-style:

```bash
OR3_STORAGE_S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
OR3_STORAGE_S3_FORCE_PATH_STYLE=true
```

## Optional config

```bash
# Presigned URL TTL (seconds). Default 900, maximum 3600.
OR3_STORAGE_S3_URL_TTL_SECONDS=900

# Optional key prefix inside the bucket (no leading slash)
OR3_STORAGE_S3_KEY_PREFIX=or3-storage

# Optional temporary credentials
OR3_STORAGE_S3_SESSION_TOKEN=...

# Checksum enforcement is mandatory. Omit this variable or set it to true.
OR3_STORAGE_S3_REQUIRE_CHECKSUM=true

# Development-only HTTP endpoint override
OR3_STORAGE_S3_ALLOW_INSECURE_HTTP=true
```

## Bucket CORS (required)

Because uploads/downloads are **direct from browser → S3 host**, your bucket must allow CORS from your OR3 origin.

Minimum guidance:

- Methods: `GET`, `PUT`, `HEAD`
- Allowed headers: `Content-Type`, `x-amz-*`
- Expose headers: `ETag`, `Content-Length`
- Allowed origins: your OR3 site origin(s)

(Exact JSON varies by host. R2/MinIO/AWS all support equivalent CORS rules.)

`OR3_STORAGE_S3_REQUIRE_CHECKSUM=false` is rejected at startup. S3 uploads
always require `x-amz-checksum-sha256` and a signed `Content-Length`.

## How it works

OR3 client flow:

1. Client asks OR3 for a presigned URL: `POST /api/storage/presign-upload`
2. OR3 server checks `can('workspace.write')`, rate limits, size/MIME allowlist.
3. `or3-provider-s3` signs a presigned `PUT` URL.
4. Client uploads bytes directly to S3.
5. Client calls `POST /api/storage/commit` so the server can verify the upload (size/type) and finalize metadata.

Downloads are similar via `POST /api/storage/presign-download` + direct `GET`.
`POST /api/storage/delete` derives the object key from the authorized workspace
and hash, rejects a mismatched `storage_id`, and idempotently removes the blob
and commit marker.

## Garbage Collection Safety

Destructive S3 blob GC runs only when the active sync provider supplies
canonical, workspace-scoped materialized reference state. Without that
capability it returns `deleted_count: 0`, `status: "disabled"`, and
`reason: "canonical_reference_state_required"`. Candidate scans, canonical
queries, and immediate pre-delete reference checks are bounded and fail closed.

## Related

- [cloud/storage-layer](./storage-layer)
- [cloud/or3-cloud-wizard](./or3-cloud-wizard)
- [cloud/providers](./providers)
