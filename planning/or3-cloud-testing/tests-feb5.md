# OR3 Cloud Test Backlog (Feb 5, 2026)

Purpose: build production-hardening test coverage for OR3 Cloud (SSR auth + sync + storage) with explicit edge cases and failure modes.

Status: unchecked task list, prioritized for implementation.

## Scope and quality bar

- Validate correctness under normal, failure, and adversarial inputs.
- Catch auth regressions (`can()` gating, workspace scoping, provider token flow).
- Catch data-loss risks (outbox, cursor, GC, transfer queue, retries).
- Catch provider-decoupling regressions (registry dispatch, adapter capability mismatch).
- Keep static/local-first behavior safe (SSR-gated paths remain gated).

## Test execution gates (Bun)

- `bun run test`
- `bunx nuxi typecheck`
- `bun run test -- --coverage` (for cloud-related suites)

---

## P0: Sync SSR endpoint tests

- [ ] `server/api/sync/__tests__/push.post.test.ts` for `server/api/sync/push.post.ts`
  - Validate `404` when SSR auth disabled.
  - Validate `404` when sync feature disabled.
  - Validate `400` for invalid `PushBatchSchema`.
  - Validate `400` when `put` payload fails table schema validation.
  - Validate `delete` op does not require full payload fields.
  - Validate `401` when session is unauthenticated/missing user/workspace.
  - Validate `403` when `workspace.write` fails for `scope.workspaceId`.
  - Validate `429` with `Retry-After` header when rate limited.
  - Validate rate-limit headers on allowed requests.
  - Validate `500` when adapter is not configured.
  - Validate adapter result passthrough and `recordSyncRequest` invocation.
  - Validate snake_case/camelCase payload conversion behavior for `TABLE_PAYLOAD_SCHEMAS`.

- [ ] `server/api/sync/__tests__/pull.post.test.ts` for `server/api/sync/pull.post.ts`
  - Validate auth/sync disabled behavior (`404`).
  - Validate malformed pull body (`400`).
  - Validate unauthenticated behavior (`401`).
  - Validate permission failure (`403`) for workspace mismatch.
  - Validate rate-limit rejection and `Retry-After`.
  - Validate `X-RateLimit-*` headers on success.
  - Validate `500` when adapter missing.
  - Validate adapter response passthrough (`changes`, `nextCursor`, `hasMore`).

- [ ] `server/api/sync/__tests__/update-cursor.post.test.ts` for `server/api/sync/update-cursor.post.ts`
  - Validate schema rejection: negative version, missing deviceId/scope.
  - Validate auth/permission/rate-limit matrix (`404/401/403/429`).
  - Validate adapter missing (`500`).
  - Validate success path returns `{ ok: true }`.
  - Validate cursor update called with exact `scope`, `deviceId`, `version`.

- [ ] `server/api/sync/__tests__/gc-change-log.post.test.ts` for `server/api/sync/gc-change-log.post.ts`
  - Validate schema errors (`retentionSeconds <= 0`).
  - Validate `workspace.write` enforcement.
  - Validate adapter missing (`500`).
  - Validate adapter capability missing (`501`) when `gcChangeLog` undefined.
  - Validate adapter call argument integrity.

- [ ] `server/api/sync/__tests__/gc-tombstones.post.test.ts` for `server/api/sync/gc-tombstones.post.ts`
  - Validate schema errors (`retentionSeconds <= 0`).
  - Validate permission enforcement.
  - Validate adapter missing (`500`) and unsupported capability (`501`).
  - Validate successful result passthrough.

---

## P0: Storage SSR endpoint tests

- [ ] `server/api/storage/__tests__/presign-upload.post.test.ts` for `server/api/storage/presign-upload.post.ts`
  - Validate `404` when SSR auth disabled or storage disabled.
  - Validate body schema failures (`workspace_id/hash/mime_type/size_bytes`).
  - Validate `401` unauthenticated session.
  - Validate `403` on `workspace.write` denial.
  - Validate `429` with `Retry-After` on rate-limit.
  - Validate `413` when size exceeds `or3Config.limits.maxCloudFileSizeBytes`.
  - Validate `415` when MIME type not allowlisted.
  - Validate `500` when adapter missing.
  - Validate adapter invocation payload mapping.
  - Validate metric and rate-limit accounting calls on success.
  - Validate response preserves `disposition`.

