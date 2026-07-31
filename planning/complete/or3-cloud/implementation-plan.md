# implementation-plan.md

artifact_id: da046aa5-3175-46c8-8168-2a6121eafe42
date: 2026-01-25

## Goals

- Deliver SSR-capable, multi-user auth with a single `can()` authorization surface.
- Add optional Dexie-to-SyncProvider backend sync without breaking local-first UX (Convex default).
- Add remote blob storage with presigned transfers and hash-based dedupe.
- Keep static builds unchanged and SSR-only features gated.

## Non-goals (for this plan)

- Marketplace UI and purchasing flows (explicitly deferred).
- CRDT merging or collaborative editing.
- Multi-provider runtime selection for sync or storage (v1: per-deployment).

## Phase 0: Alignment and contract decisions

Outputs:
- A single source of truth for users/workspaces (the selected SyncProvider backend; Convex default).
- A documented data model mapping between Dexie and the SyncProvider backend (snake_case wire schema).
- Finalized hook names and payload shapes.

Tasks:
- Lock canonical workspace store to the selected SyncProvider backend (Convex default) via `AuthWorkspaceStore`.
- Lock auth propagation: client providers use session JWTs (Clerk templates) when direct; SSR endpoints enforce `can()` then call providers with server credentials when gateway.
- Lock local workspace scoping to one Dexie DB per workspace (`or3-db-${workspaceId}`).
- Define mapping rules: snake_case wire schema matches Dexie; avoid camelCase DTOs unless a provider requires it.
- Confirm sync hook shapes and update hook types to include full entity payloads where needed.
- Define SyncProvider modes (`direct` vs `gateway`) and when to fall back.

Exit criteria:
- Selected SyncProvider backend confirmed as workspace/user source of truth (Convex default).
- Signed off field mapping table (snake_case wire schema).
- Hook names and payloads consistent across plans.

## Phase 1: SSR auth foundation (Clerk)

Outputs:
- SSR-only auth provider registry.
- `SessionContext`, `can()`, and server guards.

Key tasks (see `planning/ssr-auth-system/tasks.md`):
- Implement SSR auth flag and provider selection.
- Register Clerk provider (server-only) and session resolution.
- Implement `AuthWorkspaceStore` using the chosen canonical store.
- Add `can()` + `auth.access:filter:decision` hook enforcement.
- Add `/api/auth/session` endpoint and client composables.
- Implement `AuthTokenBroker` for provider-specific tokens.

Exit criteria:
- `can()` is enforced on server endpoints.
- Session resolution works in SSR and is a no-op when disabled.

## Phase 2: SyncProvider backend foundation (Convex default)

Outputs:
- SyncProvider backend setup with Clerk auth wired (Convex default).
- Canonical schema for synced entities in snake_case.

Key tasks (adapt `planning/db-sync-layer/tasks.md`):
- Initialize backend project and schema (snake_case fields).
- Implement Clerk authentication for direct providers (JWT validation for client calls).
- Define change log strategy and server version counter.
- Enforce workspace membership in provider functions for direct client calls; SSR endpoints enforce `can()` before server calls.
- Implement `AuthTokenBroker` for provider-specific tokens (Clerk templates).

Exit criteria:
- Backend functions can validate user identity and workspace membership.
- Schema aligns with Dexie mapping decisions.

## Phase 3: Local schema upgrades and shared model utilities

Outputs:
- Single Dexie schema bump with all required tables.
- Utilities for hash parsing and field mapping.

Key tasks:
- Add `pending_ops`, `sync_state`, `sync_runs`, `file_transfers`, and any missing tables in one migration.
- Add local-only transfer metadata fields, avoid syncing per-device state.
- Add hash utilities (sha256 default, md5 legacy).
- Add mapping helpers (Dexie <-> backend DTOs, only when required).
- Ensure `clock` increments on all mutation paths.

Exit criteria:
- Dexie version bump is complete and backward-compatible.
- All sync-required fields are present and consistently updated.

## Phase 4: Sync engine (metadata)

Outputs:
- Outbox push loop, pull/subscription loop, conflict resolver.

Key tasks (see `planning/db-sync-layer/tasks.md`):
- Implement capture layer with suppression for remote-applied writes using Dexie hooks for atomic outbox writes.
- Implement outbox batching, retry, coalescing, and backpressure.
- Implement subscription/pull with a single cursor strategy.
- Implement conflict resolution with deterministic tie-breakers and stable message ordering.
- Add telemetry hooks and `sync_runs` persistence.

Exit criteria:
- Offline writes sync reliably on reconnect.
- Remote changes apply without echoing back into the outbox.

## Phase 5: Storage engine (blobs)

Outputs:
- Object storage provider registry and Convex implementation (default).
- Transfer queue with retries and progress reporting.

Key tasks (see `planning/db-storage-system/tasks.md`):
- Implement provider registry and Convex provider (default).
- Add SSR endpoints for presign/commit/GC with `can()` enforcement.
- Implement transfer queue with concurrency and progress.
- Verify hash on download and de-dupe blobs.
- Ensure file metadata syncs without sharing per-device upload state or `ref_count`.

Exit criteria:
- Attachments upload from device A and download to device B.
- Blobs are cached locally and survive offline usage.

## Phase 6: Integration, test, and hardening

Outputs:
- End-to-end validation for auth + sync + storage.

Key tasks:
- Integration tests for session gating, sync flows, and file transfers.
- Conflict and offline recovery tests.
- Load tests for change log growth and transfer queue stability.

Exit criteria:
- Multi-device flows work with auth + sync + storage enabled.
- Static builds remain unaffected.

## Phase 7: Admin Dashboard (SSR-only control plane)

Outputs:
- SSR-only `/admin/*` area with its own layout/navigation.
- Server-enforced admin APIs for workspace access management, extension install, config apply, and restart.
- Parallel admin plugin system (pages/widgets) + admin lifecycle hooks.

Key tasks (see `planning/or3-cloud/admin-dashboard/tasks.md`):
- Gate admin UI from static builds and require SSR auth to be enabled.
- Implement admin access policy (`owner` + `editor` can access; owners can mutate deployment).
- Add workspace member management (Convex mutations + SSR endpoints) and guest access setting.
- Add extension manager: install plugins/themes from zip, validate manifests, prevent zip slip.
- Add workspace-scoped plugin enablement + settings (stored in synced `kv`).
- Add config editing workflow (validate + apply) and server restart control provider.
- Emit admin hooks for all privileged operations.

Exit criteria:
- Viewer cannot access admin routes.
- Editor can access admin routes but cannot perform deployment mutations.
- Owner can manage members, enable/disable plugins per workspace, and apply config + restart safely.
