# tasks.md

artifact_id: 2f9e5c1a-0e25-4bde-8a7a-2a3e5dbf6f2f
date: 2026-01-29

## 0. Scope Notes

- Multi-admin from the start.
- Admin auth is new (super admin JWT). Front-end auth remains unchanged.
- Admin can list all workspaces, but cannot access workspace contents.
- Workspace deletion is soft delete; retention is configurable and not hard-coded.

## 1. Config + Runtime Wiring

- [ ] Add admin-auth env vars to config (`config.or3cloud.ts`). Requirements: 1.1, 1.3, 7.1
  - [ ] Add `OR3_ADMIN_USERNAME`, `OR3_ADMIN_PASSWORD`, `OR3_ADMIN_JWT_SECRET`, `OR3_ADMIN_JWT_EXPIRY`, `OR3_ADMIN_DELETED_WORKSPACE_RETENTION_DAYS`.
  - [ ] Ensure values appear only in server runtimeConfig (never public).
  - [ ] Update server/admin/config metadata pages if needed.

- [ ] Add `isAdminEnabled()` utility (server-only) and use it consistently for 404 gating. Requirements: 1.1, 7.2

## 2. Super Admin Auth (JWT)

- [ ] Implement credentials store at `.data/admin-credentials.json` (atomic write; 0600). Requirements: 1.1, 5.1, 5.5
- [ ] Implement bcrypt hashing + verification. Requirements: 5.1
- [ ] Implement JWT sign/verify + cookie helpers (httpOnly, sameSite=strict, path=/admin). Requirements: 1.3, 5.2, 5.4
- [ ] Implement login rate limiting (IP + username). Requirements: 5.3

- [ ] Add admin auth API routes. Requirements: 1.1, 1.3, 1.4
  - [ ] `POST server/api/admin/auth/login.post.ts`
  - [ ] `POST server/api/admin/auth/logout.post.ts`
  - [ ] `POST server/api/admin/auth/change-password.post.ts` (super admin only)

## 3. Hybrid Admin Session Resolution

- [ ] Add `resolveAdminRequestContext(event)` that returns super-admin principal OR workspace-admin principal. Requirements: 1.2, 1.3
  - [ ] Super admin path: JWT cookie -> principal.
  - [ ] Workspace admin path: `resolveSessionContext(event)` -> check `admin.access` -> principal.

- [ ] Update `server/middleware/admin-gate.ts`.
  - [ ] Replace SSR-auth-only gate with `isAdminEnabled()` gate. Requirements: 1.1, 7.2
  - [ ] Allow unauthenticated access to `/admin/login` and `/api/admin/auth/login`.
  - [ ] For other `/admin/*`, require resolved admin context, otherwise redirect to `/admin/login`.
  - [ ] Keep `OR3_ADMIN_ALLOWED_HOSTS` behavior.

- [ ] Update `server/admin/api.ts` to accept the new admin context, not only `SessionContext`. Requirements: 1.2
  - [ ] Keep `can()` / `requireCan()` as the central authorization gate for workspace-admin requests.
  - [ ] For super admin requests, apply explicit policy checks (owner-only operations, destructive operations).

## 4. Canonical Store: Admin Grants (Multi-admin)

- [ ] Add canonical-store schema for deployment admin grants (Convex: add `admin_users` table, **hard-delete on revoke**). Requirements: 1.2, 3.2
- [ ] Add Convex functions to list/grant/revoke admin grants (**revoke = hard-delete**). Requirements: 3.2
- [ ] Add `AdminUserStore` interface + registry in `server/admin/stores/*`. Requirements: 1.2, 3.2
- [ ] Extend session resolution to include deployment-admin flag.
  - [ ] Update `resolveSessionContext(event)` to set `deploymentAdmin` based on store lookup. Requirements: 1.2
  - [ ] Update `app/core/hooks/hook-types.ts` SessionContext type to include `deploymentAdmin?: boolean`.
  - [ ] Update `server/auth/can.ts` so `admin.access` can be granted based on `deploymentAdmin`. Requirements: 1.2

## 5. Canonical Store: Workspace List + Soft Delete