- [ ] `server/api/storage/__tests__/presign-download.post.test.ts` for `server/api/storage/presign-download.post.ts`
  - Validate `404` gating on auth/storage flags.
  - Validate body schema failures.
  - Validate `401`/`403` authz behavior (`workspace.read`).
  - Validate `429` and `Retry-After`.
  - Validate `500` when adapter missing.
  - Validate provider `expiresAt` precedence over fallback default.
  - Validate server fallback expiry when provider omits expiry.
  - Validate metric + rate-limit accounting on success.

- [ ] Expand `server/api/storage/__tests__/commit.post.test.ts` for `server/api/storage/commit.post.ts`
  - Add `404`, `400`, `401`, `403`, `500`, and `429` paths (currently only rate-limit path covered).
  - Validate commit is no-op when adapter has no `commit`.
  - Validate commit is executed when adapter supports it.
  - Validate `recordUploadComplete` and `recordSyncRequest` only on success.

- [ ] `server/api/storage/__tests__/gc.run.post.test.ts` for `server/api/storage/gc/run.post.ts`
  - Validate schema errors and defaults (`retention_seconds` default 30 days).
  - Validate `admin.access` enforcement.
  - Validate cooldown (`429`) and wait message.
  - Validate map behavior under repeated runs (same workspace throttled, other workspace allowed).
  - Validate adapter missing (`500`) and unsupported `gc` (`501`).
  - Validate adapter return passthrough (`deleted_count`).

---

## P0: Workspace SSR endpoint tests

- [ ] `server/api/workspaces/__tests__/index.get.test.ts` for `server/api/workspaces/index.get.ts`
  - Validate `401` when user ID absent.
  - Validate workspaces normalized correctly (`description`, `isActive`, defaults).
  - Validate sort by `createdAt` descending.
  - Validate empty list behavior.
  - Validate store failure propagation as proper server error.

- [ ] `server/api/workspaces/__tests__/index.post.test.ts` for `server/api/workspaces/index.post.ts`
  - Validate missing/blank name (`400`).
  - Validate overlong name (`>100`) and description (`>1000`) limits.
  - Validate whitespace trimming behavior.
  - Validate `401` when user missing.
  - Validate create payload shape passed to store.
  - Validate store errors surfaced predictably.

- [ ] `server/api/workspaces/__tests__/active.post.test.ts` for `server/api/workspaces/active.post.ts`
  - Validate missing workspace ID (`400`).
  - Validate `401` when user missing.
  - Validate store invocation with exact IDs.
  - Validate store rejection path and response shape on success.

- [ ] `server/api/workspaces/__tests__/id.patch.test.ts` for `server/api/workspaces/[id].patch.ts`
  - Validate ID extraction and validation.
  - Validate name/description validation and trim rules.
  - Validate permissions and role constraints via helper/session.
  - Validate optimistic update behavior and error mapping.

- [ ] `server/api/workspaces/__tests__/id.delete.test.ts` for `server/api/workspaces/[id].delete.ts`
  - Validate workspace ID requirement and permission checks.
  - Validate delete restrictions (owner/admin expectations, if enforced in store).
  - Validate protected/default workspace edge cases.
  - Validate success response contract.

- [ ] `server/api/workspaces/__tests__/_helpers.test.ts` for `server/api/workspaces/_helpers.ts`
  - Validate `requireWorkspaceSession` returns `404` when SSR auth disabled.
  - Validate `requireWorkspaceSession` enforces `workspace.read`.
  - Validate `resolveWorkspaceStore` provider selection fallback order.
  - Validate missing store error message includes provider ID.

---

## P0: Auth + token broker tests

- [ ] `server/auth/token-broker/__tests__/resolve.test.ts` for `server/auth/token-broker/resolve.ts`
  - Validate broker selection by runtime provider.
  - Validate fallback to clerk provider ID when missing config.
  - Validate null return when broker not registered.
  - Validate broker receives exact request payload.

- [ ] `server/auth/token-broker/impls/__tests__/clerk-token-broker.test.ts` for `server/auth/token-broker/impls/clerk-token-broker.ts`
  - Validate null behavior when `event.context.auth` missing.
  - Validate invalid auth context shape handling.
  - Validate empty/whitespace token rejection.
  - Validate happy path token mint with template passthrough.
  - Validate error handling when `getToken` throws.

