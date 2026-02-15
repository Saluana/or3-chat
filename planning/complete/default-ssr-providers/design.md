# design.md

artifact_id: f41b3a3d-71d5-4694-ade7-9bcfaaabc54d

## Overview

This design introduces a new default SSR provider stack for OR3 Cloud:

- `or3-provider-basic-auth` (JWT auth + account UI)
- `or3-provider-sqlite` (SQLite sync + canonical workspace store via Kysely)
- `or3-provider-fs` (filesystem object storage gateway)

The design keeps existing Clerk + Convex flows working while removing hard assumptions that those providers are always present.

### Goals

- Preserve existing core contracts (`AuthProvider`, `AuthWorkspaceStore`, `SyncGatewayAdapter`, `StorageGatewayAdapter`, `WorkspaceApi`).
- Keep local-first behavior unchanged (Dexie remains source for UI state; cloud remains sync/storage layer).
- Make new providers install-only with config-driven activation.
- Keep static builds unchanged (`SSR_AUTH_ENABLED` gate remains authoritative).

### Non-goals

- Rewriting the client sync engine internals.
- Replacing existing hook system or admin provider architecture.
- Removing Clerk/Convex support.

## Architecture

```mermaid
flowchart LR
  UI[Nuxt Client UI] --> SessionApi[/api/auth/session]
  UI --> SyncApi[/api/sync/*]
  UI --> StorageApi[/api/storage/*]
  UI --> WorkspaceApi[/api/workspaces/*]

  SessionApi --> AuthRegistry[AuthProvider Registry]
  SessionApi --> WorkspaceStoreRegistry[AuthWorkspaceStore Registry]

  SyncApi --> SyncRegistry[SyncGatewayAdapter Registry]
  StorageApi --> StorageRegistry[StorageGatewayAdapter Registry]
  WorkspaceApi --> WorkspaceStoreRegistry

  AuthRegistry --> BasicAuth[or3-provider-basic-auth]
  AuthRegistry --> ClerkAuth[or3-provider-clerk]

  WorkspaceStoreRegistry --> SQLiteStore[or3-provider-sqlite]
  WorkspaceStoreRegistry --> ConvexStore[or3-provider-convex]

  SyncRegistry --> SQLiteSync[or3-provider-sqlite]
  SyncRegistry --> ConvexSync[or3-provider-convex]

  StorageRegistry --> FsStorage[or3-provider-fs]
  StorageRegistry --> ConvexStorage[or3-provider-convex]
```

## Core Integration Changes

### 1. Provider Defaults and IDs

Update provider defaults to the new SSR trio:

- `DEFAULT_AUTH_PROVIDER_ID = 'basic-auth'`
- `DEFAULT_SYNC_PROVIDER_ID = 'sqlite'`
- `DEFAULT_STORAGE_PROVIDER_ID = 'fs'`

Provider IDs remain `string` types at schema level; strict-mode registration validation remains the boot gate.

### 2. Config-driven Module Resolution

Keep existing `providerId -> or3-provider-${id}/nuxt` resolution, but ensure defaults and metadata include `basic-auth`, `sqlite`, and `fs`.

### 3. Auth UI Decoupling (remove hardcoded Clerk UI assumption)

Current runtime warnings (missing `SignedIn`, `SignedOut`, `SignInButton`) are caused by rendering Clerk-specific component names from core.

Introduce a provider-agnostic auth UI boundary:

- New client registry: `app/core/auth-ui/registry.ts`
- New interface:

```ts
export interface AuthUiAdapter {
  id: string;
  // Single entrypoint for sidebar/account surface.
  component: Component;
}
```

- Core `SidebarAuthButton` renders active auth UI adapter, not provider-specific components.
- Each auth provider package registers its adapter.
- Fallback adapter renders a safe disabled/no-auth state with no unresolved component warnings.

This removes the last visible Clerk hardcoding in core UI without changing auth/session backend semantics.

### 4. No changes to locked server authorization boundary

- `can()` remains sole authorization gate.
- Session still resolves via `AuthProvider` + configured `AuthWorkspaceStore`.
- SSR endpoints remain provider-agnostic dispatchers.

## Provider Design

