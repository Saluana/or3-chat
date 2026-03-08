# Dumb Issues

## Workspace admin is fake

Code:

- `server/admin/api.ts:144-169`
- `server/admin/context.ts:83-88`
- `server/auth/can.ts:53-63`
- `server/api/admin/workspace/members/remove.post.ts:27-43`
- `planning/complete/or3-cloud/admin-dashboard/requirements.md:55-63`
- `planning/complete/or3-cloud/admin-dashboard/design.md:125-139`

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

The planning docs say `owner` and `editor` should reach `/admin/*` through `can()`. The implementation does not do that. `can()` does not grant `admin.access` to owners or editors, `resolveAdminRequestContext()` only recognizes workspace admins when `can(session, 'admin.access')` succeeds, and `requireAdminApiContext()` rejects every non-super-admin unless a route explicitly opts into `allowWorkspaceAdmin`. The workspace admin routes do not opt in.

Real-world consequence:

The advertised workspace-admin control plane is a lie. Member management and other workspace-scoped admin operations are effectively super-admin-only even though the docs claim otherwise. Anyone trying to reason about admin behavior from the planning docs will get the wrong answer.

Concrete fix:

Pick one policy and implement it consistently.

- If workspace owners/editors are supposed to access admin, grant `admin.access` through `can()` and pass `allowWorkspaceAdmin: true` on workspace-scoped admin routes.
- If admin is supposed to stay super-admin-only, stop claiming otherwise in the requirements and design docs.

At minimum, workspace-scoped routes should look like this:

```ts
const session = await requireAdminApi(event, {
    allowWorkspaceAdmin: true,
    ownerOnly: true,
    mutation: true,
});
```

## Revoked users keep stale access for 60 seconds

Code:

- `server/auth/session.ts:45`
- `server/auth/session.ts:224-237`
- `server/api/admin/workspace/members/remove.post.ts:39-45`
- `server/api/admin/workspace/members/set-role.post.ts:41-54`

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

Membership and role changes alter authorization state, but the routes that perform those changes do not invalidate the shared session cache. That means the old `SessionContext` survives across requests until TTL expiry.

Real-world consequence:

A removed user or downgraded admin can keep calling protected endpoints with their stale session for up to a minute. That is exactly the kind of garbage that makes “access revoked” mean “eventually, maybe” instead of “now”.

Concrete fix:

Invalidate the affected identity after every access-shaping mutation. If the current admin store cannot resolve the target user's provider identity, fix the store contract instead of pretending this is fine.

```ts
invalidateSharedSessionCacheForIdentity({
    provider: affectedProvider,
    providerUserId: affectedProviderUserId,
});
```

Also add tests proving role removal and member removal affect the very next request.

## Core authz is outsourced to adapters

Code:

- `server/api/workspaces/_helpers.ts:24-27`
- `server/api/workspaces/active.post.ts:28-31`
- `server/api/workspaces/[id].patch.ts:48-53`
- `server/api/workspaces/[id].delete.ts:24-27`
- `../or3-provider-sqlite/src/runtime/server/auth/sqlite-auth-workspace-store.ts:349-359`
- `../or3-provider-sqlite/src/runtime/server/auth/sqlite-auth-workspace-store.ts:375-385`
- `../or3-provider-sqlite/src/runtime/server/auth/sqlite-auth-workspace-store.ts:429-440`

Snippet:

```ts
const session = await requireWorkspaceSession(event);

await store.setActiveWorkspace({
    userId: session.user.id,
    workspaceId,
});
```

Why this is bad:

`requireWorkspaceSession()` only proves the caller can access the current workspace. The target workspace routes then skip `requireCan(..., { id: targetWorkspaceId })` and trust the store adapter to re-enforce membership and role checks. SQLite does. A future provider may not. When core says "`can()` is the only gate" and then quietly relies on adapter authors not being sloppy, the invariant is fake.

Real-world consequence:

A permissive or buggy `AuthWorkspaceStore` implementation can turn workspace switching, renaming, or deletion into cross-workspace authorization bugs without touching core route code. That is a terrible contract boundary for multi-provider auth.

Concrete fix:

Authorize the target workspace in core before delegating to the store.

```ts
requireCan(session, 'workspace.read', {
    kind: 'workspace',
    id: workspaceId,
});
```

Use the appropriate stronger permission for patch/delete paths, then add route-level contract tests that fail even if the mocked store allows everything.

## Session resolution is doing side-effect writes

Code:

- `server/auth/session.ts:419-439`
- `server/auth/session.ts:442-457`
- `server/admin/plugins/workspace-plugin-store.ts:93-109`

Snippet:

```ts
if (Array.isArray(defaultEnabledPlugins) && defaultEnabledPlugins.length > 0) {
    try {
        const settingsStore = getWorkspaceSettingsStore(event);
        await bootstrapDefaultEnabledPlugins(
            settingsStore,
            workspaceId,
            defaultEnabledPlugins.filter(...)
        );
    } catch (error) {
        console.warn('[auth:session] Failed to bootstrap default plugins', ...)
    }
}
```

Why this is bad:

`resolveSessionContext()` is supposed to be the auth/session read path. Instead it mutates workspace settings as a side effect on cache misses. That drags plugin bootstrap concerns into session resolution, couples auth to admin/settings storage, and makes “fetch my session” capable of changing persistent state.

Real-world consequence:

Authentication latency now depends on unrelated settings IO. Session resolution can partially succeed while silently failing side effects. Debugging gets worse because a read endpoint is now hiding provisioning behavior. Future regressions will look like auth bugs even when the real failure is workspace settings bootstrap.

Concrete fix:

Move default plugin bootstrap into explicit workspace provisioning or a post-create hook. Session resolution should hydrate state, not perform write-time initialization.

If you need lazy initialization, isolate it behind an idempotent provisioning service and call it from workspace creation flows, not from every session resolve path.

## Tests are locking in the wrong behavior

Code:

- `server/auth/__tests__/can.test.ts:71-74`
- `server/api/admin/__tests__/route-policy.contract.test.ts:12-44`
- `server/api/workspaces/__tests__/active.post.test.ts:61-77`

Snippet:

```ts
it('denies elevated permissions for editor', () => {
    expect(can(mockEditorSession, 'workspace.settings.manage').allowed).toBe(false);
    expect(can(mockEditorSession, 'admin.access').allowed).toBe(false);
});
```

Why this is bad:

The planning docs say editors should access admin. The auth test suite explicitly locks in the opposite behavior. Meanwhile the admin route contract tests only check a few mutation flags and super-admin routes, and the workspace switch test never asserts a target-workspace `requireCan` gate. The tests are covering the implementation drift instead of the intended contract.

Real-world consequence:

You can “improve coverage” and still keep the wrong system behavior frozen in place. Future engineers will trust the green test suite while it actively protects broken authorization semantics.

Concrete fix:

Rewrite the contract tests around the actual intended behavior.

- If editors should access admin, add `can()` tests that assert it.
- Add admin route policy tests that fail when workspace-scoped routes forget `allowWorkspaceAdmin: true`.
- Add workspace route tests that fail when target workspace authorization is missing.
- Add cache invalidation tests for membership and role changes.
