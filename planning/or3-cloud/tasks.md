# tasks.md

artifact_id: 3d56ebaa-75b0-4290-b066-2bb1b2993121
date: 2026-01-25

## Purpose

Execution guide for OR3 Cloud (SSR auth + sync + storage). Use this as the top-level checklist and pointer map.

## Required reading (before any code)

-   `planning/or3-cloud/AGENTS.md` (system prompt for this feature set)
-   `planning/or3-cloud/implementation-plan.md`
-   `planning/or3-cloud/architecture.md`
-   `public/_documentation/docmap.json` (entry point to docs)

## Ordered task list (with guidance)

1. Plan alignment and doc updates (COMPLETED)

-   Ensure locked decisions remain consistent across all planning docs.
-   Update/remove deprecated docs if discovered.

2. SSR auth foundation (COMPLETED)

-   Execute `planning/ssr-auth-system/tasks.md`.
-   Gate SSR-only modules in `nuxt.config.ts` (no Clerk in static builds).
-   Implement `AuthWorkspaceStore` backed by the selected SyncProvider backend.
-   Implement `AuthTokenBroker` for provider-specific JWT templates.
    Acceptance criteria:
-   Static build runs without SSR auth enabled.
-   `/api/auth/session` returns null when disabled and a valid session when enabled.
-   `can()` is the only gate for SSR endpoints.

### Notes / deferred until DB integration

-   `AuthWorkspaceStore` is currently interface-only (no backend implementation). This blocks:
    -   Mapping provider sessions to internal user/workspace
    -   Assigning `role` and `workspace` in `SessionContext`
    -   Meaningful authorization decisions beyond "unauthenticated"
-   `auth.access:filter:decision` hook enforcement inside `can()` is deferred until we have a
    server-side hook engine available to Nitro routes (no Nuxt composables in `server/**`).

3. Sync layer (metadata) (COMPLETED)

-   Execute `planning/db-sync-layer/tasks.md`.
-   Use per-workspace Dexie DB (`or3-db-${workspaceId}`).
-   Capture writes via Dexie hooks with remote suppression.
-   Add `order_key` and index `[thread_id+index+order_key]` for deterministic ordering.
-   Add outbox coalescing and backpressure.
-   Add change_log retention via `device_cursors`.
    Acceptance criteria:
-   Offline writes sync on reconnect without loops.
-   Conflicts resolve deterministically.
-   Sync queue does not grow unbounded.

4. Storage layer (blobs) (COMPLETED)

-   Execute `planning/db-storage-system/tasks.md`.
-   Keep transfer state local-only (`file_transfers`).
-   Persist `storage_id` + `storage_provider_id` on upload completion.
-   Ensure presigned URLs are short-lived and gated via `can()`.
    Acceptance criteria:
-   Device A uploads → Device B downloads and caches.
-   Missing blobs show placeholder without breaking sync.

5. Integration and hardening (COMPLETED)

-   Add unit + integration tests (auth, sync, storage).
-   Add E2E coverage for multi-device flows and offline recovery.
-   Validate change_log retention and GC.
    Acceptance criteria:
-   Static builds unchanged.
-   SSR builds pass auth/sync/storage smoke tests.

6. Notification Center (COMPLETED)

-   Execute `planning/notification-center/tasks.md`.
    Acceptance criteria:
-   Notifications persist locally and sync when enabled.
-   Hooks and UI work without breaking the hot path.

7. Admin Dashboard (NEXT)

-   Execute `planning/or3-cloud/admin-dashboard/tasks.md`.
-   Keep admin SSR-only; never ship admin UI in static builds.
-   Enforce all admin actions via `can()` and fail closed.
    Acceptance criteria:
-   Owner/editor can access `/admin/*` in SSR mode.
-   Viewer/unauthenticated cannot access `/admin/*`.
-   Owner can manage members, install extensions, apply config, and restart safely.

## Implementation checks (do not skip)

-   No duplicate workspace/user stores.
-   SSR-only code stays in `server/**`.
-   Client-only code stays in `.client.ts` or `process.client` guards.
-   Hooks and registries updated with type maps.
-   Wire schema remains snake_case unless a provider requires mapping.

## Doc maintenance

-   Update `planning/or3-cloud/findings.md` as issues are resolved.
-   Update docmap references if you add or move docs.
