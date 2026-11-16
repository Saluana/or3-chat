# Sync write and unavailable-record contract (v1)

This is the matched host/SQLite contract. Activation requires host and provider
qualification; an old provider is not assumed to implement it.

## Write preparation

`prepareSyncWrite(input)` is exported from `shared/sync/prepare-sync-write.ts`
(provider import `~~/shared/sync/prepare-sync-write`). Input is `{tableName, pk,
operation: 'put'|'delete', payload?, stamp: {deviceId,opId,hlc,clock}}`.
It returns the same envelope with a deterministically normalized wire payload,
or throws `SyncWriteError` with `code: 'VALIDATION_ERROR'|'OVERSIZED'`.
No wall clock, randomness, database access or truncation is used. Snake-case and
existing field mappings run before reader payload validation. Final persisted
metadata must agree with the stamp and logical key. Only threads, messages,
projects, posts, file_meta, kv and notifications are writable. Identifiers must
round-trip through UTF-8: reject lone surrogates, preserve NUL, colon, CJK and
supplementary scalars. PK admission remains 1–1,024 UTF-16 code units.
Delete validates its envelope and optional object payload without requiring a
live row, preserving the payload's exact keys and values. Do not normalize delete
metadata: old receipts fingerprinted it verbatim, including camel-case fields.
Put validates the applicable TABLE_PAYLOAD_SCHEMAS reader contract and key.
The final serialized payload must fit MAX_SYNC_PAYLOAD_BYTES (256 KiB). Clocks,
assigned versions and increments must be nonnegative safe integers (versions
positive); `nextSyncClock` rejects exhaustion before mutation. HLC grammar is
unchanged. SnapshotRevisionSchema still accepts nonempty legacy op IDs; new
write ChangeStampSchema requires UUIDs. Sinks prepare after adding metadata and
before allocating/writing row, log, receipt or counter, within their transaction.
Early background admission also prepares before durable job acceptance.
The background envelope parser validates without rewriting its records: existing
admission/finalization receipts hash that envelope. New-job preparation normalizes
before sanitization; provider replay checks must precede transformations of an
already persisted envelope or write intent. Legacy admission messages without
`order_key` remain parseable using a validation-only derived ordering value;
do not add that value to their stored envelope or receipt hash.

## Durable unavailable records

Pull adds optional `unavailable: PullUnavailableRecord[]` beside `changes`.
Each marker has `{tableName,pk,originalKind:'put'|'delete',serverVersion,
evidenceRef,reason}`. serverVersion is required, trustworthy, positive and safe.
Snapshot adds optional `unavailable: SnapshotUnavailableRecord[]` beside `items`.
Each marker has `{tableName,pk,originalKind:'row'|'tombstone',snapshotId,
highWatermark,evidenceRef,reason}` matching the enclosing page identity.
Keys are nonempty lossless identifiers; unknown table names may be identified
for incoming evidence but never used as DB transaction scopes. evidenceRef is a
nonempty opaque reference (at most 512 code units); reason is a sanitized,
non-secret diagnostic code/text (at most 256 code units), never raw content.
A corrupt revision need not be forged into a valid stamp.

Valid entries and markers share one scanned-window count and serialized byte
budget: at most requested limit/pageSize, at most 1,000 entries and 2 MiB JSON per
response. Never truncate markers while advancing past their records. Versions
are unique and ascending across the merged pull window, exceed request cursor
and do not exceed nextCursor. All-invalid windows advance. Snapshot entries and
markers merge by their original kind, have unique logical keys and obey the
same ordering across the full chain. A final all-invalid page completes.
Untrustworthy version, ordering, snapshot identity or logical key is a coverage
failure: fail the page, never invent a skip. Auth, storage and quota errors also
fail the operation. Whole-response structural validation remains mandatory.

Provider reads contain defects before JSON SQL evaluation or large payload
allocation, including snapshot capture. Before emitting a marker, persist the
original bytes/metadata once per source revision, workspace, source locator,
reason and resolution state. Evidence survives ordinary log GC and snapshot
expiry; never truncate/drop unresolved evidence. Oversized evidence is retained
without loading it whole into JavaScript. Notification visibility stays
fail-closed: no other-user/unknown-owner key or payload appears in markers.

Gateway `capabilities.unavailableRecords: 'v1'` advertises this durability
contract. `retainUnavailableRecord(event, {scope,source,record,marker})` is the
host fallback for reader-discovered faults; it returns `{evidenceRef}` only
after durable retention and authorized identity verification. Without that
method/capability the host fails closed on a malformed provider row. Source is
`'pull'|'snapshot'`; marker omits evidenceRef; record is the original entry.
Already supplied markers pass through final validation. The browser sends
`unavailableRecordCapability: 'unavailable-v1'` on pull/snapshot. Before any
partial/unavailable page or changed-order snapshot is returned, an incapable
reader receives HTTP 426 with code `OR3_SYNC_UPDATE_REQUIRED` and
requiredCapability `unavailable-v1`, following existing update-required gates.
Gate changed-order snapshots when the provider advertises this contract;
healthy old-provider pages remain usable. Direct backends require separate
matching deployment qualification.

