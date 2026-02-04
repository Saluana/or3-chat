# design.md

## Overview
Provider decoupling has one real goal:

> **The core repo must build + typecheck when provider SDKs and generated files are uninstalled.**

That means we must solve *build-graph coupling*, not just runtime behavior.

This doc describes the simplest architecture that:
- preserves today’s default behavior (Clerk + Convex)
- avoids conditionals sprinkled across core
- keeps provider boundaries boring (registries + small interfaces)
- makes new providers (LocalFS storage, SQLite sync) straightforward

---

## Reality check: why “dynamic import behind config” is not enough in Nuxt

The intern design emphasizes `await import(...)` after config checks. That helps with **runtime** behavior, but it does *not* guarantee uninstallability in Nuxt/Vite:

- Nuxt auto-registers files by directory conventions (`app/plugins`, `server/api`, `server/middleware`, `server/plugins`).
- Vite/Nitro still need to **resolve and bundle** any statically analyzable import targets.
- TypeScript still needs to resolve modules for **type-only imports**.

So the rule for true decoupling is stricter:

> **Core must not contain any imports (value or type) from provider SDKs or provider-generated files in any auto-included zone.**

The only durable way to achieve this is:

> **Provider implementations live in installable packages (Nuxt modules).**

Core ships interfaces + registries + provider-agnostic endpoints. Provider packages register concrete implementations when installed.

---

## What’s coupled today (actual hotspots)

This list is intentionally concrete so the intern can grep and delete/relocate confidently.

### Client build graph coupling
- `app/plugins/convex-sync.client.ts` (imports `convex-vue` + Convex provider modules)
- `app/plugins/convex-clerk.client.ts` (imports `convex-vue` + assumes Clerk globals)
- `app/core/sync/providers/convex-sync-provider.ts` (imports `convex-vue` + `~~/convex/_generated/*`)
- `app/plugins/workspaces/WorkspaceManager.vue` (imports `convex-vue` + `~~/convex/_generated/api`)
- `app/pages/_tests/**` (imports `convex-vue` and `~~/convex/_generated/*`)

### Server build graph coupling
- `server/api/sync/*.post.ts` (imports `~~/convex/_generated/*` + uses Clerk token minting)
- `server/api/storage/*.post.ts` (imports `~~/convex/_generated/*` + uses Clerk token minting)
- `server/auth/providers/clerk/clerk-auth-provider.ts` (imports `@clerk/nuxt/server`)
- `server/auth/deployment-admin.ts` (imports/loads `~~/convex/_generated/*`)
- `server/utils/convex-client.ts` (imports `convex/browser` + `~~/convex/_generated/api`)
- `server/utils/sync/convex-gateway.ts` (imports `convex/browser` + assumes Clerk auth context)
- `server/admin/stores/convex/**` and `server/admin/providers/adapters/*convex*.ts` (imports `~~/convex/_generated/*`)
- `server/utils/rate-limit/store.ts` (imports Convex provider at module top-level)
- `server/utils/background-jobs/providers/convex.ts` (imports `convex/_generated/*`)
- `server/utils/notifications/emit.ts` (imports `convex/_generated/*`)
- `server/types/convex-http-client.d.ts` (imports `convex/server` in core type augmentation)
- `server/middleware/00.clerk.ts` and `server/plugins/auth.ts` (run on `auth.enabled`, not `auth.provider`)

### Configuration coupling (blocks external providers)
- `shared/cloud/provider-ids.ts` (compile-time provider ID unions)
- `utils/or3-cloud-config.ts` and `config.or3cloud.ts` (zod enums/casts based on those unions)
- `nuxt.config.ts` (module config keys + conditional module lists)

---

## Chosen solution (simplest that actually works)

### Principle: core owns contracts, providers own SDK imports
Core provides:
- small interfaces (what core needs)
- registries (how providers plug in)
- provider-agnostic SSR endpoints (gateway mode)
- UI/composable boundaries (workspace lifecycle)

Provider packages provide:
- SDK imports (Clerk/Convex/etc)
- concrete implementations and registrations
- optional server middleware/routes
- optional init/codegen scripts (Convex)

This avoids “optional dependencies” hacks and matches Nuxt conventions.

---

## Core contracts (minimal, boring)

### 1) Auth
Already exists:
- `server/auth/registry.ts` (`registerAuthProvider`, `getAuthProvider`)

Add:
- `AuthWorkspaceStore` registry (server)
  - interface already exists at `server/auth/store/types.ts`
  - core session resolution MUST call store adapter, not Convex directly

Add (needed for gateway auth):
- `ProviderTokenBroker` (server)
  - “give me a provider token for `<providerId>` and optional `<template>`”
  - implemented by auth provider package (Clerk implementation calls `event.context.auth().getToken(...)`)

Why this is best:
- fixes “Convex admin assumes Clerk”
- keeps “minting provider tokens” as an auth-provider responsibility (correct boundary)

