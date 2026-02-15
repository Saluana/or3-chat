# Dumb Issues

## 1) Sync Gateway Pretends To Be Session-Auth But Doesn't Send Credentials
- Evidence: `app/core/sync/providers/gateway-sync-provider.ts:125-131`
- Why this is dumb: cross-origin cookie auth never works without `credentials: 'include'`.
- Consequence: sync breaks in real deployments.
- Fix: add `credentials: 'include'` to fetch.

## 2) Storage Gateway Repeats The Exact Same Credential Bug
- Evidence: `app/core/storage/providers/gateway-storage-provider.ts:44-50`
- Why this is dumb: same architectural contract, same broken fetch options.
- Consequence: presign/commit fails outside same-origin setups.
- Fix: add `credentials: 'include'`.

## 3) `autoProvision=false` Can Become Global Deny-All
- Evidence: `server/auth/session.ts:223-231`, `server/auth/store/types.ts:31-41`
- Why this is dumb: `getUser` is optional, but missing `getUser` is treated as “user not found”.
- Consequence: one config toggle can lock out everyone on providers that don't implement `getUser`.
- Fix: require `getUser` when `autoProvision=false`, else fail with explicit 500 config error.

## 4) Convex Job `complete`/`fail` Ignore State Machine
- Evidence: `convex/backgroundJobs.ts:180-195`, `convex/backgroundJobs.ts:210-217`
- Why this is dumb: terminal state writes are unconditional.
- Consequence: aborted jobs can be overwritten to complete/error via race.
- Fix: guard both mutations with `if (!job || job.status !== 'streaming') return;`.

## 5) Background Workflow Persists State With Fire-And-Forget Writes
- Evidence: `server/utils/workflows/background-execution.ts:249-275`, `server/utils/workflows/background-execution.ts:295`
- Why this is dumb: concurrent async writes can land out of order.
- Consequence: persisted workflow state regresses (wrong node/status).
- Fix: serialize writes via a local promise queue.

## 6) Admin/Wizard Config Builder Is Out Of Sync With Runtime Auth Config
- Evidence: `server/admin/config/resolve-config.ts:191-199` vs `config.or3cloud.ts:25-31`
- Why this is dumb: “authoritative” builder drops `guestAccessEnabled`, `autoProvision`, `sessionProvisioningFailure`.
- Consequence: validation and runtime disagree.
- Fix: map these fields in `buildOr3CloudConfigFromEnv`.

## 7) OpenRouter “Fallback” Isn't A Fallback For Proxy Errors
- Evidence: `app/utils/chat/openrouterStream.ts:215-229`
- Why this is dumb: non-404/405 proxy errors hard-fail even when client API key exists.
- Consequence: transient SSR route failures kill chat instead of falling back.
- Fix: only hard-fail when `forceServerRoute` is true.

## 8) Sync Delete Logic Can Resurrect Data
- Evidence: `convex/sync.ts:289-304`, `convex/sync.ts:307-327`
- Why this is dumb: repeated delete with higher clock is ignored if already deleted.
- Consequence: stale put can win and revive deleted records.
- Fix: always advance delete clock/hlc when incoming delete wins.

## 9) Payload Size Validation Can Blow Up Into 500
- Evidence: `convex/sync.ts:467-468`
- Why this is dumb: `JSON.stringify` can throw on circular payloads.
- Consequence: malformed payload triggers generic server error instead of clean validation failure.
- Fix: wrap stringify in try/catch and return deterministic validation error.

## 10) Lint Setup Ignores Core Runtime Directories
- Evidence: `eslint.config.mjs:48-56`
- Why this is dumb: plugin/runtime glue is excluded from strict linting.
- Consequence: unsafe patterns are allowed where integrations are most fragile.
- Fix: remove blanket ignores; use narrow per-file exceptions.

