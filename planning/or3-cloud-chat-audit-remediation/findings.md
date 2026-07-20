# Combined Code Review Findings

## Verdict: IMPLEMENTATION COMPLETE — RELEASE VERIFICATION PENDING

All 89 findings in this catalog have been remediated and their linked implementation
and regression tasks are complete. The release gate remains in place only because
the workspace sandbox denied the Basic Auth package's loopback endpoint test server;
see [verification.md](verification.md). Do not lift the gate until those 10 tests are
rerun in an environment that permits binding `127.0.0.1`.

This file is the evidence catalog. Completion is tracked in [tasks.md](tasks.md),
and command-level release evidence is recorded in [verification.md](verification.md).

## Scope

- `or3-chat`
- `or3-provider-basic-auth`
- `or3-provider-clerk`
- `or3-provider-convex`, including generated templates
- `or3-provider-sqlite`
- `or3-provider-fs`
- `or3-provider-s3`

## Cloud authorization and identity

### CA-001 — Public Convex invite and identity APIs trust the caller

- **Status:**** Closed · **Severity:** Blocker
- **Evidence:**** `convex/workspaces.ts:577`, `convex/workspaces.ts:642`, `convex/users.ts:38`; the provider template mirrors the public surface.
- **Failure:**** Callers can resolve identities and supply inviter, accepting user, and requested role without authenticated owner/`users.manage` enforcement. Direct Convex callers can enumerate mappings, forge owner invitations, or revoke legitimate invitations.
- **Required remediation:**** Derive identity from authenticated context, subject-bind public functions, make server-only helpers internal, and enforce owner/capability checks.
- **Tasks:**** 0.4, 1.1, 1.3, 1.4, 11.1.

### CA-002 — Viewer membership is treated as write and GC authorization

- **Status:**** Closed · **Severity:** Blocker
- **Evidence:**** `convex/sync.ts:391`, `convex/sync.ts:448`, `convex/sync.ts:875`.
- **Failure:**** Any member, including a viewer, can push arbitrary rows and invoke destructive history/tombstone GC with caller-supplied cursor/retention values.
- **Required remediation:**** Split read, write, and administrative capabilities; make GC internal/administrative and strictly validate all bounds.
- **Tasks:**** 0.4, 1.1, 1.5, 2.7, 2.8, 11.1.

### CA-003 — Anonymous traffic can consume the managed OpenRouter key

- **Status:**** Closed · **Severity:** Blocker
- **Evidence:**** `server/api/openrouter/stream.post.ts:99`, `server/api/openrouter/stream.post.ts:343`; background execution omits `workspace.write`.
- **Failure:**** Instance credentials are selected before authentication, allowing anonymous credit burn and viewer-launched paid/background work.
- **Required remediation:**** Require authenticated paid/background capability for managed keys; guest mode must use caller credentials.
- **Tasks:**** 0.5, 1.1, 11.1.

### CA-004 — Convex user identity changes after the first request

- **Status:**** Closed · **Severity:** High
- **Evidence:**** `../or3-provider-convex/src/runtime/server/auth/convex-auth-workspace-store.ts:121`, `:147`.
- **Failure:**** Initial provisioning returns the provider subject while later lookup returns the internal user ID. Basic Auth UUIDs may also be cast as Convex document IDs. Sessions can change identity between requests.
- **Required remediation:**** Return/query the created internal `user_id` and remove prefix-based ID guessing.
- **Tasks:**** 1.6, 11.1.

### CA-005 — Workspace activation authorizes against the wrong workspace

- **Status:**** Closed · **Severity:** High
- **Evidence:**** `server/api/workspaces/active.post.ts:30`, `server/auth/can.ts:125`.
- **Failure:**** Policy rejects a legitimate target workspace because it is outside the currently active scope; tests mock away the real gate.
- **Required remediation:**** Authorize target membership or introduce `workspace.activate`, with real-policy tests.
- **Tasks:**** 1.1, 1.2, 1.7, 11.1.

### CA-006 — Invite acceptance is not atomic

- **Status:**** Closed · **Severity:** High
- **Evidence:**** `server/auth/session.ts:341`.
- **Failure:**** User creation precedes invite consumption. A consumption failure leaves an existing account that can bypass closed registration on the next request.
- **Required remediation:**** Atomically validate/consume the invite and create identity/membership, or use a non-login-capable provisional state.
- **Tasks:**** 1.8, 11.1.

### CA-007 — Basic Auth accepts any nonempty invite token

- **Status:**** Closed · **Severity:** High
- **Evidence:**** `../or3-provider-basic-auth/src/runtime/server/api/basic-auth/register.post.ts:62`.
- **Failure:**** Garbage token input permits account/session creation and email preclaiming.
- **Required remediation:**** Validate signature, expiry, state, and normalized invited email before mutation.
- **Tasks:**** 1.9, 11.1.

### CA-008 — Clerk accepts an unverified primary email

- **Status:**** Closed · **Severity:** High
- **Evidence:**** `../or3-provider-clerk/src/runtime/server/auth/clerk-auth-provider.ts:80`.
- **Failure:**** Mere email presence satisfies email-bound invitation logic, so an unverified address can claim an invitation.
- **Required remediation:**** Require `primaryEmail.verification.status === "verified"`.
- **Tasks:**** 1.10, 11.1.

### CA-009 — Raw cookies and bearer credentials are cache keys

- **Status:**** Closed · **Severity:** High
- **Evidence:**** `server/auth/token-broker/resolve.ts:39-41`, `:71`.
- **Failure:**** Secrets live in long-lived map keys and can leak through heap inspection/diagnostics; authorization changes do not naturally invalidate the key.
- **Required remediation:**** Use provider-namespaced opaque digests plus authorization revision and never log the source credential.
- **Tasks:**** 1.11, 11.1.

### CA-010 — Stale session requests can overwrite newer auth state

