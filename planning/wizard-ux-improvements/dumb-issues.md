# Dumb Issues Report (S3 Provider + OR3 Chat)

## 1) Cross-workspace object exfiltration via trusted `storage_id`
- **Location:** `/Users/brendon/Documents/or3/or3-provider-s3/src/runtime/server/storage/s3-storage-gateway-adapter.ts:216-224`
- **Why this is bad:** `presignDownload` trusts caller-supplied `storageId` as the S3 key if present. The API auth check only proves access to the provided `workspace_id`, not to arbitrary keys in the bucket. A caller can request a presigned URL for a different workspace key by sending a forged `storage_id`.
- **Real-world consequence:** Tenant isolation break. A user in one workspace can download objects from another workspace if they can guess/obtain key names.
- **Concrete fix:** Never trust arbitrary `storage_id` for S3 here. Derive key from `(workspaceId, hash)` or require exact equality with derived key.

```ts
const derivedKey = buildS3ObjectKey({
  keyPrefix: this.cfg.keyPrefix,
  workspaceId: input.workspaceId,
  hash: input.hash,
});

if (input.storageId && input.storageId.trim() && input.storageId !== derivedKey) {
  throw createError({ statusCode: 400, statusMessage: 'storage_id mismatch' });
}

const key = derivedKey;
```

## 2) Commit integrity checks are optional when S3 omits HEAD fields
- **Location:** `/Users/brendon/Documents/or3/or3-provider-s3/src/runtime/server/storage/s3-storage-gateway-adapter.ts:273-288`
- **Why this is bad:** Size and MIME checks only run when `HeadObject` returns those fields. If `ContentLength` or `ContentType` is absent, commit still succeeds. That violates the stated verification contract.
- **Real-world consequence:** Invalid uploads can be committed, poisoning metadata and producing hard-to-debug client hash/download failures later.
- **Concrete fix:** Treat missing required HEAD fields as verification failure and delete blob best-effort.

```ts
if (typeof head.ContentLength !== 'number') {
  await this.clientInstance.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: derivedKey })).catch(() => {});
  throw createError({ statusCode: 400, statusMessage: 'Uploaded object missing content length' });
}
if (!head.ContentType) {
  await this.clientInstance.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: derivedKey })).catch(() => {});
  throw createError({ statusCode: 400, statusMessage: 'Uploaded object missing content type' });
}
```

## 3) GC early-stop condition is wrong and forces unnecessary full scans
- **Location:** `/Users/brendon/Documents/or3/or3-provider-s3/src/runtime/server/storage/s3-storage-gateway-adapter.ts:363-365`
- **Why this is bad:** Break condition uses `staleBlobCandidates >= limit && staleMarkerCandidates >= limit`. If one list reaches limit and the other does not, scan continues across the bucket.
- **Real-world consequence:** GC latency/cost scales with bucket size instead of requested limit, which gets ugly fast on large workspaces.
- **Concrete fix:** Stop when total candidate capacity is enough (or at least use `||`), not when both independent pools reach limit.

```ts
if (staleBlobCandidates.length + staleMarkerCandidates.length >= maxDeletes) {
  break;
}
```

## 4) New presign inputs are forwarded with zero validation
- **Location:** `/Users/brendon/Documents/or3/or3-chat/server/api/storage/presign-upload.post.ts:28-35`, `/Users/brendon/Documents/or3/or3-chat/server/api/storage/presign-download.post.ts:27-33`, `/Users/brendon/Documents/or3/or3-chat/server/api/storage/presign-upload.post.ts:121-128`, `/Users/brendon/Documents/or3/or3-chat/server/api/storage/presign-download.post.ts:91-97`
- **Why this is bad:** `expires_in_ms` and `disposition` are unbounded free-form values. Core now forwards them directly to adapters and eventually into response headers/query signing behavior.
- **Real-world consequence:** Input abuse surface expands (oversized disposition strings, malformed disposition directives, pathological expiry values). Even if one adapter clamps, future adapters can easily miss it.
- **Concrete fix:** Validate in core schema before dispatch: integer range for expiry and strict disposition grammar/length.

```ts
const BodySchema = z.object({
  // ...
  expires_in_ms: z.number().int().min(1).max(86_400_000).optional(),
  disposition: z.enum(['inline', 'attachment']).optional(),
});
```

