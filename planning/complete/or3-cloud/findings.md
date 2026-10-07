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

- Real models switched mid-thread (eight providers, shared tool history)
  worked. A low key balance no longer fails every default-allowance send (one
  retry at the affordable size), an unreachable catalog fails within seconds
  as a provider outage instead of "Model capacity unavailable", and the image
  omission note no longer implies earlier replies were blind. Kimi K2.5 at
  its full output window remains open; see
  [the 2026-10-07 report](../or3-cloud-production-readiness/chat-reliability-2026-10-07.md#real-models-switched-mid-thread-follow-up-pass).
- A managed-install chat pass found that relayed provider 404s cached the
  stream route as missing, that image history broke every send after
  switching to a text-only model, that carried images were sent twice and
  that the image cap dropped the newest attachment. All are repaired, with
  provider-404 and unsupported-image guidance; catalog badges, alias provider
  grouping and title-only sidebar search were clarified. Evidence and open
  follow-ups (invite links, failed-turn copy, signed-out shell, prerendered
  config) are in
  [the 2026-10-07 chat reliability report](../or3-cloud-production-readiness/chat-reliability-2026-10-07.md).
- A code-review follow-up now guards composer ownership across asynchronous
  hooks, keeps active streamed replies pending, copies inherited reference
  history with remapped turn/tool ownership, scopes reused tool-call results
  to their parent assistant, and preserves model search fallback/lifetimes.
  Invalid catalog prices no longer appear negative or qualify as free.
  The follow-up passed 22 browser journeys and live Chrome branch/tool/reload
  continuation; evidence and remaining limits are recorded in
  [the chat reliability report](../or3-cloud-production-readiness/chat-reliability-2026-10-05.md#code-only-review-follow-up).
- Basic-chat reliability fixes now preserve failed turns, replay embedded tool
  results (including nested failure transcripts), omit empty/invalid-role tool
  calls, refresh expired cached authorization before background client tools,
  recover completed replies across the reload/admission gap, and open a branch
  through workspace navigation. Fresh-account model selection, exact model
  search, notifications over the composer, and empty-search wording were also
  corrected. Local Chrome evidence and qualification limits are recorded in
  [the 2026-10-05 chat reliability report](../or3-cloud-production-readiness/chat-reliability-2026-10-05.md).
- The empty-chat fallback reuses the theme registry's lazy message renderer,
  keeping Markdown/highlighting out of the root preload graph. The offline
  chat journey harness disables Cloud features and mocks catalog startup with
  SDK-compatible pagination metadata so local SSR settings cannot cause 429s.
- Dexie schema 20 removes the unused standalone snapshot-staging generation
  index while preserving staged rows and its sentinel. The compound sequence
  index remains the page reader; snapshot workload and budgets are unchanged.
- Dexie schema 19 removes three unused outbox indexes while preserving queued
  rows, statuses, revisions, and the due-time scheduler index. Upgrade coverage
  includes pre-scheduler and schema-18 queues across reopen; the strict outbox
  benchmark retains its original workload and budgets.
- Extended deployment qualification now preserves local-image binding during
  explicit recovery. Dashboard interruption qualification requires an explicit
  snapshot restore after target mutation and is available on demand, including
  in the `all` suite, instead of assuming automatic rollback.
- Public runtime config now exposes only non-sensitive values; server-only storage providers stay private.
- Provider identifiers are centralized in shared constants to reduce string drift across adapters.
- Convex gateway clients are cached by token to avoid per-request client creation.
- Shared auth-session cache now invalidates immediately when active workspace changes or active workspace is removed.
- Sync wire payload validation now accepts camelCase and snake_case inputs, then normalizes to snake_case before ingestion.
- Background tool/workflow execution now emits structured JSON logs with recursive secret redaction for token-like fields/values.
- Provider and operations documentation for the default stack (basic-auth + sqlite + fs) is now published and indexed in docmap.
- SSR auth now turns off when the selected sync/AuthWorkspaceStore provider package is unavailable, preventing server session resolution from entering a dead store.
- Invite-only registration now validates the signed invite against current store state before provisioning a new internal user mapping.
- Reattach priming for terminal background jobs now reuses the normal terminal cleanup path, so final persistence, notifications, completion promises, and tracker eviction stay consistent.
- Wizard local-dev deploy no longer kills arbitrary processes on port 3000; it now surfaces a manual-action warning instead.

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
