# Code Review - Feb 10

Scope: Branch-wide deep review (correctness, safety, performance, maintainability, clarity).
Method: Neckbeard + razor criteria.

Findings:

## [High] Gateway Sync Drops Auth Cookies On Cross-Origin Calls
- Evidence: `app/core/sync/providers/gateway-sync-provider.ts:125-131`
```ts
const res = await fetch(`${baseUrl}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
```
- Why this is bad: The provider is documented as SSR cookie/session-backed, but requests omit `credentials: 'include'`. Browsers do not send cookies for cross-origin requests without explicit credentials.
- Real-world consequence: Sync silently fails with 401/403 in split-origin deployments (UI origin != API origin), exactly the environment CORS middleware is trying to support.
- Concrete fix:
```ts
const res = await fetch(`${baseUrl}${path}`, {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
```

## [High] Gateway Storage Has The Same Credential Bug
- Evidence: `app/core/storage/providers/gateway-storage-provider.ts:44-50`
```ts
const res = await fetch(`${baseUrl}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
```
- Why this is bad: Same architectural contract, same omission. Storage presign/commit routes depend on session auth, but cookies are not guaranteed to be sent cross-origin.
- Real-world consequence: Upload/download presign breaks in production topologies that separate app and API hostnames.
- Concrete fix:
```ts
const res = await fetch(`${baseUrl}${path}`, {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
```

## [Blocker] `autoProvision=false` Can Lock Out Every User Depending On Store Implementation
- Evidence: `server/auth/session.ts:223-231`, `server/auth/store/types.ts:31-41`
```ts
const existingUser = await store.getUser?.({ ... });
if (!existingUser) {
  throw createError({ statusCode: 403, ... });
}
```
```ts
getUser?(...): Promise<... | null>;
```
- Why this is bad: `getUser` is optional in the interface, but session logic treats missing implementation as “user does not exist”. That turns `autoProvision=false` into a global deny-all for providers that legitimately implement only `getOrCreateUser`.
- Real-world consequence: Production auth outage after flipping one env flag, with no migration guard.
- Concrete fix: Make capability explicit and fail fast when misconfigured.
```ts
if (!autoProvision) {
  if (!store.getUser) {
    throw createError({
      statusCode: 500,
      statusMessage:
        'Auth store must implement getUser when OR3_AUTH_AUTO_PROVISION=false',
    });
  }
  const existingUser = await store.getUser({ ... });
  if (!existingUser) { ...403... }
}
```

## [High] Convex Background Job `complete`/`fail` Can Overwrite Aborted Jobs
- Evidence: `convex/backgroundJobs.ts:180-195`, `convex/backgroundJobs.ts:210-217`
```ts
const job = await ctx.db.get(args.job_id);
if (!job) return;
await ctx.db.patch(args.job_id, { status: 'complete', ... });
```
```ts
const job = await ctx.db.get(args.job_id);
if (!job) return;
await ctx.db.patch(args.job_id, { status: 'error', ... });
```
- Why this is bad: No status guard means terminal state transitions are not enforced. An aborted job can be overwritten to `complete` or `error` if completion races with abort.
- Real-world consequence: UI/notification inconsistency and broken abort semantics (“aborted” jobs finish anyway).
- Concrete fix:
```ts
if (!job || job.status !== 'streaming') return;
```
Apply this to both `complete` and `fail` mutations.

## [High] Background Workflow State Writes Are Fire-And-Forget And Can Reorder
- Evidence: `server/utils/workflows/background-execution.ts:249-275`, `server/utils/workflows/background-execution.ts:295`
```ts
void updateWorkflowJob(provider, jobId, workflowState);
```
- Why this is bad: Multiple async writes are launched without sequencing. Slower earlier writes can land after newer writes and persist stale `workflow_state`.
- Real-world consequence: Node states jump backward, wrong current node, or stale error/completion state in persisted status endpoints.
- Concrete fix: serialize writes through a local promise chain in this module.
```ts
let writeQueue = Promise.resolve();
const enqueueWrite = (chunk?: string, chunksReceived?: number) => {
  writeQueue = writeQueue.then(() =>
    updateWorkflowJob(provider, jobId, workflowState, chunk, chunksReceived)
  );
  return writeQueue;
};
```
Then replace `void updateWorkflowJob(...)` with `void enqueueWrite(...)`.

## [Medium] Config Builder Drift: Admin/Wizard Validation Ignores New Auth Flags
- Evidence: `server/admin/config/resolve-config.ts:191-199`, `config.or3cloud.ts:25-31`
```ts
// resolve-config auth output
auth: {
  enabled: authEnabled,
  provider: authProvider as AuthProviderId,
  clerk: { ... }
}
```
```ts
// runtime config source includes:
guestAccessEnabled,
autoProvision,
sessionProvisioningFailure
```
- Why this is bad: authoritative env->config builder used by admin/wizard omits fields now used by runtime auth behavior.
- Real-world consequence: validation and generated config can diverge from runtime, causing “config says one thing, server does another”.
- Concrete fix: include all auth fields in `buildOr3CloudConfigFromEnv`.
```ts
auth: {
  enabled: authEnabled,
  provider: authProvider as AuthProviderId,
  guestAccessEnabled: env.OR3_GUEST_ACCESS_ENABLED === 'true',
  autoProvision: env.OR3_AUTH_AUTO_PROVISION !== 'false',
  sessionProvisioningFailure:
    (env.OR3_SESSION_PROVISIONING_FAILURE as
      | 'throw'
      | 'unauthenticated'
      | 'service-unavailable'
      | undefined),
  clerk: { ... },
}
```

## [Medium] OpenRouter “Fallback” Path Hard-Fails On Proxy Errors Even When Client Key Exists
- Evidence: `app/utils/chat/openrouterStream.ts:215-229`
```ts
throw new Error(`OpenRouter proxy error ${serverResp.status}: ...`);
...
if (error.message.startsWith('OpenRouter proxy error')) {
  throw error;
}
```
- Why this is bad: The function contract says “try server route first, fall back to direct when allowed”, but this path blocks fallback for any non-404/405 proxy failure.
- Real-world consequence: transient server-route issues (500/502) break chat for users who already have a valid client key and should be able to continue.
- Concrete fix: only hard-fail proxy errors when `forceServerRoute === true`; otherwise mark route unavailable and continue to direct fallback.
```ts
if (error instanceof Error && error.message.startsWith('OpenRouter proxy error')) {
  if (forceServerRoute) throw error;
  setServerRouteAvailable(false);
} else if (forceServerRoute) {
  throw ...;
}
```
## [High] Delete Replay With Higher Clock Is Ignored, So Stale Puts Can Resurrect Data
- Evidence: `convex/sync.ts:289-304`, `convex/sync.ts:307-327`
```ts
if (op.operation === 'delete') {
  if (existing && !existing.deleted) {
    await ctx.db.patch(existing._id, { deleted: true, clock: op.clock, hlc: op.hlc, ... });
  }
}
```
- Why this is bad: A second delete with a newer clock is dropped when row is already deleted. The row clock is left stale, so a later put with an intermediate clock can pass LWW and resurrect data incorrectly.
- Real-world consequence: Cross-device delete/put races can produce phantom data resurrection.
- Concrete fix: always advance deletion clock/hlc when incoming delete wins, regardless of current `deleted` flag.
```ts
if (existing) {
  const existingClock = existing.clock ?? 0;
  const existingHlc = typeof existing.hlc === 'string' ? existing.hlc : '';
  const shouldApplyDelete =
    op.clock > existingClock || (op.clock === existingClock && op.hlc > existingHlc);
  if (shouldApplyDelete) {
    await ctx.db.patch(existing._id, {
      deleted: true,
      deleted_at: payloadDeletedAt ?? nowSec(),
      updated_at: payloadUpdatedAt ?? nowSec(),
      clock: op.clock,
      hlc: op.hlc,
    });
  }
}
```

## [Medium] Payload Size Check Can Throw 500 On Circular Payloads
- Evidence: `convex/sync.ts:467-468`
```ts
if (op.payload && JSON.stringify(op.payload).length > MAX_PAYLOAD_SIZE_BYTES) {
```
- Why this is bad: `JSON.stringify` throws on circular structures. That escapes as a generic server error instead of a structured validation error.
- Real-world consequence: malformed/malicious payload can bypass expected error path and trigger noisy 500s.
- Concrete fix:
```ts
let payloadBytes = 0;
if (op.payload !== undefined) {
  try {
    payloadBytes = JSON.stringify(op.payload).length;
  } catch {
    throw new Error(`Invalid payload for ${op.table_name}: payload is not serializable`);
  }
}
if (payloadBytes > MAX_PAYLOAD_SIZE_BYTES) { ... }
```

## [Medium] Lint Coverage Is Artificially Narrow For Core Runtime Surfaces
- Evidence: `eslint.config.mjs:48-56`
```ts
'**/*.test.ts',
'tests/**',
'utils/**',
'app/plugins/**',
```
- Why this is bad: `app/plugins/**` and root `utils/**` are high-risk runtime codepaths, but strict TS lint rules are explicitly disabled for them.
- Real-world consequence: type-safety regressions and unsafe patterns accumulate in precisely the extension/runtime glue where they hurt most.
- Concrete fix: stop blanket-ignoring runtime directories; use targeted per-file overrides only where absolutely necessary.
```ts
// Remove broad ignores, then add narrow exceptions:
{ files: ['app/plugins/legacy-*.ts'], rules: { ... } }
```
