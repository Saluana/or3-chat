# design.md

artifact_id: 1f5712a1-ec3a-49bf-b9a8-17283c3ebf5b
date: 2026-01-25

## Overview

This design adds an **SSR-only Admin Dashboard** for OR3 Cloud that can safely manage a deployment (config + restart) and workspace-scoped settings (members + plugin enablement), while preserving:

- Local-first UX and static builds (admin code excluded when SSR auth disabled)
- The hook/registry/composable extension model
- Locked OR3 Cloud decisions (`can()`, AuthWorkspaceStore in SyncProvider backend, per-workspace Dexie DB, snake_case wire schema)

The dashboard is implemented as a separate SSR area under `/admin/*` with its own layout/navigation and a **parallel admin plugin registry**.

Related:
- `planning/or3-cloud/admin-dashboard/architecture.md` (visual flows + data paths)

---

## Architecture

```mermaid
flowchart TB
    subgraph Browser[Browser]
        AdminUI[/admin/* UI/]
        AdminPlugins[Admin Plugin Registry]
        AdminApiClient[Admin API Client]
    end

    subgraph Nitro[Nitro Server]
        AdminApi[server/api/admin/**]
        Sess[resolveSessionContext]
        Can[can()/requireCan()]
        Hooks[Server Hook Engine]
        ExtMgr[ExtensionManager]
        CfgMgr[ConfigManager]
        SrvCtl[ServerControlProvider]
        StoreClient[Workspace/Settings Store Client]
    end

    subgraph Deployment[Deployment Resources]
        FS[(Filesystem: extensions/, .env, config files)]
        Proc[Process supervisor / restart strategy]
    end

    subgraph Backend[Canonical Store (selected SyncProvider backend)]
        WS[(workspaces)]
        Members[(workspace_members)]
        KV[(kv)]
    end

    AdminUI --> AdminApiClient --> AdminApi
    AdminUI --> AdminPlugins

    AdminApi --> Sess --> Can
    AdminApi --> Hooks
    AdminApi --> ExtMgr --> FS
    AdminApi --> CfgMgr --> FS
    AdminApi --> SrvCtl --> Proc
    AdminApi --> StoreClient --> Backend
    StoreClient --> Members
    StoreClient --> WS
    StoreClient --> KV
```

### Core Components

| Component | Responsibility |
|---|---|
| Admin UI (`app/pages/admin/**`) | SSR-only control plane pages + navigation |
| Admin API (`server/api/admin/**`) | Server-enforced endpoints for workspace/deployment operations |
| `ExtensionManager` | Install/list/remove plugins/themes/admin-plugins on disk; validate manifests |
| `ConfigManager` | Read/write `.env` and/or config files; validate config; track “restart required” |
| `ServerControlProvider` | Perform restart (and optional rebuild) via a configured safe strategy |
| `Server Hook Engine` | Emit admin lifecycle hooks from Nitro routes |
| Workspace + settings store adapters | Provider-agnostic access to canonical workspaces/members and workspace-scoped settings (default Convex implementation) |

---

## Routing, Build Gating, and Subdomain/Port Support

### Route Boundary

- Admin UI pages live under `app/pages/admin/**`.
- Admin layout lives under `app/layouts/admin.vue` (no reuse of main panes/sidebar).
- Admin API endpoints live under `server/api/admin/**`.

### SSR-only + Static Build Exclusion

Admin must not ship in static builds. Implementation approach:

1. **Runtime gating (fail closed):**
   - All `server/api/admin/**` handlers call `isSsrAuthEnabled(event)` and return `404` if disabled.
   - Admin UI route middleware redirects/404s when `runtimeConfig.public.ssrAuthEnabled` is false.

2. **Build-time exclusion (preferred):**
   - In `nuxt.config.ts`, when `or3CloudConfig.auth.enabled` is false, add ignore patterns for:
     - `app/pages/admin/**`
     - `app/layouts/admin.vue`
     - `app/components/admin/**`
     - `app/composables/admin/**`
   This keeps the static bundle clean and avoids “hidden” admin routes.

### Subdomain / Alternate Port

Admin can be served behind:

- `admin.<domain>` (recommended) via reverse proxy, OR
- A different port in dev/testing.

Code-level support (simple, effective):

- `OR3_ADMIN_ALLOWED_HOSTS` (comma-separated) restricts serving admin routes to specific `Host` headers.
- `OR3_ADMIN_BASE_PATH` optionally remaps the base path from `/admin`.

This yields isolation without a second Nuxt app.

---

## Authorization Model

### Access