- **Status:**** Closed · **Severity:** High
- **Evidence:**** client session refresh/state commit paths under `app/composables/auth/useSessionContext.ts` and workspace/session watchers; no shared generation guard covers all commits.
- **Failure:**** An older in-flight response can restore signed-out identity or a previous workspace after a newer transition.
- **Required remediation:**** Bind commits to a monotonic auth/workspace generation.
- **Tasks:**** 1.12, 11.1.

### CA-011 — Workspace switching is not coordinated across tabs

- **Status:**** Closed · **Severity:** Medium
- **Evidence:**** active-workspace client state has no cross-tab revision/broadcast contract.
- **Failure:**** Tabs can operate against different active workspaces and late writes can restore stale state.
- **Required remediation:**** Broadcast a monotonic workspace revision and ignore stale commits.
- **Tasks:**** 1.13.

### CA-012 — Auxiliary Convex persistence functions are public and unauthenticated

- **Status:**** Closed · **Severity:** Blocker
- **Evidence:**** `../or3-provider-convex/templates/convex/backgroundJobs.ts:48`, `:91`, `:133`; `notifications.ts:72`; public webhook delivery and rate-limit mutations accept caller-selected identifiers without a shared authenticated boundary.
- **Failure:**** A direct Convex caller can forge job ownership, read or mutate guessed jobs, use the `user_id='*'` bypass, author notifications for other users, mutate delivery state, or consume shared rate-limit capacity outside the SSR authorization layer.
- **Required remediation:**** Make server persistence/worker functions internal, expose only subject-bound job/user reads or aborts, remove wildcard ownership bypasses, and derive every actor/rate-limit key from trusted server or authenticated context.
- **Tasks:**** 1.1, 1.14, 4.4, 7.4, 11.1.

## Cloud sync and convergence

### CS-001 — Retention makes fresh-device bootstrap permanently incomplete

- **Status:**** Closed · **Severity:** Blocker
- **Evidence:**** `app/core/sync/subscription-manager.ts:214`, `../or3-provider-sqlite/src/runtime/server/sync/sqlite-sync-gateway-adapter.ts:597`, `convex/sync.ts:702`.
- **Failure:**** Empty clients start at cursor zero but receive only retained log rows. Once an unchanged record's log entry is pruned, it is undiscoverable forever.
- **Required remediation:**** Disable GC, implement a consistent materialized snapshot at a high-watermark, then replay later log entries.
- **Tasks:**** 0.2, 2.1-2.9, 11.2.

### CS-002 — Convex inserts stale puts without consulting tombstones

- **Status:**** Closed · **Severity:** High
- **Evidence:**** `convex/sync.ts:358`, tombstones at `convex/sync.ts:142`.
- **Failure:**** A stale put resurrects a deleted record whenever the materialized row is absent.
- **Required remediation:**** Compare incoming revision against both live row and tombstone before insert.
- **Tasks:**** 3.1, 3.4, 11.2.

### CS-003 — Local conflict resolution uses stale page-start state

- **Status:**** Closed · **Severity:** High
- **Evidence:**** `app/core/sync/conflict-resolver.ts:94`.
- **Failure:**** State is preloaded once and not updated after each operation; a later logged loser can overwrite an earlier winner in the same page.
- **Required remediation:**** Update per-key state after every applied decision.
- **Tasks:**** 3.1, 3.5, 11.2.

### CS-004 — Startup deletes retry-exhausted outbox data

- **Status:**** Closed · **Severity:** High
- **Evidence:**** `app/core/sync/outbox-manager.ts:110`, `:637`.
- **Failure:**** Reload purges failed operations, including transient retry exhaustion, destroying the only retry record for unsynced user changes.
- **Required remediation:**** Retain explicit retryable/permanent failure states until user/system retry or discard.
- **Tasks:**** 4.1-4.3, 11.2.

### CS-005 — Row HLC and operation HLC describe different revisions

- **Status:**** Closed · **Severity:** High
- **Evidence:**** `app/core/sync/hook-bridge.ts:286`; several registered tables have no canonical row HLC.
- **Failure:**** Client and server can choose different equal-clock winners.
- **Required remediation:**** Stamp the exact revision tuple onto row and outbox operation in one transaction.
- **Tasks:**** 3.1, 3.6, 3.7, 11.5.

### CS-006 — Tombstones cannot resolve equal-clock conflicts

- **Status:**** Closed · **Severity:** High
- **Evidence:**** `shared/sync/types.ts:203`, `shared/sync/schemas.ts:252`, Convex tombstone schema.
- **Failure:**** Tombstones store clock but not HLC, contradicting deterministic LWW.
- **Required remediation:**** Migrate tombstones to the canonical revision tuple.
- **Tasks:**** 3.1-3.3, 11.5.

### CS-007 — Convex does not deduplicate same-batch `op_id`

- **Status:**** Closed · **Severity:** High
- **Evidence:**** idempotency checks query only pre-batch state around `convex/sync.ts:523`.
- **Failure:**** Repeated IDs each receive a version and log entry; conflicting payloads under one ID are accepted.
- **Required remediation:**** Deduplicate before version allocation and reject conflicting fingerprints.
- **Tasks:**** 3.8, 11.2.

### CS-008 — Device cursors can regress or jump into the future

- **Status:**** Closed · **Severity:** High
- **Evidence:**** `convex/sync.ts:656`.
- **Failure:**** Delayed requests pin GC while malicious future cursors can make retained data eligible for deletion.
- **Required remediation:**** Store monotonic bounded cursors and reject invalid values.
- **Tasks:**** 2.7, 11.2.

### CS-009 — Notifications leak through workspace-wide sync

- **Status:**** Closed · **Severity:** High
- **Evidence:**** `app/core/sync/hook-bridge.ts:22`; pull authorization is workspace-scoped.
- **Failure:**** Members receive other users' notification bodies/actions and writers can target another `user_id`.
- **Required remediation:**** Use a user-scoped stream with server-bound authorship.
- **Tasks:**** 4.4, 11.2.

### CS-010 — Oversized message bodies are replaced with a success marker

