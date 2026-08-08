# Migration Guide: Clerk + Convex to Default Stack

This guide migrates an existing SSR deployment from `clerk + convex` to `basic-auth + sqlite + fs`.

## Scope and Constraints

- Local-first client DB remains unchanged.
- Server auth/sync/storage providers change.
- Workspace/user canonical storage moves to selected sync provider backend.
- No direct automated data copier is assumed in this guide.

## 1. Prepare and Back Up

1. Export/backup current workspace data.
2. Snapshot current `.env`.
3. Confirm current deployment is healthy (`GET /api/health`).

## 2. Install Default Providers

```bash
bun add or3-provider-basic-auth
bun add or3-provider-sqlite
bun add or3-provider-fs
```

If using local sibling packages:

```bash
bun add or3-provider-basic-auth@link:../or3-provider-basic-auth
bun add or3-provider-sqlite@link:../or3-provider-sqlite
bun add or3-provider-fs@link:../or3-provider-fs
```

## 3. Update Environment

```bash
SSR_AUTH_ENABLED=true
AUTH_PROVIDER=basic-auth
OR3_SYNC_ENABLED=true
OR3_SYNC_PROVIDER=sqlite
OR3_STORAGE_ENABLED=true
NUXT_PUBLIC_STORAGE_PROVIDER=fs

OR3_BASIC_AUTH_JWT_SECRET=replace-with-random-secret
OR3_BASIC_AUTH_BOOTSTRAP_EMAIL=admin@example.com
OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD=replace-with-strong-password

OR3_SQLITE_DB_PATH=.data/or3-sync.sqlite
OR3_STORAGE_FS_ROOT=/srv/or3/.data/storage
OR3_STORAGE_FS_TOKEN_SECRET=replace-with-random-secret
```

## 4. Rebuild and Verify

```bash
bun install
bun run type-check
bun run build
```

Verify:

1. Auth session resolves for a basic-auth user.
2. Sync push/pull succeeds.
3. Storage presign/upload/download succeeds.
4. Background jobs can start and complete.

## 5. Data Migration Considerations

- If historical cloud data must be preserved, export from old backend and import through supported workspace tooling.
- Validate thread/message counts after migration in a staging environment first.

## Rollback Plan

1. Restore previous `.env` values (`AUTH_PROVIDER=clerk`, `OR3_SYNC_PROVIDER=convex`, storage provider back to convex).
2. Redeploy previous lockfile/image.
3. Restore previous backend credentials/secrets.
4. Validate `/api/health`, auth session, and sync pull.

## Related

- [provider-basic-auth](./provider-basic-auth)
- [provider-sqlite](./provider-sqlite)
- [provider-fs](./provider-fs)
- [release-notes-production-readiness](./release-notes-production-readiness)