## A) `or3-provider-basic-auth`

### Responsibilities

- Register `AuthProvider` with ID `basic-auth`.
- Register `ProviderTokenBroker` for `basic-auth` (returns provider token or `null` with explicit behavior).
- Provide auth endpoints (sign-in/sign-out/refresh/change-password).
- Provide auth UI components for login/account management.

### Runtime Surfaces

- `src/module.ts`
- `src/runtime/server/plugins/register.ts`
- `src/runtime/server/auth/basic-auth-provider.ts`
- `src/runtime/server/token-broker/basic-auth-token-broker.ts`
- `src/runtime/server/api/basic-auth/sign-in.post.ts`
- `src/runtime/server/api/basic-auth/sign-out.post.ts`
- `src/runtime/server/api/basic-auth/refresh.post.ts`
- `src/runtime/server/api/basic-auth/change-password.post.ts`
- `src/runtime/plugins/basic-auth-ui.client.ts`
- `src/runtime/components/*` (sign-in modal, account popover, change-password modal)

### Session Model

- Access token: short-lived JWT in HttpOnly cookie.
- Refresh token: long-lived opaque token (hashed at rest) in HttpOnly cookie.
- Rotation on refresh and on password change.
- Token claims include at minimum:
  - `sub` (provider user id)
  - `sid` (session id)
  - `exp`, `iat`
  - `ver` (session/token version for revocation)

### Credential Storage

To keep the provider self-contained and compatible with any sync backend:

- Provider owns a small auth DB (SQLite file under server data dir) containing:
  - `basic_auth_accounts`
  - `basic_auth_sessions`
  - `basic_auth_refresh_tokens`

Important: this DB stores credentials/session state only. Canonical OR3 users/workspaces remain in selected sync backend via `AuthWorkspaceStore`.

### UI Compatibility

Provide basic UI equivalents used today:

- Login trigger/modal (email + password)
- Signed-in account button/popover
- Sign-out action
- Change password modal

The adapter-driven approach avoids depending on Clerk component names in core.

### Security Controls

- Password hash: strong salted hash (bcrypt cost >= 12 or Argon2id if adopted).
- Cookie flags: `HttpOnly`, `SameSite=Lax`, `Secure` in production.
- CSRF mitigation for auth mutation endpoints (origin checks + same-site cookie policy).
- Session revocation table keyed by `sid`/`ver`.
- No token logging.

## B) `or3-provider-sqlite`

### Responsibilities

- Register `AuthWorkspaceStore` ID `sqlite`.
- Register `SyncGatewayAdapter` ID `sqlite`.
- Optionally register admin adapters for sync maintenance/health.
- Own schema migrations and Kysely runtime.

### Runtime Surfaces

- `src/module.ts`
- `src/runtime/server/plugins/register.ts`
- `src/runtime/server/db/kysely.ts`
- `src/runtime/server/db/migrations/*`
- `src/runtime/server/auth/sqlite-auth-workspace-store.ts`
- `src/runtime/server/sync/sqlite-sync-gateway-adapter.ts`
- `src/runtime/server/admin/adapters/sync-sqlite.ts` (optional but recommended)

### Database and Kysely

Use Kysely with SQLite dialect in provider package (recommended path: `SqliteDialect` + `better-sqlite3`, with Bun compatibility validation in CI).

### Schema (snake_case, aligned with wire model)

Auth/workspace tables:

- `users`
- `auth_accounts` (`provider`, `provider_user_id` unique)
- `workspaces`
- `workspace_members`
- `admin_users` (optional)

Sync infrastructure:

- `server_version_counter` (per workspace monotonic counter)
- `change_log` (`op_id` unique, `server_version` indexed)
- `device_cursors`
- `tombstones`

Synced entities (same logical model as current Convex sync):

- `threads`, `messages`, `projects`, `posts`, `kv`, `file_meta`, `notifications`

### Sync Semantics (must match existing behavior)

- `push`:
  - validate table + payload
  - idempotency via `op_id`
  - allocate contiguous `server_version` block per batch
  - apply LWW (`clock`, then `hlc` tie-break)
  - write `change_log`
  - upsert tombstones for deletes