- **Status:**** Closed · **Severity:** High
- **Evidence:**** `shared/sync/sanitize.ts:144`.
- **Failure:**** `data.content` is destroyed while the outbox reports success.
- **Required remediation:**** Reject visibly while retaining the operation, or externalize/chunk content losslessly.
- **Tasks:**** 4.5, 11.2.

### CS-011 — Same-millisecond outbox coalescing can retain the older mutation

- **Status:**** Closed · **Severity:** High
- **Evidence:**** `app/core/sync/outbox-manager.ts:360`.
- **Failure:**** Replacement requires a strict later `Date.now()` value; same-tick put→delete can keep the put.
- **Required remediation:**** Order/coalesce by monotonic revision rather than wall-clock milliseconds.
- **Tasks:**** 3.9, 11.2.

### CS-012 — Generated Convex deployments reintroduce stale-delete wins

- **Status:**** Closed · **Severity:** High
- **Evidence:**** `../or3-provider-convex/templates/convex/sync.ts:292`.
- **Failure:**** Template delete behavior lacks the application's current LWW comparison. Newly generated deployments regress.
- **Required remediation:**** Share/port the comparator and test generated output continuously.
- **Tasks:**** 3.1, 3.12, 11.2.

### CS-013 — One malformed operation poisons valid batch siblings

- **Status:**** Closed · **Severity:** High
- **Evidence:**** validation in the Convex push loop around `convex/sync.ts:470-520` throws for the whole mutation.
- **Failure:**** A bad operation prevents deterministic results for unrelated valid operations, encouraging unsafe whole-batch replay.
- **Required remediation:**** Return per-operation validation/application results.
- **Tasks:**** 3.13, 11.2.

### CS-014 — Payloads can mutate indexed logical primary keys

- **Status:**** Closed · **Severity:** High
- **Evidence:**** payload normalization/application around `app/core/sync/sync-payload-normalizer.ts:61-82` and Convex materialization.
- **Failure:**** An update can move logical identity/ownership while retaining the old storage identity, breaking indexes and authorization assumptions.
- **Required remediation:**** Enforce immutable logical keys and ownership fields after insert.
- **Tasks:**** 3.10, 11.2.

### CS-015 — Tombstone retention trusts client deletion timestamps

- **Status:**** Closed · **Severity:** High
- **Evidence:**** `convex/sync.ts:613-621`, retention checks at `convex/sync.ts:915` and `:1043`.
- **Failure:**** A caller can make tombstones look old enough for immediate collection.
- **Required remediation:**** Server-bind deletion time and strictly validate any legacy input.
- **Tasks:**** 2.8, 3.2, 11.2.

### CS-016 — Soft-delete helpers emit puts instead of tombstones

- **Status:**** Closed · **Severity:** High
- **Evidence:**** soft-delete capture paths under `app/core/sync/hook-bridge.ts:286-363`.
- **Failure:**** Deleted rows do not participate in tombstone retention/conflict rules and can be resurrected inconsistently.
- **Required remediation:**** Emit canonical delete operations for soft deletion.
- **Tasks:**** 3.11, 11.2.

### CS-017 — Pull parses `Retry-After` but ignores it

- **Status:**** Closed · **Severity:** Medium
- **Evidence:**** parser at `app/core/sync/providers/gateway-sync-provider.ts:141`; subscription scheduling under `app/core/sync/subscription-manager.ts`.
- **Failure:**** Clients ignore server throttling and create avoidable retry load.
- **Required remediation:**** Carry typed retry delay into abortable bounded scheduling.
- **Tasks:**** 2.10.

### CS-018 — Stopped sync can resubscribe itself

- **Status:**** Closed · **Severity:** High
- **Evidence:**** lifecycle paths in `app/core/sync/subscription-manager.ts:176` and later retry/subscription callbacks.
- **Failure:**** In-flight completions can schedule work after `stop()`, duplicating engines or crossing workspace/logout boundaries.
- **Required remediation:**** Add a lifecycle generation checked by every callback.
- **Tasks:**** 4.6, 4.7, 11.2.

### CR-001 — Static generation still evaluates cloud/auth provider modules

- **Status:**** Closed · **Severity:** Medium
- **Evidence:**** provider module resolution in `nuxt.config.ts:100-180` occurs before all static/cloud-disabled gates.
- **Failure:**** Static/offline builds retain provider import side effects and can fail on unavailable server-only dependencies.
- **Required remediation:**** Gate module resolution/import and assert the static import boundary.
- **Tasks:**** 11.6.

## Cloud storage and transfers

### CST-001 — Quota and FS GC reconstruct liveness from lossy logs

- **Status:**** Closed · **Severity:** Blocker
- **Evidence:**** `server/utils/storage/quota.ts:30`, `../or3-provider-fs/src/runtime/server/storage/fs-storage-gateway-adapter.ts:117`.
- **Failure:**** Retention and losing LWW operations make canonical live files disappear from reconstructed state, allowing undercount and irreversible live-blob deletion.
- **Required remediation:**** Query canonical materialized metadata/reference edges only.
- **Tasks:**** 0.2, 0.3, 5.1-5.3, 5.14, 11.3.

### CST-002 — S3 partial listing can delete a committed live blob

- **Status:**** Closed · **Severity:** Blocker
- **Evidence:**** `../or3-provider-s3/src/runtime/server/storage/s3-storage-gateway-adapter.ts:344`.
- **Failure:**** Blob and marker split across pages appear unpaired; GC deletes the blob.
- **Required remediation:**** Finish listing or directly `HEAD` the counterpart before deletion.
- **Tasks:**** 0.3, 5.4, 5.14, 11.3.

### CST-003 — Missing remote state becomes a replicated user deletion

- **Status:**** Closed · **Severity:** High
- **Evidence:**** `app/core/storage/transfer-queue.ts:564`, `:606`, destructive helper at `:730`.
- **Failure:**** Missing `storage_id` or one 404/410 increments the clock, marks metadata deleted, and removes the cached blob. Normal upload ordering becomes data loss.
- **Required remediation:**** Use typed pending/remote-missing states; only authoritative user/server delete mutates metadata.
- **Tasks:**** 6.1, 6.2, 6.10, 11.3.