## 5) Wizard S3 TTL validation allows invalid values that runtime rejects
- **Location:** `/Users/brendon/Documents/or3/or3-chat/shared/cloud/wizard/validation.ts:233-238`
- **Why this is bad:** Wizard only emits warnings for TTL outside practical bounds and never enforces integer/range constraints. Provider runtime later hard-fails for invalid TTL env values.
- **Real-world consequence:** Wizard reports “valid enough”, generated config ships, server fails/soft-disables provider at runtime. This is exactly the mismatch the wizard is supposed to prevent.
- **Concrete fix:** Make S3 TTL validation authoritative in wizard (`int`, `1..86400`) and use errors, not warnings, for invalid bounds.

```ts
if (!Number.isInteger(answers.s3UrlTtlSeconds)) {
  errors.push('OR3_STORAGE_S3_URL_TTL_SECONDS must be an integer.');
} else if (answers.s3UrlTtlSeconds < 1 || answers.s3UrlTtlSeconds > 24 * 60 * 60) {
  errors.push('OR3_STORAGE_S3_URL_TTL_SECONDS must be between 1 and 86400.');
}
```

## 6) Non-strict mode silently disables selected S3 provider
- **Location:** `/Users/brendon/Documents/or3/or3-provider-s3/src/runtime/server/plugins/register.ts:18-25`
- **Why this is bad:** When `storage.provider === 's3'` and config is invalid, plugin only warns and returns in non-strict mode. App boots without adapter and storage endpoints degrade to runtime 500s.
- **Real-world consequence:** Broken deployments pass startup and fail only during user traffic. That is avoidable operational pain.
- **Concrete fix:** Match FS behavior: if selected provider is invalid, fail fast regardless of strict mode.

```ts
if (!diagnostics.isValid) {
  throw new Error(`${diagnostics.errors.join(' ')} Install/configure s3 storage provider env values and restart.`);
}
```

## 7) Web wizard deploy skips Convex env bootstrap
- **Severity:** `P1`
- **Location:** `/Users/brendon/Documents/or3/or3-chat/server/wizard/index.ts:335-434`, `/Users/brendon/Documents/or3/or3-chat/shared/cloud/wizard/deploy.ts:194-241`
- **Why this is bad:** The web/API deploy path never calls `applyConvexEnv`, even though Clerk+Convex setups require Convex-side env keys (`CLERK_ISSUER_URL`, `OR3_ADMIN_JWT_SECRET`) to function.
- **Real-world consequence:** UI wizard installs look successful but auth fails immediately in Convex-backed deployments because required backend env vars were never set.
- **Concrete fix:** Invoke `applyConvexEnv` inside `runWizardDeploy` (and any shared deploy path), gate it on provider selections, respect `dryRun`, and surface failures as hard deploy errors.

```ts
if (answers.authProvider === 'clerk' && hasConvexProvider(answers)) {
  const convexEnvResult = await applyConvexEnv({ answers, instanceDir, dryRun });
  if (!convexEnvResult.ok) throw new Error(convexEnvResult.error);
}
```

## 8) Secret cache re-injects deleted credentials
- **Severity:** `P1`
- **Location:** `/Users/brendon/Documents/or3/or3-chat/shared/cloud/wizard/api.ts:402-429`
- **Why this is bad:** `transientSessionSecrets` is merged on write but never pruned. If a user removes or changes secret fields, stale values stay in memory and are reattached to subsequent `getSession(...includeSecrets=true)` responses.
- **Real-world consequence:** Removed secrets can continue to leak to clients and stale secrets can be silently reapplied, which is both a security and correctness bug.
- **Concrete fix:** Replace merge-with-old behavior with replace-from-current; delete missing keys and delete the map entry when no secrets remain.

```ts
const nextSecrets = extractWizardSecretAnswers(currentAnswers);
if (Object.keys(nextSecrets).length === 0) {
  this.transientSessionSecrets.delete(sessionId);
} else {
  this.transientSessionSecrets.set(sessionId, nextSecrets);
}
```

## 9) Wizard auth dies after cookie TTL expires
- **Severity:** `P1`
- **Location:** `/Users/brendon/Documents/or3/or3-chat/app/wizard/composables/useWizardSession.ts:41-44`, `/Users/brendon/Documents/or3/or3-chat/app/wizard/composables/useWizardSession.ts:255-258`, `/Users/brendon/Documents/or3/or3-chat/server/middleware/wizard-token-auth.ts:11-90`
- **Why this is bad:** The client is wired to send `x-wizard-token` from `sessionStorage`, but never stores that token. Once short-lived grant cookies expire, API calls become unauthorized and there is no client-side recovery path.
- **Real-world consequence:** Users get kicked out mid-install after long sessions and must restart the wizard flow, losing momentum and often state.
- **Concrete fix:** Persist the token on first load (query/cookie bootstrap) and always include `x-wizard-token`; alternatively refresh grant-cookie TTL on wizard API traffic.

