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
or workspace data is lost. After extraction and before app startup, restore also
opens both databases with the restored image's native SQLite driver in read-only
mode in a network-denied helper, requiring a passing `quick_check` and a nonempty
schema. A refused payload follows the existing automatic pre-start snapshot
recovery path; a failed recovery keeps the verified snapshot and operation
journal. Deep health alone can pass for a non-SQLite file, and startup can
initialize an empty database with a fresh schema. This check
does not prove every application record or referenced attachment is complete.
The real `--sqlite-placeholder-schema-only` drill replaces the sync database
with a valid SQLite file containing one unrelated table, removing its WAL/SHM.
Restore still reports success; startup initializes provider tables beside the
placeholder, all six original canonical records are absent, and sign-in returns
403 despite the separate credential database retaining the account. Restoring
the intact archive repairs sign-in, records and attachment access. The
nonempty-schema check is physical validation; provider schema/completeness
validation needs a versioned provider contract and remains unresolved.
Before opening each database, restore validates any nonempty WAL's 32-byte
header magic, format, page size and checksum using the
[documented SQLite WAL format](https://sqlite.org/fileformat2.html#wal_file_format).
SQLite can ignore an invalid WAL and use an older, structurally valid main
database: the drill reproduced successful restore with a committed WAL-only
record missing after header corruption and SHM omission. Invalid headers are
now refused before startup and the original snapshot is recovered. Empty WALs
remain valid checkpoint artifacts. SQLite performs frame recovery itself.
A custom full-frame check falsely rejected genuine same-salt leftovers after
an interrupted transaction and later healthy appends, including the known-good
automatic recovery snapshot. A cache-aware follow-up still rejected otherwise
healthy cacheless tails, so both frame decoders are excluded from production
restore. Their experiments remain in `scripts/test/fixtures/sqlite-wal-diagnostics.ts`
and `scripts/test/sqlite-wal-diagnostics.test.ts` as offline diagnostics only.
Native recovery accepts healthy rollback/reset/partial tails and rebuilds a
missing or corrupt SHM cache. Committed-frame corruption can still silently
discard the later record while native integrity and baseline reads pass.
Truncation or altered salts can likewise resemble legitimate interrupted/reset
tails. Archive checksums and physical integrity do not establish an expected
record inventory; those semantic completeness gaps remain unresolved.
The real `--wal-tail-only` drill verifies those remaining omissions: truncating
one byte from a frame carrying a commit marker, or altering the first frame's
salt, preserves healthy baseline data but loses the later committed record.
Both restores report success; intact-archive recovery restores the record.
For the archived FS root under
`/data`, the reader also pairs canonical SHA-256/MD5 committed sidecars with
their blob entries. Uncommitted uploads, temporary sidecars and opaque generation
artifacts remain accepted. No new archive format or physical cleanup is used.
The local drill checks application semantics separately: an authenticated archive
missing both a referenced blob and its sidecar can still report restore success
and then return 404 on attachment download. Pairing is not database-reference
validation; deep health cannot establish that completeness.
The pre-start native helper also streams each canonical committed filesystem
payload and compares its bytes with the SHA-256/legacy-MD5 filename hash, using
a 64 KiB buffer. The real drill showed that authenticated archive checksums and
payload presence still allowed a changed byte: restore reported success and
HTTP 200 returned wrong content under the original hash. Such content mismatch
is now refused before startup and follows safe snapshot recovery. Uncommitted
uploads, temporary sidecars and opaque generation artifacts remain unscanned;
no files are deleted or rewritten by content verification. This scan does not
discover database references whose payload and sidecar are both absent, and
production-scale hashing throughput has not been qualified.
Restore and rollback run this read-only inventory preflight before journaling
or capturing the pre-mutation snapshot, which itself stops the app. The stronger
two-workspace drill exposed why checking only inside the replacement primitive
was insufficient: a refused missing blob still stopped the service, recorded an
operation and unnecessarily restored the recovery snapshot. Early refusal now
preserves state and the running container; the later inventory recheck remains.

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
`--concurrency-only` waits up to five seconds for at least one of the seven
racing atomic batches to be acknowledged before requesting stop. It checks
that every acknowledged pair is present and no batch is split in the separate
restored instance, after managed restore, and after another cold restart. This
qualifies acknowledged writes before stop; capture itself runs with the app
stopped. Requests interrupted by stop may have committed, so their restored
pairs are allowed to be either wholly present or wholly absent.
`--multi-workspace-only` creates a second workspace through the real API and
stores six records per workspace with colliding IDs and distinct payloads. It
uploads the same hash into both workspace directories with distinct scoped
storage IDs. After separate-instance restore, managed restore and cold restart,
it checks both memberships, active workspace switching, document/project/message
references, different settings and exact attachment bytes in each scope.
`--workspace-omission-only` adds two authenticated archive faults to that fixture:
removing only the second workspace's blob must refuse before state/container
mutation even though the first workspace retains the same hash. Removing both
that blob and its sidecar records the unresolved reference-completeness gap,
checks that the first workspace remains usable, then restores both scopes from
the intact archive and checks another cold restart.
The deep pass kills a separate restore process with SIGKILL after app startup,
then checks that its durable journal protects a subsequently accepted write.
`--crash-only` runs that process-death case with the source/target qualification.
`--prestart-crash-only` kills the CLI after real extraction but before native
validation/startup. It checks a durable `target-mutating` journal and a stopped
app, confirms the older target lacks a record accepted before restore, then
verifies that explicit recovery restores that record from the pre-mutation
snapshot through a cold restart.
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
`--sqlite-only` restores authenticated archives containing non-SQLite auth and
sync database payloads and a valid SQLite database with an empty schema. It
checks that native validation prevents startup of those payloads and that safe
automatic recovery preserves original records and attachment bytes. It also
interrupts both target validation and automatic recovery, verifies that neither
app starts, then checks a successful explicit recovery retry.
`--sqlite-wal-only` removes the captured sync WAL/SHM from this populated fixture
while retaining its main database and authenticating the resulting archive.
Its schema and records reside in the WAL, so the pre-start check must refuse the
empty main database and recover the original data. Checkpointed SQLite snapshots
can legitimately omit WAL/SHM; this is not a blanket WAL presence requirement.
`--transaction-crash-only` spills a real two-MiB uncommitted transaction into WAL,
then sends SIGKILL to the owned app with its restart policy temporarily disabled.
It captures the stopped source and checks managed source restore discards the
pending table/document change while retaining the acknowledged baseline. Later
healthy writes leave a genuine obsolete same-salt tail. The built CLI must
restore that backup with valid, corrupt and missing SHM caches, retaining the
baseline. An invalid database candidate must safely auto-recover a known-good
snapshot with the real discarded tail and no SHM, followed by another cold
restart. The offline strict decoder must reproduce its rejection of that same
healthy recovery snapshot. No manifest redesign or physical cleanup is involved.
`--wal-corruption-only` first checkpoints populated data into the main database,
commits another record into WAL, and captures a real backup. It corrupts the
WAL header and removes the transient SHM file, verifies refusal before startup
and recovery of the committed record, then verifies the intact backup again.
`--wal-frame-only` corrupts a current-generation frame beneath an intact header,
records native recovery's unresolved loss of the WAL-only record, and verifies
that a stale frame after a valid commit and an incomplete append retain it.
The intact archive recovers the record. The offline decoder is a diagnostic,
not a production completeness gate.
`--wal-tail-only` records the unresolved commit-truncation and first-frame-salt
omissions with real application reads, starting each case with the committed
record present and recovering it from the intact archive afterward.
`--built-cli-only` restores through the built CLI dispatcher with its real
deployment lease and serialized native validator, checks another cold restart,
then checks read-only status after lease release. Build the cloud package first.
An unpublished local fixture has no repository digests, so status retains
`identityMatches: null`; the drill compares its running local image ID directly
instead of relaxing the registry-identity safeguard.
`--archive-race-only` changes a target backup after early inventory preflight
has succeeded, during capture of the pre-mutation snapshot. It checks an
checksum change without updating the manifest and an authenticated database omission. The
retained manifest/inventory rechecks must refuse both changed inputs and safely
recover the stopped original data, followed by another actual cold restart.
`--blob-content-only` corrupts one committed attachment byte in a real archive
while retaining its original hash, sidecar, size and database references, then
authenticates that synthetic archive. It checks native refusal before startup,
recovery of the original bytes/hash, and another intact-archive restore.
`--filesystem-compat-only` seeds a pre-existing legacy MD5 object plus empty
and multi-chunk committed objects and temporary/uncommitted/opaque filesystem
fixtures. It publishes the legacy metadata through real sync and checks its
authenticated app download. The built CLI's native verifier must accept the
valid committed objects, retain every fixture byte, and pass another cold
restart/status check. This does not qualify a new MD5 upload contract.
`--alternate-storage-only` repeats the compatibility fixture with an explicitly
custom Compose asset and an archived storage root containing spaces inside
`/data`. It checks missing-blob refusal before state/container mutation and
native legacy-MD5 corruption refusal followed by snapshot recovery, then runs
the built CLI restore and cold restart. Managed Compose fixes its storage root
at `/data/storage`; this fixture does not expand that supported profile.
`--empty-storage-only` creates five real chat/document/project/settings records
without uploading files or creating canonical attachment references. Both
databases and WALs are captured; no object directory or sidecars exist. The
built CLI restore must retain those records and keep storage legitimately empty
through another cold restart and read-only status check.
`--capacity-only` uses a 96 MiB tmpfs volume to check refusal of a signed 80 MiB
payload plus reserve before any journal, service or data mutation. It then
allocates 40 MiB of filler and verifies that restore can reclaim those blocks
when initial free bytes alone are below the reserve. `--sparse-capacity-only`
adds a largely unallocated 128 MiB file and checks that it cannot falsely
authorize a 120 MiB restore. Restore uses allocated blocks for reclaim capacity;
backup payload estimates and `dataBytes` remain logical/apparent bytes.
The volatile filesystem is held mounted by a separate network-denied helper
across app restarts and removed after the test. These are real filesystem
capacity/refusal tests, not host-reboot durability or disk-hardware qualification.

### Remaining canonical attachment preflight

The both-blob-and-sidecar omission remains unresolved in the production reader.
A local, data-only prototype confirmed that the current SQLite 0.0.15
`queryCanonicalStorage` live-metadata selection can identify the missing pair
from the archived database/WAL before any live mutation. The FS 0.0.11 hash and
workspace-path contracts determine the required entries; the prototype accepted
the complete archive and found both missing entries in the otherwise identical
archive. Additional cases preserved tombstones and pending metadata without
storage IDs, and detected the same hash missing under a second workspace. Both
WAL-bearing and checkpointed snapshots were read successfully. It used a
network-denied, read-only-root helper with a disposable data
volume, 128 MiB memory and half a CPU. It ran a fixed trusted query with
`trusted_schema=OFF`, executed no archive code, and removed its scratch volume.
This is feasibility evidence for those provider versions, not shipped validation
or cross-version qualification.

A production implementation should give the SQLite provider a versioned offline
inspection contract corresponding to canonical live metadata, rather than
embedding a second unversioned interpretation of its schema in the CLI. Before
stopping the live application, a helper using the authenticated image should
extract only the required database/WAL members into a scratch volume, validate
regular-file inputs and SQLite integrity, and stream canonical committed
references against the archive inventory. Require both blob and sidecar at the
archived FS root; preserve deleted/pending metadata, orphan uploads and opaque
generation artifacts. No cleanup jobs or provider network calls are needed.
Check free space on the actual scratch filesystem, bound extraction/query
resources, clean up in every failure path, and refuse unsupported schemas or
roots outside captured `/data` with an explicit explanation. Qualify legacy
hashes, alternate FS roots, WAL-only committed references, duplicate workspace
hashes, older snapshots and corruption before making this a managed restore
requirement. This can retain the existing signed archive format.

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
