# Database Sync Layer

The OR3 Sync Layer provides offline-first, bidirectional synchronization between a workspace-scoped local Dexie database and the selected sync backend (SQLite or Convex in first-party deployments). It enables users to work offline and have their changes automatically synced when connectivity is restored, with support for multi-device synchronization and conflict resolution.

SQLite provider `0.0.30` stores background tool-result operations with UUIDs.
Its startup migration repairs legacy `background-tool:` operation IDs in saved
rows, change logs, tombstones, and materialized snapshots. The repair preserves
content, clocks, server versions, and cursors, so existing clients can resume
sync without resetting their workspace. Offline backup inspection accepts both
the earlier migration history and the repaired history.

## History replacement and saved work

The matched history-incarnation contract identifies a database history with an
opaque token. Every pull, snapshot, push, cursor acknowledgement and events
request negotiates `historyIncarnationCapability: 'incarnation-v1'`. Legacy
requests receive HTTP 426. An adapter must advertise `historyIncarnation: 'v1'`
and return a bound token; the gateway transport alone does not qualify a server.
The hardened Convex candidate supports this contract in direct and gateway
modes with its matching deployed backend; see [Convex qualification and setup](/documentation/cloud/provider-convex#sync-qualification-and-history-setup).
Published Convex 0.0.26 lacks these changes. Installing that published package
or obtaining an auth token does not qualify it. Startup refuses an unqualified
direct provider before subscribing or starting the outbox. Gateway providers
also require server qualification. Published SQLite 0.0.30, D1 and managed
replacement image activation retain their separate qualification gates.
This source qualification does not publish or activate a release.

An unbound browser or a different token requires a complete materialized
snapshot, even when its numeric cursor equals or trails the new head. One
workspace-wide `sync_history` control row in Dexie's `sync_state` fences pushes,
ACKs and stale completions. A follower tab can close this guard; the subscription
owner resumes checked snapshot recovery. The atomic install saves original
outbox entries, acknowledged local content, tombstones, streaming work and
transfer references in the existing quarantine, replaces authorized canonical
state, invalidates other scopes and installs the exact token/cursor pair.
On subscription startup, committed coverage for the current ready history
restores the pending cursor acknowledgement. The terminal catch-up page retries
that ACK even when no new rows arrive, so a reload after snapshot installation
cannot leave a fresh device absent from server retention accounting. Coverage
from a different history never supplies this acknowledgement.
After installation, sync replaces only that workspace's Dexie connection and
restarts its transport without navigating the page. Old connection handles keep
their original history and stay closed, so delayed callbacks cannot write into
the installed history. Cloud restore waits for this initial handoff before
starting destination uploads.
A newly created protected workspace DB carries a birth-only
`firstBindEligible: true` proof in the shared guard. Its first atomic snapshot
adopts purely local startup preferences, edits/deletes and offline conversations
with ordinary LWW rules, preserving streaming progress, drafts, attachments and
failure statuses. The proof is consumed with installation, even at cursor zero.
It survives private staging/restart but is invalidated by remote data, nonzero
coverage in any scope, imports, or an unfenced push before dispatch. Neither
cursor zero nor an absent history proves eligibility. Existing/upgraded DBs and
later history replacements retain the conservative held-work policy; existing
holds stay held. A fresh default theme therefore does not produce a false
server-recovery hold. No server/wire or explicit recovery rules change.

Edits committed while downloading are included. Quota failure preserves the old
state and leaves pushes closed. Same-history expiry keeps ordinary pending replay.

Workspace sync status shows **Saved changes from before server recovery** with
account-scoped inspection/export and deliberate Recover/Discard actions.
Retry all excludes these entries. Lost acknowledgements have unknown commit
status in the discarded history. Supported recovery puts create a fresh explicit
action after checking current history, record and parent dependencies; original
evidence remains. Deletes, files and complex entities require manual recovery.
Secrets and local-only KV/drafts are excluded from exports; held attachment bytes
are protected from cleanup until deliberate resolution. Cache retention pins only
blobs referenced by held originals or local copies; an unrelated held setting
such as a pre-bind theme selection does not prevent verified cache eviction.
Pending or failed operations, unfinished streaming messages, unsent drafts and
saved draft versions also retain their referenced local blobs. Eviction rechecks
these references in its deletion transaction after verifying the remote copy.
Background job projections and canonical tool admission also check the durable
history guard before using a connection whose history has been replaced,
including the interval before that connection closes.

Dexie schema 32 atomically moves workspace stores to a fixed `current_` physical
namespace, retaining exactly `or3-db-${workspaceId}` and unchanged logical/wire
names. All stores are protected, including file metadata, attachment references,
transfers, drafts, outbox, guard/cursors and recovery evidence. The large
content-addressed `file_blobs` store and every other store are renamed in place
through native IndexedDB; no user records or blob payloads are copied or doubled.
Old sink deletions cannot remove current attachment bytes.

Old Dexie 4.4.6 may reopen and recreate retired names through its schema patch
(`dexie.mjs:4561–4567`, `patchCurrentVersion:3763`). These stores are isolated
sinks: their writes cannot reach current state or be published. New opens tolerate
extra stores without repeated upgrades and never replay their content. A bounded
**Changes from an outdated client; origin unknown** diagnostic identifies their
presence; read-only sink inspection/export and deliberate discard are a follow-up,
with no automatic recovery. The actual legacy-schema/hooks regression checks
current state/publication isolation and stable coexistence. Packed-provider and
full deployment lifecycle qualification remain separate activation requirements.

A blocked upgrade waits for other tabs to close without clearing data. An aborted
or failed migration rolls back all renames/deletions. An accessible, themed
updating state appears during migration. Recovery state is retained per workspace
when several databases open together. The storage recovery dialog pauses automatic reopen, advises freeing storage, and offers explicit **Retry
upgrade**. Do not clear site data to resolve an upgrade failure.

## Materialized snapshot bootstrap contract

Cold bootstrap uses a provider-neutral materialized snapshot instead of cursor
zero change-log replay. Each page is bound to one workspace, opaque
`snapshotId`, and `highWatermark`; continuation tokens are opaque and returned
unchanged. Providers order canonical rows and tombstones by
`(tableName, primaryKey, kind)`, use bounded reads, and preserve the same
watermark across the complete page chain. The client applies the complete
snapshot transactionally, then begins incremental replay strictly after the
watermark.

SQLite and Convex implement provider-side materialized snapshot page generators.
The updated SQLite provider also targets 1 MiB of serialized JSON per pull or
snapshot page, in addition to its row limit. It keeps records whole, advances
past filtered changes, and requires durable unavailable handling for records beyond the hard
single-record ceiling when the matched recovery contract is enabled. Existing clients continue to follow the same cursors and tokens.
The client stages each validated page in a local IndexedDB table, then installs
the completed chain and cursor in one transaction before replaying strictly
after the watermark. Interrupted staging leaves materialized data untouched;
ordinary restarted attempts discard incomplete staging rows; a storage pause
retains the current attempt for explicit retry. Pending local operations
are read and merged in the install transaction, including writes made while
pages were fetched. Cross-provider coverage verifies deterministic rows,
tombstones, intervening writes, duplicate boundaries, and fresh-device recovery
after the original log entries have been pruned. Change-log and tombstone
retention is enabled for adapters that declare the `snapshot-v1` retention
contract; adapters that do not fail closed with `503`. Automatic maintenance
uses the same capability gate, isolates workspace failures, and reports a partial
pass as failed while continuing other workspaces. SSE disposal failures cannot
retain connection slots or prevent the remaining cleanup.

When an existing device's cursor expires, snapshot-capable providers use the
same canonical replacement path instead of attempting cursor-zero replay.
Materialized rows and tombstones for the requested tables are replaced
atomically, except device-local KV keys excluded by the sync capture policy
(including plugin extensions). Pending local puts and deletes are normalized,
merged by revision in the same transaction, and then changes after the
snapshot watermark are replayed before the live subscription resumes.

## Unavailable records and durable recovery

A compatible host/provider pair can contain a malformed stored record while
continuing healthy records. Pull and snapshot responses carry an optional
`unavailable` array. Every marker identifies the logical key, original operation
or snapshot item kind, a bounded reason and a durable server evidence reference.
Pull markers require the original server version; snapshot markers require the
matching snapshot ID and high-watermark. Healthy entries and markers share the
page count and byte budget. An all-unavailable pull window still advances, and
a final all-unavailable snapshot page completes the chain. Invalid identity,
ordering or coverage fails the page instead of silently skipping it.

This requires explicit provider support (`capabilities.unavailableRecords =
'v1'`) and browser negotiation (`unavailableRecordCapability: 'unavailable-v1'`).
An older browser receives HTTP 426 / `OR3_SYNC_UPDATE_REQUIRED` before any
partial page. The new snapshot ordering contract uses the same gate. Existing
healthy pages from older adapters remain usable; upgrading the host alone does
not add server evidence storage or repair to an older provider. The hardened
Convex candidate commits evidence through `sync.pullChecked` mutations; its
reactive subscription is only a version wakeup. Direct delivery awaits durable
page application before advancing. The legacy `sync.pull` query explicitly
refuses with update-required. Both modes require the matching deployed templates.
Legacy messages without `order_key` remain readable: the client derives their
ordering from the revision HLC without changing stored history.

The browser classifies incoming defects before opening table transactions.
Remote evidence uses `variant: 'incoming'` in the existing `sync_quarantine`
store and appears in `$syncEngine.getQuarantined()` and
`$syncEngine.exportQuarantined()`. It never reconstructs outgoing operations.
Evidence must commit before the cursor advances. Snapshot markers and
client-discovered defects preserve affected local rows, deletion tombstones and
pending intent in the same atomic replacement transaction as the watermark.
Those preserved copies remain explicitly uncertain through their incoming
quarantine entry; they are not confirmed server winners or newly queued writes.
Unresolved evidence is retained until an explicit recovery/discard decision.

Server evidence survives ordinary log garbage collection and snapshot expiry.
Providers must retain original data before returning a marker and keep
notification ownership checks fail-closed. A repair must publish a fresh op ID,
a winning valid revision and a new server version; editing old history behind
an advanced cursor cannot redeliver it. See `docs/sync-unavailable-records.md`
in the source repository for the normative provider checklist.

Snapshot ordering compares `(tableName, primaryKey, kind)` component by
component using UTF-8 byte order with shorter prefixes first. NUL, colons, CJK
and supplementary Unicode remain valid identifiers; new writes reject lone
UTF-16 surrogates. The 1,024-code-unit primary-key admission limit is unchanged.
Continuation tokens allow 65,536 characters and the snapshot request body allows
128 KiB, including worst-case escaped keys and filters. Provider token decoders
must use the matching bound.

Staging rows are consumed inside the single atomic install transaction. A local
storage-quota failure rolls the install back, leaves the previous dataset and
cursor intact, and pauses automatic reconnection. Free storage, then explicitly
retry with `$syncEngine.start(workspaceId)` to resume the retained page/staging
in the current client session.
This reduces temporary duplication; browsers may still require transaction
space, so it is not a promise of quota immunity.

Writer integrations use `prepareSyncWrite` from
`~~/shared/sync/prepare-sync-write` at HTTP/background admission and provider
transactional sinks. Preparation is deterministic, allowlists synced tables,
validates lossless identifiers, stamps and final live payloads, and enforces the
256 KiB serialized payload ceiling. Deletes validate their envelope without
requiring a live row and retain their exact payload metadata so lost-ACK retries
still match older receipts. `nextSyncClock` rejects unsafe increments. Existing
nonempty legacy snapshot revision IDs remain supported.
Reparsing stored background admissions preserves their record fields so existing
admission and finalization receipts continue to match after an upgrade.

## Pull retention and snapshot recovery

Every pull response includes `oldestRetainedVersion` and `requiresSnapshot`.
`requiresSnapshot` is true when the requested cursor would skip versions the
server has already garbage-collected. Clients must snapshot-recover instead of
advancing across that gap. Wall-clock cursor age (24h) is only a fallback when
the retention fields are absent.

## Gateway polling and request volume

On servers advertising request compression, the browser compresses large
same-origin sync push bodies when gzip makes them smaller. Both compressed and
expanded bodies remain subject to the existing request limit. Older servers and
browsers without compression support continue to receive ordinary JSON.

Open chat panes, document editors, and tab titles refresh from workspace-local
Dexie observations after incoming sync writes. They add no network polling or
outbox writes. Clean document buffers follow remote changes; unsaved buffers keep
their conflict baseline. Foreground peers receive durable user turns and finalized
assistant replies, while token streaming remains on the originating client.

The SSR gateway subscribes to content-free version notifications at
`/api/sync/events` when the adapter supports `watchVersion`. A changed version
wakes the ordinary pull/apply path immediately; it never advances a cursor by
itself. While the channel is healthy, a safety pull runs once per minute;
session refreshes do not reset that deadline.
Managed restart and shutdown close these read-only notification streams before
draining writes. Clients reconnect through the normal notification or polling path.
Older adapters, unavailable channels, and browsers without EventSource retain
the two-second polling fallback with jitter. After a channel error the client
retries the channel after 5 seconds, doubling to at most a minute, and resets
that delay once a channel opens. Duplicate version hints do not generate pulls.

SQLite shares one indexed version-counter check every two seconds per watched
workspace and server process, regardless of its listener count. Convex shares a
server-only reactive client across listeners and watches its small workspace
version counter. Deploy the matching Convex templates, including `sync:watchVersion`,
to enable notifications. A stale backend falls back to polling.

Notifications require current workspace read access before subscribing, before
every delivery, and at 30-second heartbeats. Connections refresh after a minute
to revalidate the auth session, including during a stalled permission check.
There are at most eight open notification
connections per user per server process. Messages contain only the version;
canonical data, retention recovery and acknowledgements still use normal sync.

Gateway subscriptions pause pulls and close notifications while the document is
hidden or offline. Returning to a visible, online page checks immediately using
the retained cursor. An in-flight page finishes applying before another starts.
Local edits remain captured in the durable outbox. Hidden pages may still send
pending writes; offline pushes do not consume retry attempts.

Repeated pull failures back off to 60 seconds. Bounded `Retry-After` cooldowns
survive visibility and ownership changes. HTTP 401/403 retains the existing
session recovery flow. Notification failures never disable the pull fallback.

At the previous roughly 25 empty pulls per minute, a continuously visible owner
could issue about 1.08 million pulls in 30 days. A healthy channel reduces safety
pulls to about 43,200 over that period, plus actual changes, bootstrap and session
refresh requests. Authentication and heartbeat checks still cost reads. These
are request counts, not a dollar estimate: SSE holds an HTTP connection, and
hosts that bill connection duration can cost more despite fewer invocations.
Measure the selected host's duration, memory, database and egress charges before
choosing a deployment profile. Local Dexie reads do not contact the backend.

### Shared foreground subscriptions

Client engine transitions are serialized against the latest requested workspace,
account and authorization revision. A route or account change during teardown
cannot discard the next start. Transport can pause on Admin routes while atomic
write capture remains attached to the active workspace database. Workspace or
account departure and database eviction release that capture owner.


With Web Locks available, windows on the same origin share one incoming gateway
subscription per local workspace database, provider, scope, and account. The
owner applies remote changes to the shared Dexie database; its existing
cross-window live queries update the other windows. No sync payload or
credential is broadcast by the coordinator. Each window keeps its own outbox,
so local edits/uploads do not wait for subscription ownership. An initial owner
completes bootstrap before starting its outbox, as before.

Hidden/offline owners relinquish ownership after fencing and finishing any
in-flight startup and local apply; queued visible windows can take over and
read the durable cursor. Page hide, sign-out, workspace changes, and teardown cancel queued
requests and release ownership. Browsers that lack or refuse Web Locks retain
the per-window gateway behavior. This coordination does not combine different
devices, origins, accounts, databases, or providers.

The owner owns the notification channel or fallback polling loop. Sharing
prevents multiple visible windows from multiplying that traffic; it does not
combine different devices or server processes.

### Cursor-complete subscription pages

`SyncProvider.capabilities.subscriptionPages: 'v1'` opts into
`SyncSubscribeOptions.onPage(fromCursor, page)`. The provider delivers every
validated `PullResponse`, including empty/filtered windows, awaits successful
application, and owns pagination from `nextCursor`. The gateway implements this
contract. Providers without the capability retain the legacy change callback
and backlog recovery behavior.

The subscription manager applies a covered page and advances the durable cursor
through its full window, including filtered versions. It does not issue a
confirming backlog pull or rebuild the subscription after each page. A cursor
acknowledgement is sent after the final page of a burst; unchanged idle polls do
not produce acknowledgements. Failed application rejects the page receipt,
preceding-range gaps are refused, and `requiresSnapshot` uses the existing
snapshot recovery path. This preserves cursor/data safety while removing
redundant reads during foreground updates.

On startup and after reacquiring subscription ownership, page-capable providers
apply the first pull and drain any remaining pages immediately. This replaces
the discarded retention probe, so returning to a visible, online tab does not
wait for the next polling timer. The same validation, snapshot recovery, and
final-page acknowledgement rules apply to this catch-up.

## Notification scoping

SQLite push/pull/snapshot bind `notifications.user_id` to the session user.
Spoofed owners are rejected. Pull and snapshot omit other users' notification
rows and tombstones, while the pull cursor still advances over the unfiltered
change-log window so filtering cannot stall sync.

## Server-authored operations

Convex auxiliary writers (notifications, `file_meta`, workspace settings) mint a
fresh UUID `op_id`, allocate a `server_version`, and append `change_log` using
the same stamp contract as client pushes. Historical non-UUID `op_id`s are
skipped on pull/watch without failing the request.

## Conflict resolution

LWW compares `clock`, then `hlc`, then `op_id`. Equal clock/hlc ties are
deterministic. Tombstones use the same revision tuple. A push that loses LWW
returns `success: true, applied: false` and a `winner` with its revision:
`{ kind: 'put', payload, revision }` or
`{ kind: 'delete', revision, serverDeletedAt? }`. Providers may still return
the older live-only `payload` field. A replay of a previously committed
`op_id` sets `replayed: true`; when its current winner differs, that winner
is required. The client applies the winner only if it beats the local revision,
then acknowledges the outbox row.

Gateway `/api/sync/push` validates each operation independently and returns
HTTP 200 mixed results. Request bodies are bounded; rate limits are recorded on
admission, including when the adapter later fails.

Snapshot, cursor, and enabled GC requests also reserve their existing operation
allowance before asynchronous provider work, so concurrent requests cannot share
the same remaining slot. Cache expiry respects operator-configured rate windows;
HTTP 429 carries `Retry-After` for graceful deferral.

Browser writes to `/api/sync/push`, `/api/sync/update-cursor`, and sync GC routes
send JSON with `x-or3-cloud-intent: mutation`. The server checks the exact
browser origin against its effective origin or `OR3_ALLOWED_ORIGINS` before
reading the body. Originless API requests require bearer authorization and no
cookie in addition to the intent header and JSON body.

---

## Architecture Overview

The sync layer operates on a "local-first" principle. All UI reads and writes target the local Dexie database. The sync engine runs in the background to propagate changes.

### Core Components

| Component                 | Responsibility                                                                                      |
| ------------------------- | --------------------------------------------------------------------------------------------------- |
| **HookBridge**            | Intercepts Dexie writes (`put`, `delete`) and queues them as `PendingOp` entries.                   |
| **OutboxManager**         | Flushes pending operations to the server in batches, handling retries and failure strategies.       |
| **SubscriptionManager**   | Manages real-time subscriptions to server changes and performs bootstrap/rescan operations.         |
| **ConflictResolver**      | Applies remote changes to the local DB using Last-Write-Wins (LWW) and Hybrid Logical Clocks (HLC). |
| **GcManager**             | Client lifecycle shell; server retention is capability-gated and administrative.                    |
| **CursorManager**         | Tracks the sync cursor (server version) per workspace for incremental sync.                         |
| **RecentOpCache**         | Prevents echoing of recently pushed operations back from the server.                                |
| **SyncPayloadNormalizer** | Handles snake_case/camelCase field mapping and payload validation.                                  |
| **ConvexSyncProvider**    | Adapter that communicates with the Convex backend APIs using the shared Sync Protocol.              |
| **GatewaySyncProvider**   | Alternative provider that routes sync through SSR server endpoints.                                 |

### Retention safety

Sync `change_log` and tombstone garbage collection is available only when the
active server adapter explicitly declares both `snapshotBootstrap` and
`historyRetention` as `snapshot-v1`. Missing capabilities fail closed with
`503`. SQLite and Convex collectors preserve history newer than the minimum
registered-device cursor; fresh devices recover canonical state from a snapshot
and replay strictly after its watermark.

---

## Data Flow

### Write Path (Local to Remote)

1.  **Application Write**: The UI writes to Dexie (e.g., `db.messages.put(...)`).
2.  **Capture**: `HookBridge` intercepts the transaction via Dexie hooks.
3.  **Queue**: A `PendingOp` is created and added to the `pending_ops` table within the _same transaction_.
4.  **Flush**: `OutboxManager` detects pending items and pushes them to the backend (`mutation: sync.push`).
5.  **Confirmation**: On success, the `PendingOp` is removed. On failure, it is scheduled for retry.

### Outbox scheduling and retry fairness

Each outbox row carries a local-only `readyAt` projection (`nextAttemptAt ?? 0`; `0` means immediately eligible). `OutboxManager.flush()` captures one `now`, then reads each of `pending` and `retry_wait` through `[status+readyAt+createdAt+id]` with `readyAt <= now` (inclusive) already ordered by `(readyAt, createdAt, id)` before limiting. Each stream is bounded by `maxBatchSize * 10`; the two streams share that combined scan limit fairly.

Selection interleaves the streams starting with the manager's turn (initially `retry_wait`), coalesces only the selected eligible set with the existing `compareSyncRevision` winner rule (deleting only selected losers; deferred and unselected rows stay intact), then re-interleaves the winners by original status before the existing count/byte packer. Restoring fair order after coalescing matters because the coalescer sorts by creation time. The turn flips to the opposite of the last packed operation's original status only when a batch actually starts a push, so empty or gated flushes preserve it and single-operation or byte-limited requests do not reserve unused slots. A lone ready group fills the full request capacity; deferred-only or terminal-only queues make no push request.

`readyAt` is stripped before wire-size calculation and provider submission and never reaches the server. Queue-capacity reporting (`sync.queue:action:full` at 500 ops) uses indexed `pending` plus `retry_wait` counts, not the ready candidate count.

Startup recovery resets stale `syncing`/`in_flight` rows to `pending` with no positive scheduling delay (`readyAt` 0), so a sustained same-status backlog cannot postpone them behind every fresh row. When a push returns `applied: false` with a server winner, the winner is applied only if it is newer than the local materialized row/tombstone under `compareSyncRevision` (fail closed on ambiguous ties); a stale winner never overwrites newer local state, the pushed operation is still acknowledged, and deferred newer rows are preserved for later convergence.

### Quarantine and snapshot recovery of unsynced content

Snapshot installation also preserves unsynced foreground assistant progress and
its generation lease inside the replacement transaction. Streaming rows have no
outbox operation until finalization. A live parent must remain after canonical
replacement and outbox replay; newer canonical replies and tombstones retain
the existing clock/HLC ordering. Expired local leases are retained for recovery,
not treated as permission to discard the only saved partial output.


Replacing local tables from a snapshot (expired cursor, rescan) restores every
unsynced operation on top of the remote state: `pending`, `retry_wait`,
`in_flight`, `failed_retryable`, and also `failed_permanent` and legacy `failed`
rows, because once the table is replaced their payload may be the only copy.
`discarded` (an explicit user decision) and `applied` operations are never
restored, and restored operations keep their status so they can still be retried
or discarded.

An operation that cannot be replayed or pushed (no payload object, a message
missing `thread_id`/`role`/`index`, a payload that fails the table schema, or a
stamp the push schema rejects such as a non-UUID `op_id` or a missing
`deviceId`) is **quarantined** instead of deleted or aborting the snapshot:

- The original operation, diagnostics, and the targeted local row/tombstone are
  stored in the local-only `sync_quarantine` table (never synchronized), in the
  same transaction that removes it from `pending_ops`.
- If the matching local row is valid and carries exactly the operation's
  revision, a replacement `put` is queued with a **new** `op_id`/HLC (the
  content differs from the corrupt payload, so the old `op_id` is never reused),
  and the row is re-stamped with the same tuple. A malformed delete is rebuilt
  from its complete tombstone under a new revision, and the tombstone is
  re-stamped to match, because a server that already processed the original
  `op_id` rejects the same id with different content. Content that cannot be
  sanitized for sync (for example an oversized message) stays quarantined; it
  never aborts the surrounding snapshot transaction.
- If a newer queued operation or tombstone already covers the record, the entry
  is resolved without new work.
- Anything else (no row, newer unexplained row, invalid row) stays `quarantined`
  and exportable until the user discards it.

Resolved (`repaired`/`discarded`) entries are pruned after 30 days or beyond the
newest 200, after a committed snapshot or rescan recovery, a manual run, a
discard, and when the outbox starts. Unresolved entries are never pruned
automatically.

Advanced callers use `$syncEngine`:

```ts
const { $syncEngine } = useNuxtApp();
await $syncEngine.quarantineCorruptOps(); // { quarantined, repaired }; throws while a push is running
await $syncEngine.getQuarantined();       // entries, oldest first
await $syncEngine.exportQuarantined();    // JSON string for support/manual recovery
await $syncEngine.discardQuarantined(id); // explicit give-up for an unresolved entry
```

`purgeCorruptOps()` was removed: it deleted malformed operations without
preserving them or the content they described.

Browser coverage lives in `tests/e2e/cloud-sync-recovery.e2e.ts` (part of
`bun run test:e2e:cloud`). It drives the real capture hooks, snapshot installer
and outbox in Chromium's IndexedDB through the `/_tests/_test-cloud-sync-recovery`
harness page with an in-page provider, injects corruption and permanent failures
through the raw IndexedDB API, and verifies the surviving records, quarantine
entries, rebuilt operations and what is eventually pushed after reconnect. The
provider is a stub: no server snapshot or expired cursor is involved.

### Recovering failed changes

An operation that ends `failed_permanent`, `failed_retryable` or legacy `failed`
stays in `pending_ops` with its payload, and the local record is unchanged.
Users review these in **Dashboard → Workspaces → Sync status**
(`?dashboard=workspaces&page=sync`, registered when sync is enabled). A permanent
failure notification links there with a **Review sync** action scoped to the
active workspace, and the Cloud backup export note links there too.

The view follows the active workspace database. It shows a bounded list (up to
50, with the full count) of failed changes, each with a record title or name
when the payload has one, the record kind, a plain-language reason derived from
`lastErrorCode`/status, and the failure time. It never shows payload content or
raw provider errors. A workspace or account switch drops the list, any open
discard confirmation and any in-progress result.

- **Retry** / **Retry all** requeue the operation as `pending` with its id,
  stamp and payload, so it goes through the normal authorized push and op-id
  idempotency.
- **Discard** needs a second **Discard change** confirmation. It marks the
  operation `discarded` (an auditable record) and leaves the local record in
  this browser; other devices will not receive that change.
- **Save copy** downloads a local backup of this browser's saved work and
  locally stored originals (`exportWorkspace({ localOnly: true })`) without
  waiting for the queue to drain. It does not include files kept only in the
  cloud.

The view uses these exports from `~/core/sync/outbox-manager`, which also back
`OutboxManager.getFailedOps()`, `retryFailed()` and `discardFailed()`:

```ts
const { ops, total } = await listFailedOps(db, 50);
await retryFailedOps(db, { id: op.id, opId: op.stamp.opId }); // number requeued; omit the ref for all
await discardFailedOp(db, { id: op.id, opId: op.stamp.opId }, 'user_discarded'); // false if no longer failed
```

Each action reads and writes in one `pending_ops` transaction and accepts a
row only while it is still failed (and, for the `{ id, opId }` form, still the
same operation), so a row another tab already retried, acknowledged or
discarded is never resurrected or overwritten.

Browser coverage: the `a normal user recovers failed changes from the workspace
sync view` case in `tests/e2e/cloud-offline-recovery.e2e.ts`
(`bun run test:e2e:sync:cloud`).

### Read Path (Remote to Local)

1.  **Subscription**: `SubscriptionManager` listens for changes since the last known cursor (`query: sync.watchChanges`).
2.  **Receive**: The provider receives a batch of `SyncChange` objects.
3.  **Conflict Resolution**: `ConflictResolver` applies changes to Dexie:
    - Compares `clock`, then `hlc`, then `op_id` using the shared revision comparator.
    - Applies a newer remote revision and preserves a newer local revision.
    - Uses the same deterministic tie-breaking for rows and tombstones.
4.  **Reactivity**: Dexie live queries update automatically, refreshing the UI.

---

## Conflict Resolution

We use a **Last-Write-Wins (LWW)** strategy driven by **Hybrid Logical Clocks (HLC)**.

- Every materialized record and tombstone persists the same `(clock, hlc, op_id)` tuple as its outbox/change-log operation.
- When a change occurs, the clock is incremented.
- **Tombstones** are used to track deletions, ensuring that "delete wins" against older "put" operations.
- **Tie-Breaking**: one total comparator orders clock, then HLC, then operation ID. Equal-clock legacy tombstones missing tie-break metadata fail closed.
- **Legacy repair**: the internal Convex `sync.repairLegacyTombstones` command repairs only tombstones with one uniquely matching delete in `change_log`. Missing or ambiguous history is reported and never guessed; the command is bounded and safe to repeat.

---

## Observability Hooks

The sync engine emits lifecycle hooks that plugins can listen to:

### Write Path Hooks

| Hook Key                     | Description                                             |
| ---------------------------- | ------------------------------------------------------- |
| `sync.op:action:captured`    | A local write was intercepted and queued.               |
| `sync.capture:action:nonAtomic` | A write was captured outside a Dexie transaction.    |
| `sync.push:action:before`    | A batch is about to be pushed to the server.            |
| `sync.push:action:after`     | A batch push finished (counts successes and failures).  |
| `sync.retry:action`          | An op was scheduled for retry.                          |
| `sync.queue:action:full`     | Pending op queue is near capacity (500 ops).            |
| `sync.error:action`          | A sync operation failed (retryable or permanent).       |

### Read Path Hooks

| Hook Key                        | Description                                                  |
| ------------------------------- | ------------------------------------------------------------ |
| `sync.pull:action:received`     | Remote changes were received from the server.                |
| `sync.pull:action:applied`      | Remote changes were successfully applied to local DB.        |
| `sync.pull:action:after`        | A pull cycle finished.                                       |
| `sync.pull:action:error`        | Failed to apply remote changes.                              |
| `sync.conflict:action:detected` | A conflict occurred (local and remote modified same record). |

### Bootstrap/Rescan Hooks

| Hook Key                         | Description                                       |
| -------------------------------- | ------------------------------------------------- |
| `sync.bootstrap:action:start`    | Bootstrap (initial sync) has started.             |
| `sync.bootstrap:action:progress` | Bootstrap progress update (cursor, pulled count). |
| `sync.bootstrap:action:complete` | Bootstrap has completed.                          |
| `sync.bootstrap:action:error`    | Bootstrap failed.                                 |
| `sync.rescan:action:starting`    | Rescan (cursor reset) has started.                |
| `sync.rescan:action:progress`    | Rescan progress update.                           |
| `sync.rescan:action:completed`   | Rescan has completed.                             |

### Subscription Hooks

| Hook Key                                      | Description                                                   |
| --------------------------------------------- | ------------------------------------------------------------- |
| `sync.subscription:action:statusChange`       | Connection status changed (connected, disconnected, syncing). |
| `sync.subscription:action:maxRetriesExceeded` | Max reconnection attempts reached.                            |
| `sync.stats:action`                           | Periodic sync statistics report.                              |

### Notification Suppression During Bootstrap

**Important:** During bootstrap and rescan operations, sync error notifications are suppressed to avoid overwhelming the user:

- **Sync error notifications** - Not created during bootstrap/rescan
- **Burst suppression** - More than 5 sync errors within 10 seconds starts a 60-second cooldown
- **Deduplication** - Repeated errors for the same record and message are deduplicated within a 15-second window

Sync conflict events (`sync.conflict:action:detected`) are not user-facing at all. They only emit development logs, so loading a workspace for the first time can never produce a "notification storm".

```typescript
// These hooks are useful for showing loading indicators
hooks.addAction("sync.bootstrap:action:start", () => {
  showLoadingState("Syncing workspace data...");
});

hooks.addAction("sync.bootstrap:action:complete", () => {
  hideLoadingState();
});
```

## Implementing a Custom Provider

The sync layer is backend-agnostic. You can implement your own provider (e.g., for Supabase, Firebase, or a custom WebSocket server) by implementing the `SyncProvider` interface.

### 1. The SyncProvider contract

The authoritative interface lives in `shared/sync/types.ts`. Implement `id`, `mode: 'direct' | 'gateway'`, `subscribe` (returning an unsubscribe function), `pull`, `push`, `updateCursor`, and async `dispose`. Subscription callbacks may be async and accept subscription options. Optional methods include `snapshot`, `gcTombstones`, and `gcChangeLog`.

The `snapshotBootstrap` and `historyRetention` capabilities each declare `'snapshot-v1'`. Advertise them only with the corresponding materialized snapshot and retention behavior implemented. A missing retention contract fails closed; an empty pull response is not a bootstrap implementation. Direct providers declare their auth requirement and use `AuthTokenBroker`; gateway clients use the authorized SSR adapter.

### 2. Backend Requirements

To support the OR3 Sync Protocol, your backend must:

1.  **Store Cursors**: Maintain a monotonic "server version" or "cursor" for the workspace.
2.  **LWW Logic**: When receiving a push, compare validation logic:
    - If `incoming.clock > current.clock`: Write.
    - If `incoming.clock == current.clock` and `incoming.hlc > current.hlc`: Write.
    - If both are equal, use the deterministic `op_id` tie-breaker defined by the shared stamp comparison. Do not invent a backend-specific winner.
3.  **Tombstones**: Never hard-delete synced records. Mark them as `deleted=true` so the deletion can propagate to other clients.
4.  **Batching**: Support atomic batches for both reads (`pull`) and writes (`push`).

Push handlers validate each operation before allocating its server version. A
malformed operation returns its own `VALIDATION_ERROR` while valid siblings
continue; logical primary keys and workspace ownership fields cannot be changed
through payload data. Repeated operation IDs are allocated and applied once only
when their complete operation fingerprints match. Conflicting reuse of an ID,
including a conflict with an already-processed operation, returns `CONFLICT`
without consuming another version.

Each operation may carry at most 256 KB of serialized payload data. Oversized
workflow messages are compacted into a bounded cross-device snapshot before
they enter the outbox; the complete workflow state remains in local storage and
the durable background execution checkpoint.

Server push requests are rate limited (`sync:push`: 200 requests per minute).
Client outbox flushing treats HTTP 429 (and 502/503/504) as a deferral, not a
failure: the batch moves back to `retry_wait` with `nextAttemptAt` taken from
the `Retry-After` header, and `attempts` is not incremented. Other transient
failures use `[250ms, 1s, 3s, 5s]` backoff and continue at the capped delay
until recovery; they do not become an abandoned terminal queue. Permanent
validation failures remain visible for repair or support export.

HTTP 401/403 responses stop gateway polling and trigger session refresh. Queued
writes stay in `retry_wait` without consuming an attempt, so signing out or an
expired session does not create a retry/log storm or discard local changes.
Consecutive 401/403 push rejections double the wait from the first retry delay
up to 60 seconds, so a revoked permission backs off instead of re-pushing and
refreshing the session every second; any successful push resets the backoff.

### 3. Build and wire the complete provider

Use the SQLite or Convex provider package as the reference for server registration, atomic writes, subscriptions, snapshots, and cleanup. A stub with only `subscribe/pull/push` is not a working provider. For a gateway backend, register its `SyncGatewayAdapter` and workspace/admin stores in a Nitro plugin; add that plugin through a thin Nuxt module. For a direct backend, register its client provider and token-broker requirement.

Verify duplicate `op_id` replay, rejected identity/workspace fields, monotonic workspace versions, deterministic LWW ties, remote-apply suppression, offline outbox recovery, expired-cursor snapshot recovery, and teardown before enabling it on real data. Preserve snake_case wire payloads and one cursor per workspace.

---

## Troubleshooting Sync Issues

Use the central [sync diagnostics](/documentation/cloud/troubleshooting#sync-issues)
for missing changes, slow bootstrap, repeated warnings, and rescan loops. Check
the selected backend's requirements; a Convex URL is needed only for Convex.
Recovery follows the [pull retention contract](/documentation/cloud/sync-layer#pull-retention-and-snapshot-recovery),
not a fixed cursor-age limit for snapshot-capable providers. Preserve pending
local writes during diagnosis.

## Repeatable performance measurements

For repeatable local measurements, run:

```bash
bun run sync:outbox:benchmark
bun run sync:snapshot:benchmark
bun run sync:benchmarks:check
bun run performance:workspace:check
```

The outbox harness seeds superseded writes and verifies bounded 50-operation
batches, deterministic coalescing, and a fully drained queue. The snapshot
harness installs 50,000 materialized rows in 300-row pages and verifies the row
count and replay watermark. Override fixture sizes with
`OR3_BENCH_OUTBOX_RECORDS`, `OR3_BENCH_OUTBOX_REVISIONS`,
`OR3_BENCH_SNAPSHOT_ROWS`, and `OR3_BENCH_SNAPSHOT_PAGE_SIZE`.
Both harnesses enforce wall-time and throughput regression budgets and write
versioned JSON reports under `output/performance/`. Override runner-specific
budgets with `OR3_BENCH_OUTBOX_MAX_DRAIN_MS`,
`OR3_BENCH_OUTBOX_MIN_OPS_PER_SECOND`,
`OR3_BENCH_SNAPSHOT_MAX_APPLY_MS`, and
`OR3_BENCH_SNAPSHOT_MIN_ROWS_PER_SECOND`. `bun run performance:check` also
enforces a populated-workspace profile (1,200 threads and 14,400 messages by
default), command-palette budgets, and browser Core Web Vitals. Override the
workspace fixture with `OR3_BENCH_WORKSPACE_THREADS` and
`OR3_BENCH_WORKSPACE_MESSAGES_PER_THREAD`; the workspace benchmark stays
bounded and does not create large browser quota fixtures. CI also builds the
production application and enforces total/largest compressed and uncompressed
JavaScript and CSS budgets. The harnesses retain versioned JSON reports under `output/performance/` for regression review.

`bun run test:e2e:workspace-scale` separately measures the real browser chat-search
loader and index with 1,000/10,000 chats, a 5,000-message conversation, reference
branches, legacy ordering-key omissions and unused tool payloads. It uses disposable
IndexedDB databases without switching or modifying the active workspace. It checks
complete result coverage, bounded row transfers, cancellation and a source heartbeat
budget, and attaches timings and sidebar read counts under `test-results/workspace-scale`.
Use `OR3_SCALE_CPU_RATE=4` for the slower-CPU profile; `OR3_SCALE_MAX_GAP_MS`
overrides the 150 ms source heartbeat budget. These are development-server owner
measurements, not production INP, storage-quota limits or long-session leak qualification.


## Related

- [Notifications](/documentation/cloud/notifications) - Notification system that integrates with sync
- [Auth System](/documentation/cloud/auth-system) - Authentication required for sync
- [Troubleshooting](/documentation/cloud/troubleshooting) - General troubleshooting guide
- [Hooks](/documentation/hooks/overview) - Hook system for sync events

## Device-only state and pull failures

Incremental application and server push admission reject the built-in device-only KV names (`openrouter_api_key`, `MODELS_CATALOG`, and `workspace.manager.cache`). Client plugins may add names through `sync.kv:blocklist`; they cannot remove the built-in exclusions. Remote deletes also preserve these rows. Malformed pulled records abort the apply transaction and leave the cursor unacknowledged, allowing repair and retry instead of silently skipping history. Cursor advancement and completion timestamps are persisted atomically; ordinary advancement cannot lower a cursor.

## Restart continuity

Server maintenance may briefly defer gateway operations. Keep the existing outbox IDs and workspace binding; reconnection must use the normal idempotent push path, without resetting cursors or manufacturing replacement operations. See [server restarts](/documentation/cloud/operations).

### Completed tool output chunks

Large tool results use the existing workspace KV wire schema with the
`chat.tool-result:<encoded-thread>:` name prefix and content-addressed row IDs.
Each chunk stays below the sync row limit after JSON escaping. Foreground writes
use normal atomic outbox capture; background providers that implement
`retainChatToolResult` authorize the admitted generation, bind the supplied call ID
and reference to the exact chunk contents, and atomically allocate contiguous versions
for new chunks (older providers keep results inline). Replay
must preserve the existing bytes and must never resurrect a retained tombstone.
The tool message carries a versioned reference with a SHA-256 checksum. Server-side
recovery may use the optional `readChatToolResult(actor, { admission, callId, reference })`
to authorize the live parent and verify the complete call-bound artifact in one snapshot.
It rejects confirmed missing or corrupt chunks with `TOOL_RESULT_UNAVAILABLE`;
authorization and transient storage errors must use a different error code so
recovery can retry them without inventing a terminal result.
Readers reject incomplete sync or corrupted content and can retry after synchronization.
Thread hard deletion owns cleanup; retain chunks while their chat history remains.

Durable delegation additionally requires the server sync adapter to advertise
`delegationTerminalHistory: 'v1'`. When a terminal generation snapshot includes
`expectedWorkspaceRevision`, the adapter must compare it with the current workspace
version in the same transaction as finalization, and return a retryable failure
without writing a receipt if they differ. A snapshot with
`onlyIfThreadUnavailable: true` must also check in that transaction that its
parent thread is missing or deleted. If the thread is available, return a
retryable failure without writing a message or receipt. If it is unavailable,
record a superseded finalization receipt without writing the parent message.
An existing finalization receipt is replayed before these checks, so a crash
after commit remains idempotent. Both fields are write preconditions rather than
part of the result identity: receipt fingerprints exclude them while continuing
to bind the admission and terminal content. A retry may therefore replay the
same result after a later workspace edit, but cannot substitute different content.
This capability is part of the in-development delegation contract; currently
released adapters do not advertise it.

## Durable recovery and account ownership

Each authenticated principal has independent local feed coverage within the shared workspace database. Account switches restart incoming sync even when the workspace is unchanged; notification snapshot replacement preserves other principals’ local rows and deletion watermarks. Rapid workspace changes serialize teardown and fence stale startup work before it can publish an outbox or subscription. A changed session authorization revision restarts transport for the same scope. Route pauses such as Admin keep local write capture on the active database; leaving the workspace or account releases it.

Snapshot replay always applies authoritative changes after the snapshot watermark, including recently acknowledged local operation IDs. An acknowledgement received while snapshot pages were in flight cannot make the local echo cache suppress the only surviving copy of that write. Half-open circuit probes retain their ownership throughout bootstrap and replay. Incoming subscriptions continue retrying with capped backoff through long outages.

Outbox ownership uses atomic IndexedDB claims shared by every tab. Claims expire after 60 seconds; request waits end after 30 seconds. Every acknowledgement, remote-winner application, tombstone update and retry settlement checks the still-live claim token in its write transaction. A second tab cannot steal a live request, and a suspended former owner cannot recreate an acknowledged operation. Existing open tabs recover expired claims automatically. `claimId`, `claimExpiresAt` and `readyAt` remain local and are stripped from provider submissions.

Malformed revisions are quarantined before coalescing. An invalid operation is isolated so healthy siblings still sync. Oversized message content remains committed locally with a durable failed intent and support export; it does not abort the local message save. Snapshot recovery preserves valid local content even when it exceeds the wire size limit. Notification edits and file restores advance above retained row and tombstone revisions despite clock skew.

Providers accept optional `SyncRequestOptions.signal` on `pull`, `snapshot`, `push` and `updateCursor`. First-party transports bound their waits and fence cancelled completions. A cancelled or timed-out mutation may already have committed remotely; retries reuse its operation ID. Gateway disposal aborts outstanding control requests, including stalled response bodies. `/api/sync/snapshot`, `/api/sync/update-cursor`, `/api/sync/gc-change-log` and `/api/sync/gc-tombstones` reject bodies over 8 KiB with HTTP 413 before session lookup, for declared and streamed bodies.

Run `bun run test:e2e:sync:cloud --development-providers` for disposable Basic Auth + SQLite + filesystem verification. The Chromium cases persist edits and upload intent offline, reopen the browser tab, lose an acknowledgement after a real server commit, crash the owning renderer, and verify automatic recovery by an already-open peer after the real claim expiry. Browser traces, screenshots and JSON receipts are written under `test-results/sync-hardening-cloud/`.

## Structured recovery failures

Sync providers must return `errorCode` for failed push results: `VALIDATION_ERROR`, `OVERSIZED`, or `UNAUTHORIZED` mark an operation permanent; `RATE_LIMITED` defers it. Transport failures should expose HTTP `status`/`statusCode` and `retryAfterMs` when available. Whole-request 400, 413, and 422 failures are split into individual operations; a single operation rejected with 400, 413, or 422 is retained as permanent. Unstructured failed results remain retryable. The narrowly recognized SQLite
`CONFLICT` reason for reuse of an already processed `op_id` is held for recovery;
other conflict text does not make an operation terminal. Generic `CONFLICT` and `NOT_FOUND` results keep retrying without charging the shared outage breaker. Per-operation `RATE_LIMITED` results also leave the breaker healthy and defer without incrementing attempts; transport and server failures still count toward the outage budget.

Background history adapters should throw errors with `status` or `statusCode`, a structured code (`VALIDATION_ERROR`, `OVERSIZED`, `UNAUTHORIZED`, `FORBIDDEN`, `CONFLICT`, `SUPERSEDED`, or `UNSUPPORTED`), or explicit `retryable: false` for a permanent history failure. HTTP 408, 429, and 5xx are transient. Unknown or legacy unstructured errors remain pending for retry, even if their wording resembles a permanent failure. Providers that only throw strings or plain errors must add metadata to retain permanent-block behavior.

A shared workspace/provider circuit breaker limits retries. Half-open probes have
owned, expiring leases: stopping or cancelling an attempt releases its lease,
and late results from that attempt cannot settle a replacement probe.

Outgoing operations freeze their sanitized wire payload durably before the first
send, preserving UUID intent through retries and lost acknowledgements. Existing
complete legacy payloads keep their previous normalization. Previously attempted
legacy threads whose send-time timestamps cannot be recovered are held in the
existing sync quarantine for export and explicit recovery. An explicit processed
UUID identity-reuse rejection or malformed server winner also holds only that
operation, preserving local content and winner evidence; healthy siblings settle.
These content failures do not consume the provider outage budget. Other provider
conflicts retain their existing retry behavior.

Snapshot downloads retain their staged prefix while retrying the same page/token
on HTTP 429, temporary service/network errors, or request timeouts. Backoff is
cancellable and capped at 30 seconds, with Retry-After as a minimum and the
one-hour snapshot lifetime as the total bound. Invalid/expired identities (410)
escape to a new recovery attempt. Non-transient chain, authorization or storage
failures pause recovery for a deliberate retry. Staging still installs only as
one complete atomic chain.

Sync observations (bootstrap/rescan phases, push before/after, queue/retry, pull
received/applied/error, conflicts, permanent-error notifications and subscription
diagnostics) wait at most 250 ms: observer completion does not gate sync. Listeners
are invoked in priority/registration order without awaiting earlier completions.
One unresolved invocation per callback/action/engine is retained. Only that busy
callback drops overlapping events until it settles, without queued replay. Other
ready callbacks, including async listeners, receive each event. Synchronous
suppression/invalidation callbacks run on every event, so start precedes complete
and cache/search invalidation follows the data commit even behind a hung observer. Observers must capture and
guard scope before awaiting; a timeout cannot cancel their side effects. Cancelled
subscription/outbox batches do not initiate further observations. Protocol
persistence, page receipts, pending-op capture and filters remain awaited.


### Stored-record push holds

Updated clients advertise `storedRecordCapability: 'stored-record-v1'` on push.
This is distinct from pull/snapshot `unavailable-v1`, which older clients already
advertise without understanding push holds. A provider encountering unreadable
stored receipts, winners or ownership returns HTTP 426 `OR3_SYNC_UPDATE_REQUIRED`
with `requiredCapability: 'stored-record-v1'` to an unsupported client.

Supported mixed batches return an independent result per operation. A held result
is `{opId, success:false, errorCode:'STORED_RECORD_UNAVAILABLE', evidenceRef, error}`:
`evidenceRef` is a nonempty opaque server reference of at most 128 characters;
`error` is a fixed non-secret reason of at most 160 characters. No stored payload,
winner, replay success or fabricated revision is returned. Healthy siblings commit.
The provider must preserve both original stored bytes and rejected intent before
returning the reference; database/storage outages remain service errors.

The outbox atomically moves the original intent, UUID, local row/tombstone, reason
and server reference into existing local quarantine (`variant:'stored_record'`).
Attempts do not increase, the operation is not retried or assigned a new identity,
and the result does not penalize the service breaker. The existing Saved changes
section displays these holds for inspect/export and deliberate discard. Stored
record holds require manual review/repair using the exported server reference;
no automatic recovery put is offered. Retry all affects active outbox work only.

For the hardened Convex candidate, export a hold's `evidenceRef` through the
privileged `sync.unavailable.export` action. The exported intent links to the
original stored source through `evidence_ref`; both survive GC, snapshot expiry
and history reset. Unknown-owner notification evidence stays private; known
foreign owners are denied without returning content or evidence references.
Convex also bounds push point-read/evidence work: remaining operations receive
retryable `RATE_LIMITED` deferrals when the transaction budget is exhausted.
These deferrals allocate no versions and do not fabricate unavailable holds.

## Older servers and separate browser stores

This tab sends `x-or3-cloud-intent: mutation-incarnation-v1` on existing Cloud
mutations. Published 0.1.116 rejects that value before dispatch. The current
server accepts exactly `mutation` and `mutation-incarnation-v1`, with the same
origin, JSON and bearer checks. Sync push, pull, snapshot, ACK and events keep
their independent incarnation checks; there is no retry with a legacy header.

An exact old intent refusal pauses sync before session-invalid cleanup. A
successful response with a missing/malformed incarnation pauses with
“The server does not support this tab's sync protocol”; it does not prove rollback.
Network failures and intermediary HTTP errors use bounded transport retries;
an unrecognized proxy 401/403 preserves the session without a durable protocol
pause. Recognized application authentication refusals retain normal auth handling.
The protocol pause is durable and shared with same-account workspace followers. It does
not reset cursors, settle operations, spend retries, clear browser data or sign
out. Local edits, drafts, blobs and held evidence remain saved. “Check server
again” reconnects through checked discovery; only a valid current contract can
release the captured pause. A newer follower refusal also fences an in-flight
connection before it can report connected. A later history J still requires the existing atomic
snapshot/hold transition regardless of numeric catch-up. Old responses and
connection handles stay fenced, including the in-place history rebind.

When the server is known to be older, the browser says:

> The server is running an older version, so sync in this tab is paused. Your local changes are still saved. The older app uses separate local stores and may not show these changes. Do not clear browser data. Export important work, or review saved changes after the server is upgraded again. Changes saved by an older tab can be inspected separately; they are never merged automatically.

In Workspace → Sync status, “Changes saved by an older tab” explicitly inspects
and exports up to 100 native legacy entries per batch. The database/store/schema
identity and unknown origin accompany each export. Close older tabs first:
these are partial live reads, not a certified complete snapshot. Current
workspace authorization is checked before and after reads; other-account and
unknown-account private notifications/drafts, local-only KV and unclassified
private evidence stay in place. Queued payloads explicitly naming another
workspace or account are excluded even when their wrapper is local. An attachment export revalidates its authorized
structured attachment reference and verifies the bytes against its stored hash.
A hash quoted in ordinary text does not authorize attachment bytes. Failed exports
never remove their source. No legacy store becomes a normal writable accessor,
and no inspection opens a version upgrade or automatically imports/replays data.

Held inspection/export stays available while paused; retry-all excludes held
work and paused tabs cannot retry queued changes or recover held puts. After
checked reconnect, deliberate supported recovery still validates current
parents, permissions and history and creates a fresh action. Unsupported kinds
and deletes remain exportable for manual review. Old bundles using their legacy
stores have legacy behavior during rollback, not incarnation-certified holding.