```ts
const token = getBootstrapWizardToken();
if (token) sessionStorage.setItem(WIZARD_TOKEN_KEY, token);
```

## 10) Theme generator writes invalid TypeScript for normal input
- **Severity:** `P1`
- **Location:** `/Users/brendon/Documents/or3/or3-chat/scripts/cli/create-theme.ts:109-165`
- **Why this is bad:** User-provided strings (`displayName`, `description`, colors) are interpolated into quoted template output without escaping. Apostrophes/newlines/backslashes break the generated `theme.ts`.
- **Real-world consequence:** `bun run theme:create` can produce uncompilable code from perfectly valid human input, breaking builds and forcing manual repair.
- **Concrete fix:** Use safe serialization (`JSON.stringify`) for string interpolation in generated TS and docs.

```ts
const safeDisplayName = JSON.stringify(displayName);
const safeDescription = JSON.stringify(description);
```

## 11) Failed connection test discards user-entered step data
- **Severity:** `P2`
- **Location:** `/Users/brendon/Documents/or3/or3-chat/scripts/cli/or3-cloud.ts:1191-1220`
- **Why this is bad:** On connection-test failure with "do not bypass", control jumps before `submitAnswers` executes. The step is re-rendered from old session data, dropping everything the user just entered.
- **Real-world consequence:** One bad credential check forces full re-entry of the entire step, which is hostile UX and slows setup.
- **Concrete fix:** Keep the user patch persisted before retrying the test, or loop only inside the connection-test block so the step state is retained.

```ts
await api.submitAnswers(session.id, patch);
// retry test block without resetting step inputs
```

## 12) Sandbox script is coupled to a non-portable folder layout
- **Severity:** `P2`
- **Location:** `/Users/brendon/Documents/or3/or3-chat/scripts/cli/create-temp-sandbox.ts:159-178`
- **Why this is bad:** The default source path hardcodes a sibling `or3-sandbox/sandbox3` directory and fails hard if absent.
- **Real-world consequence:** `bun run sandbox:fresh` breaks in CI, forks, and most developer machines that do not mirror the author's local directory structure.
- **Concrete fix:** Treat missing default source as non-fatal; require explicit `--source` or vendor a template inside the repo.

```ts
if (!existsSync(sourcePath)) {
  throw new Error('Template missing. Pass --source <path> or install the sandbox template package.');
}
```

## 13) Wizard form labels are not connected to inputs
- **Severity:** `P2`
- **Location:** `/Users/brendon/Documents/or3/or3-chat/app/wizard/components/WizardFieldRenderer.vue:4-69`
- **Why this is bad:** `<label>` elements are visually present, but controls do not receive linked `id`/`for` relationships.
- **Real-world consequence:** Screen-reader and keyboard users get degraded form usability and fail core accessibility expectations.
- **Concrete fix:** Generate stable per-field IDs; bind label `for`, input `id`, and `aria-describedby` for helper text.

```vue
<label :for="fieldId">{{ field.label }}</label>
<UInput :id="fieldId" :aria-describedby="helpId" ... />
```

## 14) “CLI commands” tests don’t validate CLI behavior
- **Severity:** `P2`
- **Location:** `/Users/brendon/Documents/or3/or3-chat/scripts/__tests__/cli-commands.test.ts:1-172`
- **Why this is bad:** The test file name claims CLI coverage, but tests mostly exercise helper/compiler behavior and never execute the real wizard entrypoint flows (`init`, `--ui`, prompt/error paths).
- **Real-world consequence:** Shipping regressions in actual command parsing, interaction flow, or exit codes are likely to bypass CI.
- **Concrete fix:** Add process-level tests that run `scripts/cli/or3-cloud.ts` and sibling script commands in temp dirs with assertions on exit status, output, and generated artifacts.

```ts
const result = await execa('bun', ['scripts/cli/or3-cloud.ts', 'init', '--fast'], { cwd: tmpDir });
expect(result.exitCode).toBe(0);
```

## 15) Theme preview modal is not a real dialog
- **Severity:** `P3`
- **Location:** `/Users/brendon/Documents/or3/or3-chat/app/wizard/components/WizardStepThemes.vue:28-92`
- **Why this is bad:** Overlay opens visually but lacks dialog semantics/focus trap, so keyboard focus can escape to background controls.
- **Real-world consequence:** Broken keyboard navigation and assistive-tech confusion when preview is open.
- **Concrete fix:** Add `role="dialog"` + `aria-modal="true"` and enforce focus trapping while open.

```vue
<div role="dialog" aria-modal="true" @keydown.esc="closePreview">...</div>
```