- Access to Admin UI requires `admin.access`.
- To satisfy the spec (“owner OR editor can access”), update `server/auth/can.ts` so `editor` includes `admin.access`.

### Action-level permissioning (fail closed)

Admin actions are split into:

- **Workspace-scoped** actions:
  - Membership management (`users.manage`)
  - Workspace settings (`workspace.settings.manage`)
  - Plugin enablement & settings (`plugins.manage` for writes; `workspace.read` for reads)

- **Deployment-scoped** actions (config apply, restart, install/uninstall extensions):
  - Require owner-only via existing permissions (`workspace.settings.manage` or a new explicit `system.manage` permission).
  - v1 keeps this minimal: require `workspace.settings.manage` and `admin.access`.

> Note: Even for deployment-scoped actions, auth is still workspace-bound because session context is workspace-scoped. In v1, “owner of active workspace” is the operator. If multi-tenant deployments require a separate operator role later, add a distinct permission (e.g., `system.manage`).

---

## Data Model

### 1) Workspace Members (canonical)

Admin must not assume Convex. Workspace identity and membership are owned by the **canonical workspace store** (`AuthWorkspaceStore`), which is backed by the selected SyncProvider backend (Convex default).

To support member management, introduce a provider-agnostic interface (backed by the same canonical backend):

```ts
export interface WorkspaceAccessStore {
  listMembers(input: { workspaceId: string }): Promise<Array<{ userId: string; email?: string; role: 'owner'|'editor'|'viewer' }>>;
  upsertMember(input: { workspaceId: string; emailOrProviderId: string; role: 'owner'|'editor'|'viewer' }): Promise<void>;
  setMemberRole(input: { workspaceId: string; userId: string; role: 'owner'|'editor'|'viewer' }): Promise<void>;
  removeMember(input: { workspaceId: string; userId: string }): Promise<void>;
}
```

Default Convex implementation uses `workspaces` + `workspace_members` tables and implements this interface. Alternative backends (Firebase/Firestore, Supabase/Postgres, etc.) implement the same interface using their own schema.

### 2) Workspace Settings (guest access, plugin enablement, plugin settings)

Use existing `kv` table to avoid new tables in v1.

Suggested keys (snake_case inside JSON payloads):

- `admin.guest_access.enabled` → `"true" | "false"`
- `plugins.enabled` → JSON array string `["plugin.a","plugin.b"]`
- `plugins.settings.<plugin_id>` → JSON object string

This keeps state workspace-scoped and syncable across devices (via existing sync layer).

To keep providers swappable, access to these keys should go through a small adapter rather than direct Convex calls:

```ts
export interface WorkspaceSettingsStore {
  get(workspaceId: string, key: string): Promise<string | null>;
  set(workspaceId: string, key: string, value: string): Promise<void>;
}
```

### 3) Deployment Extensions (installed plugins/themes/admin-plugins)

These are **per deployment** and stored on disk under a dedicated directory:

```
extensions/
  plugins/<id>/
    or3.manifest.json
    plugin.client.ts
    plugin.server.ts (optional)
  themes/<id>/
    or3.manifest.json
    theme.ts
  admin-plugins/<id>/
    or3.manifest.json
    admin.client.ts
```

To support “install from zip” + “marketplace later”, define a unified manifest:

```ts
export type ExtensionKind = 'plugin' | 'theme' | 'admin_plugin';

export interface Or3ExtensionManifest {
  kind: ExtensionKind;
  id: string;          // namespace:name (stable)
  name: string;
  version: string;     // semver
  description?: string;
  author?: { name: string; url?: string };
  capabilities: string[];
  permissions?: string[]; // declarative (display + future enforcement)
  or3?: { min_version?: string; max_version?: string };
  entrypoints?: {
    client?: string;   // relative path (e.g. "plugin.client.ts")
    server?: string;   // relative path (optional)
  };
}
```

Installed extension index (optional, for faster listing):

```ts
export interface InstalledExtensionRecord {
  id: string;
  kind: ExtensionKind;
  version: string;
  installed_at: number;
  source: { kind: 'upload' | 'fs' | 'url' | 'marketplace'; ref?: string };
  path: string; // absolute or workspace-relative
}
```

If the index is absent, the system can scan `extensions/**/or3.manifest.json` and cache results.

---

## Provider-Agnostic Admin Management (Auth / Sync / Storage)

The admin dashboard must not hard-code Convex/Clerk. It should be driven by the configured provider IDs in `or3CloudConfig` and use registries/adapters so alternate providers (Firebase Auth, Postgres/Supabase sync backend, S3 storage) can plug in.