### CST-004 — Workspace switching rebinds the DB under active transfers

- **Status:**** Closed · **Severity:** High
- **Evidence:**** `app/core/storage/transfer-queue.ts:154`.
- **Failure:**** Old transfer settlement/cleanup can write into the new workspace DB.
- **Required remediation:**** Capture immutable workspace/database context per claim.
- **Tasks:**** 6.3, 6.10, 11.3.

### CST-005 — Persisted running transfers are never recovered

- **Status:**** Closed · **Severity:** High
- **Evidence:**** `app/core/storage/transfer-queue.ts:292`.
- **Failure:**** Only queued rows are selected; crash leaves running rows stranded and non-atomic claims permit multi-tab races.
- **Required remediation:**** Add transactional expiring leases and stale recovery.
- **Tasks:**** 6.4-6.6, 6.10, 11.3, 11.5.

### CST-006 — `ref_count` is not a trustworthy derived value

- **Status:**** Closed · **Severity:** High
- **Evidence:**** stripped outbound at `shared/sync/sanitize.ts:47`; inbound puts/provider defaults overwrite it without deriving canonical references.
- **Failure:**** Arithmetic can become `NaN`; GC can retain dead blobs or delete live ones.
- **Required remediation:**** Recompute transactionally from canonical references or remove it as an authority.
- **Tasks:**** 5.1, 5.11, 5.14, 11.3.

### CST-007 — Convex commit trusts caller-declared CAS metadata

- **Status:**** Closed · **Severity:** High
- **Evidence:**** `convex/storage.ts:134`.
- **Failure:**** Object ID, digest, size, and MIME are not bound to a one-time intent or verified against stored bytes, enabling CAS poisoning and quota/MIME bypass.
- **Required remediation:**** Signed one-time intents plus provider metadata/digest verification.
- **Tasks:**** 5.6, 5.7, 5.14, 11.3, 11.5.

### CST-008 — S3 does not enforce actual SHA-256 or upload size

- **Status:**** Closed · **Severity:** High
- **Evidence:**** presign at `../or3-provider-s3/src/runtime/server/storage/s3-storage-gateway-adapter.ts:175`, commit at `:248`.
- **Failure:**** Wrong or oversized bytes can occupy a trusted hash key.
- **Required remediation:**** Bind storage-enforced checksum/content length and re-verify at commit.
- **Tasks:**** 5.6, 5.8, 5.9, 5.14, 11.3.

### CST-009 — Quota has a presign/commit race

- **Status:**** Closed · **Severity:** High
- **Evidence:**** `server/api/storage/presign-upload.post.ts:146`, `server/api/storage/commit.post.ts:93`.
- **Failure:**** Concurrent presigns each pass current quota, then collectively exceed it at commit.
- **Required remediation:**** Atomic expiring quota reservations consumed at commit.
- **Tasks:**** 5.2, 5.6, 5.9, 5.10, 5.14, 11.3.

### CST-010 — Committed S3 objects are immortal

- **Status:**** Closed · **Severity:** High
- **Evidence:**** marker creation and GC logic at `../or3-provider-s3/src/runtime/server/storage/s3-storage-gateway-adapter.ts:302`.
- **Failure:**** A blob/marker pair survives forever after metadata deletion because each protects the other.
- **Required remediation:**** Canonical reference-driven retention deletes eligible pairs together.
- **Tasks:**** 0.3, 5.1, 5.5, 5.14, 11.3.

### CST-011 — Queue pumping bypasses transfer retry backoff

- **Status:**** Closed · **Severity:** Medium
- **Evidence:**** backoff calculation at `app/core/storage/transfer-queue.ts:795`; ordinary queue scheduling can immediately select the failed row.
- **Failure:**** Exponential retry exists on paper but hot rescheduling defeats it.
- **Required remediation:**** Persist and honor `retryAt` during claims.
- **Tasks:**** 6.7, 6.10.

### CST-012 — Downloads double-buffer without a streaming size cap and lose MIME

- **Status:**** Closed · **Severity:** High
- **Evidence:**** `response.blob()` at `app/core/storage/transfer-queue.ts:667` and stream-to-blob at `:706`.
- **Failure:**** Large responses allocate whole payloads multiple times, cannot stop at a configured byte limit, and can persist incorrect content type.
- **Required remediation:**** Stream under a hard cap and verify/preserve MIME.
- **Tasks:**** 6.8, 6.10, 11.10.

### CST-013 — FS and Convex GC perform unbounded reads before limiting work

- **Status:**** Closed · **Severity:** Medium
- **Evidence:**** GC scan implementations in `../or3-provider-fs/src/runtime/server/storage/fs-storage-gateway-adapter.ts` and `convex/sync.ts:870-1050`.
- **Failure:**** Configured delete limits do not bound query/memory cost.
- **Required remediation:**** Page reads and apply per-run limits during scanning.
- **Tasks:**** 5.12, 5.14, 11.10.

### CST-014 — Signed storage URLs live up to 24 hours

- **Status:**** Closed · **Severity:** Medium
- **Evidence:**** provider presign TTL configuration allows 24-hour expiry despite the one-hour contract.
- **Failure:**** Leaked URLs remain usable far longer than documented.
- **Required remediation:**** Validate/cap every signed URL at one hour.
- **Tasks:**** 5.13, 5.14.

### CST-015 — Transfer timeout timers and waiters leak

- **Status:**** Closed · **Severity:** Medium
- **Evidence:**** `app/core/storage/transfer-queue.ts:228-260`, waiter maps at `:813-823`.
- **Failure:**** Losing `Promise.race` timers and waiters survive settlement/timeout paths, retaining closures and causing late callbacks.
- **Required remediation:**** Own both under one idempotent execution disposer.
- **Tasks:**** 6.9, 6.10.