- `pull`:
  - `server_version > cursor`
  - ordered ASC
  - optional table filter
  - return `nextCursor` + `hasMore`

- `updateCursor`:
  - upsert per `(workspace_id, device_id)`

- `gcTombstones` / `gcChangeLog`:
  - retain until older than retention window and below minimum device cursor

### Workspace Store Semantics

- `getOrCreateUser` maps provider identity via `auth_accounts`.
- `getOrCreateDefaultWorkspace` ensures one workspace membership exists.
- `getWorkspaceRole` resolves role via `workspace_members`.
- CRUD methods serve existing `/api/workspaces/*` endpoints.

### Concurrency and Transaction Strategy

- Use explicit transactions for batch push + counter allocation.
- Use `BEGIN IMMEDIATE` semantics on write-heavy operations to prevent duplicate server-version allocation.
- Keep `op_id` unique index as idempotency backstop.

## C) `or3-provider-fs`

### Responsibilities

- Register `StorageGatewayAdapter` ID `fs`.
- Provide secure upload/download gateway endpoints backed by local filesystem.
- Support GC for orphaned/deleted files.

### Runtime Surfaces

- `src/module.ts`
- `src/runtime/server/plugins/register.ts`
- `src/runtime/server/storage/fs-storage-gateway-adapter.ts`
- `src/runtime/server/api/storage/fs/upload.put.ts`
- `src/runtime/server/api/storage/fs/download.get.ts`
- `src/runtime/server/storage/fs-token.ts`

### Storage Model

- File path layout:
  - `${OR3_STORAGE_DATA_DIR}/workspaces/<workspace_id>/<hash>`
- Optional metadata index for GC bookkeeping:
  - `${OR3_STORAGE_DATA_DIR}/meta/*.json` or small sqlite sidecar

### Presign / Token Model

- `presignUpload` returns short-lived internal URL with signed token.
- `presignDownload` returns short-lived internal URL with signed token.
- Token payload contains:
  - `workspace_id`
  - `hash`
  - `op` (`upload`/`download`)
  - `exp`
  - optional size/mime constraints
- HMAC verification on upload/download endpoints.

### Upload Flow

1. `/api/storage/presign-upload` (core endpoint) -> adapter returns `url`, `method`, `storageId`.
2. Client uploads to internal endpoint URL.
3. Upload endpoint validates token + `can(workspace.write)` + constraints.
4. Blob streamed to disk atomically (temp file + rename).
5. Response includes `storage_id` so transfer queue can commit metadata.

### Download Flow

1. `/api/storage/presign-download` -> adapter returns signed internal URL.
2. Download endpoint validates token + `can(workspace.read)`.
3. Stream file from disk.

### GC

- Adapter `gc` removes files eligible by retention and metadata state.
- Must never delete active referenced files.

## Wizard and Defaults Integration

Update planned wizard/provider catalog to set this stack as recommended SSR default:

- Auth: `basic-auth`
- Sync: `sqlite`
- Storage: `fs`

Wizard outputs:

- env values (`AUTH_PROVIDER`, `OR3_SYNC_PROVIDER`, `NUXT_PUBLIC_STORAGE_PROVIDER`, etc.)
- generated provider module list in `or3.providers.generated.ts`
- install commands for selected provider packages

Legacy preset remains available:

- Auth: `clerk`
- Sync: `convex`
- Storage: `convex`

## Environment Contract

### Basic Auth

- `AUTH_PROVIDER=basic-auth`
- `OR3_BASIC_AUTH_JWT_SECRET`
- `OR3_BASIC_AUTH_REFRESH_SECRET` (optional separate secret)
- `OR3_BASIC_AUTH_ACCESS_TTL_SECONDS` (default 900)
- `OR3_BASIC_AUTH_REFRESH_TTL_SECONDS` (default 2592000)
- `OR3_BASIC_AUTH_DB_PATH` (optional)

### SQLite

- `OR3_SYNC_PROVIDER=sqlite`
- `OR3_SQLITE_DB_PATH`
- `OR3_SQLITE_PRAGMA_JOURNAL_MODE` (default `WAL`)
- `OR3_SQLITE_PRAGMA_SYNCHRONOUS` (default `NORMAL`)

