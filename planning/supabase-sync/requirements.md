artifact_id: 4f7a1a6a-4bc0-4f86-8d1c-d2e6e4b316f9
content_type: text/markdown

# requirements.md

## Purpose

Draft 2 codifies the requirements for a Dexie ⇄ Supabase sync engine that can later swap transports (e.g., Firebase) without re-architecting the client. It expands on the initial draft by addressing the 10 “big rocks” that routinely sink sync projects: conflicts, change capture, deletes, cursors, auth, schema evolution, throughput, UX guarantees, observability, and large payload handling.

The scope is the Nuxt 3 web client. The server-side work (RLS, change-log tables, cursor APIs) must be exposed via Supabase/Postgres but is called out where the client depends on it.

## Functional Requirements

### 1. Conflict Resolution & Causality

User Story: As a multi-device user, I want predictable outcomes when two clients edit the same record so that no edits disappear silently.

Acceptance Criteria:
1.1 Every synced table SHALL declare a conflict policy (`'lww' | 'merge' | 'crdt'`) and, when applicable, per-field merge strategy (e.g., `tags = union`, `title = lww`).  
1.2 Local and remote changes SHALL carry a `ChangeStamp` (deviceId, opId, hlc, optional serverVersion) to detect stale deliveries and guarantee idempotency.  
1.3 Engine SHALL reject inbound payloads with serverVersion <= lastAppliedVersion for that table to prevent replays out of order.  
1.4 Clock skew SHALL be neutralized by trusting server-assigned versions or hybrid logical clocks (HLCs) emitted by the provider. Client wall clocks SHALL never decide winner alone.  
1.5 When policies cannot auto-resolve (e.g., both updated `description` field under merge policy), the engine SHALL emit `sync:conflict` with both versions so UI can surface a chooser.

### 2. Change Capture & Idempotent Replay

User Story: As a contributor editing offline, I want my local mutations to survive retries so that I never lose edits to flaky networks.

Acceptance Criteria:
2.1 Dexie transactions SHALL wrap local store mutations plus `pending_ops` append to avoid “write without log.”  
2.2 Each `PendingOp` SHALL include a stable UUID `opId`; outbound push SHALL use it as the idempotency key with Supabase edge functions or Postgres dedupe table.  
2.3 The push loop SHALL treat HTTP 5xx/429 responses as retriable and re-send the same batch without duplicating effects server-side.  
2.4 The change log SHALL store minimal diffs (`patch`) where possible to minimise bandwidth, but full records MUST be sent when diffs cannot be computed.  
2.5 Pending operations SHALL persist across reloads and survive IndexedDB version bumps (Dexie migration guards).

### 3. Deletes, Updates, and History (Tombstones)

User Story: As a user who deletes content, I want that deletion to persist across devices so that nothing resurrects unexpectedly.

Acceptance Criteria:
3.1 Delete operations SHALL create tombstones `{ id, table, deletedAt, lastWriter }` both locally and remotely.  
3.2 Sync engine SHALL ignore inbound “full” records whose `serverVersion` precedes the matching tombstone version.  
3.3 A configurable purge job SHALL remove tombstones older than N days only after all registered devices report checkpoints beyond the tombstone version.  
3.4 UI SHALL treat soft-deleted entries as hidden but retrievable until purge completes to avoid user confusion during laggy sync.

### 4. Partial Sync Boundaries & Cursors

User Story: As a workspace member, I want only relevant data synced so that performance stays acceptable on large tenants.

Acceptance Criteria:
4.1 Each topic SHALL define its scope keys (tenantId, workspaceId, etc.) so provider queries always include tenant scoping.  
4.2 Pull endpoint SHALL return `(changes[], nextCursor)` where cursor = monotonically increasing `serverVersion` or `(hlc, id)` tuple; client SHALL persist `SyncState` per table.  
4.3 Initial sync SHALL bootstrap from `lastServerVersion` if present, otherwise fall back to paginated full sync honoring scope filters.  
4.4 Engine SHALL enforce back-pressure: max N records per pull (config default 200) and resume with `nextCursor`.  
4.5 Losing cursor (e.g., server resets) SHALL trigger `sync:rescan-request` so client can request a full snapshot.

### 5. Auth, Multitenancy, and Security Rules

User Story: As a security-conscious admin, I want assurance that sync never leaks data across tenants.

Acceptance Criteria:
5.1 Provider SHALL derive tenant/workspace context from Supabase session JWT (server-side) and SHALL never trust client-supplied tenant IDs for authorization.  
5.2 Client SHALL pass tenant scope only for routing (i.e., query params) but server SHALL re-derive from auth claims before executing SQL.  
5.3 When auth expires mid-sync, engine SHALL pause outbound pushes, emit `sync:auth:blocked`, and resume only after a refreshed session is available.  
5.4 Multi-tenant queries SHALL include RLS policies that limit rows per tenant; tests must cover attempts to fetch other tenants’ data.  
5.5 Anonymous/unauthenticated sessions SHALL keep sync disabled entirely.

### 6. Schema Versioning & Migrations

User Story: As a maintainer, I want clients on old builds to keep syncing safely during rolling upgrades.

