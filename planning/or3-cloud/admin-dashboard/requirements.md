# requirements.md

artifact_id: 04a847df-c36e-4d12-b936-66095d25446d
date: 2026-01-25

## Introduction

The Admin Dashboard is an **SSR-only** control plane for managing an OR3 Cloud deployment. It is intentionally separate from the main app UI and is only accessible to privileged workspace members. It provides a safe, centralized place to manage:

- Workspace access (members + roles + guest access)
- Deployment-installed plugins/themes (install/update/remove)
- Workspace-scoped enablement and configuration of installed plugins/themes
- Deployment system status and safe operational actions (config apply + restart)

Core principles:

- **SSR-only**: never statically generated; static builds must not ship/admin-bundle this UI.
- **Server-enforced permissions**: all access and actions are enforced on the server via `can()`.
- **Local-first unchanged**: the main app remains local-first; admin is a separate surface.
- **Extensible**: admin plugins can add pages/widgets via a parallel registry and typed hooks.
- **Provider-agnostic**: admin integrates through provider adapters/registries so auth/sync/storage can be swapped (Convex/Clerk are defaults, not assumptions).
- **Safe operations**: idempotent actions, confirmations for dangerous operations, fail-closed.

---

## Functional Requirements

### 1. Route Boundary & Isolation

**1.1** As a deployment operator, I want the admin dashboard isolated under a clear route boundary so that it cannot be confused with the main app UI.

Acceptance Criteria:
- WHEN a user navigates to the admin UI THEN it SHALL live under the `/admin/*` route boundary.
- WHEN the admin UI is rendered THEN it SHALL use its own layout and navigation (not the main sidebar/pane system).

**1.2** As a deployment operator, I want to optionally isolate the admin UI behind a dedicated origin so that it can be hosted on a subdomain or alternate port.

Acceptance Criteria:
- WHEN `OR3_ADMIN_ALLOWED_HOSTS` is configured THEN requests to `/admin/*` from non-allowed hosts SHALL return `404`.
- WHEN `OR3_ADMIN_BASE_PATH` is configured THEN the admin route boundary SHALL be remapped accordingly (default `/admin`).

**1.3** As a deployment operator, I want the admin dashboard to be SSR-only so that static builds stay lightweight and do not include admin code.

Acceptance Criteria:
- WHEN SSR auth is disabled THEN `/admin/*` SHALL return `404`.
- WHEN building a static build (`nuxt generate`) THEN the admin dashboard UI code SHALL not be bundled or generated.

---

### 2. Access Model (Auth + Authorization)

**2.1** As an authenticated user, I want admin access restricted to privileged workspace roles so that viewers/guests cannot access server controls.

Acceptance Criteria:
- WHEN a request to `/admin/*` is made THEN the server SHALL require an authenticated SSR session.
- WHEN the session role is `owner` OR `editor` THEN the user SHALL be allowed to access the admin UI.
- WHEN the session role is `viewer` OR the user is unauthenticated THEN access SHALL be denied (fail closed).

**2.2** As a security reviewer, I want all enforcement to happen on the server through `can()` so that client-side guards cannot be bypassed.

Acceptance Criteria:
- WHEN an admin API endpoint is called THEN it SHALL call `requireCan(session, <permission>)`.
- IF `can()` denies access THEN the endpoint SHALL return `401` (unauthenticated) or `403` (forbidden).

**2.3** As a deployment operator, I want dangerous operations limited to owners so that editors cannot restart or reconfigure the server.

Acceptance Criteria:
- WHEN performing deployment-scoped mutations (config apply, restart, install/uninstall extensions) THEN the caller SHALL require `owner` privileges (via `can()` permissions).
- WHEN an editor accesses deployment-scoped pages THEN mutation controls SHALL be disabled and server endpoints SHALL still reject writes.

**2.4** As a deployment operator, I want the admin dashboard to keep working when auth/sync/storage providers are swapped so that OR3 Cloud remains provider-agnostic.

