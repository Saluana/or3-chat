# S3 Provider (`or3-provider-s3`)

S3-compatible storage provider for OR3 Cloud.

Version `0.0.11` preserves stored blobs after failed commits, retrieves HEAD
checksums explicitly, and keeps destructive deletion and GC disabled until
provider-owned coordination is available.

This provider:

- registers a server-side `StorageGatewayAdapter` with ID `s3`
- generates short-lived presigned upload/download URLs
- binds uploads to a checksum and exact content length, including verified legacy MD5 originals
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

Endpoint URLs must use HTTP(S) and may not include embedded credentials, query
parameters, or fragments. HTTP still requires the explicit development override.
Bare and uppercase SHA-256 spellings are accepted and normalized to the same
lowercase `sha256:<hex>` identity for uploads, commits, and downloads.

## Bucket CORS (required)

Because uploads/downloads are **direct from browser → S3 host**, your bucket must allow CORS from your OR3 origin.

Minimum guidance:

- Methods: `GET`, `PUT`, `HEAD`
- Allowed headers: `Content-Type`, `Content-MD5`, `x-amz-*`
- Expose headers: `ETag`, `Content-Length`
- Allowed origins: your OR3 site origin(s)

(Exact JSON varies by host. R2/MinIO/AWS all support equivalent CORS rules.)

For a Hippius test bucket, use endpoint `https://s3.hippius.com`, region
`decentralized`, and path-style addressing. A localhost-only bucket CORS policy
with the methods and headers above was accepted and returned a successful
preflight in a live test. Hippius's published compatibility matrix describes
bucket CORS differently, so verify the policy and preflight for your actual
origin rather than assuming it is active.

`OR3_STORAGE_S3_REQUIRE_CHECKSUM=false` is rejected at startup. S3 uploads
require a signed checksum and `Content-Length`. New SHA-256 uploads use
`x-amz-checksum-sha256`; legacy MD5 uploads use `Content-MD5`.

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

When the sync backend supports upload intents, reservation and consumption must
be supplied together. Verified consumption happens before publishing the commit
marker. An exact retry within the original reservation lifetime or a verified
re-upload with a fresh reservation can reuse a matching marker. Expired receipts
and mismatched workspace, hash, storage ID, size, or MIME fail with 409. A quota
requires the paired reservation contract. Source and provider
artifacts must be upgraded together for exact consumed-receipt replay.

## File compatibility and usage

Basic Auth + SQLite + S3 is a supported source deployment combination. The host
workspace upload policy applies up to **1 GiB**, matching filesystem storage.
New files use SHA-256. Legacy MD5 identities are preserved during backup restore,
including references in messages and documents and separate MD5/SHA-256 identities
for identical bytes. Legacy commits stream and hash stored bytes before accepting
the upload; ETags and client metadata are not treated as checksum proof. Legacy
verification therefore needs an additional bounded server read.

The **Storage usage** admin action reports active metadata, retained Trash bytes,
active reservations, and current object bytes under the selected workspace prefix.
It requires `ListBucket` for object totals and scans at most 10,000 objects (or a
smaller requested `limit`). Partial, unavailable, or ambiguous observations stay
explicit. Old object versions, incomplete multipart uploads, physical disk capacity,
and the storage host's billed usage are not included. No observation deletes
objects or releases quota.

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
**Check Storage GC Status** and **Storage usage** actions. It reports the same disabled reason, including
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

The host also provides two opt-in browser profiles with a disposable S3 bucket:

```bash
# Export the OR3_STORAGE_S3_* values for your disposable bucket first.
bun run test:e2e:file-backup:s3
bun run test:e2e:workspace-cloud --s3
```

These use real Basic Auth, SQLite, and the installed S3 artifact. The backup
profile covers CORS, interrupted direct uploads, cache retention, mixed legacy
backup/restore, reference preservation, Trash, and restart. Each run owns a random
object prefix and temporarily adds its exact local origin to bucket CORS; it
removes its objects and its own rule afterward. Test credentials therefore need
object read/write/delete/list and bucket CORS configuration permissions. Keep
production credentials out of these disposable tests. Reports and browser receipts
are saved under `test-results/file-backup-cloud-s3/` and the workspace harness's
`output/workspace-assistant-files/review-fixes/cloud-sqlite-s3-installed/`.