## 11) Runtime Config Typing Is Broken In `nuxt.config.ts`
- Evidence: `nuxt.config.ts:237`, `nuxt.config.ts:240`, `nuxt.config.ts:242`
- Why this is dumb: numeric values are assigned to runtime config keys Nuxt types as string runtime overrides (`NUXT_STORAGE_*`), which hard-breaks `bun run type-check`.
- Consequence: CI/local typecheck is red, so this cannot be merged safely and blocks release hardening tasks marked as done.
- Fix: align runtime config types with Nuxt expectations (string in runtime config + parse at read site), or move typed numeric values under non-env-overridden keys.

## 12) Storage Endpoints Use Impossible Casts And Still Don’t Handle Real Runtime Types
- Evidence: `server/api/storage/presign-upload.post.ts:87-91`, `server/api/storage/gc/run.post.ts:77-81`
- Why this is dumb: both handlers force-cast `runtimeConfig.storage` to numeric fields even though runtime typing says these values may be strings; TypeScript rejects this and runtime behavior silently skips enforcement when values are stringy.
- Consequence: compile failure now; after a cast “fix,” quota/GC defaults can still misbehave depending on env override shape.
- Fix: add explicit runtime parsing/normalization helpers for `workspaceQuotaBytes`, `gcRetentionSeconds`, `gcCooldownMs` and use them in handlers instead of structural casts.

## 13) Test Mock Narrowing Broke Health Endpoint Typecheck
- Evidence: `server/api/__tests__/health.get.test.ts:37`, `server/api/__tests__/health.get.test.ts:85`
- Why this is dumb: the mock object is initialized with the extended storage shape, then reassigned with a smaller object; TypeScript narrows to the larger shape and rejects later assignments.
- Consequence: `bun run type-check` fails in test code, so you can’t claim quality gates are green.
- Fix: keep reassigned mock shape consistent (include the added storage fields) or type the mock with a broader explicit interface before mutation.

## 14) Quota Enforcement Has A Classic TOCTOU Race
- Evidence: `server/api/storage/presign-upload.post.ts:141-157`
- Why this is dumb: quota is checked before presign based on a snapshot with no reservation/lock, so concurrent uploads can both pass and exceed quota.
- Consequence: “enforced quota” is not actually enforced under real load; tenants can burst past limits.
- Fix: enforce quota at commit/write time in a transactional backend operation, or reserve bytes atomically during presign and reconcile on upload completion/expiry.

## 15) Quota Check Does O(Change Log) Work On Every Upload
- Evidence: `server/utils/storage/quota.ts:47-74`, `server/api/storage/presign-upload.post.ts:141-144`
- Why this is dumb: every presign calls sync pull from cursor `0` and replays `file_meta` history into a map; that is linear-to-history network/CPU work on a hot path.
- Consequence: upload latency and backend load scale with workspace age, not request size; this degrades badly in production.
- Fix: maintain a materialized per-workspace usage counter (or cached snapshot with invalidation) and query that in O(1) for quota checks.

## 16) New Sync GC Guards Trigger ESLint Warnings And Fail The Gate
- Evidence: `app/core/sync/gc-manager.ts:172`, `app/core/sync/gc-manager.ts:190`
- Why this is dumb: these guards are flagged as unnecessary conditionals, so the branch adds noise while failing `eslint --max-warnings 0`.
- Consequence: lint gate is red even if runtime behavior is acceptable.
- Fix: refactor the control flow so the guards are structurally necessary to the analyzer, or add a targeted lint suppression with rationale if this is intentionally defensive.

## 17) Repo Still Has Existing Lint Debt In Sync Gateway Registry
- Evidence: `server/sync/gateway/registry.ts:125`
- Why this is dumb: optional chaining/nullish fallback is used where types already guarantee a value, so lint is right to call it dead defensive code.
- Consequence: `bun run eslint . --max-warnings 0` fails, which violates the “no warnings/errors” quality bar requested here.
- Fix: simplify to one concrete source of provider ID (or adjust runtime config typing) so the fallback chain is either necessary or removed.