- [ ] `app/composables/auth/__tests__/useAuthTokenBroker.client.test.ts` for `app/composables/auth/useAuthTokenBroker.client.ts`
  - Validate returns null when `ssrAuthEnabled` is false.
  - Validate waits for Clerk and times out cleanly.
  - Validate returns null when Clerk has no session.
  - Validate token retrieval with template forwarding.
  - Validate thrown errors are swallowed and logged (returns null).

- [ ] `app/composables/auth/__tests__/useSessionRefresh.client.test.ts` for `app/composables/auth/useSessionRefresh.client.ts`
  - Validate timer starts once and does not duplicate intervals.
  - Validate token refresh requests use provider/template constants.
  - Validate warning path on null token.
  - Validate stop clears interval.
  - Validate `onUnmounted` cleanup.
  - Validate refresh errors do not crash caller.

- [ ] Expand `server/auth/__tests__/session.test.ts` for `server/auth/session.ts`
  - Add provider-not-registered behavior (`authenticated: false` cache path).
  - Add request-cache isolation checks by provider and request ID.
  - Add `sessionProvisioningFailure` mode matrix (`throw`, `unauthenticated`, `service-unavailable`).
  - Add workspace store missing-provider path.
  - Add deployment admin checker failure handling path.

- [ ] Expand `server/auth/__tests__/can.test.ts` for `server/auth/can.ts`
  - Add explicit cross-workspace denial with `resource.id` mismatch.
  - Add `admin.access` allow with `deploymentAdmin=true`.
  - Add behavior with missing role vs missing auth.
  - Add filter engine unavailable path to ensure deterministic baseline decisions.

---

## P1: Sync core client tests

- [ ] `app/core/sync/__tests__/hook-bridge.test.ts` for `app/core/sync/hook-bridge.ts`
  - Validate create/update/delete capture into `pending_ops`.
  - Validate suppression for `markSyncTransaction`.
  - Validate missing table handling does not crash start.
  - Validate dotted update keys merge correctly into nested payload.
  - Validate empty PK guard skips capture.
  - Validate KV blocklist defaults and hook-extended blocklist.
  - Validate message skip when `pending=true`.
  - Validate message required-field guard for corrupted payloads.
  - Validate message `order_key` auto-generation from HLC.
  - Validate delete capture writes tombstones.
  - Validate deferred enqueue when transaction lacks `pending_ops`/`tombstones`.
  - Validate `sync.capture:action:failed` and `sync.capture:action:deferredFailed` hook emissions.

- [ ] `app/core/sync/__tests__/cursor-manager.test.ts` for `app/core/sync/cursor-manager.ts`
  - Validate initial cursor and bootstrap detection.
  - Validate cursor persistence and `markSyncComplete` timestamp updates.
  - Validate expiry checks with custom `maxAgeMs`.
  - Validate `reset()` clears state.
  - Validate singleton behavior per `db+scope`.
  - Validate cleanup and `_resetCursorManagers()` helper behavior.

- [ ] `app/core/sync/__tests__/gc-manager.test.ts` for `app/core/sync/gc-manager.ts`
  - Validate start schedules immediate and interval GC.
  - Validate stop clears interval and idle callbacks/timeouts.
  - Validate local tombstone cleanup cutoff logic (`deletedAt`, `syncedAt`).
  - Validate circuit-breaker short-circuit skips provider GC calls.
  - Validate adapter capability checks (`gcTombstones`, `gcChangeLog` optional).
  - Validate error path emits `sync.gc:action:error`.
  - Validate re-entrancy guard (`running`) prevents overlap.

- [ ] `app/core/sync/__tests__/sync-provider-registry.test.ts` for `app/core/sync/sync-provider-registry.ts`
  - Validate registration and overwrite warnings.
  - Validate active provider set/get behavior.
  - Validate fallback to first provider when no active provider set.
  - Validate unregister clears active provider.
  - Validate `_clearProviders()` resets global state.

- [ ] `app/core/sync/providers/__tests__/convex-sync-provider.test.ts` for `app/core/sync/providers/convex-sync-provider.ts`
  - Validate provider metadata (`id`, `mode`, auth template).
  - Validate subscribe filters by table list and handles malformed change payload.
  - Validate known Convex unwatch race suppression.
  - Validate pull response schema validation failure path.
  - Validate push result schema validation failure path.
  - Validate API mapping for pull/push/updateCursor/gc mutations.
  - Validate `dispose()` unsubscribes all tracked subscriptions.

