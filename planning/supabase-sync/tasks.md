artifact_id: 8d8d1878-2e5d-43bd-8d6b-6a4d2a9bc0b3
content_type: text/markdown

# tasks.md

1. Bootstrapping & Lifecycle

-   [ ] Create `app/plugins/supabase-sync.client.ts` that lazily instantiates the engine after Nuxt hydration, resolves Supabase client + hook bus, and guards against SSR execution. (Req §1.1, §5.5)  
-   [ ] Wire Supabase `onAuthStateChange` to start/stop the engine, tear down subscriptions within 500 ms of sign-out, and expose a kill switch for feature flags. (Req §1.1–§1.5, §6.5)  
-   [ ] Register HMR / tab-dispose handlers so multiple plugin instances never coexist. (Req §6.1)

2. Schema, Types, & Config

-   [ ] Define shared zod schemas for payloads (`ChangeStamp`, `PendingOp`, `SyncRun`, adapter shapes) and export them for both client and server. (Req §6.4)  
-   [ ] Build `app/config/sync-topics.ts` enumerating adapters, conflict policies, scope descriptors, attachment metadata, and default cursors. (Req §1.1, §4.1)  
-   [ ] Document per-topic merge fields / CRDT strategies so conflicts can be reasoned about centrally. (Req §1.1, §1.5)

3. Dexie Persistence Layer

-   [ ] Define Dexie tables for `pending_ops`, `tombstones`, `sync_state`, `sync_runs`, and optional `device_registry`. (Req §2.1, §3.1, §4.2, §9.1)  
-   [ ] Implement Dexie migrations with upgrade functions covering schema additions and rehearsed downgrade paths. (Req §6.1)  
-   [ ] Provide helpers (`getSyncState`, `saveSyncState`) that encapsulate version comparisons and cursor serialization. (Req §4.2)

4. Provider Abstraction & Supabase Implementation

-   [ ] Finalize `SyncProvider` interface (subscribe, unsubscribe, pull, push, uploadAttachment, dispose) plus typed request/response DTOs. (Req §7.*)  
-   [ ] Implement `createSupabaseProvider` that maps table scopes to realtime channels, calls RPC `sync_pull`, `sync_push`, and handles Supabase Storage uploads. (Req §4.*, §5.*, §10.*)  
-   [ ] Ensure provider emits rate-limit metadata and recognizes cursor expiry responses to trigger rescan flows. (Req §4.5, §7.4)

5. Change Capture & Outbox

-   [ ] Build `HookBridge` listening to `db:*:mutated` hooks, filtering via adapter hookFilter, wrapping writes + pending_ops append in Dexie transactions, and tagging ops with `ChangeStamp`. (Req §2.*, §8.1)  
-   [ ] Implement `OutboxManager` that enqueues ops, coalesces per table, enforces byte limits, and emits `sync:queue:overflow` when purging oldest entries. (Req §2.4, §5.3)  
-   [ ] Build queue persistence tests covering reload survival and deterministic ordering. (Req §2.5, §8.2)

6. Push Loop & Retry Logic

-   [ ] Schedule flushes with configurable batch window + max batch size, preserving create→update→delete ordering. (Req §7.1–§7.2)  
-   [ ] Implement exponential backoff with jitter `[250, 1000, 3000, 5000]` ms, abort after final attempt, and emit `sync:retry` / `sync:error`. (Req §7.3)  
-   [ ] Respect Supabase rate-limit headers by dynamically throttling concurrency. (Req §7.4)

7. Pull Loop, Realtime, & Cursor Manager

-   [ ] Build `SubscriptionManager` that registers realtime channels per topic, coalesces bursts, and forwards to ConflictResolver. (Req §2.2, §7.5)  
-   [ ] Implement `CursorManager.pull()` to request paged deltas, persist `nextCursor`, and trigger rescan on cursor expiry. (Req §4.2–§4.5)  
-   [ ] Add rescan/backfill orchestrations with progress events and ability to rebase pending ops after fresh snapshots. (Req §9.3)

8. Conflict Resolution & Tombstones

-   [ ] Implement `ConflictResolver` honoring per-topic policy (LWW / merge / CRDT), verifying serverVersion monotonicity, and emitting `sync:conflict` when policy cannot auto-resolve. (Req §1.*)  
-   [ ] Ensure inbound deletes create/update local tombstones, respect purge windows, and prevent resurrection during full sync. (Req §3.*)  
-   [ ] Tag each applied change with `lastWriter` to short-circuit echo loops. (Req §1.2, §3.2)

9. Offline, Visibility, and Kill Switches

-   [ ] Build connectivity monitor reacting to `navigator.onLine`, Supabase realtime status, and fetch failures to pause/resume pushes. (Req §5.*)  
-   [ ] Slow timers when tab hidden while ensuring a final flush fires before sleeping; integrate Page Visibility API. (Req §8.5)  
-   [ ] Expose command API (`pausePush`, `resumePush`, `clearQueue`) for feature flags or emergency kill switches. (Req §9.3, §6.5)

10. Large Payloads & Attachments

-   [ ] Add attachment pipeline that uploads blobs before record push, swaps in `{ url, hash, size }`, and refreshes expiring signed URLs. (Req §10.1)  
-   [ ] Implement chunking for large text fields and payload splitting when body exceeds 8 MB, including compression toggles. (Req §10.2–§10.4)  
-   [ ] Support diff-based updates when adapters provide field-level patches; fall back to whole-record only when necessary. (Req §10.5)

11. Observability & Telemetry

-   [ ] Persist `sync_runs` metrics, expose `sync:stats` events (pending counts, cursors, last error), and ensure production build emits no console logs. (Req §6.2–§6.3, §9.1–§9.2)  
-   [ ] Implement recovery controls (`triggerRescan`, `triggerRebase`) and hook events (`sync:rescan:progress`, `sync:auth:blocked`). (Req §9.3, §5.3)  
-   [ ] Provide optional dev-only overlay subscribing to hook events for debugging without impacting prod bundle. (Req §6.1)

12. Testing & Verification

-   [ ] Unit tests for adapters, conflict policies, ChangeStamp generation, retry scheduler, tombstone purge logic, and queue overflow. (Req §1.*, §2.*, §3.*)  
-   [ ] Integration harness mocking provider to exercise push/pull/backfill, auth expiry, cursor expiry, attachment uploads, and rate-limit responses. (Req §4.*, §5.*, §7.*, §9.*)  
-   [ ] Cypress/Vitest E2E covering multi-tab conflict scenario, offline capture/flush, and manual rescan/backfill flows. (Req §8.*, §9.3)