## Chat tool execution

### CHT-001 — Disabled, wrong-runtime, and unadvertised tools still execute

- **Status:**** Closed · **Severity:** Critical
- **Evidence:**** advertisement filter at `app/utils/chat/tool-registry.ts:368`; execution at `:378`; foreground call at `app/utils/chat/useAi-internal/foregroundStream.ts:407`.
- **Failure:**** Model/provider output can invoke any registered handler regardless of request allowlist, enabled state, or runtime.
- **Required remediation:**** Snapshot and enforce an immutable request allowlist before invocation.
- **Tasks:**** 7.2, 7.3, 11.4.

### CHT-002 — Background server tools lack request authorization context

- **Status:**** Closed · **Severity:** Critical
- **Evidence:**** handler receives only args at `server/utils/chat/tool-registry.ts:13`; request tools at `server/utils/background-jobs/stream-handler.ts:611`; arbitrary execution at `:774`.
- **Failure:**** Guessed/unadvertised server tools can execute, and handlers cannot authorize user/workspace/thread/call scope.
- **Required remediation:**** Enforce exact requested definitions and pass authenticated execution context through the capability gate.
- **Tasks:**** 1.1, 7.1, 7.4, 11.4.

### CHT-003 — Tool side effects have no replay protection

- **Status:**** Closed · **Severity:** High
- **Evidence:**** foreground queues/executes every event at `foregroundStream.ts:274` and `:407`; background at `stream-handler.ts:724` and `:774`.
- **Failure:**** Duplicate IDs across provider events, iterations, reconnects, or persistence retries repeat destructive handlers; current tests execute the same call ten times.
- **Required remediation:**** Durable call-ID/fingerprint ledger with exact-result replay and conflict rejection.
- **Tasks:**** 7.7-7.9, 11.4.

### CHT-004 — Tool timeout reports failure while the handler keeps mutating

- **Status:**** Closed · **Severity:** High
- **Evidence:**** plain `Promise.race` at `app/utils/chat/tool-registry.ts:209` and `server/utils/chat/tool-registry.ts:82`.
- **Failure:**** Timed-out work continues, the model may retry, stop cannot cancel it, and successful timers remain alive.
- **Required remediation:**** Composed abort signals, typed timeout errors, timer cleanup, and idempotency for non-cooperative handlers.
- **Tasks:**** 7.1, 7.10, 11.4.

### CHT-005 — JSON Schema validation checks only required-key presence

- **Status:**** Closed · **Severity:** High
- **Evidence:**** `app/utils/chat/tool-registry.ts:155-204`, `server/utils/chat/tool-registry.ts:34-80`.
- **Failure:**** Wrong types, enums, nested shapes, bounds, and extra properties reach handlers; server output types also diverge from client behavior.
- **Required remediation:**** One shared standards-compliant validator for definitions, arguments, and result contracts.
- **Tasks:**** 7.5, 7.6, 11.4.

### CHT-006 — Tool arguments and results are unbounded everywhere

- **Status:**** Closed · **Severity:** High
- **Evidence:**** full foreground persistence/context at `foregroundStream.ts:427-481`; repeated background state at `stream-handler.ts:617-849`; UI truncation is display-only.
- **Failure:**** One result can exhaust memory, Dexie quota, sync payloads, SSE, and model context after a side effect has completed.
- **Required remediation:**** Byte caps and separate durable reference/model/UI projections.
- **Tasks:**** 7.11, 11.4, 11.10.

### CHT-007 — Tool logs leak serialized secrets and PII

- **Status:**** Closed · **Severity:** High
- **Evidence:**** `server/utils/background-jobs/stream-handler.ts:747-753`, `:803-815`; string redaction in `server/utils/background-jobs/logging.ts:14-43` does not structurally redact serialized JSON.
- **Failure:**** Passwords, API keys, email, arguments, results, and failure payloads enter logs.
- **Required remediation:**** Do not log payloads by default; log only bounded metadata/hash/correlation IDs.
- **Tasks:**** 7.12, 11.4.

### CHT-008 — Plugin tool cleanup can unregister another plugin's handler

- **Status:**** Closed · **Severity:** Medium
- **Evidence:**** override registration and name-only cleanup at `app/composables/plugins/workspace-runtime.ts:110-114`.
- **Failure:**** Plugin B can replace Plugin A's tool, then disposing A deletes B's active registration.
- **Required remediation:**** Return opaque ownership-bound disposers or reject collisions.
- **Tasks:**** 7.13.

### CHT-009 — Tool registry watchers and preferences leak across registration

- **Status:**** Closed · **Severity:** Medium
- **Evidence:**** untracked watcher at `app/utils/chat/tool-registry.ts:312-317`, unregister at `:325-327`.
- **Failure:**** HMR/re-registration accumulates watchers and unloaded tools lose or corrupt persisted preference state.
- **Required remediation:**** Store/stop watcher handles and separate preferences from mounted registrations.
- **Tasks:**** 7.13.

### CHT-010 — Public tool API types and documentation do not match runtime

- **Status:**** Closed · **Severity:** Medium
- **Evidence:**** permissive `defineTool` input at `app/utils/chat/tools-public.ts:31-35`; runtime exposes `listTools` as computed state while documentation describes a function, and hydrate signatures differ.
- **Failure:**** Plugins compile against a misleading surface and malformed definitions fail late in unrelated execution paths.
- **Required remediation:**** Type and validate `ToolDefinition` at the boundary and make documentation/runtime contract tests authoritative.
- **Tasks:**** 7.14.

## Chat orchestration and user actions

### CHO-001 — Concurrent sends share and corrupt mutable request state

- **Status:**** Closed · **Severity:** High
- **Evidence:**** send begins at `app/composables/chat/useAi.ts:1225`; async filters/creation/hydration occur before `loading` is set at `:1536`.
- **Failure:**** Concurrent API/programmatic sends share controller, accumulator, tail, stream ID, and background state.
- **Required remediation:**** Atomic admission before the first await and request-local state.
- **Tasks:**** 8.1-8.3, 11.4.