- [ ] Extend canonical workspace schema with soft delete fields (Convex: `workspaces.deleted`, `workspaces.deleted_at`). Requirements: 2.5
- [ ] Extend `WorkspaceAccessStore` to support:
  - [ ] `listWorkspaces` (search + pagination + includeDeleted)
  - [ ] `getWorkspace`
  - [ ] `createWorkspace` (requires `ownerUserId` - must be an existing user)
  - [ ] `softDeleteWorkspace`
  - [ ] `restoreWorkspace`
  - [ ] `searchUsers` (search by email/display_name for user picker UI)
        Requirements: 2.1, 2.2, 2.4, 2.5

- [ ] Implement Convex store methods and Convex functions for these operations. Requirements: 2.1, 2.4, 2.5

## 5.1 Provider Capability Detection

- [ ] Add `AdminStoreCapabilities` interface with flags: `supportsServerSideAdmin`, `supportsUserSearch`, `supportsWorkspaceList`
- [ ] Add `getAdminStoreCapabilities(providerId)` function in store registry
- [ ] Add memory provider implementation with admin support (ephemeral data, for local dev)

## 6. Admin API: Workspaces

- [ ] Add new admin endpoints:
  - [ ] `GET server/api/admin/workspaces.get.ts` (list)
  - [ ] `GET server/api/admin/workspaces/[id].get.ts` (detail)
  - [ ] `POST server/api/admin/workspaces.post.ts` (create)
  - [ ] `POST server/api/admin/workspaces/[id]/soft-delete.post.ts`
  - [ ] `POST server/api/admin/workspaces/[id]/restore.post.ts`
        Requirements: 2.1, 2.2, 2.4, 2.5

- [ ] Add member management endpoints under workspace id (or reuse existing with path change).
      Requirements: 2.3

- [ ] Ensure responses include only metadata (no workspace contents). Requirements: 2.2

## 7. Admin UI: Workspaces

- [ ] Add `/admin/login` page. Requirements: 1.1
- [ ] Add `/admin/workspaces` list page with search + pagination + deleted filter. Requirements: 2.1, 2.5
- [ ] Add `/admin/workspaces/[id]` detail page:
  - [ ] metadata + members
  - [ ] guest access toggle
  - [ ] enabled plugins list
  - [ ] soft delete / restore actions
        Requirements: 2.2, 2.3, 2.5

- [ ] Deprecate or redirect `app/pages/admin/workspace.vue` to `/admin/workspaces`. Requirements: 2.1

## 8. Admin UI: Admin Users

- [ ] Add `/admin/admin-users` page to grant/revoke deployment admin access. Requirements: 3.2
  - [ ] Search by email/provider id.
  - [ ] Show current grants.

## 9. Hooks + Events

- [ ] Emit hooks for workspace create/delete and member role changes.
  - [ ] `admin.workspace:action:created`
  - [ ] `admin.workspace:action:deleted`
  - [ ] `admin.user:action:role_changed` (already in requirements)
        Requirements: 2.3, 2.4, 2.5

## 10. Tests

- [ ] Unit tests:
  - [ ] admin auth (hash/verify, jwt sign/verify)
  - [ ] `can()` allows `admin.access` when `deploymentAdmin` true
  - [ ] retention config parsing (unset retains indefinitely)
        Requirements: 1.3, 5.1, 5.2, 2.5

- [ ] Integration tests:
  - [ ] admin disabled -> 404
  - [ ] login -> cookie set
  - [ ] workspace admin without grant -> 403
  - [ ] workspace admin with grant -> 200
  - [ ] list workspaces returns metadata only
        Requirements: 1.1, 1.2, 2.1, 2.2

## 11. Manual Checklist

- [ ] Verify `/admin/workspaces` shows all workspaces.
- [ ] Verify workspace detail shows members/settings but not messages/threads/files.
- [ ] Verify soft delete hides workspace from active list and shows in deleted filter.
- [ ] Verify retention is read from env and not hard-coded.
- [ ] Verify super admin can grant admin access to a normal user, and that user can access admin while logged into frontend.