Acceptance Criteria:
- WHEN the selected auth provider changes THEN admin session resolution and gating SHALL use the selected `AuthProvider` adapter (no hard-coded provider IDs).
- WHEN the selected sync provider (canonical store backend) changes THEN admin workspace and membership operations SHALL use the selected workspace store adapter (no hard-coded Convex calls).
- WHEN the selected storage provider changes THEN admin storage status and maintenance actions SHALL use the selected storage provider adapter.
- WHEN providers expose admin-specific diagnostics/actions THEN admin SHALL render them via registries/hooks rather than hard-coding provider behaviors.

---

### 3. Workspace & Access Management (v1)

**3.1** As a workspace owner, I want to view workspace details so that I can verify I’m managing the correct workspace.

Acceptance Criteria:
- WHEN viewing the Workspace section THEN the UI SHALL show workspace id, name, and description.
- WHEN viewing the Workspace section THEN the UI SHALL show the current user role in that workspace.

**3.2** As a workspace owner, I want to manage workspace members so that I can control access.

Acceptance Criteria:
- WHEN listing members THEN the server SHALL return the current membership list for the workspace.
- WHEN adding a member THEN the server SHALL upsert a membership entry in the canonical workspace store (idempotent).
- WHEN changing a member role THEN the server SHALL persist the new role and it SHALL affect subsequent `can()` decisions.
- WHEN removing a member THEN the server SHALL remove the membership and the user SHALL lose access immediately.

**3.3** As a workspace owner, I want to enable or disable guest access so that I can decide whether non-members can access the workspace.

Acceptance Criteria:
- WHEN guest access is enabled THEN a workspace-scoped setting SHALL be persisted.
- WHEN guest access is disabled THEN the same setting SHALL be persisted as disabled.
- WHEN guest access changes THEN it SHALL emit an admin hook event for observability.

---

### 4. Deployment Extensions: Plugins (Install Scope) + Workspace Enablement

**4.1** As a deployment operator, I want to view installed plugins for this deployment so that I can audit what code is available.

Acceptance Criteria:
- WHEN viewing the Plugins section THEN it SHALL list all installed plugins with manifest metadata (id, name, version, author, capabilities).
- WHEN a plugin is missing required manifest fields THEN it SHALL be reported as invalid and not loadable.

**4.2** As a deployment operator, I want to install plugins from a zip file so that I can add functionality without manual SSH.

Acceptance Criteria:
- WHEN a plugin zip is uploaded THEN the server SHALL validate it, extract it safely, and register it as installed.
- WHEN extraction would write outside the extensions directory THEN installation SHALL fail (no partial install).
- WHEN installation succeeds THEN the plugin SHALL not execute until explicitly enabled.

**4.3** As a workspace owner, I want to enable or disable an installed plugin for my workspace so that workspaces can opt into functionality.

Acceptance Criteria:
- WHEN enabling a plugin for a workspace THEN the enablement state SHALL be persisted (workspace-scoped).
- WHEN disabling a plugin for a workspace THEN the enablement state SHALL be persisted (workspace-scoped).
- WHEN a plugin is disabled THEN its UI extensions SHALL not register for that workspace.

**4.4** As a workspace owner, I want to configure plugin settings so that plugin behavior can be customized per workspace.

Acceptance Criteria:
- WHEN saving plugin settings THEN they SHALL be persisted to workspace-scoped storage.
- WHEN invalid settings are provided THEN the server SHALL reject the update with a validation error.

---

### 5. Deployment Extensions: Themes

**5.1** As a deployment operator, I want to install themes from a zip file so that I can customize branding and UX.

Acceptance Criteria:
- WHEN a theme zip is uploaded THEN the server SHALL validate it, extract it safely, and register it as installed.
- WHEN a theme is installed THEN it SHALL appear in the theme list and be eligible for selection as the deployment default.

**5.2** As a deployment operator, I want to set the deployment default theme so that new users get a consistent experience.

Acceptance Criteria:
- WHEN the deployment default theme is changed THEN the change SHALL update the deployment configuration and require an apply/restart workflow.

---

### 6. System Status & Operations

**6.1** As a deployment operator, I want a System page that shows provider status so that I can quickly diagnose misconfiguration.

Acceptance Criteria:
- WHEN viewing System status THEN it SHALL show auth provider status (enabled/provider/required keys present).
- WHEN viewing System status THEN it SHALL show sync provider status (enabled/provider/url present).
- WHEN viewing System status THEN it SHALL show storage provider status (enabled/provider).
- WHEN viewing System status THEN it SHALL show background streaming status (enabled/provider).

