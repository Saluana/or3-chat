# Deployment and Operations Guide

Operational runbook for OR3 Cloud SSR deployments.

## Start with the right operator

For managed installations, follow [Set up Cloud](/documentation/cloud/setup) and the canonical [installation guide](https://github.com/Saluana/or3-chat/blob/or3-cloud/docs/installation.md). The fixed profile owns its image, generated configuration, and persistent volume. Optional provider configuration belongs to the [source path](/documentation/cloud/configure), not a partial environment recipe copied into a managed installation.

Use [Updating OR3](https://github.com/Saluana/or3-chat/blob/or3-cloud/docs/cloud-updates.md) for update procedures. Ordinary application updates and stable release publication follow different workflows.

## Routine verification

Run `npx @or3/cloud doctor` and `npx @or3/cloud status` from the managed deployment directory. After an update or recovery, repeat the [two-browser verification](/documentation/cloud/setup#verify-the-deployment): login, conversation sync, a previously uploaded file, and workspace switching.

Before a recovery experiment, retain a verified backup and its separate authentication key. Restore and rollback can replace newer data; review the recorded snapshot and intended result before confirming either. A backup on the same disk does not protect against disk loss.

## Monitoring and Health Checks

- Liveness/readiness endpoint: `GET /api/health`
- Deep checks: `GET /api/health?deep=true`
- The managed container probe also requires read/write access to `/data` and
  opens the Basic Auth and sync SQLite files read/write. An HTTP-only green
  response cannot hide a volume-ownership or database-open failure.
- Managed backups include an authentication tag bound to a deployment-local
  key as well as checksummed Compose/Caddy assets. Restore/export rejects a
  modified or foreign archive. `update` installs the target CLI's generated
  assets atomically; failure, rollback, restore, and interrupted-operation
  recovery reinstall the matching backed-up assets.
  Backup creation journals the exact artifact before archiving, validates the
  completed artifact through the restore reader before reporting success, and
  lets `recover` remove only a journal-bound incomplete artifact. Standalone
  backup and failed adoption preserve an intentionally stopped source service.
  Docker operations are deadline-bound, daemon architecture is authoritative,
  and lifecycle rename commits fsync both content and parent directories.
  Assetless legacy restores fail with historical-release recovery guidance;
  failed asset rollback retains any recovery copies that could not be restored.
  An exact-version update must use the same package and image version, such as
  `npx --yes @or3/cloud@<exact-version> update --to <exact-version>`.
- The backup authentication key is not included in an exported archive. Escrow
  an owner-only copy of `.or3-cloud/backup-auth.key` separately in an encrypted
  secret store and restore it before using an off-host archive.
- The canonical update procedure — including the development-image workflow used
  for routine source changes — is the repository's
  [Updating OR3](https://github.com/Saluana/or3-chat/blob/or3-cloud/docs/cloud-updates.md)
  guide. This page documents the managed runtime contract that guide relies on.
- After every deployment or update, run `npx @or3/cloud verify`. For a public
  VPS, run `npx @or3/cloud verify --public` so success requires the real HTTPS
  origin with no redirect loop. Verification covers the managed image digest,
  deep Basic Auth + SQLite + filesystem health, authenticated session and sync,
  a disposable storage write/read/delete probe, SQLite integrity and ownership,
  proxy runtime settings, and a bounded recent-log scan.
  If the owner password changed after bootstrap, supply the current credential
  with `--verification-email` and `--verification-password-file`; it is used
  only for that run. Verification requires same-origin fixed-profile storage
  grants, deletes the probe, and revokes the temporary session in `finally`.
  Before the one-time credential handoff is deleted, verification can read its
  initial owner password directly from that protected file without restoring
  it to `.env` or container metadata.
- Managed initialization proves both account logins, persists bcrypt hashes in
  the data volume, then removes bootstrap/admin plaintext passwords from `.env`
  and recreates the container. The one-time `0600`
  `.or3-initial-credentials` handoff remains until it is saved and deleted.
  Credential reset migrates older deployments to the same password-free
  runtime metadata and removes that handoff file.
- Track HTTP rates for:
  - `/api/sync/push` and `/api/sync/pull`
  - `/api/storage/*`
  - `/api/openrouter/stream`
  - `/api/jobs/:id/*`
- Alert on repeated:
  - 401/403 spikes (auth/authorization)
  - 429 spikes (rate limits)
  - 5xx spikes

Managed updates of adopted legacy volumes rebuild data from the checksummed
pre-update archive as the hardened runtime UID. Only the volume mount root is
re-owned; the updater does not recursively change per-file ownership in place.
The previous root owner and backup remain recorded recovery material. Automatic
restoration is safe only before the target can accept writes; after target start,
review the journal and choose explicit recovery. Each mutation holds one deployment-wide
lease. Do not remove `.or3-cloud` lock or recovery files manually.

Restore and ownership recovery verify the actual Docker volume's Compose project,
data-volume role, and immutable deployment identity before changing it. A matching
volume name alone is insufficient. Missing or conflicting labels, or an
inspection failure without an explicit Docker not-found result, stop recovery
before clearing data. Inspect the recorded deployment identity and Docker
metadata; do not relabel an unrelated volume to bypass this check.

Interrupted updates recover from their authenticated `backupPath`/`backupId`
snapshot; restore and rollback operations instead recover from
`previousBackupPath`/`previousBackupId`. Recovery separates outcomes:
`recover --dry-run` explains the evidence and data-loss boundary,
`recover --finish` commits a proven completed replacement while preserving
post-replacement writes, and `recover --restore --yes` is the explicit
destructive restore that discards later writes. Plain `recover` never silently
falls back to a restore; a deployment that may have replaced data without
completion proof requires the explicit choice.

`backup list` classifies every backup-store entry (`verified`,
`legacy-unsigned`, `legacy-adoption`, `unsupported`, `invalid`, `unreadable`)
instead of aborting or silently skipping. Only `verified` entries are trusted
restore points; legacy and suspect entries are preserved and labelled.
`backup list --json` returns the same classification as one object. Automatic
retention protects the rollback point, the pending update snapshot, and every
restore/rollback source; it defers when a suspect entry is present, and no
`--force` path can remove a protected recovery source. Legacy `adopt-source-*`
directories and pre-authentication `backup-*` archives (no `manifest.auth`)
remain unauthenticated and cannot be used by restore, recovery, or export.

An update commits its terminal state (target identity, rollback reference,
receipt, and absence of a pending operation) in one atomic write before
retention or operation-mirror cleanup. A housekeeping failure is reported as a
maintenance warning and never recreates a pending operation or rolls back a
healthy deployment; the same rule covers restore, rollback, and recovery
completion. Once an update has started the target (which may accept writes), a
failed check is not restored automatically — the journal is preserved for an
explicit `recover --finish` or `recover --restore --yes`. While any incomplete
operation is recorded, `start` and `restart` refuse so an ambiguous deployment
cannot be resurrected; `stop` and read-only observation remain available.

This release is the compatibility bridge: it reads managed state schemas 1 and
2 but writes schema 1. A release qualified to write schema 2 declares that in
its package metadata and migrates only a deployment at or above the declared
bridge minimum source. A bridge CLI refuses to mutate newer-schema state and
points at the compatible exact-target CLI. Unknown future schemas are refused
before mutation. `status --json` emits a public projection that excludes
credential-reset recovery payloads and raw configuration.

## Backup progress, downtime, and recovery

Standalone `npx @or3/cloud backup` reports separate preflight, maintenance,
capture, restart, verification, and retention steps. The pending operation's
`backupProgress` in `status --json` records the last observed service and
artifact states separately; a recorded milestone is not a fresh health probe.

The service is stopped while the complete `/data` archive, configuration, and
managed assets are captured. This includes the separate Basic Auth and sync
databases, their remaining SQLite journals/WAL files, and filesystem blobs.
After capture, a previously running service is restarted and deep-health
checked **before** archive/configuration hashing, manifest authentication, and
restore-reader validation. Those checks use only the captured files. The
reported maintenance interval covers the stop request through successful
restart/deep health, not the total backup duration. Archive compression still
takes place during downtime, so larger volumes can still take substantial time.

This is a shorter stopped-volume backup, not an online snapshot. Pre-update,
restore, and rollback safety snapshots keep the source stopped through
verification so target mutation never overlaps resumed source writes. A
standalone backup never starts a service that was intentionally stopped.

Backup verification and service recovery can fail independently:

- Verification failure means the new artifact is not a trusted restore point,
  even if OR3 has already restarted successfully.
- Restart failure does not discard a backup that passes verification. The
  diagnostic names the retained verified path and leaves recovery pending.
- Cleanup errors are reported alongside the original error. Each operation-owned
  backup directory and export receipt is reported as present, confirmed absent,
  or uninspectable; removal is never inferred from an attempted delete. A failed
  streaming cleanup also names its temporary `.partial` file.
- Retention runs after the new backup is committed. Retention failure is a
  maintenance warning and does not invalidate the backup or re-open the operation.

From the deployment directory, inspect `npx @or3/cloud status`,
`npx @or3/cloud backup list`, and `npx @or3/cloud recover --dry-run`. Inspect the
exact paths and permissions named in the error, then run `npx @or3/cloud recover`
to retry standalone-backup recovery. Recovery attempts the required service
restart independently of artifact cleanup; if either fails the operation stays
pending. It preserves verified backups and the intentionally stopped state.
Do not manually remove recovery locks or use an unverified partial artifact.

See the [backup consistency design](https://github.com/Saluana/or3-chat/blob/or3-cloud/docs/cloud-backup-consistency.md)
for the barriers and restore evidence required before online database-plus-file
backups can replace this stopped-volume boundary.

## Dashboard updates

For managed Linux deployments using a local Docker socket, super admins can
open **Admin → Operations → Dashboard Update** only after a disposable probe
proves the exact operator image, mount, Unix identity, and Docker socket work
together. The card invokes the same exact-version `@or3/cloud` updater as the
host CLI: it creates a verified backup and runs deep health checks. Once the
target has started and may accept writes, failed verification preserves the
journal for explicit recovery instead of automatically restoring older data. Existing deployments gain this
capability after one normal CLI update; inaccessible, rootless, and remote
Docker setups remain CLI-only.

Docker access stays outside the application container. A dedicated,
digest-pinned operator sidecar has the Docker socket and deployment-directory
mount; the web service receives only a group-restricted local Unix socket with
status, check, and exact-update operations. The sidecar disables package
lifecycle scripts, cryptographically verifies the exact Sigstore provenance
bundle, and requires this repository, the matching version tag, and
`.github/workflows/release-cloud.yml` before any privileged updater code runs.
The authenticated package pins both qualified container image digests and the
source revision in their OCI labels, so a replaced tag or cross-commit artifact
mix fails closed. A stale dashboard-owned update is recovered through its exact
target CLI; unrelated/manual work stays locked for host-side
`npx @or3/cloud recover`.
Release-check state is atomic and durable across reloads and sidecar restarts.
The web boundary validates the exact status/job schema, distinguishes an
unsupported host from an unavailable or corrupt operator, and returns HTTP 202
when an asynchronous update is accepted. The card announces asynchronous state
changes and polls active work every two seconds, with bounded connection-error
backoff and a 15-minute polling limit.
When an earlier protocol-compatible release exists, the tagged release gate
upgrades a disposable installation through the operator, verifies
concurrent-start rejection, persistence, and deep health, then exercises
rollback.
The Unix socket is limited to the deployment group, mutation requests are
rate-limited, and the operator writes a non-secret `0600` JSONL audit trail at
`.or3-cloud/dashboard-update-audit.jsonl`. Docker API write access remains
host-root-equivalent despite the sidecar's dropped capabilities and read-only
root filesystem. Treat the operator as a host-root trust component; disable
the overlay and use host CLI updates when application-process compromise must
remain outside that boundary.
`doctor` also validates the operator container image, deployment label, three
required mounts, IPC types/modes, absence of an orphaned disabled operator,
daemon-side Caddy port publication, and an actual public HTTPS 200 response.
The deployment directory is mounted at its absolute host path, matching
`OR3_DEPLOYMENT_DIR` in the shipped operator overlay.

## Logging

- Use structured logs from core error handling and background execution paths.
- Background tool/workflow logs redact token/secret/password-like fields.
- Route logs should not include raw API keys or presigned token contents.

## Scaling Guidance

- The managed Basic Auth + SQLite + filesystem profile is a single-host deployment. Sticky routing alone does not replicate its accounts, records, or files.
- Source multi-instance setups need shared canonical auth/workspace data, object storage, durable background state, and compatible rate-limit/coordination stores. Verify each provider's concurrency and locking model; do not share a local SQLite file over an arbitrary network filesystem. Memory jobs remain process-local.
- Keep viewer suppression behavior in mind: viewer state is process-local.

## Contributor release qualification

Stable promotion is an explicit contributor workflow. Follow the [release procedure](https://github.com/Saluana/or3-chat/blob/or3-cloud/docs/releasing.md) and its [acceptance checklist](https://github.com/Saluana/or3-chat/blob/or3-cloud/docs/cloud-release-checklist.md). Retain exact-artifact staging, backup/restore, rollback, and failure/recovery evidence; an ordinary deployment update is not a release qualification.

## Related

- [Configuration reference](/documentation/cloud/config-reference)
- [Supported combinations](/documentation/cloud/providers#supported-combinations)
