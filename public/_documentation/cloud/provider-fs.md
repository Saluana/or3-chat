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

## Related

- [Choose and wire providers](/documentation/cloud/providers)
- [Storage internals](/documentation/cloud/storage-layer)
- [Basic Auth](/documentation/cloud/provider-basic-auth)
- [SQLite](/documentation/cloud/provider-sqlite)
