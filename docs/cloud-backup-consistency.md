# Managed backup consistency and downtime

## Implemented contract

The managed profile is one application service with separate Basic Auth and sync
SQLite databases plus filesystem storage in `/data`. A deployment mutation lease
serializes managed CLI operations. It does **not** stop application requests or
other processes writing the volume. Managed backup therefore still stops OR3 for
the capture boundary; independently mounting/writing the managed data volume is
outside this consistency contract.

Standalone backup sequence:

1. Check image identity and disk headroom while service state is unchanged.
2. Exclusively create a new owner-only backup directory. An existing ID must
   never be overwritten or deleted as failed-new-backup cleanup.
3. Stop OR3; capture the complete volume with `tar`, including any remaining
   SQLite WAL/journal files, then copy configuration and managed assets.
4. Restart a previously running service and verify deep health/image identity.
   Attempt this even after capture failure. An initially stopped service stays
   stopped. Record the stop-request-to-health interval separately from total time.
5. Hash and authenticate the captured archive/configuration and read it through
   the restore verifier. No live-volume or live-configuration reads enter the
   captured manifest at this stage. The manifest time is recorded while stopped.
6. Commit the backup operation, then perform warning-only retention.

The improvement removes archive/config hashing and restore-reader validation
from standalone-backup downtime. Compression and the small managed-asset copy
and checksums still happen while stopped. No production duration or percentage
improvement is claimed: the regression fixtures prove ordering, independent
artifact/service outcomes, and measured interval boundaries, not host throughput.
Update/restore/rollback snapshots retain the old stopped-until-verified boundary
because those callers immediately mutate or replace deployment data.

## Failure and recovery evidence

Errors retain primary, cleanup, and restart failures independently. Cleanup
observes both the backup directory and its export receipt after attempted
deletion; absence, presence, and inability to inspect are different outcomes.
Streaming cleanup waits for its producer and output pipeline to settle, and
reports the exact temporary file if deletion fails. A verified backup survives
restart or completion-progress failure. An unverified backup is never advertised
as usable merely because it has a manifest or OR3 is healthy.

`status --json` exposes the last backup milestone's stage, service, artifact, and
maintenance interval. A pending operation still needs recovery even when the
service is healthy. Use `recover --dry-run` to inspect it, then plain `recover`
for standalone-backup recovery; this does not restore older live data. Restart
and cleanup are attempted independently, and either failure keeps the journal.
Intentionally stopped deployments remain stopped. Do not manually delete locks.

## Why database-only online backup is insufficient

SQLite's [Online Backup API](https://www.sqlite.org/backup.html) produces a
consistent snapshot of one database while allowing other connections to operate.
[VACUUM INTO](https://www.sqlite.org/lang_vacuum.html#vacuum_with_an_into_clause)
is another per-database snapshot option, but interruption can leave incomplete
output that must not be published. Neither operation snapshots a second database,
blob files, mutable sidecars, deployment configuration, or application work in
flight. These are useful primitives, not an OR3-wide consistency protocol.

SQLite's [WAL documentation](https://www.sqlite.org/wal.html#the_wal_file) says the
WAL is persistent database state; copying a database without the corresponding
WAL can lose committed data or corrupt it. Copying the files independently while
writes/checkpoints continue does not establish a shared instant. SQLite also
documents that WAL transactions across attached databases are atomic per
database, not across the set. Basic Auth's database cannot be omitted merely
because the sync database is consistent.

OR3 additionally needs the metadata and blob bytes referenced by that database
snapshot. Concurrent uploads, commit/replacement, logical Trash/restore,
reference changes, and eventual physical deletion/GC can race an independent
file-tree copy. Hash-addressed filenames alone do not establish immutability of
sidecars, retention of referenced versions, or synchronization across stores.

## Safe candidates for later qualification

### Short application barrier plus storage snapshot

A capability-gated provider could briefly reject new writes, drain in-flight
writers and background work across both databases and blob commit/delete paths,
flush durable state, and capture one read-only storage snapshot covering the
whole dataset. Release the barrier only after a durable snapshot handle exists;
then archive, authenticate, verify, and export from that handle while online.

This requires an actual supported snapshot backend. Docker's
[volume backup example](https://docs.docker.com/engine/storage/volumes/#back-up-restore-or-migrate-data-volumes)
uses a mounted volume and `tar`; it is not a transactional snapshot API.
Filesystem-specific scope also matters: [Btrfs snapshots](https://btrfs.readthedocs.io/en/latest/Subvolumes.html)
do not recursively include nested subvolumes and share blocks with their source.
Verify every relevant mount/subvolume and application barrier; a crash-consistent
filesystem image alone does not prove application-level DB/blob consistency.
Export an independent off-host copy rather than treating the local snapshot as
protection against disk loss. No filesystem privilege expansion is proposed by
the current patch.

### Coordinated database snapshots plus pinned blob generations

A portable alternative needs a shared application snapshot epoch: establish
consistent views of both databases at the barrier, pin every referenced immutable
blob and metadata generation, then allow writes while copying those fixed views.
Upload/replacement and deletion/GC must honor those durable pins across processes,
crashes, retries, and lease expiry. Prove the SQLite driver's transaction/backup
semantics rather than assuming two independently completed online backups share
an epoch. Do not resume deletion simply because one metadata scan found no refs.

Both candidates require bounded acquisition/timeout, disk-headroom checks,
crash-safe manifests and pin cleanup, explicit downgrade/refusal for unsupported
providers, and tests that restore the exact captured generation into an isolated
deployment. Qualification must verify both databases' integrity, account login,
workspace membership, sync records/cursors, referenced file hashes/content and
sidecars, plus concurrent upload/delete/restore and crash fault matrices. A valid
archive checksum proves transfer integrity; it does not by itself prove semantic
restorability. Until that evidence exists, keep the stopped-volume protocol.