### CHO-002 — Foreground tool turns resend cumulative assistant content

- **Status:**** Closed · **Severity:** High
- **Evidence:**** cumulative `current` at `foregroundStream.ts:270`; appended as per-turn content at `:462`.
- **Failure:**** Later tool turns duplicate earlier preambles in provider context, inflating tokens and changing model behavior.
- **Required remediation:**** Separate per-iteration and cumulative buffers.
- **Tasks:**** 8.4, 10.8, 10.9.

### CHO-003 — Foreground tool-loop exhaustion silently succeeds

- **Status:**** Closed · **Severity:** High
- **Evidence:**** loop condition at `foregroundStream.ts:235`; no post-loop error, while background throws at `stream-handler.ts:858`.
- **Failure:**** The final tool side effect runs but its result never receives a model response; UI persists partial output as success.
- **Required remediation:**** Typed iteration-limit terminal error shared by both modes.
- **Tasks:**** 8.5, 10.8, 10.9.

### CHO-004 — Retry deletes the source before replacement acceptance

- **Status:**** Closed · **Severity:** High
- **Evidence:**** deletion at `app/utils/chat/useAi-internal/retry.ts:334`; send at `:354`; ordinary send rejection at `useAi.ts:1246-1304`.
- **Failure:**** Missing key, filter, quota, or pre-persist failure permanently erases the original turn.
- **Required remediation:**** Branch/stage first and preserve the source until durable acceptance.
- **Tasks:**** 8.6, 11.4.

### CHO-005 — Retrying an older turn keeps orphaned future/tool context

- **Status:**** Closed · **Severity:** High
- **Evidence:**** first-assistant selection at `retry.ts:233-244`; only user/assistant deletion at `:334-350`.
- **Failure:**** Later messages and role-tool rows remain while the retried user is appended to the tail, producing invalid chronology and model context.
- **Required remediation:**** Branch/truncate from a complete turn boundary with parent relationships.
- **Tasks:**** 8.7, 9.1-9.3, 11.4.

### CHO-006 — Composer clears drafts before send acceptance

- **Status:**** Closed · **Severity:** High
- **Evidence:**** emit at `app/components/chat/ChatInputDropper.vue:1010`, immediate clear at `:1025`, swallowed parent failure at `ChatContainer.vue:673-690`.
- **Failure:**** Auth/filter/limit/busy rejection destroys unsent text and attachments.
- **Required remediation:**** Await a structured `SendResult`; clear only after durable user-row acceptance.
- **Tasks:**** 8.1, 8.8, 11.4.

### CHO-007 — UI history and model history diverge

- **Status:**** Closed · **Severity:** High
- **Evidence:**** `app/components/chat/ChatContainer.vue:265-293` mutates only UI messages.
- **Failure:**** Visible synced edits/messages can be absent from the next model payload.
- **Required remediation:**** Atomically replace one canonical history and derive both projections.
- **Tasks:**** 8.9, 9.2, 11.4.

### CHO-008 — Token trimming subtracts messages that it later restores

- **Status:**** Closed · **Severity:** High
- **Evidence:**** subtraction at `app/utils/chat/messages.ts:193-199`; all user messages restored at `:201-205`.
- **Failure:**** The returned request can remain over budget and fail upstream; independent message trimming can also break tool groups.
- **Required remediation:**** Trim complete turns, protect only system/final user, and verify actual returned count.
- **Tasks:**** 8.10, 11.4.

### CHO-009 — Chat instance replacement leaks hooks and subscriptions

- **Status:**** Closed · **Severity:** Medium
- **Evidence:**** prompt replacement creates a new instance without disposing the old one at `ChatContainer.vue:724-736`; `clear()` mixes disposal and reset at `useAi.ts:2236-2303`.
- **Failure:**** Prompt/thread changes accumulate listeners and leave ambiguous clear behavior.
- **Required remediation:**** Separate idempotent disposal from conversation clearing and dispose before replacement.
- **Tasks:**** 8.11, 11.4.

### CHO-010 — Programmatic pane sends report success before anything is accepted

- **Status:**** Closed · **Severity:** Medium
- **Evidence:**** `app/composables/chat/useChatInputBridge.ts:143-149` returns `true` after calling a void `triggerSend`; `ChatInputDropper.vue:1048-1049` does not await `handleSend`.
- **Failure:**** Automation/plugin callers receive success during loading, missing auth, filtering, or quota rejection and cannot recover the correct draft state.
- **Required remediation:**** Make the bridge asynchronous and propagate the same structured `SendResult` as interactive submission.
- **Tasks:**** 8.12, 11.4.

### CHO-011 — Documentation `HelpChat` contains another unbounded tool loop

- **Status:**** Closed · **Severity:** Low
- **Evidence:**** alternate loop at `app/components/ui/HelpChat.vue`; contrary to the initial audit, `DocumentationShell.vue` renders it through Nuxt component auto-registration.
- **Failure:**** Duplicate live orchestration did not share the main iteration terminal contract and could loop indefinitely on repeated documentation tool calls.
- **Required remediation:**** Preserve the live documentation assistant, apply the shared iteration cap and typed terminal error, and cover it when the normalized stream reducer is shared.
- **Tasks:**** 8.13.

## Chat persistence and recovery

### CHP-001 — One failed poll permanently marks a live job failed

- **Status:**** Closed · **Severity:** High
- **Evidence:**** exception conversion at `app/utils/chat/useAi-internal/backgroundJobs.ts:779-805`; terminal cleanup at `:626-660`.
- **Failure:**** Brief offline/429/5xx state persists a false model error and deletes the tracker while the server job continues.
- **Required remediation:**** Typed transport errors with retry/backoff; terminalize only authoritative state.
- **Tasks:**** 10.4, 10.5, 11.4.

### CHP-002 — Failed background start leaves an unrecoverable pending assistant

