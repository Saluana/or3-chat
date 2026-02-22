# Identity, Workspaces, Roles, and Entitlements

OR3 access control has more moving parts than a simple "is the user logged in?" check. This doc explains those parts, why they exist, and how they combine to produce a final allow/deny decision.

## The layered access model

Access is evaluated in order. Each layer can independently deny, and later layers are irrelevant if an earlier one already failed:

1. **Identity** — is the request authenticated at all? (auth provider check)
2. **Workspace membership** — is this user a member of the active workspace?
3. **Role permission** — does this role have the specific permission being requested?
4. **Entitlements** *(optional)* — does this user/workspace have the required plan/feature?
5. **Plugin policy** *(optional)* — does this specific plugin surface add further restrictions?

This matters in practice because a logged-in user can still be denied at steps 2–5. Being authenticated is necessary, not sufficient.

---

## Identity: two user IDs, not one

OR3 tracks two distinct user identifiers and it's important not to mix them up.

**Provider User ID** (`session.providerUserId`) is the raw subject from your auth provider — the Clerk user ID, the basic-auth email hash, etc. It's used for provider-level cache keys and cross-checking with external systems. It's *not* used to scope your workspace data.

**Internal User ID** (`session.user.id`) is the canonical OR3 identifier stored in `AuthWorkspaceStore`. This is what workspace membership, sync, storage, and notification queries all use. When there's a mismatch between these two IDs — for example because a provider swap didn't correctly map identities — you'll see symptoms like "workspace exists but shows empty" or notifications that never appear.

---

## Workspaces: tenant boundaries

A workspace is a data isolation boundary. All threads, messages, settings, and plugin state live under a specific workspace ID. The local Dexie database is scoped per workspace (`or3-db-${workspaceId}`), so switching workspaces literally switches databases on the client.

A user can belong to multiple workspaces, but each request resolves exactly one active workspace. The active workspace is tracked via `users.active_workspace_id` in the store — falling back to "first membership row" instead of honoring this pointer is a known footgun that causes stale data after workspace switching.

On first login, a default workspace is created automatically. On workspace switch, the session must be refreshed so the client and server agree on which workspace is in scope.

---

## Roles and what they can do

Each workspace membership has a role. The role controls what permissions are active for that user in that workspace:

| Role | Permissions |
|------|-------------|
| `owner` | `workspace.read`, `workspace.write`, `workspace.settings.manage`, `users.manage`, `plugins.manage` |
| `editor` | `workspace.read`, `workspace.write` |
| `viewer` | `workspace.read` |

Permissions are checked using `can(session, 'workspace.write')` or `requireCan(event, 'workspace.settings.manage')`. The latter throws a 403 if the check fails.

Note: `admin.access` is a *deployment-level* permission. It is **not** granted by any workspace role — it comes from `deploymentAdmin` being set on the session (configured separately, see deployment admin docs).

Implementation: [server/auth/can.ts](../../../server/auth/can.ts)

---

## Entitlements: plan/feature flags

Entitlements answer a different question than roles. Where a role says "what can this user *do*?", an entitlement says "does this user *have* this feature?" They're things like `paid` or `enterprise` and are checked independently of role.

Entitlements are resolver-driven — each auth backend can register its own resolver. If none is registered, resolved entitlements are always empty, so policies with `requiredEntitlements` will deny everyone unless a resolver is wired up.

Entitlements are resolved once per request and cached, so the cost is a single lookup regardless of how many plugin checks happen in the same request.

Implementation: [server/auth/entitlements/registry.ts](../../../server/auth/entitlements/registry.ts)

---

## Session resolution: what actually runs on each request

When `resolveSessionContext(event)` is called (which every protected server route does), here's the sequence:

1. Check `SSR_AUTH_ENABLED` — if disabled, return an unauthenticated session immediately.
2. Ask the registered `AuthProvider` to verify the request (cookies/headers) and return a `ProviderSession`.
3. Map `providerUserId` to an internal `user` via `AuthWorkspaceStore`.
4. Resolve the active workspace and the user's role in that workspace.
5. Check for deployment admin status.
6. Cache the result in `event.context` for the rest of this request's lifecycle — re-calling `resolveSessionContext` in the same request is free.

The result is a `SessionContext` with: `authenticated`, `provider`, `providerUserId`, `user`, `workspace`, `role`, and optionally `deploymentAdmin`.

Implementation: [server/auth/session.ts](../../../server/auth/session.ts)

---

## Two separate gates, both matter

There's a common confusion between the plugin access gate and the `can()` permission gate. They're distinct and serve different purposes.

**`can()` / `requireCan()`** is for *resource authorization* — can this session read/write workspace data, manage members, access admin routes? Use it in server handlers that touch workspace-scoped resources.

**Plugin access policy** is for *feature availability* — should this plugin/page/dashboard item even be visible and accessible to this user? It combines auth, role, and entitlement checks into a single policy object, and can be overridden per-workspace by admins.

For a protected plugin server route, you typically want *both*: check plugin access first, then use `requireCan()` for the specific resource operation inside it.

---

## Practical example

```ts
// Plugin registration with access policy
registerDashboardPlugin({
    id: 'billing',
    access: {
        authRequired: true,
        requiredWorkspaceRoles: ['owner'],
        requiredEntitlements: ['paid'],
        mode: 'all', // user must satisfy ALL conditions
    },
});
```

Given this policy:
- **Unauthenticated** → denied (`unauthenticated`)
- **Authenticated `editor`** → denied (`insufficient-role`) — even though they're in the workspace
- **Authenticated `owner` without `paid`** → denied (`missing-entitlement`)
- **Authenticated `owner` with `paid`** → allowed

Switching `mode` to `'any'` would allow access if *any* condition is met instead of all.

---

## Troubleshooting access denials

Start at the outermost layer and work inward:

1. Is `SSR_AUTH_ENABLED=true` and is the auth provider configured correctly?
2. Does `/api/auth/session` return `authenticated: true` with a valid `workspace.id` and `role`?
3. Does `can(session, '<permission>')` return `allowed: true` for the operation you're checking?
4. If a plugin is involved — does `/api/plugins/access?pluginId=<id>` return `allowed: true`?
5. For installed extension plugins — is the plugin ID present in `plugins.enabled` for this workspace?
6. If the policy has `requiredEntitlements` — is an entitlement resolver registered and returning the expected values?

## Related

- [Authentication System](./auth-system)
- [Plugin Access Gating](./plugin-access-gating)
- [Cloud Providers](./providers)
- [Troubleshooting OR3 Cloud](./troubleshooting)