Clients classify defects before constructing Dexie scopes. Classification
accepts legacy messages without `order_key` when the existing
client can derive it from the revision HLC. Validate this derived view without
rewriting the original payload, stored history or replay fingerprints.
Incoming evidence uses a distinct quarantine variant, never outbox reconstruction. Pull commits
evidence before advancing/ACKing, even on all-invalid pages. Snapshot stages
markers, then in the existing single atomic install preserves affected local
rows, tombstones and pending intent, records unavailable state/evidence and
installs the watermark. Preserved copies are explicitly uncertain, not confirmed
server winners and not auto-enqueued. Consumed stage rows are deleted in the
same transaction. Quota leaves the old dataset/cursor intact and pauses recovery
until explicit retry/storage recovery; it must not restart a download loop.

Operators must be able to inspect/export/revalidate/repair durable evidence.
Repair of current content uses a fresh UUID, a valid winning revision and a new
server version through the normal writer transaction. Superseded history is
marked superseded, never replayed over a healthy newer winner. No invented clock
reset for an unrepairable revision.

## Ordering and bounds

Compare `(table_name, pk, kind)` component by component using lexicographic
UTF-8 bytes, prefix-shorter-first. Compare logical keys as two components, never
NUL/colon concatenation. SQLite BINARY matches for lossless scalar strings.
New admission does not rename historical identifiers.

For admitted PKs, JSON escaping costs at most 6 bytes per UTF-16 code unit:
6,144 bytes. Workspace and snapshot-owner IDs allow 256 code units each (3,072 escaped bytes),
table/kind and token envelope have a conservative 2,048-byte reserve. Native
base64 JSON therefore needs at most ceil((6144+3072+2048)/3)*4 = 15,020
characters. Percent-escaped JSON then base64 (Convex) is bounded by three times
that: 45,060. Shared MAX_SYNC_SNAPSHOT_TOKEN_LENGTH is 65,536; the snapshot
request body ceiling is 128 KiB, covering even a maximum-length 65,536-character ASCII token, two 256-unit scope
IDs, 50 table filters of 128 units and capability/envelope overhead. Readers do
not shorten legitimate existing keys. Provider token decoders (native/D1 and
Convex) must use the same bound. Truly larger legacy identities require explicit
durable recovery, not silent truncation. Host request/response schemas and body
decoder must change together.

## Provider checklist

- Import prepareSyncWrite/nextSyncClock at generic and internal final sinks;
  maintain atomic row/log/receipt/counter and stable replay fingerprints.
- Advertise unavailableRecords only with durable, authorized evidence storage,
  earliest-read containment and operator inspect/export/revalidate/repair.
- Return the exact marker shapes above; account healthy and unavailable entries
  together; keep complete coverage and all-invalid progress/completion.
- Guard notification JSON/ownership before capture; never expose unknown owners.
- Keep evidence independent of log/snapshot GC, bounded metadata-first reads and
  transactional new-ID/winning-revision/new-version repair.
- Use component-wise UTF-8 SQL seek/sort and shared 65,536 token ceiling in every
  decoder. Qualify CJK, supplementary, prefix/NUL and 1,024-unit keys.
- Test against this host contract before activation; Convex needs its own
  generated-backend compatibility qualification.

## Provider checklist (incarnation)

S3 must implement `SyncGatewayAdapter.capabilities.historyIncarnation: 'v1'` only
for the qualified native SQLite lane. Add `getHistoryIncarnation(event, scope)`;
read a valid singleton, never mint identity on ordinary reads/startup. Requests
carry `historyIncarnation` at envelope level (outside operation fingerprints).
Push and `updateCursor` recheck it inside their mutation transaction **before**
receipt replay, allocation, writes or ACK timestamp refresh. Return structured
409 `OR3_SYNC_HISTORY_CHANGED` with current token and `requiresSnapshot:true`.
Pull null/mismatch returns an empty recovery envelope with retention metadata
before payload decoding. Every successful pull/snapshot/push carries its bound
`historyIncarnation`; watcher callbacks carry `{historyIncarnation, version}`.
Snapshot continuation tokens bind incarnation and reject pre-reset tokens even
when presented with the new token. `retainUnavailableRecord` receives the bound
history; namespace evidence revisions by history and fence explicit repairs.

Migration 036 (or next unallocated) initializes `sync_history` once, invalidates
old device/snapshot state, and preserves unavailable evidence. Managed offline
reset uses `/app/scripts/docker/sync-history-reset.mjs`: one transaction rotates
the existing singleton and deletes all device cursors/snapshot headers/items.
The helper's image profile **must remain unqualified** until the packed provider,
matching host, native driver and exact migration history pass the real lifecycle
suite. At that point qualify `backup-inspection-profile.json` with
`historyIncarnation:'v1'` and exact `historyMigrations`, reconcile published pins
and accepted inspector histories together. Current 0.0.30 and S2 advertise no
capability and fail closed with `OR3_SYNC_HISTORY_UNSUPPORTED`. D1 and direct
Convex remain separate qualification lanes. No publication is performed here.


