# architecture.md

artifact_id: 42c5f0fb-155b-4246-a009-dc72e69ee536
date: 2026-01-25

## Purpose

This document visualizes the **Admin Dashboard (SSR-only)** architecture for OR3 Cloud: how requests flow, where authorization is enforced, how deployment extensions are managed, and how workspace-scoped settings are persisted.

It is intended as an implementation aid to keep SSR boundaries, safety constraints, and extensibility surfaces clear.

---

## System Context (High-Level)

```mermaid
flowchart TB
  subgraph Browser["Browser (Admin User)"]
    AdminUI["Admin UI (/admin/*)"]
    AdminApiClient["Admin API Client (fetch)"]
  end

  subgraph Nitro["OR3 Nitro Server (SSR)"]
    AdminPages["SSR Pages + Admin Layout"]
    AdminApi["/api/admin/**"]
    Sess["resolveSessionContext(event)"]
    Can["requireCan(session, permission)"]
    ServerHooks["Server Hook Engine (Nitro-safe)"]
    ExtMgr["ExtensionManager (FS scan/install/remove)"]
    CfgMgr["ConfigManager (.env/config read/write + validate)"]
    SrvCtl["ServerControlProvider (restart/rebuild)"]
    StoreClient["Workspace/Settings Store Client"]
    ProviderAdmin["Provider Admin Adapters (auth/sync/storage)"]
  end

  subgraph Canonical["Canonical Store (selected SyncProvider backend)"]
    WS["workspaces"]
    Members["workspace_members"]
    KV["kv (workspace-scoped settings)"]
  end

  subgraph Providers["External Providers (swappable)"]
    AuthP["Auth Provider (Clerk/Firebase/Custom)"]
    SyncP["Sync Provider Backend (Convex/Postgres/etc.)"]
    StorageP["Object Storage (Convex/S3/R2/etc.)"]
  end

  subgraph Deployment["Deployment Resources"]
    FS["Filesystem (extensions/, .env, manifests)"]
    Supervisor["Process Supervisor (systemd/docker/pm2)"]
  end

  AdminUI --> AdminPages
  AdminUI --> AdminApiClient --> AdminApi

  AdminPages --> Sess --> Can
  AdminApi --> Sess --> Can
  AdminApi --> ServerHooks

  AdminApi --> ExtMgr --> FS
  AdminApi --> CfgMgr --> FS
  AdminApi --> SrvCtl --> Supervisor
  AdminApi --> StoreClient --> Canonical
  StoreClient --> WS
  StoreClient --> Members
  StoreClient --> KV

  AdminApi --> ProviderAdmin --> AuthP
  AdminApi --> ProviderAdmin --> SyncP
  AdminApi --> ProviderAdmin --> StorageP
```

**Key invariants**
- Admin UI is **SSR-only** and **gated by SSR auth**; static builds do not include it.
- All admin API mutations are enforced on the server via `can()` / `requireCan()`.
- Workspaces are the **same** workspaces as the main app: canonical store lives in the selected SyncProvider backend (Convex default).

---

## Route & Origin Isolation

Admin is scoped by:
- Route boundary: `/admin/*`
- Optional origin/host restriction: `OR3_ADMIN_ALLOWED_HOSTS`
- Optional base path override: `OR3_ADMIN_BASE_PATH`

```mermaid
sequenceDiagram
  participant B as Browser
  participant N as Nitro
  participant G as AdminRouteGate

  B->>N: GET /admin/...
  N->>G: check SSR auth enabled?
  alt SSR auth disabled
    G-->>B: 404 Not Found
  else SSR auth enabled
    G->>G: if OR3_ADMIN_ALLOWED_HOSTS set, check Host
    alt host not allowed
      G-->>B: 404 Not Found
    else ok
      G-->>B: 200 SSR render
    end
  end
```

This supports serving admin on `admin.<domain>` via reverse proxy (recommended), or on a different port in dev.

---

## Authorization Flow (Server-Enforced)

All access and mutations flow through `can()`.

```mermaid
sequenceDiagram
  participant B as Browser
  participant A as /admin/* SSR Page
  participant API as /api/admin/**
  participant S as resolveSessionContext
  participant C as requireCan

  B->>A: GET /admin/workspace
  A->>S: resolve session
  S-->>A: SessionContext
  A->>C: requireCan(session, admin.access)
  alt denied
    C-->>B: 401/403 (fail closed)
  else allowed
    A-->>B: 200 HTML
  end

  B->>API: POST /api/admin/workspace/members/set-role
  API->>S: resolve session
  API->>C: requireCan(session, users.manage)
  alt denied
    C-->>B: 401/403
  else allowed
    API-->>B: 200 OK
  end
```