These capabilities ship in the pinned `or3-provider-s3@0.0.15` release, paired
with `or3-provider-sqlite@0.0.28`. No local provider patch is required.

## Related

- [cloud/storage-layer](/documentation/cloud/storage-layer)
- [cloud/or3-cloud-wizard](/documentation/cloud/or3-cloud-wizard)
- [cloud/providers](/documentation/cloud/providers)

Legacy MD5 downloads never perform a server-side full-object read merely because
a caller asks for a verification receipt. They return a signed download link
without that receipt; commit still verifies legacy bytes. New browser uploads
use SHA-256. MD5 remains accepted for legacy restores (including an empty target
workspace); it is not collision resistant and should not be used for new content.

Browser transfer deadlines scale with file size, up to 50 minutes within the
one-hour signed-link lifetime. Direct uploads retry transient presign admission
failures before sending bytes. Uploads do not support resumable multipart transfer.

## Dormant immutable generations

This checkout also carries an **unregistered, disabled** S3 generation factory.
The ordinary S3 adapter still uses its existing keys and refuses destructive GC.
No environment flag switches an existing installation to generation storage.

The new factory requires a versioned bucket, conditional PUT support, a private
generation namespace, and the matching local SQLite generation coordinator with
WAL, synchronous FULL/EXTRA and foreign keys enabled. It does not change those
settings itself. Uploads require signed `If-None-Match: *` and a SHA-256 checksum;
future browser activation also requires `If-None-Match` in bucket CORS. Commit
independently hashes the uploaded immutable version. Downloads pin that version.

Cleanup has a separate disabled gate. After a durable canonical claim, it leaves
a permanent tombstone at the upload key and removes only the exact payload
version. The tombstone and small receipts must not be removed by bucket lifecycle
rules: they prevent stale upload credentials from recreating deleted objects.
Versioning suspension, external key mutation and uncoordinated bucket lifecycle
cleanup are incompatible with this protocol.

Allocation, Trash and claimed bytes stay charged in the existing SQLite retained
ledger until confirmed removal is acknowledged. Restore reuses that charge. A
replacement generation waits for confirmed removal; old workers cannot release
its charge or delete its bytes. Legacy retained objects are never implicitly
adopted or reclaimed. No schema migration is added by this implementation.

Live qualification uses **new disposable buckets**, never the configured data
bucket. Run `bun run test:e2e:s3-generations:protocol --env <private-env-file>`
for the endpoint protocol probe. The provider's named `test:e2e:generations` lane
uses `OR3_GENERATION_TEST_ENV` and `OR3_PROJECT_HOST_ROOT` for real S3 + SQLite
qualification, including HTTP authorization, restore, stale uploads, interrupted
cleanup and retained quota. `OR3_S3_ARTIFACT_ROOT` and `OR3_SQLITE_ARTIFACT_ROOT`
can point at package roots to qualify built artifacts.

**Production activation remains a separate operation.** Before selecting this
factory, qualify the complete browser transfer/Trash-restore flow, fresh-workspace
backup recovery, retention policy, CORS, and the installed provider pair. There is
no automatic rollout, migration or cleanup job.

## Prepare legacy SHA-256 backups offline

`bun run storage:prepare-sha256-backup --input original.or3cloud --output prepared.or3cloud`
verifies the complete source and originals, prepares a separate SHA-256 archive,
and verifies the output. It never overwrites a file, connects to storage, changes
a workspace, or enables deletion. Keep the original backup.

The initial converter supports file metadata, chat attachment lists and document
image references. It refuses duplicate identities with the same bytes, opaque KV
settings/extension values, encoded document revisions and unrecognized legacy
references. It does not guess how plugins store references or silently merge
metadata. Such backups need a specific converter and qualification before
migration. Normal backup restore retains its existing behavior.

A separately approved cutover restores the prepared archive into a **new**
workspace and verifies its conversations, documents and files before retiring any
old workspace. Production migration and deletion remain off.
