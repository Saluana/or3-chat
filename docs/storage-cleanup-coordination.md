# Filesystem cleanup coordination: remaining implementation

## Status and boundary

The accounting patch is a safe partial deliverable, not completed reclamation.
Physical filesystem deletion and GC remain disabled. Read-only observations and
refusal tests cannot establish that a deleting collector is race-safe.

The dormant host foundation now defines the trusted-server generation contract
in `server/storage/gateway/generation-lifecycle.ts` and a strict pairing guard in
`server/utils/storage/generation-coordination.ts`. It requires independently
advertised external-generation support on both providers, valid matching provider
IDs and the complete coordinator API. Existing native Convex deletion support
and retained-metadata accounting do not satisfy this gate. No route calls the
guard and no provider advertises the new flags. These types are not a public
upload receipt or authorization to invoke lifecycle methods.

The paired prototype must keep irreversible claims and immutable identities;
there is deliberately no release or expiry-to-writable operation. Canonical
reference/metadata activity restarts retention using server time, and bounded or
malformed proof must block collection. Registration accepts only independently
verified server-owned publication evidence; public authenticated dispatch and
generation-bound upload intent handling remain separate integration requirements.

### Dormant generation-bound upload extension

`server/storage/gateway/generation-upload.ts` adds a separate, optional upload
trait without changing the original generation-v1 states. The qualifier in
`server/utils/storage/generation-upload-coordination.ts` checks the explicit
version, provider identity and every required method. Neither registers a
provider, adds a route, advertises a runtime capability or enables cleanup.

The companion implementation is scoped to explicitly constructed, default-off
factories and isolated tests:

1. The current session and `workspace.write` authorize a permanent, owner-bound
   allocation. The canonical backend reserves quota in the shared legacy-visible
   ledger and fences its pending hash against unbound older writers.
2. Only the exclusive filesystem slot creator can initialize a durable payload
   and readiness receipt. A signed generation token is issued only after this
   receipt is recorded. Distinct operation/audience/version claims prevent token
   replay against legacy mutable-path upload endpoints; the token also binds the
   user, workspace, namespace, provider, generation, intent, hash, size and MIME.
3. Server-owned verification, not a client receipt, permits atomic canonical
   publication. Credential expiry is separate from the accounting hold. The
   hold persists until exact live canonical metadata transfers it atomically,
   including when a message/post references the generation before metadata.
   Older consume/cancel/expiry/delete/replace writes cannot release that hold.
4. Ready-but-abandoned uploads require a distinct irreversible claim and durable
   authorization read. If already published, the same transaction also claims
   the real generation after proving no live metadata or references. An
   incomplete/pre-ready allocation remains retained: a paused initializer could
   otherwise resume after an absence observation and create new bytes.

Recovery listing is bounded observation, never unlink authority. Exact historical
replays must not revive expired credentials, a claimed generation or a retired
payload. `reserveGenerationRestore` admits a fresh quota hold for the exact
verified target after its old charge transferred to metadata; it creates no
upload credentials or new blob. A matching guarded metadata write consumes this
hold atomically. Without it, a restore must fail closed only for these newly
enrolled bindings. The current client restore does not yet make this authenticated
ticket roundtrip, so runtime integration remains incomplete and disabled.
Existing unmanaged behavior is unchanged.

This is an upload-admission guarantee, not an absolute quota guarantee across
unmanaged legacy writers. Legacy/raw metadata restoration can still change that
workspace's usage outside the new reservation path. Full activation requires an
explicit compatible writer/cutover policy, generation-aware restore admission,
all upload-serving instances upgraded, and outstanding legacy tokens accounted
for. A capability flag cannot stop an older filesystem server issuing tokens or
writing legacy paths. No auto-adoption, live migration or runtime activation is
part of this extension.

The inspected download consumers remain session-authorized: the browser transfer
queue sends credentials, cloud verification forwards its session cookie, and
model attachment preparation downloads to local blobs before encoding data URLs.
Background generation reuses those prepared request messages. No anonymous
external-model fetch or unauthenticated server fetch of a filesystem URL is
qualified. Generation download credentials bind the current reader, not the
original uploader; the handler must recheck live metadata and `workspace.read`
through the provider-aware session resolver rather than require a particular
cookie implementation. Upload authorization is checked at request entry;
canonical publication requires a fresh authenticated commit request. Cached
request sessions are not an immediate mid-stream role-revocation guarantee.

Current filesystem uploads atomically rename temporary bytes onto a reusable
workspace/hash pathname. Commit writes a sidecar; canonical file metadata arrives
later through client sync. A database scan or lease plus a final reference recheck
cannot prevent a restore, new reference or upload between that check and unlink.
A paused worker can resume after its lease expires and delete replacement bytes.
An inode check followed by pathname unlink has the same check/use race.

Native Convex storage already has its own transactional deletion claim and
storage-object verification protocol. That protocol does not coordinate external
filesystem bytes; native deletion skips external provider rows. Preserve it.
The host's existing deletionCoordination v1 gate must not be advertised merely
because a provider implements accounting or a proposed external lifecycle API.

## Next bounded change: dormant external generation lifecycle

Add a separately versioned, paired capability for the canonical and filesystem
providers. Keep it unadvertised/disabled for runtime deletion until all acceptance
gates below pass. Missing or mismatched support fails closed.