### Proven first binding

Only a workspace DB created under the protected-store contract receives
`sync_state['sync_history'].firstBindEligible: true`, in its IndexedDB creation
transaction. Missing/false is ineligible; null identity and cursor zero are not
proof. Upgrade/open/ready never grant eligibility. Capture starts at app workspace
activation, before startup preferences or offline edits.
Discovery and private staging preserve the proof, including across restart and
reset-target changes. Guard reads, CAS comparisons and rewrites include it.

A complete first snapshot may adopt that proven local authorship with existing
LWW replay: puts, edits, deletes and offline conversations, with streaming rows,
drafts and attachment state retained. IDs, revisions and failure statuses remain
unchanged; permanent failures are not re-enabled. The single install transaction
consumes the flag even for an empty snapshot at watermark zero. A later I→J
replacement and every unmarked legacy DB still hold all old/unknown intent;
previously held evidence is never automatically recovered. Writes during staging
are included. Abort/quota preserves the proof and original data atomically.

Remote canonical/winner application (including background-job hydration), any scope's nonzero cursor, a snapshot in
an unsupported identity lane and unclassified imports invalidate eligibility in
their transaction. Unfenced push and upload commit (which writes canonical sync metadata) invalidate durably before dispatch, including
lost-response outcomes. Legacy JSON import includes proof consumption, replacement clearing and data in
one transaction and strips imported eligibility, so imported history cannot grant the birth proof.
Deleting/resetting cursors or losing the guard never grants it again. Push/ACK
remain closed until the checked installation is ready. A locally authored DB
created while I exists can first bind J without resurrecting I-derived state.

### Browser activation boundary

Schema 32 performs a one-time atomic physical-store migration inside the same
`or3-db-${workspaceId}` database. All stores move to `current_<logical-name>`, preserving exact rows and indexes.
All 19 stores use native IDB store renaming in place, including large
content-addressed `file_blobs` payloads. No user rows are copied or doubled.
This protects attachment/transfer metadata, local-only KV, drafts, staging,
cursors/guard, outbox, tombstones and recovery evidence together. Blob bytes are
not duplicated. Renaming them also prevents an old deletion from seeing empty
reference sinks and deleting bytes still needed by current held attachments.
App table accessors, backup table names and wire entities remain logical names.

Dexie 4.4.6 retries VersionError, then can recreate missing legacy stores during
its schema patch (`dexie.mjs:4561–4567`, `patchCurrentVersion:3763`). Old clients
may reopen/write these isolated sinks. They cannot reach current state or publish
through a current outbox. New opens tolerate the extra stores without schema
ping-pong; no new reader, coalescer, importer or automatic replay consumes them.
The P0-5.9 ordinary acceptance test uses frozen actual v31 schema/hooks and
checks repeated coexistence, current state and provider publication. Failed or
blocked upgrade preserves every original row. Failed opens pause automatic
reopen and show explicit retry/storage guidance; blocked upgrades wait for tabs.
An accessible themed progress state announces active migration. Recovery state
is retained independently for concurrent workspace upgrades.

Sink detection emits one bounded diagnostic per connection: **Changes from an
outdated client; origin unknown**. A read-only sink inspection/export and deliberate
discard surface is a follow-up; automatic recovery is forbidden. Existing held
history recovery remains account scoped and excluded from Retry all. Per-op
provenance tags are deferred: the physical namespace supplies writer exclusion.
The matched provider/image/browser lifecycle still needs separate qualification;
provider and generated image profiles remain unqualified until that is complete.

The image reset helper reads `backup-inspection-profile.json`: activation requires
`historyIncarnation: 'v1'` and exact `historyMigrations`, bound to the packed runtime
and inspector's accepted historical migration sets. `prepare-backup-inspection.mjs`
currently emits `unqualified`. Extend the existing allowlists after packed-provider
qualification, preserving older accepted histories. The post-reset semantic audit
must echo the installed token; a generic healthy result cannot certify replacement.


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


### Convex matched implementation and activation boundary

The hardened Convex candidate implements unavailable-v1, incarnation-v1 and
stored-record-v1 in direct and gateway modes against matching deployed templates.
Published 0.0.26 remains incapable; a package version/capability alone is not
backend qualification. Deploy the updated schema/functions, verify the exact
backend digest and explicitly initialize history once before enabling the host.
Ordinary deploy/restart/GC preserves identity. Complete replacement requires
writer isolation and the external prepare/complete journal; hot or partial
imports are unsupported. Public operational instructions are in
`public/_documentation/cloud/provider-convex.md`.

Checked pull is a mutation; version subscriptions carry no record content and
direct page receipts precede cursor advancement. Stored-hold export retains
exact intent with an evidence_ref link to original source, independent of GC,
snapshot expiry and reset. Push reserves bounded source/evidence work and defers
remaining operations as RATE_LIMITED without fabricating coverage or holds.
Local backend/lifecycle/HTTP qualification does not certify live Clerk/browser
flows or hosted/full-storage replacement; whole-ZIP generated-schema import
remains a separate unresolved backend qualification limit.
