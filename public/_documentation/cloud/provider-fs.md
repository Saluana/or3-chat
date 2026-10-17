# Filesystem Storage Provider (`or3-provider-fs`)

Setup and operating guide for the default-stack object storage backend.

Managed installations use the fixed profile in [Set up Cloud](/documentation/cloud/setup). The install commands and manual settings below are for editable source deployments; install only the providers your source configuration selects.

## What It Provides

- Gateway-mode blob storage using local filesystem paths.
- Presign/commit/download/delete integration for OR3 storage APIs.
- Hash-addressed blob persistence (`sha256:<hex>` compatible).
- Physical deletion and GC fail closed until a coordinated deletion protocol is available.

## Install

```bash
bun add or3-provider-fs
```

Local sibling package:

```bash
bun add or3-provider-fs@link:../or3-provider-fs
```

## Required Config

```bash
SSR_AUTH_ENABLED=true
OR3_STORAGE_ENABLED=true
NUXT_PUBLIC_STORAGE_PROVIDER=fs
OR3_STORAGE_FS_ROOT=/srv/or3/.data/storage
OR3_STORAGE_FS_TOKEN_SECRET=replace-with-32+-char-random-secret
```

Optional tuning:

```bash
OR3_STORAGE_FS_URL_TTL_SECONDS=300
OR3_STORAGE_GC_RETENTION_SECONDS=2592000
OR3_STORAGE_WORKSPACE_QUOTA_BYTES=optional-quota-bytes
```

## Security and Correctness

- Token secret must be set at startup; missing secret should fail fast.
- Upload endpoints must enforce server-side max file size.
- Uploaded bytes should pass SHA-256 integrity verification before commit.
- Delete validates the canonical `workspace_id:hash` storage ID. In
  `or3-provider-fs@0.0.11`, existing blobs or sidecars return HTTP 503; an
  already absent object is an idempotent success.
- Presigned tokens are user-bound and configuration rejects lifetimes over one hour.
- Use `PUT` for FS upload URLs (`/api/storage/fs/upload?token=...`).

## Upload reservations and retries

With a sync backend that supplies both upload-intent reservation and consumption,
FS reserves before returning an upload URL and consumes the matching receipt
before publishing its commit sidecar. A backend supplying only half the contract
fails closed. A configured workspace quota requires that complete contract;
without it, presigning returns 503 rather than promising atomic quota admission.
Commit validates the canonical storage identity and actual file size. Exact
consumption replay lets a retry recover from sidecar-write failure within the
original reservation lifetime. Expired transfers need a new presign/reservation;
different hash, MIME, size, workspace, or storage identity is rejected.

## Operational Notes

- Place `OR3_STORAGE_FS_ROOT` on persistent storage.
- Use separate volumes for DB and blob storage when possible.
- GC returns `deleted_count: 0`, `status: "disabled"`, and
  `reason: "deletion_coordination_required"` without deleting bytes. Independent
  canonical scans cannot prevent concurrent restore/reference writes, so physical
  cleanup remains disabled for every sync backend. Logical Trash retains bytes.
- Keep `Cache-Control: no-store` on presign/upload/download responses.
- Downloads apply canonical safe response headers: generic files use an
  octet-stream attachment with `X-Content-Type-Options: nosniff`; supported
  raster images and PDFs may remain inline.

## Usage accounting

The admin Overview and Operations pages explain **Deleted files still use
storage** as an informational notice. Permanent server cleanup is not yet
available; no configuration change enables it. The provider diagnostic remains
available under **Technical details**, and other provider warnings stay visible.

When the provider exposes usage reporting, **View storage usage** in either
notice opens the workspace chooser in **Admin → Operations** immediately.
Choose a workspace to run the check; its result is brought into view and receives
keyboard focus. Canceling the chooser does not run an observation, and the notice
can be used again after canceling. The **Storage usage** card opens the
same chooser. Each result names the selected workspace; the observation does not
delete files or empty Trash. If a direct usage link can no longer run because
the provider is unavailable, Operations explains why.

Results show readable sizes for known active files, Trash, and workspace files on
disk. The disk figure includes Trash and supporting files; active and Trash sizes
come from file metadata. Available server space describes the shared filesystem,
not a workspace allowance. Unknown totals are omitted with a plain-language
message, and partial disk scans explain that the total may be higher. **Show JSON**
starts collapsed and exposes the complete provider response when needed.

Under **Operations → Maintenance**, **File cleanup status** explains that
permanent file cleanup is unavailable and the check does not delete files.
**Storage usage** reports logical active/deleted metadata separately from observed
active/deleted blobs, incomplete transfers, sidecars, unclassified files and
allocated filesystem blocks. Results are bounded, non-atomic observations:
inspect completion flags, nullable values and warnings before interpreting them.
No category is a deletion candidate list. Logical Trash can reduce logical quota
without reclaiming disk bytes. Missing or foreign storage identities keep
filesystem bytes unclassified, including legacy metadata without a storage ID.

Retained metadata accounting requires the sync provider's
`retainedStorageMetadata: 'v1'` capability. Older providers keep that field
unknown; the observer does not probe unsupported queries or replay history.
Physical deletion stays disabled regardless of this accounting capability.

## Related

- [Choose and wire providers](/documentation/cloud/providers)
- [Storage internals](/documentation/cloud/storage-layer)
- [Basic Auth](/documentation/cloud/provider-basic-auth)
- [SQLite](/documentation/cloud/provider-sqlite)
