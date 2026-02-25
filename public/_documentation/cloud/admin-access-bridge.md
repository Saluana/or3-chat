# Admin Access Bridge (Clerk + Convex)

This page explains why a Clerk user can appear as an admin in deployments that use the Convex provider.

## Quick Summary

- Not every Clerk user is an admin.
- Admin access for Clerk users is controlled by the Convex `admin_users` table.
- A Clerk user can be granted admin automatically by the super-admin bridge flow.
- That grant is persisted in Convex until explicitly revoked.

Current policy note:

- The `/admin/*` panel is super-admin-only.
- A persisted deployment-admin grant does not by itself unlock admin panel pages.

## Two Admin Identities

OR3 admin has two identity paths:

1. Super admin cookie (`or3_admin`) from `/api/admin/auth/login` using `OR3_ADMIN_USERNAME` and `OR3_ADMIN_PASSWORD`.
2. Workspace admin session (`kind: 'workspace_admin'`) when a Clerk session resolves to `deploymentAdmin=true`.

`deploymentAdmin=true` allows `admin.access` checks, but admin panel routes remain super-admin-only.

## How the Bridge Works

In Clerk + Convex setups, the Convex admin store includes a super-admin bridge:

1. You log into `/admin/login` with super-admin username/password.
2. You also have an active Clerk session in the same browser.
3. The server signs a bridge token using `OR3_ADMIN_JWT_SECRET`.
4. Convex mutation `admin.ensureDeploymentAdmin` inserts your mapped user into `admin_users` if missing.

This is why a first Clerk account often becomes admin during initial setup.

## Is It Permanent?

The super-admin cookie is session auth for `/admin` and can be cleared by logout.

The deployment admin grant in Convex is separate and persistent:

- Stored in `admin_users`.
- Survives logout, browser restart, and server restart.
- Remains until revoked via admin APIs (or manual Convex data changes).

## Logout Behavior

`POST /api/admin/auth/logout` clears `or3_admin` only.

It does not:

- Sign out Clerk.
- Remove the Convex `admin_users` grant.

So a user can still have a persisted deployment-admin grant after logout, even though panel access still requires super-admin auth.

## Required Secrets for Bridge Flow

For the bridge to work reliably in Clerk + Convex mode:

- Nuxt runtime must have `OR3_ADMIN_JWT_SECRET`.
- Convex environment must also have the same `OR3_ADMIN_JWT_SECRET`.

If these are mismatched or missing, bridge calls fail and admin bootstrapping behaves inconsistently.

## Verify and Revoke

- Use `/admin/admin-users` (super-admin path) to inspect grants.
- Revoke users there to remove persistent deployment admin access.

## Related

- [provider-convex](./provider-convex)
- [identity-access-concepts](./identity-access-concepts)
- [troubleshooting](./troubleshooting)
