# Remediation verification — 2026-10-15

All 26 ranked findings have implementation repairs. The original review and its
baseline results remain in `dumb-issues.md`, `results.jsonl`, and
`verification.txt`. Updated scripts assert the repaired behavior; their final
observations are in `remediation-results.jsonl`.

## Isolated source

| Repository | Worktree | Branch | Base commit |
|---|---|---|---|
| OR3 Chat | `/Users/brendon/Documents/or3/.worktrees/neckbeard-findings` | `codex/neckbeard-findings` | `68bed3fb55703375fd1e28fc436ea7fbb92b013d` |
| SQLite provider | `/Users/brendon/Documents/or3/.worktrees/neckbeard-sqlite` | `codex/neckbeard-webhook-quota` | `fa6b1257e97e8ddead049499f8654be7a22f5d22` |
| Convex provider | `/Users/brendon/Documents/or3/.worktrees/neckbeard-convex` | `codex/neckbeard-webhook-quota` | `cac396caaf70d4a9a946e3a05031163d99599b04` |

Primary dirty checkouts were preserved. Eight clean, redundant worktrees were
removed and nine missing-checkout registrations were pruned. Dirty, unmerged,
or data-bearing worktrees were retained. No branches were deleted.

## Results

| Check | Result |
|---|---|
| OR3 Chat affected suites | 52 files, 526 tests passed |
| OR3 Chat full Nuxt typecheck | Passed; existing duplicate auto-import warnings remain |
| ESLint for changed TypeScript files | Passed, no errors |
| Core, client/storage, and webhook audit scripts | All three passed |
| SQLite quota and provider integration suites | 2 files, 8 tests passed |
| SQLite build and standalone typecheck | Passed |
| SQLite changed-source lint | Passed |
| Convex quota mutation regression | 1 file, 1 test passed |
| Convex template pack, build, and standalone typecheck | Passed |
| All three repository diffs | Inspected; `git diff --check` passed |

Bug regressions were exercised against their pre-repair implementations before
the corresponding fixes. This included hostile webhook forms, concurrent
registrations, revoked membership, response streaming, batch settlement, admin
admission and rotation, local-only sync values, invalid pulled records, cursor
advancement, wizard persistence and readiness, catalog credentials, same-size
search refreshes, workspace-switch attachment writes, and public health
redaction. An additional guest-key round-trip regression caught and corrected
an error introduced by the account ownership change.

The core script also retains two diagnostic observations from the original
review: an HLC collision excluded from the ranked findings, and independent
username buckets in the account limiter. The latter is now bounded by a
separate aggregate IP limiter exercised through the real login HTTP handler.

## Published provider integration

Finding 11 is supplied by published `or3-provider-sqlite@0.0.18` and
`or3-provider-convex@0.0.18`. Both immutable tag workflows passed. Each npm
tarball was independently downloaded and its SHA-512 integrity compared with
the exact CI-qualified archive. Commits, workflow URLs, integrity and shasums
are recorded in [provider-releases.json](provider-releases.json). SQLite's
initial registry propagation check timed out; only that verification job was
retried after the exact endpoint became available. Nothing was republished.

OR3 Chat pins both published versions, aligns wizard and fixed-profile lock
metadata, and qualifies offline inspection against SQLite 0.0.18's unchanged
migration history. Convex deployments must install the matching backend
templates. Older providers return HTTP 503 on registration. No production
deployment or application release was performed.

Initial source qualification used a temporary explicit provider alias. That
configuration was removed after publication; final host qualification uses the
installed npm packages and independent dependencies in a clean checkout.

## Repeat the host checks

Run in the OR3 Chat worktree with its locked dependencies installed:

```sh
bunx vitest run \
  server/api/admin/auth/__tests__/security.test.ts \
  server/admin/auth/__tests__/rate-limit.test.ts \
  tests/unit/admin-auth-jwt.test.ts tests/unit/admin-auth-rate-limit.test.ts \
  tests/unit/admin-auth-hash.test.ts app/core/sync/__tests__ \
  app/core/auth/__tests__/useUserApiKey.test.ts app/utils/__tests__/logout-cleanup.test.ts \
  server/utils/webhooks server/api/webhooks server/api/admin/webhooks \
  server/api/__tests__/health.get.test.ts \
  app/composables/chat/__tests__/model-context-readiness.test.ts \
  app/core/search/__tests__/orama.test.ts \
  shared/cloud/wizard/__tests__/store.test.ts shared/cloud/wizard/__tests__/dev-server.test.ts \
  server/api/sync/__tests__ server/utils/chat/__tests__/tool-registry.test.ts \
  app/utils/chat/__tests__/tools-public.contract.test.ts --reporter=dot --bail=0
bunx nuxt typecheck
bunx vite-node --config vitest.config.ts audit-evidence/neckbeard-20261014/reproduce.ts
bunx vite-node --config vitest.config.ts audit-evidence/neckbeard-20261014/webhooks.ts
bunx vite-node --config vitest.config.ts audit-evidence/neckbeard-20261014/client-and-storage.ts
```

The sync HTTP harness binds disposable loopback ports; the sandbox required
elevated execution for that check. Tests use synthetic credentials, temporary
files and databases, scripted external transports, and in-process requests.
No live market lookup, external delivery, browser E2E, production load test,
full host production build, or deployment lifecycle test was run. Both provider
packages were built. The Convex quota test exercises the actual mutation with
a scripted database boundary, not a deployed Convex instance.