**Role intent (v1)**
- `owner`: full admin UI + mutations
- `editor`: admin UI access (read-only) but no deployment-scoped mutations
- `viewer`: no admin access

---

## Data Ownership & Persistence

### Canonical workspace data (selected backend)

- Workspaces: stored in the canonical workspace store backend (selected SyncProvider backend; Convex default).
- Membership: stored alongside workspaces (roles drive `can()` decisions).
- Session provisioning: `resolveSessionContext` MUST map provider identity → user/workspace via the configured `AuthWorkspaceStore` adapter (default Convex reference implementation currently uses `api.workspaces.ensure`).

### Workspace-scoped admin settings (Synced)

Admin uses the existing synced `kv` table for workspace-scoped settings (so they follow the workspace across devices):

- `admin.guest_access.enabled` → `"true" | "false"`
- `plugins.enabled` → JSON string array `["plugin.a","plugin.b"]`
- `plugins.settings.<plugin_id>` → JSON object string

```mermaid
flowchart LR
  subgraph WorkspaceScope["Workspace Scope"]
    KV["kv (synced)"]
  end

  subgraph DeploymentScope["Deployment Scope"]
    FS["extensions/ (filesystem)"]
    ENV[".env / config files"]
  end

  KV -->|"controls enablement/settings"| AdminUI
  FS -->|"controls what's installable"| AdminUI
  ENV -->|"controls instance features"| AdminUI
```

**Why this split matters**
- Deployment install scope: trusted code/assets present on the server.
- Workspace enablement scope: per-team opt-in and configuration.

---

## Workspace & Access Management (Data Flow)

```mermaid
sequenceDiagram
  participant UI as Admin UI
  participant API as /api/admin/workspace/**
  participant Can as requireCan
  participant Store as WorkspaceAccessStore (canonical backend)
  participant Hooks as Server Hooks

  UI->>API: POST set-role/remove/upsert
  API->>Can: requireCan(session, users.manage)
  API->>Store: mutation (idempotent)
  Store-->>API: ok
  API->>Hooks: emit admin.user:action:role_changed
  API-->>UI: 200
```

Notes:
- Membership mutations must be **idempotent** (upserts keyed by workspace/user).
- The canonical workspace store enforces membership and owner-only writes as the source of truth (default Convex implementation).

---

## Extension Management (Plugins/Themes/Admin-Plugins)

### On-disk layout (deployment scope)

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

### Install pipeline (zip → validated → installed)

```mermaid
sequenceDiagram
  participant UI as Admin UI
  participant API as /api/admin/extensions/install
  participant Can as requireCan
  participant Zip as Zip Extractor
  participant FS as Filesystem
  participant Hooks as Server Hooks

  UI->>API: upload .zip (multipart)
  API->>Can: requireCan(session, plugins.manage) + owner-only policy
  API->>Zip: validate zip + prevent zip slip
  Zip->>FS: extract to temp dir
  API->>API: validate or3.manifest.json (Zod)
  API->>FS: atomic rename temp -> extensions/<kind>/<id>/
  API->>Hooks: emit admin.plugin:action:installed
  API-->>UI: 200 + manifest
```

**Safety requirements**
- Zip slip protection (reject `..`, absolute paths, drive prefixes)
- Size limits (zip bytes, file count, total uncompressed)
- Temp dir + atomic rename (no partial installs)
- No execution on install (only enablement triggers load)

---

## Workspace Plugin Enablement (Installed vs Enabled)

Installed plugins exist on disk, but do nothing until enabled for a workspace.

```mermaid
sequenceDiagram
  participant UI as Admin UI
  participant API as /api/admin/plugins/workspace-enable
  participant Can as requireCan
  participant Settings as WorkspaceSettingsStore (canonical backend)
  participant Hooks as Server Hooks

  UI->>API: enable plugin X for workspace W
  API->>Can: requireCan(session, plugins.manage)
  API->>Settings: set(workspace=W, key="plugins.enabled")
  Settings-->>API: ok
  API->>Hooks: emit admin.plugin:action:enabled
  API-->>UI: 200
```

Client-side behavior (SSR app runtime):

```mermaid
flowchart TB
  subgraph Client["Browser (Workspace W)"]
    Dexie["Dexie (or3-db-${workspaceId})"]
    KV["kv table (synced into Dexie)"]
    Loader["Plugin Loader (dynamic import)"]
    Registries["UI Registries (hooks/registries)"]
  end

  KV -->|"plugins.enabled"| Loader -->|"imports enabled entrypoints"| Registries
```

