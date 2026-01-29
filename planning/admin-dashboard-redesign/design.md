# design.md

artifact_id: 59a7d7f2-2ca3-4d19-9b71-a8d4a7f4a0f3
date: 2026-01-29

## Overview

This design updates the OR3 Cloud admin dashboard to:

- authenticate via a dedicated admin auth scheme (super-admin username/password + JWT)
- support multiple admins from the start by allowing workspace-authenticated users to access admin when explicitly granted in the canonical store
- replace the current single-workspace admin page with a deployment-wide workspace registry (list + soft delete + member management)
- keep workspace contents private (no messages/threads/files in admin)

Key constraints honored:

- local-first behavior is unchanged for the main app
- static builds remain unchanged; admin is SSR-only
- authorization for SSR endpoints remains centralized in `can()` / `requireCan()`
- workspaces/users remain canonical in the selected SyncProvider backend

## Current State (Why `/admin/workspace` is wrong)

Today, `server/api/admin/workspace.get.ts` uses `requireAdminApi(event)` which resolves the *active* workspace via `resolveSessionContext(event)` and then loads members/settings for `session.workspace.id`.

That behavior is correct for “manage *my* workspace”, but incorrect for a deployment admin dashboard.

## High-Level Architecture

```mermaid
flowchart TB
  subgraph Browser
    AdminUI[/admin/* UI/]
  end

  subgraph Nitro
    AdminGate[server/middleware/admin-gate.ts]
    AdminAuth[server/admin/auth/*]
    Session[server/auth/session.ts]
    Can[server/auth/can.ts]
    AdminApi[server/api/admin/**]
    Stores[server/admin/stores/*]
  end

  subgraph Canonical[Canonical Store (selected sync backend)]
    Workspaces[(workspaces)]
    WorkspaceMembers[(workspace_members)]
    AdminUsers[(admin_users)]
    KV[(kv)]
  end

  AdminUI --> AdminGate
  AdminGate -->|super-admin jwt| AdminAuth
  AdminGate -->|workspace session| Session --> Can
  AdminApi --> Can
  AdminApi --> Stores --> Canonical
```

### Admin Identity Types

Admin access is granted via one of two identities:

1) **Super admin**: local credentials set via env; session is a JWT cookie.
2) **Workspace admin**: normal SSR auth session (Clerk/etc.) plus a deployment-scoped admin grant stored in the canonical store.

Both identities allow listing all workspaces, but admin endpoints still enforce capability boundaries (read vs mutate vs destructive).

## Authentication Design

### Enablement

Admin is enabled only when `OR3_ADMIN_USERNAME` and `OR3_ADMIN_PASSWORD` are configured.

- If not configured: admin routes and admin API return `404`.

### Super Admin Credentials

- credentials are sourced from env at boot
- passwords are hashed with bcrypt and persisted at `.data/admin-credentials.json` (to avoid keeping cleartext in memory longer than needed)
- env is treated as the bootstrap source; changing env later does not automatically rotate credentials (rotation is done via admin UI)

File format:

```ts
export type AdminCredentialsFile = {
  username: string;
  password_hash_bcrypt: string;
  created_at: string; // ISO
  updated_at: string; // ISO
};
```

### Super Admin Session (JWT)

JWT cookie:

- cookie name: `or3_admin`
- `httpOnly`, `secure` (in prod), `sameSite=strict`, `path=/admin`
- signed with `OR3_ADMIN_JWT_SECRET` (required; if unset, generate once and persist in `.data/admin-jwt-secret`)
- expiration: `OR3_ADMIN_JWT_EXPIRY` (e.g. `24h`)

Payload:

```ts
export type AdminJwtClaims = {
  kind: 'super_admin';
  username: string;
  iat: number;
  exp: number;
};
```

### Workspace Admin Access (Multi-admin)

Workspace-authenticated users can access admin only if the canonical store marks them as deployment admin.

This avoids coupling admin access to workspace roles (`owner`/`editor`), and matches the requirement “permissions set on user in DB”.

Canonical-store schema:

```ts
// deployment-scoped admin grants
admin_users: {
  user_id: Id<'users'>;
  created_at: number;
  created_by_admin_user_id?: Id<'users'>; // optional
  revoked_at?: number;
  revoked_by_admin_user_id?: Id<'users'>;
}
```

The admin dashboard UI includes an “Admin Users” screen that lets the super admin grant/revoke these entries.

### How This Fits `can()`

To keep `can()` as the sole authorization gate:

- `resolveSessionContext(event)` is extended to include a boolean like `deploymentAdmin?: boolean` computed by querying the canonical store for `admin_users`.
- `can(session, 'admin.access')` is allowed if either:
  - `session.role === 'owner'` (optional policy choice), OR
  - `session.deploymentAdmin === true`

This keeps enforcement centralized while allowing per-user admin grants.

Note: super-admin JWT is not a normal `SessionContext`. Admin endpoints accept either:

- `AdminRequestContext` (super-admin), or
- `SessionContext` (workspace admin)

but authorization decisions still flow through a single gate function.

## Workspace Management Design

### Data Model: Soft Delete

Workspaces gain soft-delete fields (mirrors other tables’ delete pattern):

```ts
workspaces: {
  ...
  deleted: boolean;
  deleted_at?: number;
}
```

Retention is configurable via `OR3_ADMIN_DELETED_WORKSPACE_RETENTION_DAYS`.

- if unset: retain indefinitely (no automatic purge)
- if set: used only for UI copy and future scheduled purge (not hard-coded)

