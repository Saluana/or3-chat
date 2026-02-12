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