- [ ] `shared/sync/__tests__/table-metadata.test.ts` for `shared/sync/table-metadata.ts`
  - Validate PK field resolution across all synced tables.
  - Validate unknown table handling behavior.

---

## P1: Storage core client tests

- [ ] Expand `app/core/storage/__tests__/transfer-queue.test.ts` for `app/core/storage/transfer-queue.ts`
  - Add success upload flow (presign -> upload -> commit -> metadata persistence).
  - Add success download flow (presign -> fetch -> hash verification -> blob save).
  - Validate workspace switch cancels in-flight transfers.
  - Validate transfer cancellation marks failed with cancellation reason.
  - Validate concurrency cap enforcement.
  - Validate backoff progression and cap (`base`, `max`).
  - Validate non-retryable failure handling (`retryable:false` / 413 scenario).
  - Validate waiter behavior (`waitForTransfer`) for done/failed/not-found/timeout.
  - Validate `ensureDownloadedBlob` behavior with cached and uncached blobs.
  - Validate policy filter rejection path.
  - Validate hook emissions before/after upload/download.
  - Validate progress updates via `readBlobWithProgress`.
  - Validate old transfer cleanup (`done`/`failed` retention).

- [ ] `app/core/storage/providers/__tests__/convex-storage-provider.test.ts` for `app/core/storage/providers/convex-storage-provider.ts`
  - Validate endpoint payload mapping for upload/download/commit.
  - Validate Zod parse failures for malformed endpoint responses.
  - Validate non-OK HTTP path raises error with status.
  - Validate default `storage_provider_id` behavior on commit.

- [ ] `app/core/storage/providers/__tests__/gateway-storage-provider.test.ts` for `app/core/storage/providers/gateway-storage-provider.ts`
  - Validate base URL joining and path selection.
  - Validate error messages include endpoint and status text.
  - Validate upload/download/commit payload mapping and response mapping.
  - Validate custom provider ID/displayName config behavior.

- [ ] Expand `app/utils/__tests__/hash.test.ts` for `app/utils/hash.ts`
  - Add SHA-256 computation path test.
  - Add MD5 fallback path tests (subtle unavailable -> spark streaming).
  - Add invalid WebCrypto path and error propagation.
  - Add `computeFileHash` prefix formatting.
  - Add large-blob chunking/yield behavior contract (mocked).

- [ ] `app/utils/files/__tests__/attachments.test.ts` for `app/utils/files/attachments.ts`
  - Validate `parseHashes` for arrays, JSON strings, CSV, single string, bad input.
  - Validate dedupe/order retention in `mergeAssistantFileHashes`.
  - Validate `normalizeImagesParam` for strings, object variants, invalid entries.

---

## P1: Gateway adapters + registries (server)

- [ ] `server/sync/gateway/__tests__/registry.test.ts` for `server/sync/gateway/registry.ts`
  - Validate register/get/list behavior.
  - Validate cached instance reuse.
  - Validate cached instance reset on re-register.
  - Validate active adapter selection from runtime config.
  - Validate null return when provider absent/not registered.

- [ ] `server/storage/gateway/__tests__/registry.test.ts` for `server/storage/gateway/registry.ts`
  - Validate register/get/list behavior.
  - Validate create() call semantics (current non-cached behavior).
  - Validate active adapter selection from runtime config.
  - Validate null return for missing provider.

- [ ] `server/sync/gateway/impls/__tests__/convex-sync-gateway-adapter.test.ts` for `server/sync/gateway/impls/convex-sync-gateway-adapter.ts`
  - Validate `resolveProviderToken` usage for every method.
  - Validate `401` when provider token missing.
  - Validate API mapping for pull/push/updateCursor/gc methods.
  - Validate pull mapping converts Convex `op` to `'put' | 'delete'`.

- [ ] `server/storage/gateway/impls/__tests__/convex-storage-gateway-adapter.test.ts` for `server/storage/gateway/impls/convex-storage-gateway-adapter.ts`
  - Validate token requirement and `401`.
  - Validate presign upload/download mapping and expiry resolution.
  - Validate `404` when download URL is absent.
  - Validate commit mapping (`storage_id` cast and metadata fields).
  - Validate GC mapping and `deleted_count` response shape.