### 2) Sync
Client side already has:
- `shared/sync/types.ts` (`SyncProvider`)
- `app/core/sync/sync-provider-registry.ts` (string-keyed registry)
- `app/core/sync/providers/gateway-sync-provider.ts` (provider-agnostic gateway client)

Add server-side contract:
```ts
export interface SyncGatewayAdapter {
  id: string;
  // called by /api/sync/* endpoints
  pull(event, input): Promise<PullResponse>;
  push(event, input): Promise<PushResult>;
  updateCursor(event, input): Promise<void>;
  gcTombstones?(event, input): Promise<void>;
  gcChangeLog?(event, input): Promise<void>;
}
```
Core `/api/sync/*` endpoints become:
- auth + `can()` + validation + rate limiting (still core)
- dispatch to `SyncGatewayAdapter` for the selected `sync.provider`

Why this is best:
- gateway endpoints stay stable (client code doesn’t change)
- providers implement only the backend proxy/logic
- core never imports provider SDKs or generated APIs

### 3) Storage
Client side already has:
- `app/core/storage/types.ts` (`ObjectStorageProvider`)
- `app/core/storage/provider-registry.ts`

Add server-side contract:
```ts
export interface StorageGatewayAdapter {
  id: string;
  presignUpload(event, input): Promise<{ url: string; expiresAt: number; headers?: Record<string,string>; storageId?: string; method?: string }>;
  presignDownload(event, input): Promise<{ url: string; expiresAt: number; headers?: Record<string,string>; storageId?: string; method?: string }>;
  commit?(event, input): Promise<void>;
  gc?(event, input): Promise<unknown>;
}
```
Core `/api/storage/*` endpoints become:
- auth + `can()` + validation + rate limiting (still core)
- dispatch to `StorageGatewayAdapter` for selected `storage.provider`

Why this is best:
- keeps the client storage queue stable
- lets providers decide “S3 presigned URL” vs “local upload endpoint” without changing the UI

**Practical simplification (recommended): make the client storage provider always “gateway”**
The current `createConvexStorageProvider()` already calls SSR endpoints (`/api/storage/presign-*`, `/api/storage/commit`) and does not require the Convex client SDK.

Rename/generalize this into a provider-agnostic *gateway storage provider* so the client does **not** need per-backend storage packages at all:
- client always talks to `/api/storage/*`
- server dispatch decides the actual backend (`storage.provider`)

This is simpler and makes “install a new storage backend, no client bundling” realistic.

### 4) Workspace lifecycle (UI)
Define a client boundary:
```ts
export interface WorkspaceApi {
  list(): Promise<Array<{ id: string; name: string; role: string }>>;
  create(input: { name: string; description?: string | null }): Promise<{ id: string }>;
  update(input: { id: string; name: string; description?: string | null }): Promise<void>;
  remove(input: { id: string }): Promise<void>;
  setActive(input: { id: string }): Promise<void>;
}
```
Core `WorkspaceManager` depends on this interface only.

Provider implementations:
- Convex provider can implement this directly (SDK) or via SSR endpoints
- SQLite provider implements via SSR endpoints (simplest)

**Gateway-first recommendation**
Prefer implementing `WorkspaceApi` via SSR endpoints for all providers (including Convex).
It avoids pulling provider SDKs into the client build graph and keeps workspace UI stable.

**Server-side backing**
To make the gateway-first approach one-shot, pick one of these (A is simplest):

**A) Extend `AuthWorkspaceStore` to fully back workspace CRUD**
- Add methods like `createWorkspace`, `updateWorkspace`, `removeWorkspace`, `setActiveWorkspace` to `AuthWorkspaceStore`.
- Add core SSR endpoints `/api/workspaces/*` that call the configured store adapter.

**B) Introduce a separate `WorkspaceStore` interface**
- Keep `AuthWorkspaceStore` focused on identity mapping + membership resolution.
- Add `WorkspaceStore` for CRUD + active workspace selection.
- Session provisioning uses both (or `AuthWorkspaceStore` delegates to `WorkspaceStore`).

Either way: the client talks to one `WorkspaceApi`, and the provider-specific logic stays server-side.

---

## How providers plug in (recommended: Nuxt module packages)

### Provider package shape
Each provider package is a Nuxt module that:
- adds its own client plugin(s) to register providers
- adds its own Nitro plugin(s) to register server adapters
- optionally adds server middleware (auth context) and/or extra server routes

Core discovers providers through registries.

### Nuxt constraint: installed deps don’t run unless included
Installing a package alone does not make Nuxt execute it. You need either:
- a Nuxt module entry in `modules: [...]`, or
- an explicit import from the core build graph

**Minimal (fine for built-ins):**
- core `nuxt.config.ts` conditionally includes the known provider modules (Clerk/Convex) based on config.

**Fully extensible (no core edits for new providers):**
- add a small build-time “provider discovery” step that generates a static import map from installed `or3-provider-*` packages
- core uses that generated map to register client/server providers without hardcoding IDs

If we don’t do discovery, external providers will still require editing `nuxt.config.ts` to include their module.

