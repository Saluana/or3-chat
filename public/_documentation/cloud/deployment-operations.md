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
OR3_AUTH_AUTO_PROVISION=true
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
OR3_STORAGE_FS_ROOT=.data/storage
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
```

## Security

```bash
OR3_ALLOWED_ORIGINS=https://your.app
OR3_FORCE_HTTPS=true
OR3_TRUST_PROXY=true
```

## Monitoring and Health Checks

- Liveness/readiness endpoint: `GET /api/health`
- Deep checks: `GET /api/health?deep=true`
- Track HTTP rates for:
  - `/api/sync/push` and `/api/sync/pull`
  - `/api/storage/*`
  - `/api/openrouter/stream`
  - `/api/jobs/:id/*`
- Alert on repeated:
  - 401/403 spikes (auth/authorization)
  - 429 spikes (rate limits)
  - 5xx spikes

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