**6.2** As a deployment operator, I want environment warnings so that I can fix unsafe or incomplete configuration.

Acceptance Criteria:
- WHEN critical required config is missing THEN the System page SHALL display a warning.
- WHEN a setting implies degraded behavior (e.g., memory-backed limits in production) THEN the System page SHALL display a warning.

**6.3** As a deployment operator, I want to safely restart the server from the admin dashboard so that I can apply changes without SSH.

Acceptance Criteria:
- WHEN requesting a restart THEN the server SHALL require explicit confirmation intent (anti-footgun).
- WHEN authorized THEN the server SHALL initiate a restart using the configured server control strategy.
- WHEN restart initiation succeeds THEN the endpoint SHALL return success even if the connection is interrupted by process exit.

**6.4** As a deployment operator, I want the admin dashboard to monitor and manage the configured sync and storage layers so that I can diagnose issues and run maintenance regardless of provider.

Acceptance Criteria:
- WHEN viewing System status THEN it SHALL show sync layer status (enabled/provider/mode and basic health checks).
- WHEN viewing System status THEN it SHALL show storage layer status (enabled/provider and basic health checks).
- WHEN a provider exposes maintenance actions (e.g., GC, retention, reindex) THEN admin SHALL render them and enforce server permissions for execution.

---

### 7. Deployment Configuration Editing

**7.1** As a deployment operator, I want to view and edit deployment configuration so that I can manage cloud features without editing files manually.

Acceptance Criteria:
- WHEN viewing configuration THEN the UI SHALL show a safe summary of effective config values for `or3` and `or3cloud`.
- WHEN editing configuration THEN secrets SHALL be masked by default and only revealed on explicit action.
- WHEN saving configuration THEN it SHALL be validated before being written.

**7.2** As a deployment operator, I want configuration changes to be applied via a controlled workflow so that I don’t brick the deployment.

Acceptance Criteria:
- WHEN saving config changes THEN the system SHALL validate the new config with the same schemas used at startup.
- IF validation fails THEN the previous config SHALL remain active and the UI SHALL show errors.
- WHEN validation succeeds THEN the system SHALL record that a restart (and possibly rebuild) is required.

---

### 8. Admin Plugins (Extensibility)

**8.1** As a platform developer, I want a parallel admin plugin system so that admin concerns can be extended without coupling to user-facing plugins.

Acceptance Criteria:
- WHEN an admin plugin is installed THEN it SHALL not execute until explicitly enabled.
- WHEN enabled THEN it SHALL be able to register admin pages and widgets via an `AdminPluginAPI`.
- WHEN disabled THEN its registrations SHALL not be visible in the admin UI.

---

### 9. Hooks & Events

**9.1** As an operator and plugin author, I want admin lifecycle hooks so that tooling can observe and extend admin operations without core changes.

Acceptance Criteria:
- WHEN a plugin is installed THEN `admin.plugin:action:installed` SHALL be emitted.
- WHEN a plugin is enabled THEN `admin.plugin:action:enabled` SHALL be emitted.
- WHEN a plugin is disabled THEN `admin.plugin:action:disabled` SHALL be emitted.
- WHEN a user role is changed THEN `admin.user:action:role_changed` SHALL be emitted.

---

## Non-Functional Requirements

### 10. Safety & Security

**10.1** Admin operations SHALL fail closed.

**10.2** State-changing admin endpoints SHALL include CSRF protection appropriate for cookie-based SSR sessions.

**10.3** Zip extraction SHALL prevent path traversal (“zip slip”) and shall enforce size limits.

**10.4** Secrets SHALL not be logged and SHALL be masked in the UI by default.

---

### 11. Performance

**11.1** Admin pages SHALL use lazy-loading/dynamic imports for heavy subsections (plugins/themes lists, editors) to avoid bloating the main app’s hot path.

**11.2** Plugin/theme directory scanning SHOULD be cached per-process with a short TTL (e.g., 5–30s) to avoid repeated filesystem work.

---

## Out of Scope (v1)

- Marketplace UI and purchasing flows (design for it, don’t implement it).
- Multi-instance extension replication (assume single instance or shared volume; document the requirement).
- General analytics or content management UI.