Acceptance Criteria:
6.1 Dexie database versioning SHALL include upgrade scripts for any schema changes (new stores, new indexes).  
6.2 Payloads SHALL embed `schemaVersion`; client SHALL refuse to apply payloads with newer versions it cannot parse and emit `sync:schema:unsupported`.  
6.3 Server SHALL accept at least two prior schema versions (configurable window) and run server-side migrations before inserting.  
6.4 Shared zod schemas SHALL live under `shared/schemas/sync` and be reused by both client validators and server edge functions.  
6.5 During critical migrations, engine SHALL expose a kill switch to pause pushes while allowing pulls (read-only mode) until client updates.

### 7. Ordering, Batching, and Rate Limits

User Story: As a mobile user on constrained networks, I need sync to respect quotas so the app stays responsive.

Acceptance Criteria:
7.1 Outbound queue SHALL batch per table with configurable window (default 250ms) and max batch size (default 50 ops).  
7.2 Dependent operations SHALL maintain ordering guarantees: create before update/delete; engine SHALL reorder or split batches to preserve causality.  
7.3 Retry policy SHALL implement exponential backoff with jitter `[250, 1000, 3000, 5000]` ms and emit `sync:retry` events containing attempt count and table.  
7.4 The engine SHALL monitor Supabase rate-limit headers and downgrade concurrency when thresholds are approached.  
7.5 Realtime inbound bursts SHALL be coalesced locally (micro-batch <= 20ms) to avoid thrashing state managers.

### 8. Offline-First UX & Consistency Guarantees

User Story: As someone working on flights, I need the UI to honor my edits immediately and reconcile once I reconnect.

Acceptance Criteria:
8.1 Local stores SHALL tag rows with `syncStatus: 'pending' | 'failed' | 'synced'` plus last local opId to support read-your-writes.  
8.2 Pending ops SHALL be visible to selectors so the UI reads from the combination of base state + pending diffs.  
8.3 Engine SHALL document guarantees: eventual global consistency, local read-your-writes, monotonic reads per device when version checkpoints exist.  
8.4 Conflict surfacing hooks (`sync:conflict`) SHALL include actionable payload (`local`, `remote`, `policy`) for UI prompts.  
8.5 Background timers SHALL avoid running while tab is hidden except for critical flushes (respect Page Visibility API).

### 9. Observability, Recovery, and Backfills

User Story: As on-call support, I need trails to debug sync incidents quickly.

Acceptance Criteria:
9.1 Client SHALL maintain `sync_runs` table capturing startedAt, endedAt, counts pushed/pulled, and errors array.  
9.2 Engine SHALL expose `sync:stats` hook with pending counts, last cursor per table, and last error timestamp.  
9.3 Recovery tools SHALL support rescan (refetch since supplied version), selective rebase (apply pending ops atop fresh snapshot), and queue kill switch.  
9.4 Fatal errors SHALL flag the engine unhealthy and require manual restart—no silent loops.  
9.5 Backfill mode SHALL allow large historical loads by pausing outbound pushes and applying pulls in chunked batches with progress callbacks.

### 10. Large Payloads, Attachments, and Limits

User Story: As a user attaching screenshots, I want uploads to succeed even when records also sync text.

Acceptance Criteria:
10.1 Records referencing binary data SHALL store metadata only (URL, hash, size); actual blobs SHALL upload via Supabase Storage/S3 separately before the record is marked synced.  
10.2 Engine SHALL chunk text fields >256 KB and merge them locally before persisting to stores.  
10.3 Payload transport SHALL support gzip/deflate when backend allows; fallback to raw JSON otherwise.  
10.4 Provider SHALL enforce max payload size (default 8 MB per request) and split batches automatically.  
10.5 Field-level diffs SHALL be preferred over whole-record updates when patch generation is available; full record fallback MUST still be correct.

## Supporting Types

```ts
type ChangeStamp = {
    deviceId: string;
    opId: string; // uuid
    hlc: string; // "ts-counter-node"
    serverVersion?: string;
};

type PendingOp = {
    id: string; // opId
    table: string;
    pk: string | number;
    kind: 'put' | 'del';
    patch?: unknown;
    baseVersion?: string;
    createdAt: number;
};

type Tombstone = {
    id: string;
    table: string;
    deletedAt: string;
    lastWriter: string;
};

type SyncState = {
    [table: string]: {
        lastServerVersion?: string;
        lastCursor?: string;
    };
};

type SyncRun = {
    id: string;
    startedAt: number;
    endedAt?: number;
    pushed: number;
    pulled: number;
    errors?: Array<{ code: string; message: string }>;
};
```

## Non-functional Requirements

-   Compatibility: Works with Nuxt 3 + Supabase JS, existing hook bus, current Dexie stores, and can gate provider factory for Firebase in the future.  
-   Simplicity: Engine remains a single plugin + helpers (subscription manager, outbox, hook bridge) with configuration-driven topics—no per-page wiring.  
-   Testability: Unit tests cover adapters, retry helpers, tombstone purge logic; integration tests simulate realtime/pull APIs; E2E verifies multi-tab convergence and offline rebases.  
-   Performance: Idle listeners keep CPU <5% p95; outbound push respects mobile rate limits; memory footprint of queues stays <5 MB default with back-pressure signals.  
-   Privacy & Security: Only authenticated Supabase sessions may sync; no additional telemetry beyond optional anonymized sync metrics.