---

## Config Editing + Apply + Restart Flow

Because `nuxt.config.ts` currently imports `config.or3.ts` + `config.or3cloud.ts` at build time, many config changes require **rebuild + restart** in production.

```mermaid
sequenceDiagram
  participant UI as Admin UI
  participant API as /api/admin/system/config/write
  participant Can as requireCan
  participant Cfg as ConfigManager
  participant FS as Filesystem (.env)
  participant Hooks as Server Hooks

  UI->>API: POST config patch (whitelisted keys)
  API->>Can: requireCan(session, workspace.settings.manage) + owner-only policy
  API->>Cfg: validate proposed config (same Zod validators)
  alt invalid
    API-->>UI: 400 validation errors (no write)
  else valid
    Cfg->>FS: write .env (atomic)
    API->>Hooks: emit admin.config:action:changed (optional)
    API-->>UI: 200 + restart required
  end
```

Restart execution (simple default: exit and rely on supervisor):

```mermaid
sequenceDiagram
  participant UI as Admin UI
  participant API as /api/admin/system/restart
  participant Can as requireCan
  participant S as ServerControlProvider
  participant Sup as Supervisor

  UI->>API: POST restart (explicit intent)
  API->>Can: owner-only policy
  API->>S: requestRestart()
  S->>Sup: (out of process) supervisor restarts app
  API-->>UI: 200 (best effort)
```

---

## Observability Hooks (Admin Lifecycle)

Admin operations emit hooks from server routes:

```mermaid
flowchart LR
  AdminApi["/api/admin/**"] --> Hooks["Server Hook Engine"]
  Hooks --> Ops["Ops tooling / logging"]
  Hooks --> AdminPlugins["Admin plugins (widgets/pages)"]
```

Core events (v1):
- `admin.plugin:action:installed`
- `admin.plugin:action:enabled`
- `admin.plugin:action:disabled`
- `admin.user:action:role_changed`

---

## Provider Management (Auth / Sync / Storage)

The admin dashboard must remain functional when providers are swapped. To avoid hard-coding (e.g., Convex/Clerk), the System page should be driven by provider adapters that expose:

- status/health (config validation + optional live checks)
- warnings (misconfig, degraded mode)
- safe maintenance actions (GC, retention, connectivity tests)

```mermaid
flowchart LR
  UI["/admin/system"] --> API["GET /api/admin/system/status"]
  API --> Can["requireCan(admin.access)"]
  API --> Registry["ProviderAdminRegistry"]

  Registry --> Auth["AuthProviderAdmin (selected)"]
  Registry --> Sync["SyncProviderAdmin (selected)"]
  Registry --> Storage["StorageProviderAdmin (selected)"]

  Auth --> AuthP["Auth Provider"]
  Sync --> SyncP["Sync Backend"]
  Storage --> StorageP["Object Storage"]
```

Example maintenance action flow:

```mermaid
sequenceDiagram
  participant UI as Admin UI
  participant API as /api/admin/system/actions/run
  participant Can as requireCan
  participant Reg as ProviderAdminRegistry
  participant P as ProviderAdmin (selected)

  UI->>API: POST { actionId: "sync.gc" }
  API->>Can: requireCan(session, workspace.settings.manage) + owner-only policy
  API->>Reg: resolve provider for actionId
  Reg-->>API: ProviderAdmin
  API->>P: runAction("sync.gc")
  P-->>API: result (counts, durations)
  API-->>UI: 200 result
```

---

## Failure Modes & Recovery (Quick Map)

| Area | Failure | Behavior |
|---|---|---|
| Auth | SSR auth disabled | Admin returns `404` (fail closed) |
| Auth | Session missing/invalid | `401` |
| AuthZ | Viewer/editor performing forbidden mutation | `403` |
| Extensions | Invalid zip / zip slip | `400`, no partial install |
| Extensions | Install collision | `409` unless explicit replace confirmed |
| Config | Validation fails | `400`, no write |
| Restart | No supervisor present | Endpoint returns error; UI warns “restart strategy not configured” |

---

## Implementation Notes (Keep Simple)

1. Prefer **one Nuxt app** with host allowlisting over a second admin server.
2. Store workspace-scoped settings in **synced `kv`** (no new tables unless needed).
3. Keep deployment extension state **on disk** and cache scans briefly.
4. Keep restart/rebuild operations behind a **pluggable provider**, defaulting to “exit and let the supervisor restart”.
