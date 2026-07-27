# OR3 Cloud Release Checklist

This is the authoritative promotion gate for OR3 Cloud. It separates
reproducible code checks from deployment-specific checks that must be performed
against the exact production candidate.

## 1. Reproducible Code Gate

Run from the `or3-chat` package:

```bash
bun run release:check
```

The command must complete successfully. It verifies:

- host type-check and unit/integration tests
- deterministic cloud browser harnesses for auth gating, offline recovery,
  workspace-switch races, and adapter fault handling
- OR3 Cloud CLI bundle
- type-check, tests, and package build for Basic Auth, SQLite, filesystem, S3,
  Clerk, and Convex providers
- SSR production build
- static production build

Do not promote a candidate from a dirty worktree. Record the clean commit SHA
and retain the complete command output with the release artifacts.

## 2. Staging Promotion Gate

Run these checks against the same immutable artifact and provider stack that
will be promoted:

Start from `scripts/release/staging-canary.example.json` and record the
machine-readable result:

```bash
bun run release:canary --config ./staging-canary.json \
  --evidence ./artifacts/staging-canary.json
```

- [ ] `GET /api/health` succeeds.
- [ ] `GET /api/health?deep=true` reports all configured providers healthy.
- [ ] Admin and end-user sign-in, session refresh, sign-out, and expired-session
      recovery succeed.
- [ ] Sync push, pull, reconnect, and a two-client conflict smoke test succeed.
- [ ] Storage presign, upload, commit, download, and garbage-collection smoke
      tests succeed.
- [ ] Background job start, reconnect/reattach, completion, and abort succeed.
- [ ] A backup is created and restored into an isolated environment.
- [ ] The previous artifact and provider-data snapshot can be restored using
      the rollback runbook.
- [ ] HTTPS, trusted-proxy, allowed-origin, cookie, and persistent-volume
      settings match the deployment topology.
- [ ] The canary JSON has `schemaVersion: "or3.staging-canary.v1"`,
      `status: "passed"`, the exact candidate/previous artifact identifiers,
      provider-data snapshot identifier, and a retained evidence SHA-256.

## 3. Scale-Specific Gate

For more than one application instance:

- [ ] Do not use the in-memory background provider.
- [ ] Do not rely on process-local viewer suppression for correctness.
- [ ] SQLite and filesystem providers use an explicitly supported shared-volume
      or single-writer topology; otherwise select shared external providers.
- [ ] Rolling-restart behavior is exercised while a sync client and background
      job are active.
- [ ] The restart assertions are observed from a different instance and use
      the shared external provider as the source of truth.

## Promotion Rule

A release may be promoted only when the reproducible code gate passes and every
applicable staging and scale-specific item above has recorded evidence. Code
completion alone creates a **release candidate**, not an automatic production
promotion.

## Related

- [deployment-operations](./deployment-operations)
- [provider-compatibility-matrix](./provider-compatibility-matrix)
- [release-notes-production-readiness](./release-notes-production-readiness)