- **Status:**** Closed · **Severity:** High
- **Evidence:**** pending row at `app/composables/chat/useAi.ts:1607-1615`; catch updates only UI at `:1809-1830`; reload at `app/utils/chat/history.ts:45-70`.
- **Failure:**** Reload shows an endless spinner with no job ID to reattach.
- **Required remediation:**** Persist terminal error/delete placeholder and abort a remotely created job if local metadata fails.
- **Tasks:**** 9.6, 11.4.

### CHP-003 — Workspace switching aborts the previous workspace's valid job

- **Status:**** Closed · **Severity:** High
- **Evidence:**** current-DB lookup at `backgroundJobs.ts:369-385`; missing-message abort at `:596-606`.
- **Failure:**** Active workspace B makes tracker A believe its row disappeared and aborts server work.
- **Required remediation:**** Pin the origin database/workspace in the tracker.
- **Tasks:**** 9.7, 11.4.

### CHP-004 — Foreground pending generations cannot recover after reload/revisit

- **Status:**** Closed · **Severity:** High
- **Evidence:**** foreground pending row at `useAi.ts:1609-1615`; only background reattach metadata at `:1157-1167`; active clear detaches at `:2248-2273`.
- **Failure:**** Reload or A→B→A leaves stale pending UI with no attachment path.
- **Required remediation:**** Persist a generation lease/tracker or mark stale foreground work interrupted.
- **Tasks:**** 9.8, 11.4.

### CHP-005 — Continuation partial writes remain `pending:false`

- **Status:**** Closed · **Severity:** High
- **Evidence:**** UI-only pending state at `app/utils/chat/useAi-internal/continue.ts:416-459`; persistence retains prior pending flag at `persistence.ts:60-63`.
- **Failure:**** Reload treats in-progress continuation output as final and cannot identify the new stream.
- **Required remediation:**** Persist pending/new stream identity before consumption.
- **Tasks:**** 9.9, 11.4.

### CHP-006 — Durable tool transcripts are discarded from later model history

- **Status:**** Closed · **Severity:** High
- **Evidence:**** role-tool write at `foregroundStream.ts:444-454`; explicit filtering at `messageBuild.ts:156-171`; background uses assistant metadata at `backgroundJobs.ts:404-438`.
- **Failure:**** Reload/later turns lose tool results and call IDs; foreground/background persistence is incompatible; retry leaves orphan rows.
- **Required remediation:**** One canonical transcript and provider projection.
- **Tasks:**** 7.9, 8.7, 9.1-9.3, 9.13, 11.4, 11.5.

### CHP-007 — Streaming persistence overwrites concurrent message changes

- **Status:**** Closed · **Severity:** High
- **Evidence:**** stale original-row spreads at `app/composables/chat/useAi.ts:476-531` and `app/utils/chat/useAi-internal/persistence.ts:28-84`.
- **Failure:**** Plugin metadata, edits, file hashes, and other concurrent fields vanish on a later delta flush.
- **Required remediation:**** Patch only stream-owned fields against the latest row.
- **Tasks:**** 9.4, 11.4.

### CHP-008 — Tool/workflow-only background updates are skipped

- **Status:**** Closed · **Severity:** Medium
- **Evidence:**** persistence eligibility checks only status/content length at `backgroundJobs.ts:359-367`.
- **Failure:**** No-text tool/HITL/workflow changes can be absent from IndexedDB until terminal state or forever after interruption.
- **Required remediation:**** Include tool/workflow version fingerprints in dirty state.
- **Tasks:**** 9.10, 11.4.

### CHP-009 — Message normalization can create duplicate, nondeterministic indices

- **Status:**** Closed · **Severity:** High
- **Evidence:**** stale anchor after normalization at `app/db/messages.ts:536-550`; readers order only by index at `app/utils/chat/history.ts:34-43` despite `order_key`.
- **Failure:**** UI/model/branch ordering can differ across reloads or synced devices.
- **Required remediation:**** Re-read neighbors and order by `(index, order_key)` everywhere.
- **Tasks:**** 9.1, 9.11, 11.4, 11.5.

### CHP-010 — Global raw message archive retains every conversation indefinitely

- **Status:**** Closed · **Severity:** Medium
- **Evidence:**** module-global `_rawMessages` at `app/utils/chat/uiMessages.ts:259-277`; no production consumer or clear/cap.
- **Failure:**** Sensitive conversation and hydrated attachment data accumulate across threads/users in session memory.
- **Required remediation:**** Delete it or replace it with development-only bounded redacted diagnostics.
- **Tasks:**** 9.12.

### CHP-011 — Tool state is clobbered and not durable before follow-up

- **Status:**** Closed · **Severity:** High
- **Evidence:**** immutable base data in `persistence.ts:35-49`; periodic writes omit tool calls at `foregroundStream.ts:390-394`; completion proceeds toward another request without a dedicated durable completion write.
- **Failure:**** A content flush can erase `loading`/complete state; a crash after side effect invites duplicate execution.
- **Required remediation:**** Merge last-known tool state and persist completion/ledger before follow-up.
- **Tasks:**** 9.4, 9.5, 11.4.

### CHP-012 — Persistence or subscriber exceptions can wedge a background tracker forever

- **Status:**** Closed · **Severity:** High
- **Evidence:**** received content advances before persistence at `app/utils/chat/useAi-internal/backgroundJobs.ts:589-595`; subscribers execute without isolation at `:615-617`; polling calls the handler without a finalizer at `:808`.
- **Failure:**** One Dexie or callback exception can leave `polling=true`, prevent restart, and advance the received offset past data that was never durably written.
- **Required remediation:**** Use `try/finally`, isolate each subscriber, and track received versus durably persisted offsets separately.
- **Tasks:**** 10.16, 11.4.

## Chat streaming, performance, and privacy

### CHS-001 — SSE parsing loses valid frames and converts provider errors to success