### Provider Admin Adapter Interface

```ts
export type ProviderKind = 'auth' | 'sync' | 'storage';

export type ProviderStatusLevel = 'ok' | 'warning' | 'error';

export interface ProviderStatusItem {
  level: ProviderStatusLevel;
  message: string;
  detail?: Record<string, unknown>;
}

export interface ProviderAdminAction {
  id: string;              // e.g. "sync.gc", "storage.gc", "auth.rotate_keys"
  label: string;
  dangerous?: boolean;     // requires explicit confirmation in UI
}

export interface ProviderAdminAdapter {
  kind: ProviderKind;
  providerId: string;      // matches config provider id
  title: string;
  getStatus(): Promise<ProviderStatusItem[]>;
  listActions(): Promise<ProviderAdminAction[]>;
  runAction(actionId: string): Promise<{ ok: boolean; result?: unknown; error?: string }>;
}
```

### Registry & Composition

- Auth: reuse `server/auth/registry` for selection; add an optional `ProviderAdminAdapter` implementation per auth provider.
- Sync: add a server-only registry for `ProviderAdminAdapter` keyed by `or3CloudConfig.sync.provider`.
- Storage: add a server-only registry for `ProviderAdminAdapter` keyed by `or3CloudConfig.storage.provider`.

The System page uses these adapters to render provider status and run maintenance actions. Providers can add deeper diagnostics without modifying admin core.

---

## Extension Execution Model (No Auto-Exec on Install)

To satisfy “no plugin code executes automatically on install”:

- Installing a zip only writes files + validates manifests.
- Execution happens only when:
  1) the plugin is **enabled** for a workspace (workspace-scoped), AND
  2) the deployment is running a build that includes the plugin bundle.

### Client-side plugin loading

Use a loader Nuxt plugin that:

- reads enabled plugin ids for the active workspace (`kv` via Dexie)
- dynamically imports only enabled plugin entrypoints
- provides a constrained API for registration

```ts
export interface Or3Plugin {
  id: string;
  register(api: Or3PluginApi): void | Promise<void>;
}

export interface Or3PluginApi {
  registerDashboardPlugin: typeof registerDashboardPlugin;
  registerMessageAction: typeof registerMessageAction;
  // keep additive and explicit
}
```

Plugins are discovered at build time via `import.meta.glob("~~/extensions/plugins/*/plugin.client.ts")`.

### Admin plugin loading

Admin has a parallel loader:

```ts
export interface AdminPlugin {
  id: string;
  register(api: AdminPluginApi): void | Promise<void>;
}

export interface AdminPluginApi {
  registerAdminPage(def: AdminPageDef): void;
  registerAdminWidget(def: AdminWidgetDef): void;
}
```

Admin plugin enablement is deployment-scoped (stored in a local file or config).

---

## Config Management & Apply Workflow

### Sources of truth

In v1, configuration is driven by environment variables read by:

- `config.or3.ts`
- `config.or3cloud.ts`
- `nuxt.config.ts` (currently imports both at build time)

Because current config is evaluated at build time, **most config changes require a rebuild + restart** in production.

### ConfigManager responsibilities

- Read and write `.env` (recommended) and optionally raw config file text (`config.or3.ts`, `config.or3cloud.ts`) in “advanced mode”.
- Validate prospective config by running the same Zod validators:
  - `defineOr3Config(...)`
  - `defineOr3CloudConfig(...)`
- Record a “pending apply” marker (e.g., `extensions/.pending_apply.json`) that includes:
  - changed keys
  - timestamp
  - operator user id

### Apply options

Two operator actions (explicit buttons):

1. **Restart** (fast): used when changes are runtime-only (future) or when running from source in dev.
2. **Rebuild + Restart** (safe default for production): runs `bun run build` then restarts.

The actual implementation is delegated to `ServerControlProvider` to avoid hard-coding a process manager.

---

## ServerControlProvider (Restart/Rebuild)

Minimal, pluggable interface:

```ts
export interface ServerControlProvider {
  id: string; // 'self_exit' | 'command' | 'systemd' | ...
  restart(reason?: string): Promise<void>;
  rebuildAndRestart?(reason?: string): Promise<void>;
}
```

Recommended default behavior (`self_exit`):

- Write a `restart.requested` marker file (audit + idempotency)
- Respond `200 OK`
- Exit the process after a short delay
- Rely on an external supervisor (systemd/Docker/PM2) to restart

This is simple, avoids arbitrary command execution, and works across environments.

If a deployment does not use a supervisor, an alternative provider can run a configured command (from config only, not user input).