### FS Storage

- `NUXT_PUBLIC_STORAGE_PROVIDER=fs`
- `OR3_STORAGE_FS_ROOT`
- `OR3_STORAGE_FS_TOKEN_SECRET`
- `OR3_STORAGE_FS_URL_TTL_SECONDS` (default 900)

## Backward Compatibility Strategy

- Keep `or3-provider-clerk` and `or3-provider-convex` unchanged as supported providers.
- Ensure provider-specific assumptions in existing Convex store are removed (no hardcoded `provider='clerk'` internals).
- Keep core fallback behavior for missing providers in non-strict mode.
- Keep strict-mode startup validation for missing configured providers.

## Error Handling and Observability

### Error policy

- Auth failures: 401 with generic message.
- Authorization failures: `can()` -> 401/403 via existing helpers.
- Misconfiguration: startup failure in strict mode; clear warning in dev/non-strict.
- Storage token errors: 400/401/403 with no token leakage.

### Logs and metrics

- Structured logs with `provider`, `workspace_id`, `operation`, `status`.
- No secrets in logs.
- Reuse existing sync/storage metrics hooks where possible.

## Testing Strategy

### Unit

- Basic Auth:
  - token mint/verify/expiry
  - refresh rotation and revocation
  - change-password invalidates older sessions
  - UI adapter visibility and fallback rendering

- SQLite:
  - server_version monotonic allocation
  - op_id idempotency
  - LWW + HLC tie-break
  - pull window paging and table filtering
  - GC min-cursor safety

- FS:
  - token sign/verify expiry
  - upload/download workspace scoping
  - path traversal rejection
  - MIME/size enforcement

### Integration

- `resolveSessionContext` with basic-auth + sqlite store.
- End-to-end gateway sync cycle (`push` -> `pull` -> `updateCursor` -> GC).
- Storage transfer flow with queue (`presign-upload` -> upload -> commit -> presign-download).
- Workspace CRUD via `/api/workspaces/*`.

### E2E Matrix

- Default new stack: basic-auth + sqlite + fs.
- Legacy stack: clerk + convex + convex.
- Mixed compatibility sanity:
  - basic-auth + convex + convex
  - clerk + sqlite + fs
- Zero-provider local-only compile and runtime smoke.

## Rollout Plan

### Phase 1: Core prep

- Auth UI adapter boundary.
- Default/provider metadata updates.
- Convex provider hardcoded-clerk assumption cleanup.

### Phase 2: Provider implementation

- Build and test `or3-provider-basic-auth`.
- Build and test `or3-provider-sqlite`.
- Build and test `or3-provider-fs`.

### Phase 3: Wizard and docs

- Update wizard defaults/catalog.
- Add provider setup docs and migration guides.

### Phase 4: Hardening

- Load/perf tests (sync and file upload).
- Security checks (session fixation, token replay, path traversal).

## Risk Register and Mitigations

1. Kysely + SQLite runtime incompatibility on Bun
- Mitigation: validate `better-sqlite3` path early in CI; provide Bun-compatible fallback adapter behind same provider interface.

2. Auth UI regressions due to provider-specific assumptions
- Mitigation: ship auth UI adapter boundary before enabling default switch.

3. Sync correctness regressions (ordering, idempotency, GC)
- Mitigation: reuse existing sync integration test cases and port Convex behavior tests to SQLite provider.

4. FS storage security issues (token replay/path traversal)
- Mitigation: HMAC tokens + short TTL + workspace scope + normalized path checks + atomic writes.

5. Migration confusion from Convex/Clerk defaults
- Mitigation: keep legacy preset, add explicit migration docs, and add setup wizard preset labels.

## External References

- VueSchool Nuxt upload + `useStorage` article (user-provided guidance):
  - https://vueschool.io/articles/vuejs-tutorials/handling-file-uploads-in-nuxt-with-usestorage/
- Nitro storage API docs (`useStorage` server API):
  - https://nitro.build/guide/storage
- Kysely migration docs:
  - https://kysely.dev/docs/migrations
- Kysely SQLite dialect API (`SqliteDialect`):
  - https://kysely-org.github.io/kysely-apidoc/classes/SqliteDialect.html

