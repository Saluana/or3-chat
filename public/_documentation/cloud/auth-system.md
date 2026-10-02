# Accounts and access

Cloud login verifies who you are; workspace membership and permissions decide what you can do. OpenRouter authorization and the deployment admin panel use separate credentials. This page explains the distinctions for both Basic Auth/SQLite and Clerk/Convex deployments.

## Sign in, invitations, and workspaces

Managed Cloud uses Basic Auth and invite-only registration. Sign in with the bootstrap account, then invite people through the workspace/admin invitation flow. On a source deployment, provisioning depends on `registrationMode`, `autoProvision`, and the workspace store: first login does not universally create a workspace.

A user can belong to multiple workspaces. Each request resolves one active workspace and its membership role. Switching workspaces refreshes the session and switches the browser's Dexie database to `or3-db-${workspaceId}`. It does not merge or delete the old workspace data.

The store honors `users.active_workspace_id`. Workspace switches are coordinated across tabs using a monotonic revision, so a late response cannot commit an older selection. If data looks empty after login or switching, check the resolved workspace before resetting local storage.

## Two user identifiers

| Identifier | Used for |
|---|---|
| `session.providerUserId` | External provider identity and provider-level cache keys |
| `session.user.id` | Canonical internal OR3 user, membership, sync/storage authorization, notification scope |

The selected sync backend implements `AuthWorkspaceStore` for internal users and workspaces. The auth provider verifies external identity; it is not a second workspace database. This store is required even when sync transfer is disabled.

## Roles and permissions

| Workspace role | Permissions |
|---|---|
| owner | Read/write workspace data, manage workspace settings, users, and plugins |
| editor | Read/write workspace data |
| viewer | Read workspace data |

Server handlers use `can()` or `requireCan()` for resource authorization. Authentication alone is insufficient: membership, resource ownership, capability policy, and optional constraints can deny a request. The [capability matrix](/documentation/cloud/capability-matrix) lists operation-specific requirements.

Entitlements are separate plan/feature flags resolved by a registered backend resolver and cached per request. With no resolver, entitlements are empty; a plugin policy requiring `paid` will deny access. [Plugin access policy](/documentation/cloud/plugin-access-gating) controls feature availability, while server permissions protect the underlying data. Hiding a button is not server authorization.

## Session resolution and refresh

The core server resolver in `server/auth/session.ts` verifies a registered provider session, maps the external identity through `AuthWorkspaceStore`, resolves active membership and role, and checks deployment-admin status. The result is cached on the current request. It does not directly hard-code a Convex workspace mutation.

`GET /api/auth/session` reserves its existing per-IP `auth:session` rate allowance before
resolving identity or entitlements, so concurrent lookups share the configured
bucket. A rate-limited response includes `Retry-After`; all session responses
remain `no-store`.

It returns an envelope with `session` and `appAccessAllowed`. Client code reads
it through `useSessionContext()`:

```ts
const context = useSessionContext();
const authenticated = computed(() => context.data.value?.session.authenticated === true);
await context.refresh();
```

Auth-provider client adapters signal sign-in/sign-out changes so the application refreshes its session and workspace scope. Provider SDK refresh/recovery belongs in those adapters; there is no `AuthProvider.refreshSession` interface method or POST session-refresh endpoint.

Direct sync providers acquire provider-specific JWTs through `AuthTokenBroker`. Gateway providers call SSR endpoints that enforce `can()`; core should not reach directly into a Clerk SDK for tokens.

## OpenRouter is separate

Connect OpenRouter with OAuth PKCE or paste a supported key. Source code must use `persistUserApiKey()` to save browser keys in Dexie `kv`, update reactive state, and emit the connection signal.

Local mode can use the browser key directly. SSR mode forwards the key per request to the server stream route, unless the host supplies an instance key under its override policy. Plaintext user keys are not persisted as ordinary server configuration; durable background jobs can keep an encrypted credential envelope so work continues after detachment. Keep its encryption secret server-only. See [background execution](/documentation/cloud/background-execution) and [configuration](/documentation/cloud/config-reference#servicesllmopenrouter).

## Deployment administration

The `/admin/*` panel requires the super-admin `or3_admin` cookie obtained from the admin login credentials. A workspace owner is not automatically a deployment admin. A persisted `deploymentAdmin` grant permits deployment-level `admin.access` checks but does not, on its own, unlock super-admin panel routes.

Admin APIs resolve `WorkspaceAccessStore`, `WorkspaceSettingsStore`, and `AdminUserStore` from the selected sync backend. SQLite and Convex implement the shared bridge. Unsupported providers fail explicitly rather than borrowing another backend's admin data.

For Clerk + Convex, signing into the super-admin panel while also signed into Clerk can persist a deployment-admin grant through the signed bridge. `OR3_ADMIN_JWT_SECRET` must match between Nuxt and Convex. Inspect and revoke persistent grants at `/admin/admin-users`.

Admin logout clears the super-admin cookie. It does not sign out the application auth provider or revoke persisted deployment-admin grants. Account logout is a separate operation; local workspace data remains in Dexie.

## Custom auth provider contract

This is an advanced source integration, not a complete new-provider tutorial. The actual contract in `server/auth/types.ts` is:

```ts
import type { H3Event } from 'h3';

interface ProviderSession {
    provider: string;
    user: { id: string; email?: string; displayName?: string };
    expiresAt: Date;
    claims?: Record<string, unknown>;
}
interface AuthProvider {
    name: string;
    getSession(event: H3Event): Promise<ProviderSession | null>;
}
```

Validate the provider's token/cookie and its expiry before returning a normalized identity; return null for unauthenticated requests. Do not accept a user ID supplied by the request as proof of identity.

A Nitro server plugin registers a factory with `registerAuthProvider({ id, create: () => provider })`, and a thin Nuxt module adds that server plugin. Keep server SDKs under `runtime/server/**`, install the module, and register the required workspace store. Client UI, session-change signaling, recovery, and any direct-provider token broker also need adapters. Copy a first-party provider's structure and verify the whole sign-in/workspace/logout journey before calling a custom stack supported.

## Diagnose an access denial

1. Confirm the SSR server and selected provider are running.
2. Inspect the GET session envelope for authentication, internal user ID, workspace ID, and role.
3. Check the operation in the [capability matrix](/documentation/cloud/capability-matrix).
4. For plugin surfaces, inspect their [access policy](/documentation/cloud/plugin-access-gating), enabled-plugin setting, and entitlement resolver.
5. For the admin panel, verify the separate super-admin session.

Use [Troubleshooting](/documentation/cloud/troubleshooting) for session, provisioning, and workspace-scope symptoms.