1. Add durable canonical generation state scoped by workspace, provider, hash
   and immutable generation ID. Define uploading, committed, deletion-claimed and
   deleted states; store one-time upload intent, claim identity and durable
   operation result. Generation IDs and object paths are never reused.
2. Allocate an authorized upload generation/reservation transactionally. Bind its
   ID, hash, byte count, workspace, user and expiry into signed upload credentials.
   Publish verified bytes to its immutable generation path without overwriting a
   previous generation. Old tokens cannot publish current or claimed generations.
3. Add verified upload publication to the sync-provider lifecycle API. Sidecar
   creation alone is not canonical commitment. A crash between filesystem and DB
   publication leaves a durable, recoverable incomplete generation. Never clear a
   deletion barrier solely because a caller supplied a hash or storage ID.
4. Enforce generation binding inside the same canonical transaction as every
   metadata restore and live reference write, including ordinary push and
   server-authored mutations. Derive references from canonical messages/posts;
   do not sync ref_count by LWW. A claim wins only if retention, no live metadata,
   no references and no active upload for that generation are proved atomically.
   When proof exceeds a bounded query budget, defer deletion rather than guess.
5. A physical worker may unlink only the immutable generation named by its
   durable claim. It may never resolve a mutable hash alias at deletion time.
   A newly committed replacement uses another generation, so an expired/resumed
   worker cannot target it. Claim renewal/expiry must not make an old generation
   writable again. Retries and acknowledgements are idempotent.
6. Retain durable deletion state until every stale writer can be rejected.
   Restoration either preserves an unclaimed generation or requires a verified
   replacement upload before admitting its references. Treat absence after an
   interrupted unlink as a reconciliation state, not permission to revive bytes.

Start with host contracts, SQLite transactional state/admission and race tests,
then filesystem signed-generation upload/commit/read and claim-bound deletion
tests. Keep the runtime cleanup gate off. Add external-generation coordination
to Convex separately; its native storage protocol is not a substitute. Other
providers, including S3 and unsupported SQLite runtimes, stay fail-closed.

## Rollout and migration prerequisites

- All app instances and canonical writers must enforce the new protocol before
  enabling claims. A new capability flag alone does not fence an old server.
- A transaction that survives a process crash is not necessarily durable against
  power loss. The current SQLite WAL + synchronous=NORMAL default is insufficient
  for a claim that authorizes durable filesystem removal. The active coordinator
  must verify durable local settings (such as WAL + FULL/EXTRA), refuse unsafe or
  unsupported configurations, and never silently change operator defaults.
  Filesystem publication/removal must synchronize data and parent directories
  before canonical publication/deletion acknowledgement.
- Preserve a permanent, exclusively initialized generation namespace slot after
  removing its payload. Delayed allocation retries must never recreate a retired
  payload directory; normal signed uploads must not create directories. Missing
  storage mounts/namespaces are errors, not successful deletion.
- Fence old clients through versioned admission and expire outstanding legacy
  upload tokens. Prove direct Convex mutations and server-authored writers are
  covered, not just host HTTP routes.
- Legacy workspace/hash paths require an explicit migration/reconciliation plan.
  They remain retained and non-deletable until safely bound to immutable
  generations; do not infer identity from filename, mtime or current references.
- Preserve canonical provider ownership, snake_case wire fields, local-first
  queues, workspace boundaries, can() authorization and static-build gating.
- Deployment, migration execution and cleanup activation are separate operations.
  This design authorizes none of them and adds no manual-unlink workaround.

## Required acceptance evidence

Run production-backed deterministic interleavings against real provider
transactions/filesystem operations, plus multi-process tests where relevant:

- Restore or new reference wins before claim: claim is refused and bytes survive.
- Claim wins: stale restore/reference admission is rejected; replacement can be
  admitted only after verified new-generation publication.
- Upload, commit and collection overlap: old tokens cannot overwrite/revive a
  claimed generation or delete a successor; duplicate commits are idempotent.
- A worker pauses past claim expiry and resumes after hash reuse: only its old
  immutable generation can be affected.
- Crash before unlink, after blob unlink, after sidecar unlink, and before DB
  acknowledgement: restart/retry safely reconciles each durable state.
- Two workers and two app instances contend: canonical transactions serialize
  admission; process-local locks are not relied on for correctness.
- Native guard triggers remain intact and enforce old raw-SQL writers, server
  authored writes, replacement writes and full transaction rollback. A missing
  or modified guard must prevent claims even if the migration ledger is current.
- Unsafe durability settings refuse claims. Process termination/restart evidence
  must be described separately from actual power-loss durability qualification.
- Mixed provider versions, old clients/servers, unsupported providers, stale
  storage IDs, malformed claims and oversized reference scans all fail closed.
- Workspace/provider boundaries, symlink/hardlink/path substitution, incomplete
  uploads, zero-byte files and metadata-size disagreement retain safety.
- Sync-log GC, snapshot pruning and metadata retention never themselves
  authorize physical deletion.
- Observations remain bounded and honest throughout races; no test infers
  reclaimed disk space from a logical delete or a disabled-GC result.

A green accounting suite is not evidence for these future deleting-collector
gates. Record the exact commits, providers/runtimes and test artifacts before
considering activation.
