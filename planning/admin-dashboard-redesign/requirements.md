# Admin Dashboard Redesign: Requirements

**artifact_id:** `admin-dashboard-redesign-2026-01-29`  
**date:** 2026-01-29  
**status:** Draft for Review

---

## Introduction

This document outlines the requirements for two major changes to the OR3 Cloud admin dashboard:

1. **Workspace Management Redesign**: The current `/admin/workspace` page shows only the active workspace. It should be redesigned to show **all workspaces** in the deployment and allow the admin to manage them.

2. **Hybrid Admin Authentication**: The admin dashboard will have its **own authentication system** that supports:
   - **Super Admin**: Created via environment variables (`OR3_ADMIN_USERNAME`, `OR3_ADMIN_PASSWORD`) with JWT auth
   - **Additional Admins**: Granted admin access via a deployment-scoped admin grant stored in the canonical backend (DB)
   - This provides a consistent admin experience regardless of which auth provider the main app uses, while allowing flexibility for teams

---

## Functional Requirements

### 1. Admin Authentication System (Hybrid Approach)

**1.1** As a deployment operator, I want to bootstrap the admin dashboard with a super admin account via environment variables so that I can set up a new deployment without external auth configuration.

**Acceptance Criteria:**
- WHEN `OR3_ADMIN_USERNAME` and `OR3_ADMIN_PASSWORD` are set THEN the super admin account SHALL be created on first boot
- WHEN the super admin logs in THEN they SHALL receive a JWT signed with `OR3_ADMIN_JWT_SECRET`
- WHEN the JWT is valid THEN the super admin SHALL have full admin access to all features
- WHEN no admin credentials are configured THEN the admin dashboard SHALL return 404 (fail closed)

**1.2** As a super admin, I want to grant admin access to other users via a deployment-scoped permission in the canonical backend so that team members can access the admin dashboard.

**Acceptance Criteria:**
- WHEN a user is granted deployment admin access in the canonical backend THEN they SHALL be able to access the admin dashboard while authenticated via the main app auth provider
- WHEN accessing `/admin/*` THEN the system SHALL check for EITHER:
  - Valid super admin JWT, OR
  - Valid workspace-authenticated session that is marked as deployment admin
- WHEN a deployment admin accesses the admin dashboard THEN they SHALL see all workspaces (not just their own)

**1.3** As an admin user (super or permission-based), I want my session to be secure and time-limited so that unauthorized access is prevented.

**Acceptance Criteria:**
- WHEN logging in as super admin THEN a JWT SHALL be issued with configurable expiration (default: 24 hours, via `OR3_ADMIN_JWT_EXPIRY`)
- WHEN the JWT expires THEN the user SHALL be redirected to the login page
- WHEN logging out THEN the JWT SHALL be invalidated client-side
- WHEN a workspace session expires THEN the user SHALL be redirected to re-authenticate with their provider

**1.4** As a super admin, I want to change my password from within the admin dashboard so that I can maintain security.

**Acceptance Criteria:**
- WHEN authenticated as super admin THEN I SHALL be able to change my password
- WHEN changing password THEN the new password SHALL be validated (min 12 characters, at least one uppercase, one lowercase, one number)
- WHEN password is changed THEN the change SHALL be persisted to the admin credentials file
- WHEN password is changed THEN existing JWTs SHALL remain valid until expiry (no forced logout)

---

### 2. Workspace Management (List All Workspaces)

**2.1** As an admin, I want to see a list of all workspaces in the deployment so that I can understand the full scope of the system.

**Acceptance Criteria:**
- WHEN viewing the Workspaces section THEN the UI SHALL show all workspaces (not just the active one)
- WHEN listing workspaces THEN each workspace SHALL show: ID, name, member count, creation date, owner email
- WHEN there are many workspaces THEN the list SHALL support pagination (default: 20 per page)
- WHEN viewing the workspace list THEN I SHALL be able to search by workspace name or owner email

**2.2** As an admin, I want to view details of any workspace so that I can understand its configuration.

**Acceptance Criteria:**
- WHEN clicking on a workspace THEN the UI SHALL navigate to a workspace detail view (`/admin/workspaces/[id]`)
- WHEN viewing workspace details THEN I SHALL see: name, ID, creation date, owner, members list with roles
- WHEN viewing workspace details THEN I SHALL see guest access status and enabled plugins
- WHEN viewing workspace details THEN I SHALL be able to navigate back to the workspace list
- WHEN viewing workspace details THEN I SHALL NOT see workspace content (messages, threads, files) - workspace data remains private

**2.3** As an admin, I want to manage members of any workspace so that I can control access.

**Acceptance Criteria:**
- WHEN viewing a workspace's details THEN I SHALL see all members and their roles
- WHEN adding a member THEN the server SHALL upsert a membership entry in the canonical workspace store
- WHEN changing a member's role THEN the server SHALL persist the new role and it SHALL affect subsequent `can()` decisions
- WHEN removing a member THEN the server SHALL remove the membership and the user SHALL lose access immediately
- WHEN performing member operations THEN the server SHALL emit `admin.user:action:role_changed` hook

**2.4** As an admin, I want to create new workspaces so that teams can be onboarded.