---

## Admin API Surface (Nitro)

All admin endpoints:

- gate on `isSsrAuthEnabled(event)` else `404`
- resolve session via `resolveSessionContext(event)`
- enforce permissions via `requireCan(session, ...)`
- enforce CSRF checks for mutations (Origin/same-site)

Suggested endpoints (v1):

### Workspace

- `GET /api/admin/workspace` → { workspace, role, members, guest_access_enabled }
- `POST /api/admin/workspace/members/upsert`
- `POST /api/admin/workspace/members/set-role`
- `POST /api/admin/workspace/members/remove`
- `POST /api/admin/workspace/guest-access/set`

### Extensions

- `GET /api/admin/extensions` → list installed plugins/themes/admin-plugins (from filesystem cache)
- `POST /api/admin/extensions/install` → multipart zip upload (kind inferred or specified)
- `POST /api/admin/extensions/uninstall`
- `POST /api/admin/plugins/workspace-enable` → enable/disable plugin for active workspace (writes `kv`)

### System / Config

- `GET /api/admin/system/status` → provider status + warnings summary
- `GET /api/admin/system/config` → safe config summary + pending apply marker
- `POST /api/admin/system/config/write` → write `.env` updates (whitelisted keys)
- `POST /api/admin/system/restart`
- `POST /api/admin/system/rebuild-restart`

Provider-agnostic note:
- `/api/admin/system/status` should query registries/adapters for the *configured* auth/sync/storage providers and render provider-specific diagnostics/actions via an extension surface (registry or admin plugins), rather than hard-coding Convex/Clerk.

---

## Zip Installation Pipeline

Implementation requirements:

- Accept `.zip` via multipart upload.
- Enforce max upload size (separate from chat upload limits).
- Extract using a pure JS library (e.g., `fflate`) to avoid external binaries.
- Prevent zip slip:
  - normalize entry paths
  - reject `..`, absolute paths, and drive prefixes
  - only write under `extensions/<kind>/<id>/`
- Write to a temp directory, then atomically rename into place.
- Validate `or3.manifest.json` before committing.

Idempotency:

- If same `id@version` already installed, return success (no-op).
- If `id` installed with different version, treat as update (replace directory) with explicit confirmation.

---

## Hooks & Server Hook Engine

Admin lifecycle hooks originate from Nitro routes, so they require a server hook engine that does not depend on Nuxt composables.

Design:

- Implement a small server-only hook engine in `server/hooks/**` (mirrors the app hook engine API).
- Expose it via `event.context.hooks` using a Nitro plugin.
- Emit hooks from admin endpoints:
  - `admin.plugin:action:installed`
  - `admin.plugin:action:enabled`
  - `admin.plugin:action:disabled`
  - `admin.user:action:role_changed`

Typed payload map additions live alongside existing hook typing (`app/core/hooks/*`) and a parallel server type map.

---

## UI Structure (Nuxt UI, Retro Variants)

Admin UI uses Nuxt UI primitives (`UCard`, `UForm`, `UButton`, `UInput`) and existing theme variants.

Pages:

- `/admin` → Overview (status + quick actions)
- `/admin/workspace` → Workspace & Access
- `/admin/plugins` → Plugins (installed + workspace enablement)
- `/admin/themes` → Themes (installed + default selection)
- `/admin/system` → Providers + config + restart

Editors see read-only views; owners see mutation controls (server still enforces).

---

## Error Handling

Use consistent patterns:

- `401` unauthenticated, `403` forbidden, `404` when SSR auth disabled
- `400` validation errors (invalid zip, invalid config, invalid role transitions)
- `409` conflict (install/update collisions) where appropriate

Never log secrets; sanitize error payloads.

---

## Testing Strategy

### Unit Tests

- `can()` role mapping includes `admin.access` for `editor`
- Zip slip prevention (path normalization, rejection)
- Manifest validation (required fields, kind-specific entrypoints)
- KV parsing/validation for plugin enablement/settings
- Config validation flow (accept/reject; no partial writes)

### Integration Tests

- Admin endpoints:
  - deny when SSR auth disabled (`404`)
  - deny unauthenticated (`401`)
  - deny viewer (`403`)
  - allow editor to view (`200`) but deny deployment mutations (`403`)
  - allow owner mutations (`200`)

### Manual / E2E

- Install plugin zip → appears as installed → enable for workspace → UI registrations appear
- Install theme zip → appears as installed → set as default → apply/restart → theme active on reload
- Config edit → validation error surfaces → no changes applied
- Restart request → server restarts under supervisor
