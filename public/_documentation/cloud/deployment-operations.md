# Deployment and Operations Guide

Operational runbook for OR3 Cloud SSR deployments.

## Baseline Deployment Profile

- SSR auth enabled (`SSR_AUTH_ENABLED=true`).
- Provider packages installed for selected auth/sync/storage stack.
- Persistent volumes for provider data paths.
- Reverse proxy with HTTPS and explicit origin policy.

## Required Environment Groups

## Core SSR

```bash
SSR_AUTH_ENABLED=true
OR3_AUTH_REGISTRATION_MODE=invite_only
OR3_AUTH_AUTO_PROVISION=false
```

## Auth

For basic-auth:

```bash
AUTH_PROVIDER=basic-auth
OR3_BASIC_AUTH_JWT_SECRET=...
OR3_BASIC_AUTH_BOOTSTRAP_EMAIL=...
OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD=...
```

For Clerk:

```bash
AUTH_PROVIDER=clerk
NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...
NUXT_CLERK_SECRET_KEY=...
```

## Sync

```bash
OR3_SYNC_ENABLED=true
OR3_SYNC_PROVIDER=sqlite|convex
```

SQLite examples:

```bash
OR3_SQLITE_DB_PATH=.data/or3-sync.sqlite
OR3_SQLITE_PRAGMA_JOURNAL_MODE=WAL
OR3_SQLITE_PRAGMA_SYNCHRONOUS=NORMAL
```

## Storage

```bash
OR3_STORAGE_ENABLED=true
NUXT_PUBLIC_STORAGE_PROVIDER=fs|convex|s3
```

FS examples:

```bash
OR3_STORAGE_FS_ROOT=/srv/or3/.data/storage
OR3_STORAGE_FS_TOKEN_SECRET=...
OR3_STORAGE_FS_URL_TTL_SECONDS=300
```

## Background Jobs

```bash
OR3_BACKGROUND_STREAMING_ENABLED=true
OR3_BACKGROUND_STREAMING_PROVIDER=memory|convex
OR3_BACKGROUND_MAX_JOBS=20
OR3_BACKGROUND_MAX_JOBS_PER_USER=5
OR3_BACKGROUND_JOB_TIMEOUT=300
OR3_BACKGROUND_ENCRYPTION_KEY=<random-secret-at-least-32-characters>
```

## Security

```bash
OR3_ALLOWED_ORIGINS=https://your.app
OR3_FORCE_HTTPS=true
OR3_TRUST_PROXY=true
```

Managed Compose maps `OR3_TRUST_PROXY` to Nuxt's nested runtime setting. Keep
it enabled only behind the bundled Caddy proxy (or another proxy that replaces
forwarding headers); otherwise proxy-supplied client identity is untrusted.

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
  `npx --yes @or3/cloud@0.1.39 update --to 0.1.39`.
- The backup authentication key is not included in an exported archive. Escrow
  an owner-only copy of `.or3-cloud/backup-auth.key` separately in an encrypted
  secret store and restore it before using an off-host archive.
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
The previous root owner and backup remain the automatic recovery path until
the replacement passes deep health. Each mutation holds one deployment-wide
lease. Do not remove `.or3-cloud` lock or recovery files manually.

## Dashboard updates

For managed Linux deployments using a local Docker socket, super admins can
open **Admin → Operations → Dashboard Update** only after a disposable probe
proves the exact operator image, mount, Unix identity, and Docker socket work
together. The card invokes the same exact-version `@or3/cloud` updater as the
host CLI: it creates a verified backup, runs deep health checks, and restores
the prior release/data when the update fails. Existing deployments gain this
capability after one normal CLI update; inaccessible, rootless, and remote
Docker setups remain CLI-only.

Docker access stays outside the application container. A dedicated,
digest-pinned operator sidecar has the Docker socket and deployment-directory
mount; the web service receives only a group-restricted local Unix socket with
status, check, and exact-update operations. The sidecar disables package
lifecycle scripts, cryptographically verifies the exact Sigstore provenance
bundle, and requires this repository, the matching version tag, and
`.github/workflows/release-cloud.yml` before any privileged updater code runs.
The authenticated package pins both qualified container image digests, so a
replaced GHCR tag fails closed. A stale dashboard-owned update is recovered
through its exact target CLI; unrelated/manual work stays locked for host-side
`npx @or3/cloud recover`.
Release-check state is atomic and durable across reloads and sidecar restarts.
The web boundary validates the exact status/job schema, distinguishes an
unsupported host from an unavailable or corrupt operator, and returns HTTP 202
when an asynchronous update is accepted. The card announces asynchronous state
changes and polls active work every two seconds, with bounded connection-error
backoff and a 15-minute polling limit.
`doctor` also validates the operator container image, deployment label, three
required mounts, IPC types/modes, absence of an orphaned disabled operator,
daemon-side Caddy port publication, and an actual public HTTPS 200 response.

## Logging

- Use structured logs from core error handling and background execution paths.
- Background tool/workflow logs redact token/secret/password-like fields.
- Route logs should not include raw API keys or presigned token contents.

## Scaling Guidance

- Stateful providers (`sqlite`, `fs`, memory background provider) need shared storage or sticky instance design.
- For multi-instance setups, prefer providers with shared persistence (for example Convex-backed background jobs).
- Keep viewer suppression behavior in mind: viewer state is process-local.

## Operational Checks Before Release

The authoritative gate is the
[OR3 Cloud release checklist](./release-checklist). In summary:

1. Run `bun run release:check` from `or3-chat`.
2. Copy `scripts/release/staging-canary.example.json`, replace its endpoint,
   artifact, topology, credential, and deployment-control values, then run:

   ```bash
   bun run release:canary --config ./staging-canary.json \
     --evidence ./artifacts/staging-canary.json
   ```

3. Retain the JSON evidence beside the clean commit and immutable artifact.
   A passing report covers deep provider health, auth, sync, storage,
   background jobs, isolated backup/restore, rollback, and rolling-restart
   assertions. It also requires a bounded multi-instance short soak and explicit
   failure/recovery evidence for Convex, S3/R2-compatible object storage,
   OpenRouter, network partitions, and partial provider outages.

The canary runner is deployment-provider neutral: each scenario is a sequence
of HTTP operations with an expected status and optional dotted JSON assertions.
Production canary routes should be protected by short-lived credentials and
should create namespaced, disposable fixtures. The runner never assumes that
the public application exposes test-control routes.

For multi-instance candidates, the topology declaration fails closed when:

- background jobs use process-local memory;
- correctness depends on process-local viewer suppression;
- SQLite or filesystem storage lacks an explicit single-writer or supported
  shared-volume topology.

The rolling-restart scenario must begin sync and background work before
restarting an instance, then verify convergence and job completion through
another instance. External providers must remain the source of truth across
the restart.

The short soak repeats its configured steps 2-25 times, with a hard cap of 100
requests. At least two named instances must be exercised in multi-instance
topologies. Requests time out after 15 seconds by default (`timeoutMs` is capped
at 60 seconds), preventing an unavailable dependency from hanging the promotion
job indefinitely.

Fault steps declare a `faultTarget` and an `inject` or `recover` `faultPhase`;
the config is rejected unless every target has both phases. Expected injected
502/503 responses count as successful evidence only when their exact status is
configured; subsequent recovery assertions must independently prove convergence
or provider health.
Fault-control endpoints are deployment-owned and must require short-lived
credentials.

## Related

- [config-reference](./config-reference)
- [provider-compatibility-matrix](./provider-compatibility-matrix)
- [release-checklist](./release-checklist)
- [release-notes-production-readiness](./release-notes-production-readiness)