### Workspace List vs Workspace Contents

Admin APIs only expose metadata:

- workspace id/name/created_at/deleted/deleted_at
- owner email/id (if available)
- member count
- members list + roles
- workspace settings used for access control (guest access, plugin enablement)

Explicitly out of scope:

- threads/messages/posts/file_meta contents

## Server Interfaces

### Admin Auth

```ts
export type AdminPrincipal =
  | { kind: 'super_admin'; username: string }
  | { kind: 'workspace_admin'; userId: string };

export type AdminRequestContext = {
  principal: AdminPrincipal;
  // if present, this is the workspace session that can be used by can()
  session?: import('~/core/hooks/hook-types').SessionContext;
};
```

### Store Extensions

The existing `WorkspaceAccessStore` is extended to support deployment-wide listing and soft delete.

```ts
export interface WorkspaceSummary {
  id: string;
  name: string;
  createdAt: number;
  deleted: boolean;
  deletedAt?: number;
  ownerUserId?: string;
  ownerEmail?: string;
  memberCount: number;
}

export interface WorkspaceAccessStore {
  listMembers(input: { workspaceId: string }): Promise<WorkspaceMemberInfo[]>;
  upsertMember(input: { workspaceId: string; emailOrProviderId: string; role: 'owner'|'editor'|'viewer'; provider?: string }): Promise<void>;
  setMemberRole(input: { workspaceId: string; userId: string; role: 'owner'|'editor'|'viewer' }): Promise<void>;
  removeMember(input: { workspaceId: string; userId: string }): Promise<void>;

  // new
  listWorkspaces(input: { search?: string; includeDeleted?: boolean; page: number; perPage: number }): Promise<{ items: WorkspaceSummary[]; total: number }>;
  getWorkspace(input: { workspaceId: string }): Promise<WorkspaceSummary | null>;
  createWorkspace(input: { name: string; description?: string; ownerUserId: string }): Promise<{ workspaceId: string }>;
  softDeleteWorkspace(input: { workspaceId: string; deletedAt: number }): Promise<void>;
  restoreWorkspace(input: { workspaceId: string }): Promise<void>;
}
```

Admin users are managed via a separate store (deployment-scoped):

```ts
export interface AdminUserStore {
  listAdmins(): Promise<Array<{ userId: string; email?: string; createdAt: number; revokedAt?: number }>>;
  grantAdmin(input: { userId: string; createdAt: number }): Promise<void>;
  revokeAdmin(input: { userId: string; revokedAt: number }): Promise<void>;
  isAdmin(input: { userId: string }): Promise<boolean>;
}
```

## API Surface (New/Updated)

Routes are SSR-only and all mutations enforce CSRF via the existing admin guard (`server/admin/guard`).

Auth endpoints:

- `POST /api/admin/auth/login` (super admin credentials -> JWT cookie)
- `POST /api/admin/auth/logout` (clear cookie)
- `POST /api/admin/auth/change-password` (super admin only)

Workspace endpoints:

- `GET /api/admin/workspaces` (list all workspaces; supports `search`, `page`, `perPage`, `includeDeleted`)
- `GET /api/admin/workspaces/:id` (workspace metadata + members + guest access + enabled plugins)
- `POST /api/admin/workspaces` (create workspace)
- `POST /api/admin/workspaces/:id/soft-delete` (soft delete)
- `POST /api/admin/workspaces/:id/restore` (restore)
- `POST /api/admin/workspaces/:id/members/upsert`
- `POST /api/admin/workspaces/:id/members/set-role`
- `POST /api/admin/workspaces/:id/members/remove`

Admin-user endpoints:

- `GET /api/admin/admin-users` (list admin grants)
- `POST /api/admin/admin-users/grant`
- `POST /api/admin/admin-users/revoke`

## UI Changes

Pages:

- `app/pages/admin/login.vue` (super admin login)
- `app/pages/admin/workspaces/index.vue` (workspace list)
- `app/pages/admin/workspaces/[id].vue` (workspace detail)
- `app/pages/admin/admin-users.vue` (grant/revoke deployment admins)

Route behavior:

- `app/pages/admin/workspace.vue` is removed or replaced with a redirect to `/admin/workspaces`.

## Security Notes

- rate limit `/api/admin/auth/login` (IP + username)
- never log passwords or JWTs
- admin cookie scoped to `/admin`
- admin APIs fail closed (404 when admin disabled; 401/403 otherwise)
- listing all workspaces is allowed, but workspace contents are never returned

## Provider Notes / Risks

The canonical store is the selected sync backend. Deployment-wide operations like listing all workspaces and managing `admin_users` require provider support.

- Convex implementation today uses user-minted provider tokens (Clerk JWT template) for admin store calls.
- For super-admin JWT to fully manage workspaces without a provider session, the sync provider must support a server-side admin credential path.

Design choice:

- v1: allow super-admin login independent of SSR auth, but allow “workspace management” features only when the sync provider supports server-side admin store access.
- When unsupported: show a clear warning on `/admin/system` and disable workspace mutations.

## Testing Strategy

Unit tests:

- admin auth: password hashing/verify; JWT sign/verify; cookie options
- `can()` decision: `admin.access` allowed when `deploymentAdmin` is true
- soft delete retention parsing (unset retains indefinitely)

Integration tests:

- admin gate: 404 when disabled; redirect/login flow; allow JWT; allow workspace session only when granted
- workspaces list: returns metadata only; search/pagination
- workspace detail: excludes content tables
