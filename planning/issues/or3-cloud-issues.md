# Dumb Issues

This is the blunt version. The architecture has some solid bones, but several parts are either lying, outsourcing critical guarantees, or turning temporary states into destructive ones.

## Workspace admin is fake

Code:

- `server/admin/api.ts:144-149`
- `server/api/admin/workspace/members/upsert.post.ts:29-30`
- `server/api/admin/workspace/members/set-role.post.ts:28-29`
- `server/api/admin/workspace/members/remove.post.ts:26-27`
- `planning/complete/or3-cloud/admin-dashboard/requirements.md:52-57`
- `planning/complete/or3-cloud/admin-dashboard/requirements.md:89-95`

Snippet:

```ts
const workspaceAdminAllowed = options.allowWorkspaceAdmin ?? false;
if (!isSuperAdmin(context) && !workspaceAdminAllowed) {
    throw createError({
        statusCode: 403,
        statusMessage: 'Forbidden: Super admin access required',
    });
}
```

Why this is bad:

The plan says workspace `owner` and `editor` should be able to access the admin UI, and owners should manage members. The code says otherwise. These routes call `requireAdminApi(..., { ownerOnly: true, mutation: true })` without `allowWorkspaceAdmin: true`, so the request dies before the role check even matters.

Real-world consequence:

You built a workspace-scoped admin feature that is functionally still super-admin-only. That is not a subtle bug. It means the control plane behavior contradicts the documented access model and blocks the exact user flows the feature claims to support.

Concrete fix:

For workspace-scoped admin routes, pass `allowWorkspaceAdmin: true` and let `ownerOnly` or `requireCan(...)` do the actual authorization.

```ts
const session = await requireAdminApi(event, {
    allowWorkspaceAdmin: true,
    ownerOnly: true,
    mutation: true,
});
```

Split deployment-level operations into explicitly super-admin-only routes instead of running everything through the same choke point.

## Revoked users get a free 60-second grace period

Code:

- `server/auth/session.ts:45`
- `server/auth/session.ts:224-235`
- `server/api/admin/workspace/members/remove.post.ts:39-45`
- `server/api/admin/workspace/members/set-role.post.ts:41-54`
- `planning/complete/or3-cloud/admin-dashboard/requirements.md:93-95`
- `server/api/workspaces/active.post.ts:33-38`
- `server/api/workspaces/[id].delete.ts:30-33`

Snippet:

```ts
const DEFAULT_SHARED_SESSION_CACHE_TTL_MS = 60_000;

const sharedCached = sharedSessionCache.get(sharedCacheKey);
if (sharedCached) {
    if (sharedCached.expiresAtMs > Date.now()) {
        event.context[cacheKey] = sharedCached.session;
        return sharedCached.session;
    }
}
```

Why this is bad:

Membership and role changes are cached cross-request, but the member mutation routes do not invalidate that cache. You already remembered to invalidate it on active workspace change and workspace delete. You forgot to do it on the operations that actually change access.

Real-world consequence:

A removed user or downgraded admin can keep using whatever the old session said for up to 60 seconds. That directly violates the requirement that removals take effect immediately and role changes affect subsequent `can()` checks.

Concrete fix:

Invalidate the shared session cache for every affected identity after membership or role mutations. Better version: attach a membership revision/version to the cache key so authz state self-invalidates when the store changes.

At minimum:

```ts
invalidateSharedSessionCacheForIdentity({
    provider: affectedProviderId,
    providerUserId: affectedProviderUserId,
});
```

If the route cannot cheaply resolve provider identity for the affected user, that is a design smell in the admin store contract and should be fixed there.

## Missing `storage_id` gets treated like deletion

Code:

- `app/db/files.ts:330-342`
- `app/core/storage/transfer-queue.ts:564-575`
- `planning/complete/db-storage-system/requirements.md:51-53`
- `planning/complete/db-storage-system/requirements.md:68-73`

Snippet:

```ts
if (!meta?.storage_id) {
    await this.markFileDeletedMissingRemote(transfer.hash);
    throw err(
        'ERR_STORAGE_FILE_NOT_FOUND',
        'Remote file not available',
    );
}
```

Why this is bad:

The requirements explicitly allow a file reference to sync before upload has finished, which means `storage_id` can be absent temporarily. The current download path interprets that temporary state as if the remote file was deleted and then marks the file deleted locally.

Real-world consequence:

One device can attach a file, sync the metadata, and another device can race into the fetch path before upload finishes. Instead of waiting, it declares the file missing and poisons local state. That is a clean way to manufacture fake data loss out of ordinary eventual consistency.

Concrete fix:

Do not call `markFileDeletedMissingRemote(...)` when `storage_id` is absent. Treat it as `pending remote upload` and bail without mutation. Only mark remote-missing on a verified 404/410 after a real `storage_id` has been issued.

```ts
if (!meta?.storage_id) {
    throw err(
        'ERR_STORAGE_FILE_PENDING_UPLOAD',
        'Remote file is not uploaded yet',
        { retryable: true }
    );
}
```

Even better: make `ensureDownloadedBlob(...)` return `undefined` or a typed pending state so callers can render a sane UI instead of turning this into an error path.

## `can()` is not actually the sole gate

Code:

- `server/api/workspaces/active.post.ts:13-31`
- `server/auth/can.ts:125-133`
- `../or3-provider-sqlite/src/runtime/server/auth/sqlite-auth-workspace-store.ts:423-445`
- `planning/complete/or3-cloud/admin-dashboard/requirements.md:59-63`

Snippet:

```ts
await store.setActiveWorkspace({
    userId: session.user.id,
    workspaceId,
});
```

Why this is bad:

Core claims `can()` is the single authorization gate for SSR endpoints. This route never checks whether the requested workspace is authorized for the current session. It punts the decision to the active store adapter. The SQLite provider happens to validate membership. That is luck plus adapter discipline, not a core guarantee.

Real-world consequence:

The next custom provider author can accidentally turn workspace switching into an authorization bug because the route contract quietly assumes the adapter will remember to re-implement core policy. Security rules that live in “whoever plugged in the store remembered to do it” are not security rules.

Concrete fix:

Authorize the target workspace in core before mutating state.

```ts
requireCan(session, 'workspace.read', {
    kind: 'workspace',
    id: workspaceId,
});
```

If the permission model needs a different capability than `workspace.read`, define it. Then add core contract tests proving that unauthorized workspace switches are rejected even if a store adapter is permissive.

## The auth docs are lying

Code:

- `public/_documentation/cloud/auth-system.md:3`
- `public/_documentation/cloud/auth-system.md:9-19`
- `public/_documentation/cloud/auth-system.md:57-77`
- `public/_documentation/cloud/auth-system.md:90-100`
- `public/_documentation/cloud/providers.md:7-23`

Snippet:

```md
The OR3 Authentication System uses a hybrid approach: Clerk is used for user
identity and workspace provisioning...

### 1. Identity & Workspace Provisioning (Clerk + Convex)
```

Why this is bad:

The public doc still explains the world as "Clerk + Convex hardwired" and even shows an obsolete session-resolution sketch that jumps straight into a Convex mutation. The actual implementation is registry-driven, provider-swappable, and intentionally not locked to that stack anymore.

Real-world consequence:

Anyone using the public docs as design truth is being taught the wrong architecture. That creates bad fixes, bad provider implementations, and endless confusion when reality does not match the docs. The docmap currently helps spread the wrong answer faster.

Concrete fix:

Rewrite the page around the current model:

- `AuthProvider` resolves provider identity.
- `AuthWorkspaceStore` is the canonical user/workspace backend.
- Sync providers declare `mode: 'direct' | 'gateway'`.
- Direct providers use `AuthTokenBroker`.
- Gateway routes enforce `can()`.
- SSR auth stays gated so static builds remain clean.

Then either remove the old Clerk+Convex-specific narrative or move it into a clearly marked historical/default-provider page.

## Features you still need

- Workspace-admin-first route policy instead of the current super-admin choke point for workspace membership and settings flows.
- Immediate auth invalidation on membership changes, role changes, and other access-shaping mutations.
- Core security contract tests that fail if an adapter forgets to enforce workspace membership or storage ownership invariants.
- A pending-upload state for attachments so the UI and queue can distinguish `not uploaded yet` from `gone forever`.
- Public docs that reflect the provider registry architecture instead of the old Clerk+Convex mythology.

## What is actually good

- The provider/registry composition is mostly sane. Core is at least trying to be adapter-first instead of hard-coding one backend everywhere.
- The sync layer shows real engineering thought around outbox capture, conflict handling, and transport backoff.
- The storage architecture is close. The main failure is the bad missing-`storage_id` branch, not the entire design.