- **Status:**** Closed · **Severity:** High
- **Evidence:**** strict `data: ` handling at `shared/openrouter/parseOpenRouterSSE.ts:183`; swallowed parse/error envelopes at `:404`; unconditional done at `:424`.
- **Failure:**** Final unterminated data is lost, `[DONE]` duplicates/hangs, and `{"error":...}` becomes empty success.
- **Required remediation:**** Standards-compliant framing and typed provider error events with one terminal emission.
- **Tasks:**** 10.1-10.3, 11.4.

### CHS-002 — Pre-response abort is overwritten as background error

- **Status:**** Closed · **Severity:** High
- **Evidence:**** fetch at `server/utils/background-jobs/stream-handler.ts:697-708` and `:1111-1123`; outer catch fails the job at `:225-244`; provider `failJob` overwrites aborted state.
- **Failure:**** User cancellation becomes failure and may emit incorrect notifications.
- **Required remediation:**** Preserve aborted terminal state and make failure transition conditional on still-streaming state.
- **Tasks:**** 10.6, 10.8, 10.9, 11.4.

### CHS-003 — Streams have no real response or idle deadline

- **Status:**** Closed · **Severity:** High
- **Evidence:**** blocking fetch/read paths use only caller signals in `app/utils/chat/openrouterStream.ts:230-306` and `server/utils/background-jobs/stream-handler.ts:697-708`; background start has no signal.
- **Failure:**** Missing headers or silent bodies can remain stuck; stop cannot act before the job ID exists.
- **Required remediation:**** Compose caller abort, absolute response deadline, idle watchdog, and abortable retry wait.
- **Tasks:**** 7.10, 10.7-10.9, 11.4.

### CHS-004 — SSE viewers have unbounded queues and incomplete cancellation cleanup

- **Status:**** Closed · **Severity:** Medium
- **Evidence:**** enqueue paths at `server/api/jobs/[id]/stream.get.ts:220-247`, `:395-398`; empty `cancel()` at `:531-533`.
- **Failure:**** Slow clients grow server memory without bound and can leave listeners/intervals alive.
- **Required remediation:**** Cap/coalesce queued bytes, disconnect with resumable offset, and centralize cleanup.
- **Tasks:**** 10.11, 11.4, 11.10.

### CHS-005 — Background delivery hot-polls and writes on every chunk

- **Status:**** Closed · **Severity:** Medium
- **Evidence:**** 80 ms per-viewer polling at `server/api/jobs/[id]/stream.get.ts:53`; client fallback at `backgroundJobs.ts:826-830`; per-token provider writes at `stream-handler.ts:726-744` and text-only flush at `:1143-1151`.
- **Failure:**** Viewer count multiplies provider load; token count multiplies durable writes.
- **Required remediation:**** One adaptive per-job poller and coalesced time/size writes with terminal flush.
- **Tasks:**** 10.10, 10.12, 11.4, 11.10.

### CHS-006 — Reasoning-only streams write IndexedDB on every event

- **Status:**** Closed · **Severity:** Medium
- **Evidence:**** text-only counter at `foregroundStream.ts:271-337`; `chunkIndex % 50 === 0` at `:384-399`; continuation duplicates it.
- **Failure:**** Counter remains zero, so every reasoning delta awaits a DB write.
- **Required remediation:**** Track total dirty events and reset after persistence.
- **Tasks:**** 10.12, 10.13, 11.4, 11.10.

### CHS-007 — Stream accumulator ignores its documented aborted state

- **Status:**** Closed · **Severity:** Medium
- **Evidence:**** `finalize({ aborted })` contract at `app/composables/chat/useStreamAccumulator.ts:65-80`; implementation at `:203-220` stores no aborted state.
- **Failure:**** Consumers cannot distinguish stop from successful completion through the advertised API.
- **Required remediation:**** Expose/reset an aborted flag or remove the false option and use one typed state.
- **Tasks:**** 10.14, 11.4.

### CHS-008 — Direct OpenRouter failures log prompt and request bodies

- **Status:**** Closed · **Severity:** High
- **Evidence:**** body preview construction/logging at `app/utils/chat/openrouterStream.ts:319-343`.
- **Failure:**** Production console/collection can receive user prompts, tool arguments, and message content.
- **Required remediation:**** Log only status, model, counts, lengths, typed error, and correlation ID.
- **Tasks:**** 10.15, 11.4.

### CHS-009 — Identical streamed argument deltas are silently dropped

- **Status:**** Closed · **Severity:** Medium
- **Evidence:**** `mergeStreamedField` treats `nextChunk === previous` as duplicate replay at `shared/openrouter/parseOpenRouterSSE.ts:92-101`.
- **Failure:**** Standard delta streams containing two identical consecutive fragments produce the wrong argument string, for example `"1"` plus `"1"` becomes `"1"` instead of `"11"`.
- **Required remediation:**** Use an explicit provider cumulative-snapshot adapter; standard protocol mode must concatenate deltas.
- **Tasks:**** 10.17, 11.4.

### CHS-010 — Per-token hook dispatch builds an unbounded promise backlog

- **Status:**** Closed · **Severity:** Medium
- **Evidence:**** chained dispatcher creation/use in `app/utils/chat/useAi-internal/foregroundStream.ts:98-115` and per-delta dispatch sites around `:311-325`.
- **Failure:**** Slow hooks retain one closure/promise per token and terminal completion waits for the entire backlog, increasing memory and latency.
- **Required remediation:**** Bound/coalesce hook delivery, isolate failures, and keep terminal persistence independent of optional observers.
- **Tasks:**** 10.18, 11.4, 11.10.

## Closure policy

A finding is Closed only when:

1. Every linked task in `tasks.md` is checked.
2. The regression test fails against the pre-fix behavior and passes after the fix, or the task records why a deterministic pre-fix test is impossible.
3. Relevant provider contract suites, type checks, import-boundary checks, and builds pass.
4. Schema changes have idempotent migration and forward-repair evidence.
5. Documentation describes the actual post-fix contract.

Release remains blocked while any Blocker or High finding is Open.