---

## P1: Auth workspace store tests

- [ ] `server/auth/store/impls/__tests__/convex-auth-workspace-store.test.ts` for `server/auth/store/impls/convex-auth-workspace-store.ts`
  - Validate config guards (`convexUrl`, `convexAdminKey`) throw clear errors.
  - Validate admin-auth subject mapping (`providerUserId` -> token identifier).
  - Validate `getOrCreateUser` existing-user and create-user paths.
  - Validate `getOrCreateDefaultWorkspace` mapping and defaults.
  - Validate `getWorkspaceRole` null when workspace mismatch.
  - Validate list normalization (`description`, `createdAt`, `isActive`).
  - Validate create/update/remove/setActive mutation payloads.
  - Validate propagated backend errors are not swallowed.

---

## P2: Integration and end-to-end hardening

- [ ] `tests/integration/sync-endpoints.integration.test.ts`
  - End-to-end push->pull->cursor checkpoint flow across SSR gateway.
  - Validate monotonic cursor advancement over multi-batch pulls.
  - Validate rate-limit recovery and retry behavior.

- [ ] `tests/integration/sync-multidevice.integration.test.ts`
  - Simulate two devices writing same record with HLC tie-breaks.
  - Validate stable message ordering (`index` + `order_key`).
  - Validate remote apply does not re-enqueue outbox writes.

- [ ] `tests/integration/sync-rescan-recovery.integration.test.ts`
  - Validate cursor reset/rescan flow with pending local ops overlay.
  - Validate no duplicate records after rescan.
  - Validate stale cursor and recovery behavior.

- [ ] `tests/integration/storage-roundtrip.integration.test.ts`
  - Upload->commit->download roundtrip with hash verification.
  - Validate dedupe behavior on same hash uploaded twice.
  - Validate expired presign URL retry path.

- [ ] `tests/integration/storage-workspace-isolation.integration.test.ts`
  - Validate cross-workspace presign/download/commit access is denied.
  - Validate GC only affects target workspace.

- [ ] `tests/integration/workspace-switch-runtime.integration.test.ts`
  - Validate switching workspace cancels transfer/sync operations safely.
  - Validate queues resume only for active workspace.

- [ ] `tests/integration/auth-provisioning.integration.test.ts`
  - Validate first-login provisioning creates workspace and role.
  - Validate provisioning failure mode matrix from runtime config.
  - Validate deployment admin flag propagation into session context.

- [ ] `tests/e2e/cloud-offline-recovery.e2e.ts`
  - Offline edits -> reconnect -> sync convergence.
  - Download missing blob on-demand after reconnect.
  - Validate no notification storm during bootstrap/rescan.

- [ ] `tests/e2e/cloud-auth-gating.e2e.ts`
  - Validate static/local mode does not expose SSR-auth cloud routes.
  - Validate SSR mode requires auth for all cloud endpoints.

- [ ] `tests/e2e/cloud-chaos.e2e.ts`
  - Inject intermittent adapter failures/timeouts.
  - Validate circuit-breaker/backoff prevent retry storms.
  - Validate system eventually recovers without data corruption.

---

## Cross-cutting bug-hunt scenarios to include in each relevant suite

- [ ] Workspace ID mismatch between session and request body/scope.
- [ ] Missing provider registration for selected runtime provider.
- [ ] Unsupported adapter capability (`gc`, `gcChangeLog`, `gcTombstones`, `commit`).
- [ ] Non-ASCII or unusual filenames and MIME edge values.
- [ ] Very large payloads and size-boundary off-by-one checks.
- [ ] Out-of-order clocks/versions and stale cursor inputs.
- [ ] Concurrent operations racing with teardown (`unsubscribe`, `stop`, unmount).
- [ ] Hook engine availability/timing (ensure no crashes before plugin init in tests).

---

## Definition of done for this backlog

- [ ] Every P0 suite implemented and passing in CI.
- [ ] P1 suites implemented or explicitly deferred with risk note.
- [ ] New failures produce deterministic, actionable assertions.
- [ ] `bun run test` and `bunx nuxi typecheck` pass after each test wave.
- [ ] Coverage report includes cloud-critical modules (auth/sync/storage/workspaces/adapters).
