# Filesystem Storage Provider (`or3-provider-fs`)

Setup and operating guide for the default-stack object storage backend.

## What It Provides

- Gateway-mode blob storage using local filesystem paths.
- Presign/commit/download/delete integration for OR3 storage APIs.
- Hash-addressed blob persistence (`sha256:<hex>` compatible).
- Canonical reference-driven, retention-bounded blob GC with a fail-closed fallback.

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
OR3_STORAGE_FS_ROOT=.data/storage
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
- Delete validates the canonical `workspace_id:hash` storage ID, removes both
  the blob and commit sidecar, and is safe to retry.
- Presigned tokens are user-bound and configuration rejects lifetimes over one hour.
- Use `PUT` for FS upload URLs (`/api/storage/fs/upload?token=...`).

## Operational Notes

- Place `OR3_STORAGE_FS_ROOT` on persistent storage.
- Use separate volumes for DB and blob storage when possible.
- With a sync provider that implements canonical storage queries, GC keeps blobs
  found in live materialized `file_meta` or message/post reference edges and
  rechecks immediately before deletion. Scans and provider pages are bounded.
- Without that capability, GC returns `deleted_count: 0`, `status: "disabled"`,
  and `reason: "canonical_reference_state_required"`. It never falls back to
  retained sync history.
- Keep `Cache-Control: no-store` on presign/upload/download responses.

## Related

- [providers](./providers)
- [storage-layer](./storage-layer)
- [provider-basic-auth](./provider-basic-auth)
- [provider-sqlite](./provider-sqlite)
