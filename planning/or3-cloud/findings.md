# findings.md

artifact_id: 57a596f9-75f7-41b8-bc59-b425f5fd299a
date: 2026-01-11

## Executive summary

This review covers:
- `planning/ssr-auth-system/*.md`
- `planning/db-sync-layer/*.md`
- `planning/db-storage-system/*.md`

The three plans are directionally aligned, but there are several conflicts and missing edge cases that will cause data corruption, auth mismatches, or sync loops if not resolved before implementation.

## Implementation updates (resolved)

- Public runtime config now exposes only non-sensitive values; server-only storage providers stay private.
- Provider identifiers are centralized in shared constants to reduce string drift across adapters.
- Convex gateway clients are cached by token to avoid per-request client creation.

## Critical conflicts and gaps

1) Dual source of truth for users/workspaces
- Resolved: `AuthWorkspaceStore` is backed by the selected SyncProvider backend (Convex default).
- All systems read workspace membership through the same store interface; no parallel DB.

2) Auth propagation mismatch
- Resolved: direct providers use `AuthTokenBroker` (Clerk JWT templates); gateway providers use SSR endpoints with `can()` enforcement.

3) Sync capture will loop and lacks atomicity
- Addressed: capture now uses Dexie hooks with remote suppression and atomic outbox writes.

4) LWW requires reliable clocks but most tables do not increment clock
- Addressed: tasks now require `clock` increments on every create/update/delete across tables.

5) File ref_count is non-commutative under LWW
- Addressed: `ref_count` treated as derived and excluded from LWW sync.

## High-risk inconsistencies

- Resolved: use per-workspace Dexie DB (`or3-db-${workspaceId}`); no `workspaceId` fields needed.
- Resolved: wire schema standardized to snake_case; mapping only needed if a backend enforces different conventions.
- Resolved: sync hook names aligned to `sync.*` convention (e.g., `sync.push:action:before`).
- Resolved: per-device transfer state moved to `file_transfers` (local-only); `file_meta` uses `storage_id`/`storage_provider_id`.
- Resolved: `file_meta` handled by `hash` index in sync apply logic.
- Resolved: `posts` now includes `clock` in provider schema examples.

## Medium-risk gaps

- Resolved: message ordering stabilized via `order_key` + `index`.
- Addressed: change_log retention via `device_cursors` watermark and retention window.
- Addressed: outbox coalescing/backpressure added to sync design.
- Addressed: single `server_version` cursor strategy documented.
- Resolved: placeholder subscription API avoids relying on `convex.onUpdate`.
- Addressed: transfer queue fills concurrency slots; progress tracking notes added (XHR/streams).
- Resolved: `storage_objects` table removed from requirements.
- Addressed: tasks now call out a single coordinated Dexie version bump.

## Decisions locked (aligned to extensibility + DX)

1) Canonical auth/workspace store: selected SyncProvider backend (Convex default) via `AuthWorkspaceStore`.
2) Auth propagation: direct providers use session JWTs (Clerk templates); SSR endpoints enforce `can()` then call providers with server credentials.
3) Workspace scoping in local Dexie: one Dexie DB per workspace (`or3-db-${workspaceId}`).
4) Record shape mapping: use a single wire schema that matches Dexie (snake_case, `file_hashes` as serialized string).
5) Sync capture: use Dexie hooks for atomic outbox writes; suppress capture for remote-applied writes.
6) Conflicts: stable message ordering via stored `order_key` (HLC-derived) plus `index`; `ref_count` is derived (not synced).

## Recommended doc updates

- Add a shared "Data Model Mapping" section across sync/storage docs.
- Add a "Workspace source of truth" section in auth + sync + storage plans.
- Align hook names and add them to hook catalog once finalized.

## Admin Dashboard notes

- Admin plugin enablement is stored in `kv`, but runtime loading of installed plugins in the main app still needs a dedicated loader that filters by `plugins.enabled`. Until that is wired, enabling a plugin will not activate its UI extensions.
- Restart/rebuild endpoints now block in development mode to avoid Nitro worker exits; operators should restart the dev server manually.
