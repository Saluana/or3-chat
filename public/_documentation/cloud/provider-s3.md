# S3 Provider (`or3-provider-s3`)

S3-compatible storage provider for OR3 Cloud.

Version `0.0.11` preserves stored blobs after failed commits, retrieves HEAD
checksums explicitly, and keeps destructive deletion and GC disabled until
provider-owned coordination is available.

This provider:

- registers a server-side `StorageGatewayAdapter` with ID `s3`
- generates short-lived presigned upload/download URLs
- binds uploads to the declared SHA-256 checksum and exact content length
- keeps S3 credentials **server-only** (never shipped to the browser)

Managed installations use the fixed profile in [Set up Cloud](/documentation/cloud/setup). The install commands and manual settings below are for editable source deployments; install only the providers your source configuration selects.

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
The gateway first requires a live, committed `file_meta` row in the requested
workspace and then verifies both the S3 object and its commit marker before
signing; a raw key/hash or pending upload cannot be downloaded.
The gateway supplies a canonical response MIME and disposition: generic files
are signed as `application/octet-stream` attachments, while supported raster
images and PDFs may be served inline. Direct S3 responses cannot add
`X-Content-Type-Options`, so the attachment/octet-stream policy is applied in
the signed request itself.
`POST /api/storage/delete` derives the object key from the authorized workspace
and hash, rejects a mismatched `storage_id`, and fails with 503 while the object or marker exists because deletion requires provider-owned coordination. An already absent pair succeeds.

## Garbage Collection Safety

Like filesystem storage, S3 cannot atomically coordinate physical object deletion
with metadata restores and reference writes in a separate sync database. Canonical
reference queries alone do not prevent this race. Destructive deletion and GC stay
disabled until the provider owns a deletion barrier honored by those writes.

GC validates its request and returns without listing or deleting objects:

```json
{ "deleted_count": 0, "status": "disabled", "reason": "deletion_coordination_required" }
```

The admin storage card exposes non-secret configuration diagnostics and a
**Check Storage GC Status** action. It reports the same disabled reason, including
when canonical reference queries are available. Files and Trash use the selected
sync provider's canonical metadata; selecting S3 changes where bytes live.

## Compatibility verification

The provider requires SHA-256 upload enforcement, checksum retrieval via HEAD
(`ChecksumMode: ENABLED`), and conditional commit-marker writes
(`If-None-Match: *`). AWS requires checksum mode for checksum retrieval; encrypted
buckets can also need KMS permissions ([AWS HeadObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html)).

The provider CI runs real upload/commit/download tests against disposable MinIO
and saves a JSON report. To qualify another S3 host, run the provider's opt-in
integration suite against a disposable bucket as described in its README. Endpoint
configuration alone is not proof that a host implements every required operation.

## Related

- [cloud/storage-layer](/documentation/cloud/storage-layer)
- [cloud/or3-cloud-wizard](/documentation/cloud/or3-cloud-wizard)
- [cloud/providers](/documentation/cloud/providers)
