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

The restore archive reader requires both fixed-profile database payloads,
`auth.sqlite` and `sync.sqlite`, before clearing the current volume. A valid tar
file that omits one is refused: application startup or a sign-in request can
otherwise create an empty replacement and make deep health pass after account
or workspace data is lost. This presence check does not prove database contents
or every referenced attachment is complete. For the archived FS root under
`/data`, the reader also pairs canonical SHA-256/MD5 committed sidecars with
their blob entries. Uncommitted uploads, temporary sidecars and opaque generation
artifacts remain accepted. No new archive format or physical cleanup is used.
The local drill checks application semantics separately: an authenticated archive
missing both a referenced blob and its sidecar can still report restore success
and then return 404 on attachment download. Pairing is not database-reference
validation; deep health cannot establish that completeness.

## Local restore qualification

`scripts/test/run-backup-restore-drill.ts` drives the production backup/restore
commands against two fresh Docker instances with synthetic accounts, real SQLite
databases and filesystem storage. It checks authenticated chat/document/project/
settings records, exact attachment bytes, database integrity and foreign keys,
sync replay receipts, cold restarts, malformed or missing backup components,
extraction interruption, and a write accepted before startup verification fails.
The `--deep` pass also races seven atomic push batches with capture, tests missing
database payloads and a referenced blob inside authenticated archives, and checks
explicit recovery after extraction and automatic recovery both fail. It also
checks that a write accepted before terminal state recording fails survives
another cold restart. `--recovery-only` runs the source/target qualification and
these two additional recovery cases without repeating the malformed-input matrix.
The deep pass kills a separate restore process with SIGKILL after app startup,
then checks that its durable journal protects a subsequently accepted write.
`--crash-only` runs that process-death case with the source/target qualification.
`--browser-only` checks restored chat and document bodies in a fresh Chromium
context and writes a screenshot. It requires `/usr/bin/chromium`, forwards only
the disposable app through a loopback relay, and blocks external browser requests
and model routes. It uses newly issued synthetic provider session cookies.
`--journal-only` checks persistent failure of the terminal state and error record,
refusal to extract when recovery cannot persist its journal, and a successful
explicit retry after persistence is available. These cases use injected write
failures with real journals/databases/archives; they do not simulate disk hardware.
`--attachment-only` checks refusal of a committed sidecar without its payload,
then records the still-detectable application failure when both are absent and
verifies recovery from the known-good archive.

Build the current SSR application with Basic Auth, SQLite and filesystem providers
using disposable build paths/secrets and no model credentials. Then build the
local fixture image from that `.output`:

```bash
docker build --network=none \
  --target bookworm \
  --build-arg SOURCE_REVISION="$(git rev-parse HEAD)" \
  --build-arg OR3_VERSION="$(bun -e 'console.log((await Bun.file("package.json").json()).version)')" \
  -f scripts/test/fixtures/backup-restore.Dockerfile \
  -t or3-backup-drill:local .
OR3_BACKUP_DRILL_IMAGE=or3-backup-drill:local \
  bun scripts/test/run-backup-restore-drill.ts --deep
```

To qualify the pinned production distroless base instead, build the fixture's
`--target distroless` and set `OR3_BACKUP_DRILL_NODE_PATH=/nodejs/bin/node` when
running the drill. Both targets use the same SSR output and pinned BusyBox tools;
this is local runtime qualification, not a release image build or publication.

This is an explicit contributor qualification command, not installation or
production restore guidance. It requires a local Docker daemon and a prebuilt
local image, creates fresh random deployment/volume identities, blocks provider
egress with internal Docker networks, and removes only its disposable resources.
HTTP checks execute inside the app container so nested Docker hosts do not need
to expose the test ports. Results are written to `output/backup-restore-drill.json`
(override with `OR3_BACKUP_DRILL_EVIDENCE`). Failed cleanup preserves the fixture
directory and returns a failure for inspection.

The managed CLI deliberately rejects cross-deployment restores. The drill first
tests that rejection, then explicitly transfers the authenticated source archive
into the second disposable volume through the production archive primitive. Its
subsequent restore/recovery tests use the second deployment's own signed backup.
This does not establish a production identity-migration procedure. The drill
covers application APIs/backend persistence; browser rendering, external provider
stacks and cross-release database downgrades require separate qualification. The
optional browser pass qualifies conversation/document reads; other browser flows
still require separate coverage.

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
