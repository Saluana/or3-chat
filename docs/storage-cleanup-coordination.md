# Filesystem cleanup coordination: remaining implementation

## Status and boundary

The accounting patch is a safe partial deliverable, not completed reclamation.
Physical filesystem deletion and GC remain disabled. Read-only observations and
refusal tests cannot establish that a deleting collector is race-safe.

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