### Why *not* a “core ProviderLoader that imports providers”
A core loader that maps `providerId -> import('./providers/convex')` reintroduces coupling:
- bundlers will still include/resolve those modules
- missing SDKs still break builds

Let provider packages self-register instead. If a provider package isn’t installed, it cannot register, and core can fail fast with a clean error message.

---

## Configuration: IDs become strings, validation becomes runtime

Current problem:
- provider IDs are compile-time unions (`z.enum([...])`), which forces core edits for new providers.

Fix:
- `auth.provider`, `sync.provider`, `storage.provider`, etc become `string`
- strict mode validation happens at boot:
  - “configured provider missing from registry” ⇒ startup error with instructions

This is both simpler and more extensible.

---

## Implementation plan (phases)

### Phase 1 (still in this repo): create boundaries + dispatchers
Goal: core code no longer imports provider SDKs/generated code in auto-included zones.

Key moves:
- replace Convex-specific client plugins with provider-agnostic core plugins + provider package plugins
- refactor Workspace UI to `WorkspaceApi`
- refactor `server/auth/session.ts` to use `AuthWorkspaceStore`
- refactor `/api/sync/*` and `/api/storage/*` endpoints to dispatch to adapters
- introduce server `ProviderTokenBroker` and use it everywhere we currently call `getClerkProviderToken`
- relocate/remove `_tests` pages that import provider SDKs (or move them into provider packages)

### Phase 2: extract to installable packages
Goal: `package.json` for core no longer depends on `@clerk/nuxt`, `convex-*`, or generated Convex files.

Recommended packages (names illustrative):
- `or3-provider-clerk` (auth)
- `or3-provider-convex` (sync + storage + AuthWorkspaceStore + admin adapters)
- `or3-provider-localfs` (storage example)
- `or3-provider-sqlite` (sync + AuthWorkspaceStore example)

---

## Example provider: LocalFS storage (minimal but correct)

**Use-case**: single-node/self-hosted deployments without S3.

### Server-side adapter behavior
- `presignUpload` returns an internal upload URL like `/api/storage/localfs/upload?token=...`
- `token` is short-lived (e.g., 60s) and includes:
  - workspaceId, hash, sizeBytes, mimeType, exp
  - HMAC signature
- Upload endpoint validates token + `can(workspace.write)` then streams body to disk:
  - path: `${DATA_DIR}/or3-storage/${workspaceId}/${hash}`
- `presignDownload` returns `/api/storage/localfs/download?token=...` with `can(workspace.read)`
- `commit` is optional; if used, it records metadata (or triggers the existing metadata write path)

Why this fits the existing contract:
- client already supports “presigned” URLs and optional headers/method
- LocalFS just uses “presigned internal endpoints” instead of S3 presigned URLs

---

## Example provider: SQLite sync (gateway mode)

**Use-case**: self-hosted, no Convex, no vendor lock-in.

### Minimal server model
SQLite schema (names illustrative):
- `users(id, provider, provider_user_id, email, display_name, created_at)`
- `workspaces(id, name, created_at)`
- `memberships(user_id, workspace_id, role, created_at)`
- `change_log(workspace_id, server_version, table_name, pk, op, payload_json, stamp_json, created_at)`
- `device_cursors(workspace_id, device_id, last_seen_version, updated_at)`
- `tombstones(workspace_id, table_name, pk, deleted_at, clock, hlc, device_id)` (optional if already encoded in change_log)

Key invariants to keep identical to existing client sync:
- stable ordering via `server_version` cursor
- idempotency via `op_id` (unique constraint if stored)
- wire schema stays snake_case aligned with Dexie sync payloads

### How the gateway adapter maps requests
- `push`:
  - validate batch (shared schemas)
  - for each op: insert into `change_log` and/or apply to materialized tables
  - return per-op results + new `serverVersion`
- `pull`:
  - select from `change_log` where `server_version > cursor`
  - return up to limit, plus `hasMore`
- `updateCursor`:
  - upsert device cursor row
- `gcChangeLog`:
  - delete change_log rows older than retention window *and* below the min cursor across devices

### AuthWorkspaceStore on SQLite
- `getOrCreateUser`: upsert by `(provider, provider_user_id)`
- `getOrCreateDefaultWorkspace`: create workspace + membership if none
- `getWorkspaceRole`: look up membership role
- `listUserWorkspaces`: join memberships/workspaces

Why this is best as an example:
- no client SDK required (gateway provider already exists)
- lets us validate that core boundaries are correct
- gives a clear non-Convex “reference provider” for future backends

---

## Testing strategy (what proves decoupling)

### Build gates (non-negotiable)
Prove these configurations work:
- No Clerk deps installed + `auth.provider != clerk`
- No Convex deps installed + no configured surface selects Convex-backed providers

### Runtime sanity
- Workspace UI still works through `WorkspaceApi`
- Sync still runs in gateway mode via `/api/sync/*`
- Storage queue still works via `/api/storage/*`