**Acceptance Criteria:**
- WHEN clicking "Create Workspace" THEN a form SHALL appear for workspace name and optional description
- WHEN submitting the form THEN the workspace SHALL be created in the canonical store
- WHEN a workspace is created THEN the admin SHALL be added as owner
- WHEN a workspace is created THEN the server SHALL emit `admin.workspace:action:created` hook

**2.5** As an admin, I want to soft-delete workspaces so that I can clean up unused workspaces with the ability to recover.

**Acceptance Criteria:**
- WHEN viewing workspace details THEN a "Delete Workspace" option SHALL be available with explicit confirmation
- WHEN deleting a workspace THEN the server SHALL mark it as deleted (soft delete) with a timestamp
- WHEN a workspace is soft-deleted THEN all members SHALL lose access immediately
- WHEN a workspace is soft-deleted THEN it SHALL appear in a "Deleted Workspaces" list for recovery
- WHEN the retention period expires (configurable via `OR3_ADMIN_DELETED_WORKSPACE_RETENTION_DAYS`) THEN the workspace MAY be permanently deleted (implementation deferred to future)
- WHEN deleting a workspace THEN the server SHALL emit `admin.workspace:action:deleted` hook

---

### 3. Super Admin User Management

**3.1** As a super admin, I want to view the current super admin configuration so that I can verify the setup.

**Acceptance Criteria:**
- WHEN viewing Admin Settings THEN I SHALL see the super admin username (read-only)
- WHEN viewing Admin Settings THEN I SHALL see when the super admin was created
- WHEN viewing Admin Settings THEN I SHALL see the option to change the super admin password

**3.2** As a super admin, I want to see which users have deployment admin access so that I can understand the admin landscape.

**Acceptance Criteria:**
- WHEN viewing Admin Users section THEN I SHALL see all users with deployment admin grants
- WHEN viewing the list THEN each entry SHALL show: user email (if available), granted date, and current status (active/revoked)
- WHEN viewing the list THEN I SHALL be able to revoke deployment admin access

---

### 4. Migration and Backward Compatibility

**4.1** As an existing OR3 Cloud user, I want the admin dashboard to use the new auth system immediately so that there's no confusion about which auth to use.

**Acceptance Criteria:**
- WHEN upgrading to the new admin system THEN the old auth integration SHALL be removed from admin routes
- WHEN the new auth system is enabled THEN admin routes SHALL only accept super admin JWT OR workspace sessions with `admin.access`
- WHEN no admin credentials are configured AND no workspace session exists THEN the admin dashboard SHALL return 404

---

## Non-Functional Requirements

### 5. Security

**5.1** Super admin passwords SHALL be hashed using bcrypt with a cost factor of 12.

**5.2** JWTs SHALL be signed with HS256 algorithm using a secret key (configurable via `OR3_ADMIN_JWT_SECRET`, auto-generated if not provided).

**5.3** Failed login attempts SHALL be rate-limited to 5 attempts per 15 minutes per IP.

**5.4** Admin sessions SHALL use httpOnly, secure, sameSite=strict cookies for the JWT.

**5.5** The super admin credentials file SHALL be stored at `.data/admin-credentials.json` with restricted permissions (readable only by server process).

**5.6** Admin passwords SHALL never be logged or returned in API responses.

### 6. Performance

**6.1** Super admin login SHALL complete in under 500ms (password verification + JWT issuance).

**6.2** Workspace list SHALL load in under 1 second for up to 100 workspaces.

**6.3** Admin pages SHALL use pagination for large datasets (workspaces, members).

**6.4** Workspace list SHALL be cached for 30 seconds to reduce database load.

### 7. Deployment

**7.1** The admin auth system SHALL be opt-in via environment variables (no breaking changes to existing deployments without credentials).

**7.2** When admin credentials are not configured, the admin dashboard SHALL be completely disabled (404).

**7.3** The system SHALL support running admin on a separate subdomain or port (existing `OR3_ADMIN_ALLOWED_HOSTS` functionality).

**7.4** The deleted workspace retention period SHALL be configurable via `OR3_ADMIN_DELETED_WORKSPACE_RETENTION_DAYS` (and SHALL NOT be hard-coded in application logic).

---

## Out of Scope (Future Versions)

- OAuth/SAML integration for super admin auth
- Audit logging for admin actions
- Admin activity dashboard (who did what when)
- Automatic permanent deletion of soft-deleted workspaces
- Workspace content inspection (messages, files) - admins manage access, not content
- Multi-super-admin support (v1 supports only one super admin)

---

## Configuration Summary

| Environment Variable | Description | Default |
|---------------------|-------------|---------|
| `OR3_ADMIN_USERNAME` | Super admin username (required to enable admin) | - |
| `OR3_ADMIN_PASSWORD` | Super admin password (required to enable admin) | - |
| `OR3_ADMIN_JWT_SECRET` | JWT signing secret (auto-generated if not set) | - |
| `OR3_ADMIN_JWT_EXPIRY` | JWT expiration time | `24h` |
| `OR3_ADMIN_DELETED_WORKSPACE_RETENTION_DAYS` | Days to retain soft-deleted workspaces | unset (retain indefinitely) |
| `OR3_ADMIN_ALLOWED_HOSTS` | Allowed hosts for admin (existing) | - |
