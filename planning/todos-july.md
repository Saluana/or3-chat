# or3-chat neckbeard review todos

Review date: 2026-07-30

This is a deliberately blunt, issue-oriented backlog from ten independent review lanes. Findings are grouped by code area, with duplicates merged where the same underlying defect appeared in more than one lane. Severity is a prioritization signal, not a substitute for threat modeling or an incident review.

Review lanes:

1. Server authentication and authorization
2. Server sync, storage, and Connect
3. Server chat, LLM streaming, jobs, workflows, and webhooks
4. Server admin, configuration, providers, and wizard
5. Client persistence, sync, workspace lifecycle, and auth state
6. Client chat, projects, threads, and external agents
7. Client documents, search, notifications, dashboard, and admin UX
8. Client shell, routing, themes, wizard UI, and general UI
9. Plugin, extension, SDK, and isolation runtime
10. Shared contracts, Convex, tests, tooling, and build configuration

## Server authentication and authorization

### [CRITICAL] Workspace mutations have no CSRF boundary

Location: server/api/workspaces/index.post.ts:16-20; server/api/workspaces/active.post.ts:19-23; server/api/workspaces/[id].patch.ts:20-29; server/api/workspaces/[id].delete.ts:17-18

Why this is bad: credentialed browser requests can be induced by a cross-site page because these state-changing routes do not enforce same-origin or an equivalent mutation-intent check.

Consequence: an attacker can potentially create, switch, rename, or delete workspace state from a victim's authenticated browser.

Fix: require same-origin mutation validation, an explicit intent header, and a strict JSON content type before parsing or mutating state. Add regression tests for cross-origin form and fetch-like requests.

### [CRITICAL] Authorization uses a stale membership snapshot

Location: server/api/workspaces/_helpers.ts:73-86; server/api/workspaces/[id].delete.ts:30-43

Why this is bad: permission is checked against a previously read membership record and then the mutation happens later without an atomic capability recheck.

Consequence: a removed member or downgraded role can win a race and still perform a privileged workspace operation.

Fix: perform the membership/role check in the same transaction or guarded write as the mutation, with a revision or compare-and-swap condition.

### [CRITICAL] Session revocation is process-local

Location: server/auth/session.ts:57-59,263-281,470-476,532-557

Why this is bad: auth cache and revision state live in one worker process, so another instance can continue accepting a revoked session.

Consequence: logout, password rotation, role changes, and workspace removal are not reliably enforced across a multi-instance deployment.

Fix: move revocation generations and session validity checks to a shared store, or make every request validate a distributed revision. Keep any local cache bounded by a short, explicit freshness window.

### [HIGH] In-flight auth work can repopulate an invalidated cache

Location: server/auth/session.ts:274-279,470-476,532-547

Why this is bad: a request that started before invalidation can finish afterward and write an old session back into the local cache.

Consequence: revocation appears to work briefly and then silently regresses under concurrency.

Fix: attach a generation to cache reads and writes; discard a write if the generation changed while the lookup was in flight.

### [HIGH] Workspace deletion invalidates only the actor's session

Location: server/api/workspaces/[id].delete.ts:40-53

Why this is bad: deleting a workspace only invalidates the deleting user's auth state.

Consequence: other members can retain active sessions, cached workspace access, or stale capability data after the workspace is gone.

Fix: publish a workspace-wide invalidation revision and invalidate every affected member's session/capability cache.

### [HIGH] Session rate limiting happens after expensive work

Location: server/api/auth/session.get.ts:54-64,73-89

Why this is bad: the route performs session lookup and related work before applying the rate-limit decision.

Consequence: an unauthenticated attacker can still consume CPU, storage, or upstream capacity with repeated session requests.

Fix: perform an atomic ingress check and record before expensive parsing, database access, or provider calls.

### [HIGH] Configured rate-limit providers silently fall back to memory

Location: server/utils/rate-limit/store.ts:40-70

Why this is bad: a deployment that believes it has durable/shared rate limiting can silently operate with a process-local store.

Consequence: limits disappear across workers and fail open during abuse or a provider outage.

Fix: fail closed when a configured provider cannot initialize. Make the in-memory implementation an explicit development-only mode and expose a startup health check.

### [HIGH] Token broker can mint an anonymous token

Location: server/auth/token-broker/resolve.ts:92-121

Why this is bad: the broker path can issue a token without first requiring an authenticated workspace subject.

Consequence: downstream services may treat a broker-issued anonymous identity as a valid tenant identity.

Fix: reject before broker resolution unless the request has a validated user and workspace capability. Make anonymous tokens a separate, explicit type that cannot reach tenant APIs.

### [HIGH] Wizard bearer authentication fails open without a token

Location: server/middleware/wizard-token-auth.ts:68-70

Why this is bad: the middleware allows requests through when the configured wizard token is empty or absent.

Consequence: a deployment mistake turns the setup surface into an unauthenticated administrative API.

Fix: require a non-empty secret outside an explicitly isolated loopback development mode, and fail startup rather than accepting an empty credential.

### [HIGH] Wizard credentials are accepted in the URL

Location: server/middleware/wizard-token-auth.ts:73-87

Why this is bad: bearer tokens in query strings leak through browser history, access logs, referrers, analytics, and copied URLs.

Consequence: anyone who obtains routine HTTP metadata may gain wizard access.

Fix: accept the token only in an Authorization header or a narrowly scoped secure cookie, and redact it from all error and access logging.

### [HIGH] Workspace list responses are cacheable

Location: server/api/workspaces/index.get.ts:10-32

Why this is bad: a personalized workspace list lacks an explicit no-store policy.

Consequence: shared browser, proxy, or CDN caches can expose workspace names and membership metadata to another user.

Fix: send Cache-Control: no-store and verify that framework/server caching does not cache the handler implicitly.

### [MEDIUM] Workspace request bodies are unbounded

Location: server/api/workspaces/index.post.ts:20-22; server/api/workspaces/active.post.ts:23-24; server/api/workspaces/[id].patch.ts:29-31

Why this is bad: the routes parse request bodies without a bounded reader or a small schema-specific size limit.

Consequence: oversized requests can waste memory and parsing time before validation rejects them.

Fix: enforce a body-size limit at the server boundary and use strict schemas that reject unknown and oversized fields.

### [MEDIUM] Workspace creation is unthrottled

Location: server/api/workspaces/index.post.ts:44-50

Why this is bad: workspace creation is a resource-producing operation with no abuse control.

Consequence: a valid account can create large numbers of workspaces and trigger provisioning/storage costs.

Fix: add an atomic per-user and per-origin creation limit, and make the limit visible in the API response.

### [MEDIUM] Auth, workspace, and entitlement stores can disagree

Location: server/auth/session.ts:263-268; server/api/workspaces/_helpers.ts:37-47; server/auth/entitlements/registry.ts:48-57

Why this is bad: these paths appear to resolve user/workspace state through separate stores and caches with no single consistency contract.

Consequence: a user can be authenticated in one layer but missing, downgraded, or entitled differently in another.

Fix: define one canonical identity/capability read model, version it, and invalidate dependent caches on every membership or entitlement change.

### [MEDIUM] can() skips workspace scope when the id is empty

Location: server/auth/can.ts:124-132

Why this is bad: an empty workspace identifier changes the authorization path instead of being rejected as malformed input.

Consequence: callers that accidentally omit scope can receive a broader authorization result than intended.

Fix: make workspace-scoped checks require a non-empty validated id and return deny/error for missing scope.

### [MEDIUM] Invalid roles can crash authorization

Location: server/auth/can.ts:106-117

Why this is bad: role parsing assumes stored values are valid.

Consequence: corrupt or stale role data becomes a 500 path, causing availability issues and potentially inconsistent deny behavior.

Fix: validate roles at the storage boundary and treat unknown values as deny, never as an exception that escapes a request.

### [MEDIUM] Existing users can be classified as unknown

Location: server/auth/store/types.ts:67-84; server/auth/session.ts:298-307

Why this is bad: the session path appears to infer user existence from a partial store view.

Consequence: returning users can be re-provisioned, denied, or assigned defaults incorrectly depending on which lookup path ran.

Fix: make user identity existence and provisioning status explicit fields with a single idempotent lookup/create operation.

### [MEDIUM] Provider identities are not strictly validated

Location: server/auth/session.ts:234-237

Why this is bad: provider identity fields are accepted before strict normalization and validation.

Consequence: malformed, ambiguous, or colliding external identities can create account-linking and authorization problems.

Fix: canonicalize provider, subject, issuer, and email fields before lookup; reject empty, oversized, or structurally invalid identities.

### [MEDIUM] Invites do not require a verified email identity

Location: server/auth/types.ts:34-55; server/auth/session.ts:357-375

Why this is bad: invitation acceptance can be tied to an unverified or mutable email claim.

Consequence: invite redemption can be misattributed or transferred between identities.

Fix: require a provider-verified email or a separate verified invite-email flow, and bind redemption to the immutable subject.

### [MEDIUM] Invite secrets are too weak

Location: server/auth/registration.ts:100-109

Why this is bad: generated invite material does not provide enough entropy for a bearer secret exposed to users.

Consequence: offline guessing or leaked low-entropy values can lead to unauthorized workspace enrollment.

Fix: generate cryptographically random, sufficiently long single-use tokens, store only a hash, and enforce expiry and redemption limits.

### [MEDIUM] Authentication errors are logged with raw details

Location: server/auth/session.ts:242-246,481-485

Why this is bad: provider/session failures can include identifiers, tokens, or sensitive upstream response content.

Consequence: routine logs become a secondary credential and personal-data exposure channel.

Fix: log a stable event id and redacted error class; keep raw provider diagnostics behind restricted, short-retention tracing.

### [MEDIUM] Active workspace updates use last-write-wins

Location: server/api/workspaces/active.post.ts:45-48; server/auth/store/types.ts:169-176

Why this is bad: two tabs can overwrite the active workspace pointer without a version or timestamp policy.

Consequence: the user is silently switched to an unintended workspace, and server/client state can diverge.

Fix: use a monotonic client/session version or make active workspace selection request-scoped rather than global mutable state.

### [MEDIUM] Workspace creation is not atomic with provisioning

Location: server/api/workspaces/index.post.ts:44-52; server/workspaces/provisioning.ts:22-37

Why this is bad: the workspace record can be committed before dependent resources are provisioned.

Consequence: users receive a workspace that is present but unusable, with no reliable retry or repair state.

Fix: create an explicit provisioning state machine, use idempotent steps, and expose pending/failed state instead of returning success prematurely.

### [MEDIUM] Limited JSON fallback is still unbounded

Location: server/utils/security/limited-json-body.ts:87-101

Why this is bad: the fallback path reads or constructs data before the intended limit is reliably enforced.

Consequence: malformed or oversized JSON can bypass the protection specifically on error/fallback paths.

Fix: enforce byte limits while reading, reject before materializing the full body, and test chunked oversized inputs.

### [LOW] Force-HTTPS redirects can be host-header poisoned

Location: server/middleware/force-https.ts:46-60

Why this is bad: redirect construction trusts a raw Host value instead of a configured canonical host.

Consequence: an attacker can create redirects to an arbitrary host and facilitate phishing or token leakage.

Fix: use a configured allowlisted origin and ignore untrusted forwarded host values unless the proxy chain is explicitly trusted.

### [LOW] Credentialed null-origin CORS is too permissive

Location: server/middleware/cors.ts:50-60,93-95

Why this is bad: allowing credentials for a null origin expands the set of contexts that can issue authenticated requests.

Consequence: sandboxed documents and local file contexts may gain a browser-mediated attack path.

Fix: reject null origins by default and allow only an explicit, reviewed origin list.

## Server sync, storage, and Connect

### [CRITICAL] Sync rate limiting is local and racy

Location: server/utils/sync/rate-limiter.ts:147-245

Why this is bad: the limit check and increment are not a shared atomic operation.

Consequence: concurrent workers and concurrent requests can exceed the intended quota, while limits reset when a worker is replaced.

Fix: use a shared atomic counter with a bounded window/token bucket and key it by authenticated subject, workspace, device, and abuse-relevant origin.

### [CRITICAL] Upload quota enforcement is advisory

Location: server/api/storage/presign-upload.post.ts:146-186; server/utils/storage/quota.ts:15-69

Why this is bad: quota is calculated from a snapshot, then upload authorization is issued without reserving the bytes atomically.

Consequence: parallel uploads can oversubscribe storage and leave the system with an inaccurate quota view.

Fix: reserve bytes transactionally when issuing an upload intent, release on abort/expiry, and reconcile actual provider size on commit.

### [CRITICAL] Presigned URL expiry is not enforced by the API

Location: server/api/storage/presign-upload.post.ts:31-36,177-199; server/api/storage/presign-download.get.ts:27-33,92-113

Why this is bad: expiry values appear to be passed through or trusted without a server-side maximum and intent check.

Consequence: leaked URLs remain useful longer than the product security policy expects.

Fix: clamp expiry to a short server-defined maximum, bind the URL to an intent record, and reject expired/revoked intents at every gateway boundary.

### [CRITICAL] Storage object selection is caller-controlled

Location: server/api/storage/presign-download.get.ts:27-31,92-99; server/api/storage/delete.post.ts:16-53

Why this is bad: object keys/provider ids supplied by the caller are not consistently resolved through an ownership record.

Consequence: an authenticated user may read or delete another user's object by guessing or supplying a foreign key.

Fix: accept an application file id, resolve it under the current workspace, and derive the provider key server-side. Never authorize a raw provider path directly.

### [HIGH] File identity and hash normalization disagree

Location: server/utils/storage/quota.ts:11-13; server/api/storage/presign-upload.post.ts:31-45; convex/storage.ts:39-41,285-340

Why this is bad: different layers normalize or compare hashes differently.

Consequence: deduplication, quota accounting, integrity checks, and cleanup can refer to different logical files.

Fix: define one canonical hash encoding and normalization function in shared code, validate it at ingress, and use it for all persistence and comparison.

### [HIGH] Commit can succeed without proving the upload

Location: server/api/storage/commit.post.ts:30-43,94-110; server/storage/gateway/types.ts:168-179

Why this is bad: commit accepts metadata without a strong, single-use capability proving that the intended upload completed.

Consequence: rows can claim files that do not exist, point at the wrong object, or consume quota without bytes behind them.

Fix: require an unexpired upload intent, verify provider metadata/size/hash, atomically consume the intent, and make retries idempotent.

### [HIGH] Aborted uploads leak intents and blobs

Location: app/core/storage/transfer-queue.ts:116-123,650-725; convex/storage.ts:241-254

Why this is bad: cancellation paths do not reliably release both the server intent and the provider-side temporary object.

Consequence: repeated canceled uploads accumulate billed storage and permanently inflate quota.

Fix: make abort/reaper cleanup idempotent, schedule expiry cleanup independently of the client, and record orphan cleanup failures for retry.

### [HIGH] Transfer leases do not fence side effects

Location: app/core/storage/transfer-queue.ts:538-569,714-725,962-1001

Why this is bad: an old worker can continue uploading/committing after another worker has acquired the lease.

Consequence: duplicate transfers, stale commits, and progress updates from the wrong owner can corrupt transfer state.

Fix: attach a lease generation to every side effect and reject writes from stale generations at the server boundary.

### [MEDIUM] Transfer deduplication has a check/insert race

Location: app/core/storage/transfer-queue.ts:155-199,290-300

Why this is bad: dedupe lookup and queue insertion are separate operations.

Consequence: two tabs enqueue the same file and both perform expensive upload work.

Fix: enforce a unique transfer key in the database and handle duplicate-key as a successful join to the existing transfer.

### [CRITICAL] Garbage collection lock is process-local and consumed too early

Location: server/api/storage/gc/run.post.ts:31-57,105-135

Why this is bad: the lock does not coordinate multiple instances, and it can be marked used before the destructive work has succeeded.

Consequence: concurrent GC runs can race, while a failed run can suppress future cleanup.

Fix: use a distributed lease with fencing, hold it through completion, and release/retry on failure.

### [HIGH] GC trusts destructive request parameters

Location: server/api/storage/gc/run.post.ts:25-29,128-133

Why this is bad: the caller can influence retention, limits, or scope for a destructive operation.

Consequence: an authorized but careless or compromised caller can delete live objects outside the intended policy.

Fix: derive scope and retention exclusively from server configuration and a narrowly scoped capability; ignore client-supplied destructive knobs.

### [MEDIUM] Quota pagination can loop or omit pages

Location: server/utils/storage/quota.ts:40-68

Why this is bad: pagination advances from provider responses without proving cursor progress.

Consequence: a malformed provider response can cause repeated scans or inaccurate totals.

Fix: detect repeated cursors, cap page count and total bytes, and fail/reconcile explicitly when pagination is invalid.

### [HIGH] Sync push accepts mutable server-owned fields

Location: server/api/sync/push.post.ts:62-85; shared/sync/schemas.ts:55-62

Why this is bad: client operations can forward primary keys, workspace ids, timestamps, or other fields that should be assigned by the server.

Consequence: clients can move records across workspaces, forge ordering metadata, or overwrite another record.

Fix: separate client-writable fields from server-owned fields in the schema and derive identity, workspace, version, and timestamps on the server.

### [HIGH] Device cursors can poison garbage collection

Location: server/api/sync/update-cursor.post.ts:22-26,54-84; server/sync/gateway/types.ts:176-190

Why this is bad: callers can submit arbitrary cursor values and keep them indefinitely.

Consequence: GC can be pinned forever, or invalid cursors can cause data to be deleted before a device has actually observed it.

Fix: validate cursors against the server's known stream/version, advance monotonically, expire inactive devices, and require device ownership.

### [HIGH] Connect claims expire without renewal

Location: server/connect/lifecycle.ts:142-183,206-230,376-404; server/connect/store/types.ts:149-187

Why this is bad: long-lived clients have no robust lease renewal or fencing protocol.

Consequence: stale devices can continue acting after ownership should have expired, while legitimate clients are disconnected unpredictably.

Fix: add renewable leases with monotonic generations and require the generation on approve, deny, status, and device actions.

### [HIGH] Cloudflare provisioning is not idempotent

Location: server/connect/cloudflare.ts:151-207

Why this is bad: retries can create duplicate resources or partially apply configuration.

Consequence: transient network failures leave orphaned tunnels/resources and make recovery manual.

Fix: persist an idempotency key and external resource ids, use read-before-create, and model partial provisioning with resumable states.

### [HIGH] Missing outbox storage silently drops captured mutations

Location: app/core/sync/hook-bridge.ts:364-377

Why this is bad: when outbox initialization is unavailable, the hook path can continue instead of failing the mutation.

Consequence: local state appears committed but cannot ever reach the server.

Fix: make outbox persistence part of the transaction boundary; reject or visibly queue mutations until durable capture is available.

### [MEDIUM] Outbox recovery can reset another tab's work

Location: app/core/sync/outbox-manager.ts:157-191,258-262

Why this is bad: recovery treats stale processing rows as abandoned without a cross-tab lease/fencing protocol.

Consequence: one tab can requeue or overwrite work that another tab is still uploading.

Fix: use owner ids, lease generations, and a server/client clock policy before reclaiming processing entries.

### [MEDIUM] Connect endpoints use the wrong limiter

Location: server/api/connect/device/request.get.ts:10-24; server/api/connect/device/status.get.ts:20-48; server/api/connect/device/approve.post.ts:23-46; server/api/connect/device/deny.post.ts:10-30

Why this is bad: device request, polling, approval, and denial paths are not consistently protected by the limiter appropriate to their cost and sensitivity.

Consequence: polling and approval guessing can become an abuse and account-enumeration channel.

Fix: assign per-route limits keyed by user/device/IP, return Retry-After on 429, and test that all four paths enforce the intended policy.

### [MEDIUM] Generated Connect ids disagree on underscore formatting

Location: server/api/connect/device/approve.post.ts:81-84; server/api/connect/device/status.get.ts:30-38

Why this is bad: generated environment/resource identifiers are not normalized consistently between creation and lookup.

Consequence: valid device records can become unreachable or accidentally treated as missing during approval/status flows.

Fix: centralize identifier generation and parsing in one shared function with round-trip tests.

## Server chat, LLM streaming, jobs, workflows, and webhooks

### [CRITICAL] Workflow tools can execute without tenant context

Location: server/utils/workflows/background-execution.ts:133-165

Why this is bad: background execution constructs tool context without a guaranteed authenticated workspace subject.

Consequence: tools may read or mutate global data, use another tenant's credentials, or run with system-level scope.

Fix: make tenant context a non-optional constructor argument, reject execution when it is absent, and include workspace capability checks in every tool invocation.

### [HIGH] Background jobs are not restartable

Location: server/utils/background-jobs/stream-handler.ts:247-266

Why this is bad: job progress and event offsets are not persisted as a durable resume point.

Consequence: a worker restart loses output, duplicates side effects, or leaves a job stuck in running state.

Fix: persist event sequence and idempotency state, resume from the last committed offset, and make terminal transitions compare-and-swap protected.

### [HIGH] Workflow abort can happen after irreversible side effects

Location: server/utils/workflows/background-execution.ts:538-571

Why this is bad: cancellation is checked around side effects rather than being part of an idempotent step protocol.

Consequence: the workflow reports aborted while email, storage, billing-like, or external mutations have already occurred.

Fix: give each side-effecting step an idempotency key and explicit committed state; cancellation should stop future steps, not pretend committed work was undone.

### [HIGH] Shutdown abandons active jobs

Location: server/utils/shutdown/controller.ts:75-85

Why this is bad: shutdown stops workers without draining or durably marking active jobs.

Consequence: deployments create permanently running jobs, missing terminal events, and leaked resources.

Fix: stop intake, drain with a deadline, checkpoint active jobs, and requeue unfinished work on startup.

### [HIGH] Initial upstream failure skips terminal events

Location: server/utils/background-jobs/stream-handler.ts:1327-1355

Why this is bad: failures before the first streamed chunk take a path that does not emit the same terminal state as mid-stream failures.

Consequence: clients wait forever or display a job as active even though the upstream request has failed.

Fix: centralize terminal transition/error emission and test failure before headers, after headers, and during body streaming.

### [HIGH] Durable job misconfiguration silently falls back to memory

Location: server/utils/background-jobs/store.ts:48-73

Why this is bad: a configured durable provider can fail initialization and be replaced by process-local storage.

Consequence: jobs disappear on restart and multiple workers disagree about state.

Fix: fail startup or fail job submission when durability is configured but unavailable. Make memory mode explicit and development-only.

### [MEDIUM] Timeout finalization bypasses normal hooks

Location: server/utils/background-jobs/providers/memory.ts:57-63

Why this is bad: timeout state is written through a shortcut that does not run the same cleanup, viewer, and notification hooks as ordinary completion.

Consequence: leaked timers/resources and clients that never receive a consistent terminal event.

Fix: route timeout through the same idempotent terminal transition pipeline as success and failure.

### [MEDIUM] Abort races can overwrite a completed job

Location: server/utils/background-jobs/providers/memory.ts:197-204

Why this is bad: abort writes status without checking whether another worker already completed the job.

Consequence: successful work is reported as aborted and downstream consumers may retry it.

Fix: use compare-and-swap terminal transitions and make completed/failed states immutable.

### [HIGH] HITL updates are last-write-wins

Location: server/utils/workflows/hitl-store.ts:152-207

Why this is bad: approval/denial updates do not appear to enforce a single terminal decision.

Consequence: two operators can make conflicting decisions, or a late request can reopen/completely replace an earlier decision.

Fix: use a conditional update from pending to one terminal state and return conflict for later decisions.

### [HIGH] HITL request ids can collide

Location: server/utils/workflows/hitl-store.ts:31,83-99

Why this is bad: request identifiers are not guaranteed unique across workflows, tenants, and retries.

Consequence: one approval can resolve the wrong workflow request.

Fix: use cryptographically random ids or a database uniqueness constraint over tenant/workflow/request, and test retry collisions.

### [MEDIUM] HITL action payloads are not constrained

Location: server/api/workflows/hitl.post.ts:32-71

Why this is bad: arbitrary action payloads are accepted at an interactive control boundary.

Consequence: oversized, unexpected, or tool-specific payloads can bypass workflow invariants or create memory/logging problems.

Fix: validate action type and payload with a per-action schema, cap size, and authorize the action against the pending request.

### [CRITICAL] Custom webhook secret sanitization is bypassable

Location: server/utils/webhooks/payload.ts:252-280

Why this is bad: admin-provided custom payloads can avoid the normal secret redaction path.

Consequence: webhook delivery, logs, or retries can expose signing secrets and credentials.

Fix: sanitize after all payload merging, not only for built-in templates, and maintain a field-level secret registry that cannot be overridden by custom keys.

### [HIGH] Snake-case webhook secret detection is broken

Location: server/utils/webhooks/payload.ts:18-26,87-104

Why this is bad: secret fields using snake_case are not recognized by the sanitizer.

Consequence: common API payload naming can leak secrets that camelCase tests miss.

Fix: normalize field names before classification and test both casing styles, nested objects, arrays, and custom payloads.

### [HIGH] Webhook PATCH can erase unspecified fields

Location: server/api/webhooks/[id].patch.ts:39-43

Why this is bad: partial updates appear to replace the whole record or write undefined values over fields the caller did not provide.

Consequence: a small edit can disable delivery, erase secrets/configuration, or change ownership-related metadata.

Fix: validate a true patch object and update only explicitly present fields, with immutable fields rejected.

### [HIGH] Webhook quota check races

Location: server/api/webhooks/index.post.ts:31-37

Why this is bad: quota is counted before insert without an atomic constraint.

Consequence: concurrent requests can exceed the webhook limit.

Fix: enforce a database-level count/unique allocation or serialize quota reservation per workspace.

### [HIGH] Deleting a webhook does not stop active delivery

Location: server/utils/webhooks/route-factories.ts:92-103

Why this is bad: deletion removes configuration but does not cancel queued/in-flight delivery.

Consequence: deleted endpoints continue receiving retries and may still receive sensitive payloads.

Fix: mark the endpoint revoked, check that state before every attempt, and cancel/revoke queued deliveries transactionally.

### [MEDIUM] Failure notifications can use the wrong provider

Location: server/utils/webhooks/dispatcher.ts:84-111

Why this is bad: failure reporting is not bound tightly enough to the original webhook/provider context.

Consequence: errors are sent to an unintended destination or are silently lost.

Fix: carry an immutable delivery/provider id through retry and failure paths; test mixed-provider failure scenarios.

### [HIGH] Truncated foreground streams emit completion

Location: server/utils/foreground-stream-monitor.ts:3-37

Why this is bad: disconnect/timeout/truncation is treated as a normal completed stream.

Consequence: the client persists incomplete assistant output as final and will not retry or surface data loss.

Fix: distinguish completed, aborted, upstream-failed, and truncated terminal states; only emit completion after an explicit upstream terminal signal.

### [HIGH] Session bearer is forwarded to OpenRouter

Location: server/api/openrouter/stream.post.ts:126-132

Why this is bad: the incoming session credential is reused in an upstream request where it is not needed.

Consequence: an external provider or intermediary can receive a token that grants access to the application.

Fix: strip application auth headers before proxying and pass only a provider-scoped key or short-lived downstream credential.

### [HIGH] Workflow background requests repeat bearer leakage

Location: server/api/workflows/background.post.ts:163-178

Why this is bad: the background workflow proxy forwards request auth into provider/tool calls.

Consequence: a long-lived workflow can leak user session material to third parties.

Fix: construct an allowlisted upstream header set and carry tenant identity through internal context, not a raw browser bearer.

### [MEDIUM] Foreground proxy forwards internal fields

Location: server/api/openrouter/stream.post.ts:396-412

Why this is bad: internal request metadata is passed through to the provider rather than being explicitly selected.

Consequence: provider behavior can be influenced by fields intended only for internal routing, and sensitive metadata can escape.

Fix: map to a strict provider request schema and reject unknown fields at the API boundary.

### [HIGH] OpenRouter request bodies are unbounded

Location: server/api/openrouter/stream.post.ts:93-113

Why this is bad: large chat/tool payloads are buffered without a route-level bound.

Consequence: memory exhaustion and expensive provider requests become easy denial-of-service vectors.

Fix: enforce byte and structural limits before buffering, including message count, attachment sizes, tool count, and recursive depth.

### [HIGH] CoinGecko proxy allows attacker-controlled cache behavior

Location: server/api/coingecko/price.get.ts:23-24,72-109,158-187

Why this is bad: cache keys and upstream requests are influenced by unbounded caller input, with no robust timeout/circuit policy.

Consequence: cache pollution, upstream exhaustion, and slow requests can degrade the whole server.

Fix: allowlist symbols/currencies, normalize keys, bound cache cardinality, and use strict timeout, retry, and circuit-breaker behavior.

### [MEDIUM] CoinGecko responses can fabricate prices

Location: server/api/coingecko/price.get.ts:123-147

Why this is bad: missing or malformed upstream values are converted into a plausible fallback price.

Consequence: consumers cannot distinguish live data from fabricated zero/default data.

Fix: return an explicit unavailable/error state and validate freshness and numeric ranges before caching.

### [MEDIUM] Background streaming drops non-text events

Location: server/utils/background-jobs/stream-handler.ts:389-425

Why this is bad: the event bridge assumes text deltas are the only meaningful output.

Consequence: tool calls, usage, citations, structured data, and terminal metadata disappear for background jobs.

Fix: persist and forward typed events with sequence numbers; treat unknown event types as observable errors rather than silently dropping them.

### [MEDIUM] One viewer exception can abort every viewer

Location: server/utils/background-jobs/viewers.ts:295-297,344-346

Why this is bad: viewer fan-out lacks per-subscriber error isolation.

Consequence: one broken client or callback can interrupt delivery to all other subscribers.

Fix: catch and remove failing viewers individually, and keep the durable job independent of viewer lifecycle.

### [MEDIUM] Workflow state byte limits count characters

Location: server/utils/workflows/background-execution.ts:48-127

Why this is bad: string length is used as a proxy for serialized byte size.

Consequence: multibyte data can exceed storage/transport limits while passing validation.

Fix: measure UTF-8 encoded bytes after serialization and enforce limits recursively before persistence.

### [MEDIUM] Workflow overflow breaks error handling

Location: server/utils/workflows/background-execution.ts:648-685

Why this is bad: the error path attempts to persist an oversized state/error payload and can fail again.

Consequence: the original failure becomes an unobservable stuck job.

Fix: reserve a compact failure record, truncate/redact large payloads, and guarantee a minimal terminal state can always be persisted.

### [MEDIUM] Workflow catalog cache is unbounded and races refreshes

Location: server/utils/workflows/workflow-catalog.ts:28-83,118-165

Why this is bad: catalog entries accumulate without an eviction policy, and concurrent refreshes can replace newer data with older results.

Consequence: memory growth and nondeterministic workflow availability.

Fix: bound the cache by tenant/version, deduplicate refreshes, and apply results only if their source version is current.

### [MEDIUM] Webhook delivery history grows without bound

Location: server/utils/webhooks/route-factories.ts:112-126

Why this is bad: delivery logs are appended without a retention or pagination strategy.

Consequence: database/storage growth and increasingly expensive webhook reads.

Fix: define retention, archive/delete old attempts, and query with bounded pagination and indexes.

### [MEDIUM] Workflow arguments are written to raw logs

Location: server/utils/workflows/background-execution.ts:143-193

Why this is bad: arguments can contain prompts, tokens, document contents, or personal data.

Consequence: sensitive workflow input persists in logs and becomes broadly accessible to operators/tools.

Fix: log schema/type and stable ids only; explicitly redact secrets and cap diagnostic payloads.

## Server admin, configuration, providers, and wizard

### [CRITICAL] Web wizard is unauthenticated by default

Location: server/wizard/index.ts:182-215

Why this is bad: the web wizard exposes setup operations without a mandatory authenticated administrative boundary.

Consequence: an attacker who can reach the endpoint may configure providers, write files, deploy resources, or change server state.

Fix: require an authenticated admin session plus a single-use wizard capability, bind it to the server/installation, and disable the wizard after setup.

### [CRITICAL] Wizard sessions are traversable

Location: shared/cloud/wizard/store.ts:54-56,78-88; server/wizard/index.ts:254-267

Why this is bad: session lookup is not strongly bound to the current authenticated owner.

Consequence: guessing or obtaining a session id can expose another installation's setup state.

Fix: use unguessable ids, bind every read/write to an owner and server nonce, and return the same not-found response for unauthorized ids.

### [CRITICAL] Wizard APIs return secrets

Location: server/wizard/index.ts:259-277; server/api/wizard/session.get.ts:9-16; shared/cloud/wizard/api.ts:624-640,692-726

Why this is bad: session/config responses include credentials or secret-bearing provider data.

Consequence: browser state, logs, support screenshots, and client-side code become secret exfiltration surfaces.

Fix: return redacted metadata only, keep secrets server-side, and use write-only secret fields with explicit “configured” markers.

### [CRITICAL] Wizard accepts arbitrary instance paths and commands

Location: server/wizard/index.ts:261-294,349-385; shared/cloud/wizard/validation.ts:132-134; shared/cloud/wizard/install-plan.ts:422-445

Why this is bad: caller-controlled paths and command parameters reach filesystem/process operations.

Consequence: path traversal, arbitrary file overwrite, or command execution can escape the intended installation directory.

Fix: resolve against a fixed allowlisted root, reject traversal/symlinks, use structured command arguments, and remove client control over executable paths.

### [HIGH] envFile is cast instead of validated

Location: server/wizard/index.ts:281-294; server/admin/config/env-file.ts:59-61

Why this is bad: a type assertion turns untrusted wizard input into a filesystem target.

Consequence: malformed input or traversal can reach environment-file writes.

Fix: parse a strict schema, normalize and validate the path against the configured root, and reject any alternate/absolute path.

### [HIGH] Deploy responses expose secrets

Location: shared/cloud/wizard/deploy.ts:232-246; server/wizard/index.ts:448-454

Why this is bad: deployment results include generated credentials/configuration rather than a redacted status.

Consequence: secrets leak into browser state, API logs, and client telemetry.

Fix: return operation id, status, and redacted resource identifiers only; provide one-time secret delivery through a dedicated protected channel.

### [HIGH] Provider connection tests permit SSRF

Location: shared/cloud/wizard/api.ts:212-247,278-337; server/api/wizard/test-connection.post.ts:13-29

Why this is bad: the wizard can make server-side requests to caller-selected provider URLs.

Consequence: attackers can probe internal services, cloud metadata endpoints, or loopback admin APIs.

Fix: allowlist provider hosts/schemes, resolve and block private/link-local addresses after DNS, disable redirects or revalidate every hop, and impose short timeouts.

### [HIGH] Wizard shutdown can terminate a remote process

Location: server/wizard/index.ts:239-243; server/api/wizard/shutdown.post.ts:8-12

Why this is bad: shutdown control is exposed without a narrowly scoped local/admin capability.

Consequence: an attacker can take the service offline.

Fix: require local authenticated admin authorization, a confirmation nonce, and an explicit server policy allowing remote shutdown.

### [HIGH] Wizard deploy is not transactional

Location: shared/cloud/wizard/apply.ts:160-187; server/wizard/index.ts:349-385

Why this is bad: config, credentials, extensions, and external resources are changed through independent steps without a durable plan/rollback state.

Consequence: a failed step leaves a half-configured installation that may be less secure than the original.

Fix: persist a deployment plan and step state, make each step idempotent, use atomic local file swaps, and implement compensating rollback for external resources.

### [HIGH] Wizard session writes are unlocked and non-atomic

Location: shared/cloud/wizard/store.ts:58-70,119-122

Why this is bad: concurrent browser tabs/processes can read-modify-write the same session file/store.

Consequence: configuration steps disappear, secrets are interleaved, or one deployment overwrites another.

Fix: use a lock/transaction with revision checks and atomic replace; serialize all session mutations per installation.

### [HIGH] Environment files are written non-atomically with weak permissions

Location: server/admin/config/env-file.ts:217-218

Why this is bad: direct writes can expose partial contents and inherit permissive file modes.

Consequence: a crash can leave invalid configuration, and other local users/processes can read credentials.

Fix: write a new file with restrictive mode, fsync if required, atomically rename, and verify ownership/mode after replacement.

### [HIGH] Environment parser permits quoting/multiline injection

Location: server/admin/config/env-file.ts:71-91,193-202

Why this is bad: values are reconstructed with ad hoc quoting/escaping rules.

Consequence: a value can change neighboring variables, create malformed dotenv content, or alter subsequent deployment behavior.

Fix: use a well-tested dotenv serializer, round-trip parse the output, and reject unsupported control characters/newlines.

### [HIGH] Admin JWTs lack hardening and reliable revocation

Location: server/admin/auth/jwt.ts:52-91,106-144

Why this is bad: signing/verification policy does not clearly enforce algorithm, issuer, audience, expiry, key rotation, and revocation semantics.

Consequence: weak/misconfigured tokens remain usable across password changes or server restarts.

Fix: pin algorithm and claims, use a key id/rotation strategy, keep short expiries, and store a revocation/session generation checked on every admin request.

### [HIGH] Admin-enabled policy is not centrally enforced

Location: server/admin/guard.ts:43-46; server/api/admin/workspaces/[id].get.ts:45-48; server/api/admin/plugins-page.get.ts:33-36; server/api/admin/workspace-enable.post.ts:32-36

Why this is bad: routes independently decide whether the admin subsystem is enabled.

Consequence: disabled admin deployments still expose individual sensitive endpoints.

Fix: put one mandatory guard in shared middleware/policy and add a route inventory test that every admin endpoint is covered.

### [HIGH] Password rotation bypasses the admin guard

Location: server/api/admin/auth/change-password.post.ts:45-61,83-105

Why this is bad: password-changing logic performs its own checks instead of using the central admin policy.

Consequence: a disabled or partially configured admin surface can still mutate credentials.

Fix: require the same admin session/capability guard and record a revocation generation after rotation.

### [MEDIUM] Admin login rate limiting is racy and unbounded

Location: server/admin/auth/rate-limit.ts:34-43,63-120,127-149,180-248

Why this is bad: counters are not clearly atomic/shared and attacker-controlled keys can accumulate forever.

Consequence: brute-force protection is bypassable across instances and the limiter itself becomes a memory-growth vector.

Fix: use bounded shared counters, normalize keys, cap cardinality, and add exponential backoff or account-level lock policy.

### [HIGH] Admin config can execute shell commands

Location: server/admin/config/resolve-config.ts:416-417; server/admin/system/server-control.ts:62-76; server/api/admin/system/rebuild.post.ts:44-46

Why this is bad: configuration and rebuild paths reach shell execution.

Consequence: compromised admin input can become arbitrary code execution on the server.

Fix: replace shell strings with fixed executable paths and structured argv, allowlist every operation, and never interpolate config values into a shell.

### [MEDIUM] Rebuild marker is written before rebuild success

Location: server/admin/system/server-control.ts:62-76

Why this is bad: a marker says a rebuild is complete before the command has successfully finished.

Consequence: readers skip required work after a failed rebuild and the server enters a misleading state.

Fix: write a pending marker first, atomically promote it only after verified success, and preserve failure diagnostics for retry.

### [MEDIUM] Provider actions lack complete authorization

Location: server/api/admin/system/provider-action.post.ts:14-18,31-67; server/admin/system/provider-action/types.ts:105-131

Why this is bad: action names and provider ids are accepted without a single capability check and strict allowlist.

Consequence: a lower-privileged admin can trigger sensitive provider operations.

Fix: map each action to an explicit permission and validated provider capability; reject unknown actions before dispatch.

### [MEDIUM] Admin store resolver ignores event context

Location: server/admin/stores/registry.ts:46-50,55-100

Why this is bad: store resolution appears to ignore request/event context that should carry authorization and tenant scope.

Consequence: admin operations can resolve global state when they should resolve installation or workspace-specific state.

Fix: make context a required parameter and test scope propagation end to end.

### [HIGH] Invite admin routes expose public configuration/data

Location: server/api/admin/workspace/invites/create.post.ts:64-75; server/api/admin/workspace/invites/index.get.ts:42-44; server/api/admin/workspace/invites/[id].delete.ts:59-61

Why this is bad: invite create/list/revoke paths do not consistently enforce admin authorization and no-store semantics.

Consequence: invite tokens or metadata can be enumerated, cached, or revoked by an unintended caller.

Fix: apply the central admin/workspace guard, return redacted invite records, and set no-store on all personalized responses.

### [HIGH] Static generation loads providers with auth enabled

Location: nuxt.config.ts:34-37,109-119,197-203

Why this is bad: build-time/static generation imports or initializes server provider code in a deployment where runtime auth boundaries are expected.

Consequence: secrets/config can be bundled, build behavior can differ from runtime, and static pages may expose server-only data.

Fix: separate server-only provider initialization from static generation and audit generated assets for secret/config leakage.

### [HIGH] Static soft-delete route is dead or incomplete

Location: server/api/admin/workspaces/soft-delete.post.ts:14,53-55

Why this is bad: the route is present but appears to rely on a disabled/static execution path.

Consequence: operators believe deletion is protected/available while the actual route can no-op or bypass expected lifecycle state.

Fix: either remove the dead route or wire it through the canonical workspace lifecycle service with tests for authorization and state transitions.

### [HIGH] Static restore route is dead or incomplete

Location: server/api/admin/workspaces/restore.post.ts:13,37-39

Why this is bad: restore behavior is similarly disconnected from the live lifecycle path.

Consequence: deleted workspaces cannot be reliably recovered, or a restore can omit dependent resources.

Fix: implement restore as an idempotent state-machine transition and test data, membership, and storage recovery together.

### [MEDIUM] Admin pagination accepts NaN

Location: server/api/admin/workspaces.get.ts:87-92; server/api/admin/users/search.get.ts:51-56

Why this is bad: invalid page/limit values are coerced instead of rejected.

Consequence: database queries can receive invalid offsets/limits or return inconsistent results.

Fix: parse positive bounded integers with a strict schema and return 400 for invalid values.

### [MEDIUM] Wizard readiness accepts every status below 600

Location: server/wizard/index.ts:87-106

Why this is bad: an arbitrary non-error HTTP status is treated as readiness success.

Consequence: redirects, authentication pages, and partial failures can be reported as a healthy deployment.

Fix: require the expected status and a validated response marker from the target service.

### [HIGH] Extension install has no cross-process lock

Location: server/admin/extensions/install.ts:432-457

Why this is bad: concurrent installs can mutate the same extension directory and registry.

Consequence: partially extracted packages, mismatched manifests, and load-time code execution from an inconsistent tree.

Fix: lock per extension/version, stage extraction in a new directory, verify manifest/hash, then atomically publish.

### [MEDIUM] Extension limits accept invalid values

Location: server/admin/extensions/install.ts:485-506; server/api/admin/extensions/install.post.ts:161-180

Why this is bad: size/file/count limits are not consistently normalized and bounded.

Consequence: a malformed request can disable safety checks or trigger excessive extraction work.

Fix: validate positive integer limits against server maxima and ignore client values that exceed policy.

### [MEDIUM] Credential JSON is unchecked

Location: server/admin/auth/credentials.ts:49-58; server/api/admin/auth/login.post.ts:105-124

Why this is bad: credential records are parsed/cast without strict shape, size, and algorithm validation.

Consequence: malformed credentials can crash login or alter authentication interpretation.

Fix: validate credential schema at read and write, pin supported hash algorithms, and fail closed on unknown fields/versions.

### [HIGH] S3 connection test can accept a false success

Location: shared/cloud/wizard/api.ts:298-345

Why this is bad: the test does not reliably use the supplied credentials and can treat a 403-like response as proof of connectivity.

Consequence: invalid provider configuration passes setup and fails later during real storage operations.

Fix: perform a minimal authenticated operation with the supplied credentials, distinguish auth failure from reachability, and require the expected response.

### [HIGH] Password change does not revoke existing JWTs

Location: server/api/admin/auth/change-password.post.ts:101-105; server/admin/auth/jwt.ts:106-144

Why this is bad: changing the password updates the secret but leaves previously issued admin tokens valid.

Consequence: a stolen token remains useful after the operator believes access has been revoked.

Fix: increment an admin auth generation on password change and include/check that generation in every token.

### [HIGH] Wizard does not consistently configure server JWT state

Location: shared/cloud/wizard/catalog.ts:81-161,1043-1048,1097-1099; shared/cloud/wizard/derive.ts:234-238,359-365; server/admin/auth/jwt.ts:60-66

Why this is bad: setup can generate or validate provider config without establishing the server's actual JWT key/issuer policy.

Consequence: login works in one process, fails after restart, or silently falls back to weak/default auth material.

Fix: make JWT configuration a required deployment step with generated key material, explicit issuer/audience, persisted key id, and startup validation.

### [HIGH] Credential writes race

Location: server/admin/auth/credentials.ts:49-85,92-133

Why this is bad: concurrent password/bootstrap writes can overwrite each other without revision checks.

Consequence: the operator receives a password that is not the one actually persisted.

Fix: serialize credential mutations, write atomically, and return the persisted credential version.

### [HIGH] Convex secrets can reach argv or logs

Location: shared/cloud/wizard/deploy.ts:204-252,93-123; shared/cloud/wizard/error-handler.ts:67-82; shared/cloud/wizard/cli.ts:1579-1582

Why this is bad: secrets are passed to subprocesses or interpolated into diagnostics.

Consequence: process listings, CI logs, crash reports, and shell history can expose deployment credentials.

Fix: use stdin or a protected environment mechanism, redact command args/errors, and assert secrets never appear in captured output.

### [MEDIUM] Sensitive admin responses lack no-store

Location: admin API routes including server/api/admin/workspaces.get.ts, server/api/admin/auth/login.post.ts, and wizard session/deploy routes

Why this is bad: personalized administrative data is returned without a consistent cache policy.

Consequence: browser/proxy caches can retain user records, workspace state, or setup metadata.

Fix: apply Cache-Control: no-store in shared admin middleware and test every sensitive route.

### [MEDIUM] Config manager reads the wrong environment source

Location: server/admin/config/config-manager.ts:162-169,184-200,216-249

Why this is bad: config resolution can mix process environment, generated env files, and cached values inconsistently.

Consequence: the UI reports one provider/config while runtime uses another.

Fix: define one precedence order and source-of-truth resolver, include a config revision, and make writes invalidate all readers.

### [MEDIUM] Session/deploy operations are not serialized per wizard session

Location: shared/cloud/wizard/api.ts:506-514,548-551; shared/cloud/wizard/store.ts:66-71; server/wizard/index.ts:303-454

Why this is bad: multiple requests can apply plans, poll status, and mutate the same session concurrently.

Consequence: duplicate deploys, contradictory status, and corrupted session state.

Fix: serialize by session id and reject stale revision numbers.

### [MEDIUM] Extension swap can race with load

Location: server/admin/extensions/install.ts:241-278,432-478

Why this is bad: registry publication and filesystem replacement are not one atomic visibility event.

Consequence: the loader can see a half-old/half-new extension and execute inconsistent code.

Fix: stage and verify the entire extension, atomically switch a version pointer, and keep the old version until no readers reference it.

### [MEDIUM] Wizard apply can delete unrelated config

Location: shared/cloud/wizard/derive.ts:404-418; shared/cloud/wizard/catalog.ts:81-161

Why this is bad: generated output is treated as the entire configuration rather than a scoped patch.

Consequence: enabling one provider can remove unrelated settings, secrets, or custom extensions.

Fix: merge only owned keys, preserve unknown/custom keys, and show a diff/confirmation before destructive config changes.

### [MEDIUM] Password changes lack their own rate limit

Location: server/api/admin/auth/change-password.post.ts:54-90

Why this is bad: a high-value credential mutation is protected only by the general session path.

Consequence: repeated guesses, resource exhaustion, or password-rotation abuse can target the endpoint.

Fix: add per-account and per-origin throttling, require current credential/re-auth where appropriate, and audit every attempt.

### [MEDIUM] DISABLE_RATE_LIMIT can bypass production controls

Location: server/admin/auth/rate-limit.ts:22-24,180-193

Why this is bad: a broad environment flag can turn off protection without a deployment safety check.

Consequence: an accidental or attacker-controlled configuration change removes brute-force defenses.

Fix: permit bypass only in explicit development mode, emit a startup failure/warning in production, and make the flag unavailable to runtime request input.

### [MEDIUM] Provider requirements are warnings instead of errors

Location: shared/cloud/wizard/validation.ts:365-380,471-505; shared/cloud/wizard/derive.ts:359-365; server/wizard/index.ts:381-385

Why this is bad: missing required provider credentials can still produce a “valid” deployment plan.

Consequence: runtime failures occur after setup has reported success.

Fix: make required-field validation fail the plan and distinguish optional provider warnings from deploy blockers.

### [MEDIUM] Secret-strength checks are advisory

Location: shared/cloud/wizard/validation.ts:140-148,297-313

Why this is bad: weak generated/user-provided secrets produce warnings but are accepted.

Consequence: administrative credentials and signing keys can be brute-forced or guessed.

Fix: enforce minimum entropy/length for security-critical fields and reject known defaults.

### [MEDIUM] Provider defaults drift between registries

Location: shared/cloud/provider-ids.ts:73-75; server/admin/config/resolve-config.ts:265-270; server/admin/stores/registry.ts:46-50

Why this is bad: different registries define different default provider ids and capabilities.

Consequence: the UI, deploy plan, and runtime select different providers.

Fix: make one shared provider registry authoritative and generate all default/capability views from it.

## Client persistence, sync, workspace lifecycle, and auth state

### [CRITICAL] Backup restore imports sync metadata as user data

Location: app/utils/workspace-backup-stream.ts:262-277,585-589; app/composables/core/useWorkspaceBackup.ts:568-579

Why this is bad: backup restore can restore cursors, outbox state, revisions, or identifiers that belong to the old installation.

Consequence: restored data can be skipped, replayed, uploaded to the wrong server, or treated as already acknowledged.

Fix: restore application records only; generate fresh local ids/sync metadata and run an explicit reindex/resync step.

### [CRITICAL] Logout deletes the active database before invalidation

Location: app/utils/logout-cleanup.ts:57-70; app/utils/workspace-db-logout.ts:55-65

Why this is bad: cleanup destroys storage while reactive stores/watchers still reference it.

Consequence: stale data can be written after logout, errors can crash the client, and another user can see residual state.

Fix: freeze writes, stop subscriptions/workers, invalidate stores, close connections, then delete/evict storage and clear credentials.

### [HIGH] Workspace eviction can delete the active database

Location: app/db/client.ts:450-464

Why this is bad: generic eviction does not protect the currently mounted workspace.

Consequence: active chat/editor state loses its persistence underneath the user.

Fix: exclude active workspace ids from eviction or require an explicit lifecycle transition before deletion.

### [HIGH] Null workspace skips cleanup

Location: app/db/client.ts:508-519

Why this is bad: a missing workspace id takes an early-return path that leaves resources alive.

Consequence: subscriptions, timers, and stale stores survive workspace/logout transitions.

Fix: cleanup by resource owner/session even when the workspace id is unavailable; make null an explicit “all scoped resources” transition.

### [HIGH] HookBridge outbox writes are fire-and-forget

Location: app/core/sync/hook-bridge.ts:379-384,410-415

Why this is bad: mutation capture is started without awaiting or surfacing write failure.

Consequence: the UI commits local state while the durable outbox write silently fails.

Fix: await capture as part of the mutation transaction or mark the mutation visibly unsynced and retry with bounded durable state.

### [HIGH] HookBridge stop leaks hooks

Location: app/core/sync/hook-bridge.ts:110-191,196-198,495-500

Why this is bad: stop/restart does not reliably unregister all listeners and hook registrations.

Consequence: duplicate outbox writes, duplicate network pushes, and memory growth after workspace switching.

Fix: make registration return disposers, store them by generation, and make stop idempotently dispose every resource before a new bridge starts.

### [HIGH] Sync cursor can move backward

Location: app/core/sync/cursor-manager.ts:67-79,100-110

Why this is bad: cursor updates do not enforce monotonicity.

Consequence: the client replays old changes, duplicates writes, or prevents safe pruning.

Fix: compare-and-set only forward cursors, persist a stream generation, and reject stale updates.

### [HIGH] Outbox has no cross-tab lease

Location: app/core/sync/outbox-manager.ts:194-208,258-261

Why this is bad: tabs can process the same outbox item concurrently.

Consequence: duplicate server mutations, conflicting retries, and inconsistent local status.

Fix: use an IndexedDB lease/owner generation or a single shared worker to claim entries.

### [HIGH] Rescan can preserve stale canonical rows

Location: app/core/sync/subscription-manager.ts:500-543

Why this is bad: rescan merges observed rows without taking a consistent snapshot or deleting rows absent from the authoritative result.

Consequence: deleted/changed records remain visible after resync.

Fix: use snapshot generation, replace the scoped set atomically, or explicitly tombstone rows absent from the snapshot.

### [HIGH] Pending overlay hides canonical conflicts

Location: app/core/sync/subscription-manager.ts:577-581

Why this is bad: the overlay considers only pending local operations and ignores rejected/failed/conflicted states.

Consequence: the UI shows optimistic data indefinitely after the server has rejected it.

Fix: model pending, acknowledged, rejected, and conflict states separately and reconcile overlays from server acknowledgements.

### [HIGH] Legacy import can overwrite newer data

Location: app/composables/core/useWorkspaceLegacyImport.ts:23-41,59-75

Why this is bad: import writes records without a revision/conflict check or a user-visible merge policy.

Consequence: a legacy file can erase current workspace content.

Fix: import into a staging workspace/transaction, compare revisions, and require explicit conflict resolution before replacement.

### [HIGH] Message-file lookup is not workspace-scoped

Location: app/db/message-files.ts:81-161,177-198

Why this is bad: file records are queried/deleted by message/file id without always including workspace scope.

Consequence: one workspace can read or delete attachment metadata belonging to another.

Fix: include workspace id in every key/index/query and assert scope at the repository boundary.

### [HIGH] Attachment creation has a race

Location: app/db/message-files.ts:42-64,115-139

Why this is bad: existence check and insert are separate.

Consequence: duplicate attachment rows and inconsistent message/file associations appear under concurrent sends.

Fix: add a scoped unique key and make insert-or-get atomic.

### [HIGH] Revision pruning can target the wrong workspace

Location: app/db/document-revisions.ts:197-202,245-261

Why this is bad: pruning criteria do not consistently include workspace/document ownership.

Consequence: history from another workspace can be deleted during local retention cleanup.

Fix: scope every revision operation by workspace and document id, and add cross-workspace fixture tests.

### [HIGH] Prompt deletion can target the wrong workspace

Location: app/db/prompts.ts:590-631

Why this is bad: deletion uses a prompt id/path without a complete workspace condition.

Consequence: a delete in one workspace can remove a similarly addressed prompt elsewhere.

Fix: require a scoped composite key and reject unscoped repository calls.

### [HIGH] Document deletion has the same scope defect

Location: app/db/documents.ts:568-618

Why this is bad: document deletion can be resolved independently of the active workspace.

Consequence: destructive UI actions can affect a document outside the current tenant.

Fix: make workspace id mandatory in the repository API and transactionally delete dependent rows under that scope.

### [HIGH] Multi-pane loads can commit stale results

Location: app/composables/documents/useMultiPane.ts:482-547

Why this is bad: asynchronous pane loads do not consistently check that the requested pane/document is still current before committing.

Consequence: switching quickly between panes displays or edits the previous document.

Fix: use load generations/AbortController and commit only if pane id and workspace generation still match.

### [HIGH] Backup import can switch workspaces after parsing

Location: app/composables/core/useWorkspaceBackup.ts:515-543,568-579

Why this is bad: the active workspace is read again after a long parse/import operation.

Consequence: a workspace switch during import writes the backup into the wrong database.

Fix: capture workspace id and database handle at operation start, abort if the generation changes, and require explicit destination selection.

### [HIGH] API key hydration is one-shot

Location: app/composables/core/useUserApiKey.ts:31,121-125

Why this is bad: key state is loaded once and does not react to account/workspace/auth changes.

Consequence: the next user or workspace can inherit the previous key in memory.

Fix: scope key state by user/workspace/auth generation and clear it synchronously on logout/switch.

### [HIGH] OpenRouter logout leaves a reactive key alive

Location: app/core/auth/useOpenrouter.ts:161-182

Why this is bad: persisted key cleanup does not clear every in-memory/reactive reference.

Consequence: a logged-out session can continue making provider requests.

Fix: centralize secret lifecycle, clear reactive state before storage deletion, and test logout during an in-flight send.

### [HIGH] Preview cache URLs leak across scopes

Location: app/composables/files/usePreviewCache.ts:89-145

Why this is bad: object URLs/cache entries are not keyed and disposed by workspace/user.

Consequence: previews from a previous workspace remain accessible through the UI or memory.

Fix: scope cache keys by workspace/user, revoke object URLs on eviction, and clear on auth/workspace generation change.

### [HIGH] Tokenizer HMR promises never reject

Location: app/composables/files/useTokenizer.ts:30-36,129-159,228-232

Why this is bad: hot-reload or worker failure leaves pending promises unresolved.

Consequence: editors hang indefinitely and retain listeners/workers.

Fix: reject all pending requests on worker teardown/replacement and add a timeout/cancellation path.

### [HIGH] Revision worker can hang forever

Location: app/utils/revision-codec-client.ts:8-13,43-53

Why this is bad: worker RPC has no timeout and does not reject on termination/error.

Consequence: document history and save flows remain permanently pending.

Fix: implement request ids, timeout/abort, worker error handling, and deterministic cleanup.

### [MEDIUM] Storage gateway exposes raw server errors

Location: app/core/storage/gateway-storage-provider.ts:39-58

Why this is bad: provider errors are surfaced without normalization/redaction.

Consequence: internal paths, provider ids, and operational details reach users and telemetry.

Fix: map errors to stable user-safe codes and keep raw causes in restricted diagnostics.

### [MEDIUM] Replacing a sync provider does not dispose the old one

Location: app/core/sync/sync-provider-registry.ts:41-60

Why this is bad: registry replacement overwrites the reference without stopping the old provider.

Consequence: duplicate subscriptions, background pushes, and leaked network connections.

Fix: await disposal before publication of the replacement and guard with provider generations.

### [MEDIUM] Workspace watchers are registered more than once

Location: app/composables/core/useWorkspaceManager.ts:28-83; app/plugins/00.*; app/plugins/convex-sync.*

Why this is bad: multiple startup paths attach the same workspace watcher.

Consequence: repeated initialization, duplicate sync loops, and hard-to-reproduce state races.

Fix: make watcher registration idempotent and record a single owner/disposer.

### [MEDIUM] Remote deletion trusts client-provided time

Location: app/core/sync/conflict-resolver.ts:206-232,380-405

Why this is bad: retention/conflict decisions use payload timestamps without server authority.

Consequence: a client with a skewed or malicious clock can preserve or delete records incorrectly.

Fix: use server sequence/revision time for conflict and retention decisions; treat client time as display metadata only.

## Client chat, projects, threads, and external agents

### [CRITICAL] Thread switching can rebind a live request

Location: app/composables/chat/useAi.ts:2525-2599

Why this is bad: a running request reads mutable current-thread state while the user switches threads.

Consequence: assistant deltas, tool results, or final messages can land in the wrong conversation.

Fix: snapshot thread/workspace/request ids at send time and route every event through that immutable request context.

### [HIGH] Empty assistant cleanup uses the current database

Location: app/composables/chat/useAi.ts:2156-2171

Why this is bad: cleanup after an async request resolves against whichever database is active now.

Consequence: an empty-message cleanup can delete a record from another workspace/thread.

Fix: retain the original database handle and message id, then verify request generation before cleanup.

### [HIGH] Background deltas are not replay-safe

Location: app/utils/chat/useAi-internal/backgroundJobs.ts:194-226

Why this is bad: deltas are applied without durable sequence/idempotency checks.

Consequence: reconnects duplicate text or apply events out of order.

Fix: persist event sequence, ignore already-applied events, and rebuild assistant state from an ordered event log.

### [HIGH] Inactive trackers are reused indefinitely

Location: app/utils/chat/useAi-internal/backgroundJobs.ts:643-667,838-886

Why this is bad: completed/abandoned request trackers remain eligible for later events.

Consequence: stale background output is attached to a new UI session.

Fix: expire trackers, mark terminal state immutably, and require exact request generation on every update.

### [HIGH] Local persistence failure aborts durable server work

Location: app/utils/chat/useAi-internal/backgroundJobs.ts:316-335

Why this is bad: a local IndexedDB failure is coupled to the server job's lifecycle.

Consequence: a transient browser storage issue can cancel otherwise recoverable server work.

Fix: separate durable server job state from local projection; retry local persistence without aborting the server job.

### [HIGH] Polling errors are unhandled

Location: app/utils/chat/useAi-internal/backgroundJobs.ts:594-614

Why this is bad: polling exceptions do not consistently transition the tracker to a terminal/error state.

Consequence: the UI can spin forever with no retry or user-visible failure.

Fix: wrap polling in bounded retry/backoff, handle terminal error, and stop timers on unmount/switch.

### [MEDIUM] SSE and polling can race

Location: app/utils/chat/useAi-internal/backgroundJobs.ts:697-753

Why this is bad: both transports can apply the same event without a shared sequence gate.

Consequence: duplicate assistant chunks and contradictory status transitions.

Fix: converge both transports on one ordered event reducer keyed by event sequence.

### [MEDIUM] Foreground hook queue drops events

Location: app/utils/chat/useAi-internal/foregroundHooks.ts:123-179

Why this is bad: queue overflow or lifecycle transitions discard tool events rather than preserving backpressure.

Consequence: tool UI and transcript diverge from the actual model run.

Fix: bound and persist events, apply backpressure, and surface overflow as an explicit run failure.

### [HIGH] Foreground tools can run without security scope

Location: app/utils/chat/useAi-internal/foregroundHooks.ts:559-570

Why this is bad: tool execution accepts a context where workspace/user capability is nullable.

Consequence: a chat tool can access global or unintended data when invoked from a malformed/stale UI state.

Fix: require non-null immutable scope and authorize each tool operation server-side.

### [MEDIUM] Stream abort has no deadline

Location: app/utils/chat/openrouterStream.ts:767-778

Why this is bad: abort waits for provider/fetch cleanup without a hard timeout.

Consequence: aborted chats retain network resources and UI locks indefinitely.

Fix: race abort cleanup with a deadline, terminate the reader/controller, and force terminal local state.

### [HIGH] Intentional abort is reported as failure

Location: app/utils/chat/continue.ts:551-595

Why this is bad: user cancellation follows the same error path as provider failure.

Consequence: the UI shows scary errors, records false failures, and may schedule an unwanted retry.

Fix: classify AbortError/cancel intent separately and persist a canceled terminal state.

### [HIGH] Retry uses a mutable thread reference

Location: app/utils/chat/retry.ts:182-227,322-330

Why this is bad: retry resolves the target thread from current reactive state instead of the failed request.

Consequence: retry can duplicate a message in a different thread after navigation.

Fix: persist the original request/thread id with the failure and retry only against that immutable target.

### [HIGH] Continue can use stale message/thread refs

Location: app/utils/chat/continue.ts:193-223,442-450

Why this is bad: continuation is assembled from reactive values that can change during the async operation.

Consequence: continuation content is appended to the wrong message or sends with old settings.

Fix: snapshot all ids/settings at invocation and reject if the current generation no longer matches.

### [HIGH] Tool reconciliation keys globally by call id

Location: app/utils/chat/transcript.ts:213-237

Why this is bad: tool call ids are not guaranteed globally unique across runs/threads.

Consequence: a result from one run can reconcile against another run's tool call.

Fix: key by workspace/thread/run/call id and enforce uniqueness in the transcript model.

### [HIGH] Project-created threads can omit project_id

Location: app/composables/projects/useProjectsCrud.ts:64-88

Why this is bad: thread creation can write a thread without the project relation that the UI assumes.

Consequence: project views lose threads, and later cleanup cannot identify project-owned data.

Fix: make project id required for project-scoped creation and enforce the relation in the persistence schema.

### [HIGH] Project creation is not atomic

Location: app/composables/projects/useProjectsCrud.ts:64-110

Why this is bad: project, membership, and initial thread writes happen independently.

Consequence: a failed step leaves partial project state that the UI cannot repair.

Fix: use a transaction or explicit resumable creation state with rollback/repair.

### [HIGH] Project CRUD is not fully workspace-scoped

Location: app/composables/projects/useProjectsCrud.ts:67-88,95-109,117-125

Why this is bad: reads/updates/deletes do not consistently include the active workspace.

Consequence: project operations can cross tenant boundaries in local persistence.

Fix: include workspace id in every key/query and prohibit unscoped project repository calls.

### [HIGH] Thread search index is shared across workspaces

Location: app/composables/threads/useThreadSearch.ts:23-24,35-109

Why this is bad: the search index is a singleton without a workspace/user generation.

Consequence: search results from another workspace appear in the current workspace.

Fix: build/index per workspace generation, clear on switch/logout, and include scope in document ids.

### [MEDIUM] Recursive thread search rejection is not handled

Location: app/composables/threads/useThreadSearch.ts:102-109,157-160

Why this is bad: rejected recursive/index work leaves state unchanged without a visible fallback.

Consequence: search silently appears empty or stale after an indexing error.

Fix: catch and surface index errors, retain the previous valid index, and provide a bounded fallback search.

### [HIGH] AI settings can come from the old workspace

Location: app/composables/chat/useAiSettings.ts:147-188

Why this is bad: settings are loaded asynchronously without checking the workspace generation that initiated the load.

Consequence: the next workspace inherits model/provider/temperature settings from the previous one.

Fix: scope settings by workspace id and generation; discard late loads and clear on switch.

### [HIGH] Model catalog is a global singleton

Location: app/stores/model.ts:61-93,192-228,347-362

Why this is bad: model availability and selected model are shared across workspace/user contexts.

Consequence: restricted models or stale provider settings leak between sessions.

Fix: key catalog and selection by user/workspace/provider generation and clear on auth changes.

### [MEDIUM] Programmatic chat sends are not serialized

Location: app/composables/chat/useChatInputBridge.ts:145-153

Why this is bad: multiple programmatic send callers can mutate the same composer/thread concurrently.

Consequence: prompts, attachments, and pending state are interleaved.

Fix: provide a per-thread send queue or reject a second send until the first has captured immutable input.

### [MEDIUM] Message edits can save stale content

Location: app/composables/chat/useMessageEditing.ts:149-177

Why this is bad: the save callback does not verify that the message revision being edited is still current.

Consequence: an older edit overwrites a newer edit or server-generated update.

Fix: use message revision compare-and-swap and surface conflict instead of silently overwriting.

### [HIGH] Default prompt can race workspace switching

Location: app/composables/chat/useDefaultPrompt.ts:71-88

Why this is bad: prompt load/write is asynchronous and not tied to a workspace generation.

Consequence: a default prompt is written into the wrong workspace.

Fix: capture workspace id/DB at start and validate generation before every write.

### [HIGH] Activity ids discard background deltas

Location: app/core/activity/adapters/background-chat.ts:119-149

Why this is bad: the adapter assumes one activity id maps one immutable output and does not account for revisions/sequence.

Consequence: later deltas are ignored or overwrite the wrong activity.

Fix: store sequence/revision with each activity event and reduce by run/thread/activity scope.

### [HIGH] Workflow activity output is not revision-aware

Location: app/core/activity/adapters/workflow.ts:129-177,320-359

Why this is bad: out-of-order workflow events can replace newer status/output.

Consequence: a completed/failed workflow can reappear as running or display stale text.

Fix: enforce monotonic sequence/revision before updating activity state.

### [HIGH] External-agent SSE ignores raw data safely

Location: app/core/external-agents/event-store.ts:103-117

Why this is bad: event parsing assumes structured fields and does not preserve unrecognized/raw events.

Consequence: provider-specific output, errors, or terminal markers vanish without an audit trail.

Fix: persist raw bounded event payload alongside parsed type and sequence, and make unknown events observable.

### [HIGH] External-agent stale sequences are accepted

Location: app/core/external-agents/event-store.ts:432-448

Why this is bad: event sequence checks do not reject older events.

Consequence: reconnects regress transcript/status state.

Fix: atomically advance sequence and ignore stale/duplicate events.

### [HIGH] Failed external-agent launch leaks remote sessions

Location: app/core/external-agents/controller.ts:1045-1115

Why this is bad: local launch failure does not reliably cancel the remote session.

Consequence: orphaned agent processes continue consuming provider resources.

Fix: use a compensating cancel in every post-launch failure path and reconcile orphaned sessions from the server.

### [HIGH] Cancel can report failure after success

Location: app/core/external-agents/controller.ts:1214-1243

Why this is bad: cancel response handling can overwrite a successful terminal state with a late error.

Consequence: the UI offers retry/cleanup for a session that is already safely canceled.

Fix: make terminal state monotonic and ignore late contradictory responses.

### [MEDIUM] External-agent delta overlap can corrupt output

Location: app/core/external-agents/event-store.ts:290-295

Why this is bad: overlapping/replayed text deltas are concatenated without sequence/content reconciliation.

Consequence: duplicated or corrupted assistant output after reconnect.

Fix: use event sequence or a provider cursor, and dedupe exact ranges before append.

### [HIGH] External-agent pane commits stale loads

Location: app/components/external-agents/ExternalAgentSessionPane.vue:767-813

Why this is bad: async session loading commits after the user has switched panes/sessions.

Consequence: one agent's transcript appears in another agent's pane.

Fix: use an abortable load generation keyed by workspace/session id.

## Client documents, search, notifications, dashboard, and admin UX

### [HIGH] Notification markRead is not user-scoped

Location: app/core/notifications/notification-service.ts:197-206

Why this is bad: marking a notification read uses a notification id without checking current user/workspace ownership.

Consequence: one account/session can mutate another user's notification state if ids are exposed.

Fix: require user id and workspace scope in the update predicate and reject mismatches.

### [HIGH] Notification singleton crosses users

Location: app/composables/notifications/useNotifications.ts:41-46,139-159,289-339

Why this is bad: a singleton store survives auth transitions and retains rows/subscriptions from the previous user.

Consequence: private notifications leak after account switching.

Fix: key the store by auth generation, tear down subscriptions on logout, and clear all cached rows before mounting the next user.

### [MEDIUM] Notification persistence errors look like empty data

Location: app/core/notifications/notification-service.ts:181-211,217-245

Why this is bad: IndexedDB failures are converted into an empty result.

Consequence: users lose notifications silently and retries/diagnostics never occur.

Fix: distinguish empty from unavailable, surface a recoverable error, and retry with backoff.

### [MEDIUM] Mute writes can be lost

Location: app/composables/notifications/useNotifications.ts:346-374

Why this is bad: mute updates are fire-and-forget and can race with another update or unmount.

Consequence: notification preferences revert unexpectedly.

Fix: serialize preference writes, await persistence, and reconcile optimistic state from the stored revision.

### [MEDIUM] Notification rows are inaccessible

Location: app/components/notifications/NotificationItem.vue:2-6,127-131

Why this is bad: interactive notification rows do not expose appropriate semantics/focus/keyboard behavior.

Consequence: keyboard and assistive-technology users cannot reliably read or mark notifications.

Fix: use buttons/links with accessible names, focus states, and keyboard activation; keep mark-read state announced.

### [HIGH] Model search state is shared

Location: app/core/search/useModelSearch.ts:52-53,103-130

Why this is bad: query/results state is singleton and not scoped to workspace/provider/user.

Consequence: search results and model access can leak across contexts.

Fix: scope search state and index keys by auth/workspace/provider generation.

### [HIGH] Model index is truncated to 100 entries

Location: app/core/search/useModelSearch.ts:100-114

Why this is bad: indexing silently stops at a fixed prefix.

Consequence: valid models are undiscoverable and selection behavior differs from provider capability.

Fix: paginate/index all authorized models or explicitly communicate a server-defined search limit.

### [MEDIUM] Search index can be stale without fallback

Location: app/core/search/useModelSearch.ts:103-106,120-122

Why this is bad: index build errors and provider/catalog updates are not coordinated.

Consequence: search returns old/incomplete results with no indication.

Fix: version the index, rebuild on catalog revision, retain last-good state, and provide a bounded direct-search fallback.

### [HIGH] Documentation search indexes metadata only

Location: app/components/search/SearchPanelRoot.vue:89-109,113-158

Why this is bad: the search index does not include document body/content.

Consequence: users searching for actual documentation text get no results.

Fix: index normalized content with size limits and workspace/document revision keys; use a clear fallback when indexing is unavailable.

### [HIGH] Document switch can save document A into document B

Location: app/components/documents/DocumentEditorRoot.vue:299-309,427-505,507-512

Why this is bad: save/load callbacks use mutable current document state and lack a generation check.

Consequence: editing one document and switching quickly can overwrite another document.

Fix: snapshot document id/revision per save, abort stale loads, and require compare-and-swap on persistence.

### [HIGH] Document history can load the previous document

Location: app/components/documents/DocumentHistoryPanel.vue:107-117,181-185

Why this is bad: history requests are not canceled or validated after document switching.

Consequence: the history panel displays or restores revisions from the wrong document.

Fix: key requests by document id/revision and discard late responses.

### [HIGH] Documentation fetch errors are hidden

Location: app/composables/documentation/useDocumentationContent.ts:17-30,40-45

Why this is bad: failed content fetch is represented as missing content.

Consequence: users see an empty page and cannot distinguish outage from an empty document.

Fix: keep explicit loading/error/empty states and provide retry.

### [HIGH] Document store cache is not workspace-scoped

Location: app/stores/documents.ts:29-39,185-200,309-310

Why this is bad: cache keys omit workspace identity.

Consequence: document lists and selected content bleed between workspaces.

Fix: include workspace generation in every cache key and clear on switch/logout.

### [HIGH] Failed flush can discard unsaved document changes

Location: app/composables/documents/usePaneDocuments.ts:404-439

Why this is bad: local draft is cleared or advanced before the server/storage flush is confirmed.

Consequence: a transient save failure becomes irreversible user data loss.

Fix: retain dirty state until durable acknowledgement, persist a local recovery draft, and make flush retryable.

### [HIGH] Pane switch continues after save failure

Location: app/composables/documents/usePaneDocuments.ts:152-174

Why this is bad: navigation proceeds even when saving the current pane fails.

Consequence: the user leaves a document believing it was saved while the failed state is hidden.

Fix: block or explicitly confirm navigation on save failure and keep recovery state.

### [HIGH] Document AI settings are global

Location: app/composables/documents/useDocumentAiSettings.ts:67-70,122-150

Why this is bad: settings are not scoped to workspace/document.

Consequence: private provider/model choices and prompts carry between tenants or documents.

Fix: key settings by workspace/document and invalidate on auth/switch.

### [MEDIUM] Document insights process the whole document every frame

Location: app/composables/documents/useDocumentInsights.ts:19-24,39-65

Why this is bad: reactive updates trigger full-document analysis without debouncing or incremental work.

Consequence: typing causes CPU spikes, jank, and battery waste on large documents.

Fix: debounce, cap input, and compute incrementally or in a worker.

### [MEDIUM] Protocol-relative links are accepted

Location: app/utils/document-href.ts:9-17

Why this is bad: URLs beginning with // inherit the current scheme and can point to an attacker-controlled host.

Consequence: rendered document links can become insecure or unexpected external navigation.

Fix: require explicit http/https or relative paths and reject protocol-relative URLs.

### [MEDIUM] Revision decoding has no resource limits

Location: app/utils/revisions/revision-codec.ts:92-114

Why this is bad: compressed/encoded revision data is decoded without strict output size/depth limits.

Consequence: malformed content can cause decompression/memory exhaustion.

Fix: enforce encoded and decoded byte limits, recursion/depth limits, and abortable decoding.

### [MEDIUM] Data URLs bypass byte checks

Location: app/utils/files/data-url.ts:14-23,60-68

Why this is bad: the textual URL length is used instead of decoded payload bytes.

Consequence: base64 data can exceed intended attachment limits.

Fix: decode with a bounded reader, calculate actual bytes, and reject unsupported media/types before allocating.

### [HIGH] Dashboard plugin icons are inert

Location: app/components/dashboard/PluginIcons.vue:7-15; app/components/dashboard/Dashboard.vue:25-35

Why this is bad: plugin actions are rendered as icon-like elements without reliable activation semantics.

Consequence: users cannot invoke plugin actions consistently, and keyboard/accessibility behavior is broken.

Fix: use semantic buttons/links with explicit action handlers, labels, focus, and disabled/error states.

### [MEDIUM] Dashboard plugin loader has a race

Location: app/composables/dashboard/useDashboardPlugins.ts:750-786

Why this is bad: late plugin discovery results can overwrite newer configuration.

Consequence: dashboard tiles flicker, duplicate, or show plugins from a previous workspace.

Fix: use load generations and workspace-scoped cache keys; discard stale results.

### [MEDIUM] Dashboard navigation uses global mutable state

Location: app/composables/dashboard/useDashboardPlugins.ts:793-815

Why this is bad: navigation selection is not scoped to route/workspace/plugin generation.

Consequence: switching dashboards can reopen a stale plugin panel.

Fix: derive navigation from route state and scope any cache by workspace/user.

### [MEDIUM] Webhook form can duplicate submissions

Location: app/components/admin/webhooks/WebhookForm.vue:201-205,386-443

Why this is bad: submit is not disabled/serialized while the request is pending.

Consequence: double-clicks create duplicate webhooks or send duplicate test deliveries.

Fix: disable submission, use an idempotency key, and reconcile with the server response.

### [HIGH] Admin user lookup can apply stale responses

Location: app/composables/admin/useAdminUserLookup.ts:22-26,29-56

Why this is bad: clearing/changing the query does not cancel or generation-check prior requests.

Consequence: an old search result appears for a new query or selected workspace.

Fix: abort previous requests and apply results only for the latest query generation.

### [HIGH] Confirm dialog promises can be orphaned

Location: app/composables/ui/useConfirmDialog.ts:18-44

Why this is bad: unmount/navigation can leave pending promise resolvers without a completion path.

Consequence: callers hang forever and retain closures/state.

Fix: resolve/reject all pending dialogs on unmount and expose cancellation as a first-class result.

### [HIGH] Extension admin API can recurse on duplicates

Location: app/composables/admin/useAdminExtensions.ts:59-73,102-115

Why this is bad: duplicate extension registration/reload paths can call each other without a stable identity guard.

Consequence: repeated network requests, stack growth, or duplicate UI entries.

Fix: normalize extension id/version, dedupe in-flight operations, and make refresh idempotent.

### [HIGH] Super-admin role can be lost in client auth state

Location: app/composables/admin/useAdminAuth.ts:19-27

Why this is bad: client role derivation recognizes only a subset of privileged claims.

Consequence: super-admin controls disappear or the client makes incorrect authorization assumptions.

Fix: preserve the server-issued role/capability set as opaque data and derive UI permissions from a shared policy map.

### [MEDIUM] Admin config UI can disable the super-admin control

Location: app/components/admin/AdminConfigEditor.vue:220-231

Why this is bad: UI disablement is based on incomplete role state.

Consequence: administrators cannot correct configuration, while the server may still accept a contradictory request.

Fix: make server capability authoritative and render disabled state only from a complete role/capability response.

### [MEDIUM] AI settings updates are fire-and-forget

Location: app/components/documents/DocumentAiPanel.vue:625-688

Why this is bad: UI state advances without awaiting persistence or handling conflicts/errors.

Consequence: a panel appears configured while reload reverts the setting.

Fix: await writes, show pending/error state, and serialize updates by document revision.

## Client shell, routing, themes, wizard UI, and general UI

### [HIGH] Sidebar accesses window during SSR

Location: app/components/sidebar/SideBar.vue:372

Why this is bad: an unguarded window access runs in a server-rendered path.

Consequence: SSR crashes or hydration behavior differs between server and browser.

Fix: move browser-only access into onMounted/client-only code and add an SSR render test.

### [HIGH] Images route bypasses the lock page

Location: app/pages/images/index.vue:1

Why this is bad: the route is not covered by the same lock/auth middleware as neighboring protected pages.

Consequence: unauthenticated users can reach image workspace data or UI bootstrapping.

Fix: apply the canonical route middleware and test every protected page with direct navigation, not only in-app links.

### [HIGH] Wizard UI can submit deploy repeatedly

Location: app/wizard/composables/useWizardSession.ts:818-820

Why this is bad: the deploy action is not guarded by an idempotency key or pending state.

Consequence: double-click/retry creates duplicate external resources or concurrent config writes.

Fix: disable while pending, include a session-scoped idempotency key, and make the server operation resumable.

### [MEDIUM] Readiness checks treat no-cors failures as success

Location: app/wizard/composables/useWizardSession.ts:339-346

Why this is bad: a browser response that cannot be inspected is interpreted as a healthy target.

Consequence: setup advances even when the service is down or the response is an auth/error page.

Fix: perform readiness from the server or require an inspectable status/body marker.

### [MEDIUM] Theme application leaves stale CSS variables

Location: app/core/theme/apply-merged-theme.ts:153-170

Why this is bad: applying a new theme adds variables but does not remove variables from the previous theme.

Consequence: old colors/spacing survive partial theme changes and produce inconsistent UI.

Fix: track variables owned by the theme layer and remove obsolete values before applying the new set.

### [MEDIUM] Sidebar activation has concurrent transitions

Location: app/composables/sidebar/useActiveSidebarPage.ts:139-256

Why this is bad: activation/deactivation requests can overlap without a generation or cancellation policy.

Consequence: the sidebar ends in a state different from the user's latest selection.

Fix: serialize transitions or cancel stale ones and commit only the latest generation.

### [MEDIUM] Orama search failure bypasses fallback

Location: app/composables/sidebar/useSidebarSearch.ts:209-237

Why this is bad: an index failure does not reliably fall back to a bounded direct search.

Consequence: navigation/search appears empty when a recoverable index issue occurs.

Fix: retain last-good index and provide a simple fallback over visible/authorized items.

### [LOW] Theme class cleanup removes another owner

Location: app/core/theme/_shared/css-selector-runtime.ts:54-66

Why this is bad: cleanup removes a class without tracking whether another component still owns it.

Consequence: unrelated theme/layout state flickers when components unmount out of order.

Fix: use reference-counted ownership or a single centralized theme controller.

## Plugin, extension, SDK, and isolation runtime

### [HIGH] Cached server handlers survive plugin deselection

Location: server/admin/plugins/server-module-resolver.ts:166-178

Why this is bad: removing a plugin from the active registry does not invalidate already cached server handlers.

Consequence: disabled plugin code continues serving requests and may retain old permissions/configuration.

Fix: key handler caches by plugin revision/selection generation and evict on deselection or reload.

### [HIGH] Isolated server filesystem checks use raw prefix matching

Location: server/admin/plugins/isolation/isolated-server-runtime.ts:148-174,222-226

Why this is bad: path authorization compares strings rather than canonical path components.

Consequence: sibling paths, traversal, symlinks, or prefix collisions can escape the sandbox root.

Fix: resolve real paths, reject symlinks/traversal, and compare path components under an allowlisted root.

### [HIGH] Structured RPC messages bypass size limits

Location: shared/plugins/isolation/rpc-envelope.ts:126-151

Why this is bad: message-size validation covers raw payloads but not all structured/encoded forms.

Consequence: an isolated plugin can send oversized nested data and exhaust host memory.

Fix: validate serialized byte size and recursive depth for every envelope variant before decoding.

### [HIGH] Isolated-server response budgets are not enforced

Location: server/admin/plugins/isolation/isolated-server-runtime.ts:628-660

Why this is bad: response body/time/resource limits are not enforced consistently after plugin execution.

Consequence: one plugin can hold connections or stream unbounded output through the host.

Fix: enforce deadline, byte, header, and event-count budgets at the host boundary and terminate over-budget execution.

### [MEDIUM] Optional dependency cycles block valid plugins

Location: shared/plugins/v2-dependency-graph.ts:242-257

Why this is bad: cycle detection treats optional dependencies as hard edges.

Consequence: independent plugins cannot load even when the optional dependency is absent by design.

Fix: distinguish required and optional edges in graph resolution and report only unsatisfied required cycles.

### [MEDIUM] Trusted-host loader accepts arbitrary remote URLs

Location: shared/plugins/module-v2-loader.ts:258-272

Why this is bad: “trusted host” validation is too broad and does not fully constrain URL scheme/redirect/host behavior.

Consequence: plugin loading can become SSRF or arbitrary remote code execution through a compromised URL.

Fix: allowlist exact origins, require https, validate every redirect, pin integrity/digest, and prefer local packaged modules.

### [MEDIUM] Plugin package assets are read before authorization

Location: server/api/plugins/packages/[pluginId]/[digest]/[...path].get.ts:49-67

Why this is bad: filesystem/package lookup happens before the caller is proven authorized to access that plugin/digest/path.

Consequence: timing/errors can enumerate private packages and potentially expose assets across tenants.

Fix: authenticate/authorize and validate path/digest before filesystem access; return uniform not-found responses.

### [MEDIUM] Transactional plugin publication can leak rollback state

Location: shared/plugins/transactional-plugin-scope.ts:220-233

Why this is bad: a failed publication can leave temporary registrations/resources after rollback.

Consequence: later requests see stale handlers or duplicated plugin capabilities.

Fix: make publication and rollback idempotent, track every side effect in a transaction journal, and assert registry equivalence after rollback.

## Shared contracts, Convex, tests, tooling, and build configuration

### [HIGH] Convex auth is hardwired to Clerk

Location: convex/auth.config.ts:21-37

Why this is bad: the backend authentication contract is coupled to one provider even though the rest of the application supports a broader auth model.

Consequence: deployments using another configured identity provider can authenticate in the app but fail at the data layer, or accidentally fall back.

Fix: derive Convex auth configuration from the canonical provider registry and fail startup when the selected provider has no backend adapter.

### [HIGH] Convex changelog accepts unsanitized payloads

Location: convex/sync.ts:1250-1265

Why this is bad: sync payload data is copied into changelog/audit structures without strict size and field validation.

Consequence: unbounded storage growth, sensitive data retention, and malformed changelog entries.

Fix: validate an allowlisted changelog schema, cap encoded bytes/depth, and redact fields that are not required for replay/audit.

### [HIGH] Convex revision metadata can be invalid

Location: convex/sync.ts:698-735

Why this is bad: revision/version metadata is accepted without proving monotonicity and relationship to the stored record.

Consequence: clients can skip or replay changes, and conflict resolution becomes nondeterministic.

Fix: assign server revisions transactionally, reject stale/backward versions, and test concurrent writes.

### [MEDIUM] Convex upload quota scans the whole workspace

Location: convex/storage.ts:192-217

Why this is bad: quota calculation performs a full workspace scan for every upload decision.

Consequence: upload latency and database cost grow linearly with workspace size, creating an easy availability problem.

Fix: maintain transactional aggregate counters, reconcile asynchronously, and bound repair scans.

### [MEDIUM] Convex storage hash normalization differs by path

Location: convex/storage.ts:286-310,326-352,396-400

Why this is bad: upload, commit, and cleanup paths normalize hashes/keys differently.

Consequence: duplicate files, failed cleanup, and quota mismatches.

Fix: import the shared canonical normalization helper and add cross-path round-trip tests.

### [MEDIUM] Convex file GC scans every member

Location: convex/storage.ts:427-456

Why this is bad: cleanup work is repeated per member instead of operating on deduplicated workspace/file ownership.

Consequence: GC cost scales with membership, and large workspaces become slow or time out.

Fix: index file ownership/reference counts and delete orphaned provider objects from a bounded queue.

### [MEDIUM] Sync endpoint limit validation is invalid

Location: convex/sync.ts:1884-1914,1969-1997

Why this is bad: endpoint limits can accept invalid/zero/negative values or apply defaults inconsistently.

Consequence: clients can request oversized batches or receive empty/infinite pagination behavior.

Fix: validate positive bounded integers centrally and enforce limits server-side regardless of client claims.

### [MEDIUM] Sync integration tests are mostly fake

Location: app/pages/__tests__/sync-layer.integration.test.ts:96-180,242-263

Why this is bad: mocks replace the persistence/network behavior that is most likely to fail in production.

Consequence: tests can pass while cursor, transaction, reconnect, and cross-tab bugs remain undetected.

Fix: add a real IndexedDB/in-memory database adapter and a deterministic fake server that exercises retries, conflicts, and restarts.

### [MEDIUM] Storage tests contradict the contract

Location: app/pages/__tests__/storage-layer.integration.test.ts:174-184

Why this is bad: test expectations do not match the documented/provider contract.

Consequence: regressions can be blessed as correct and implementation behavior remains ambiguous.

Fix: resolve the contract, update tests to assert externally observable behavior, and add provider-metadata/error cases.

### [LOW] Lint script is a no-op

Location: package.json:49-50

Why this is bad: the advertised lint command does not actually analyze the project.

Consequence: obvious correctness/security/style regressions reach review with false green CI.

Fix: wire the command to the real linter, make it fail on errors, and run it in CI.

### [LOW] Documentation contains dead links

Location: docs/README.md:16,45

Why this is bad: contributor/operator documentation sends readers to missing or moved resources.

Consequence: setup and recovery workflows become tribal knowledge and support load increases.

Fix: verify links in CI and update/remove stale references.

### [MEDIUM] Sandbox helper uses recursive forced deletion

Location: scripts/cli/create-temp-sandbox.ts:177-195

Why this is bad: a CLI cleanup path performs recursive forced deletion based on a computed path.

Consequence: a path-resolution bug can erase data outside the intended temporary sandbox.

Fix: validate the target against a dedicated temp root, refuse non-temp paths, use a recoverable cleanup where possible, and add destructive-path tests.

### [MEDIUM] Gateway registries can drift or silently replace entries

Location: server/sync/gateway/registry.ts:36-41,113-115; server/storage/gateway/registry.ts:31-35,106-108; server/admin/stores/registry.ts:46-50

Why this is bad: multiple registries independently define provider ids and registration behavior, with duplicate registrations replacing silently.

Consequence: runtime selection differs by route and a plugin can shadow an existing capability without an audit signal.

Fix: use one canonical registry contract, reject duplicate ids unless an explicit versioned replacement is requested, and expose registry revision/health.

### [MEDIUM] Gateway public config can drift from runtime config

Location: server/sync/gateway/registry.ts:36-41,113-115; server/storage/gateway/registry.ts:31-35,106-108

Why this is bad: public provider metadata is maintained separately from actual implementation capabilities.

Consequence: clients select unavailable/incorrect providers and fail only after starting work.

Fix: derive public config from the registered implementation metadata and validate it at startup.

### [MEDIUM] Invite TTL accepts NaN

Location: nuxt.config.ts:451-455; server/api/admin/workspace/invites/create.post.ts:83-85

Why this is bad: TTL parsing can turn malformed input into NaN/default behavior.

Consequence: invites can become effectively non-expiring or expire immediately.

Fix: parse and clamp a positive integer TTL at one shared boundary, then persist the resolved absolute expiry.

### [MEDIUM] ZIP extraction uses synchronous filesystem work

Location: server/admin/extensions/install.ts:313-371

Why this is bad: archive extraction blocks the event loop and combines untrusted archive contents with filesystem operations.

Consequence: large/malicious archives cause server stalls in addition to traversal risk.

Fix: use bounded asynchronous extraction in a worker/job, validate entries before writing, cap file count/size/ratio, and stage atomically.

### [HIGH] Malformed sync operations can block valid siblings

Location: server/api/sync/push.post.ts:56-81; server/sync/gateway/types.ts:161-174

Why this is bad: one invalid operation rejects the whole batch without per-operation result semantics.

Consequence: clients repeatedly retry good operations alongside the bad one, amplifying load and delaying convergence.

Fix: return per-operation accepted/rejected/conflict results, commit valid independent operations, and make rejection durable.

### [MEDIUM] Duplicate operations in a batch are rejected inconsistently

Location: shared/sync/schemas.ts:362-386; server/api/sync/push.post.ts:56-60

Why this is bad: duplicate detection is not clearly idempotent across retries and batch boundaries.

Consequence: a retried batch can fail instead of being treated as already applied.

Fix: require operation ids, store idempotency results, and return the original result for duplicates.

### [MEDIUM] Unknown sync tables are not uniformly blocked

Location: server/api/sync/push.post.ts:68-81; shared/sync/schemas.ts:235-243

Why this is bad: table/entity names are validated in some paths but not all.

Consequence: clients can probe or target internal tables not intended for synchronization.

Fix: use a single server-side allowlist mapping table names to schemas and capabilities; never dispatch by arbitrary string.

### [MEDIUM] Prototype table names can crash sync dispatch

Location: server/api/sync/push.post.ts:56-72; shared/sync/schemas.ts:235-243

Why this is bad: dynamic table lookup can encounter names such as constructor/prototype properties.

Consequence: malformed input causes exceptions or unexpected object access.

Fix: use Map/own-property checks and strict enum validation before dispatch.

### [MEDIUM] Push size limit is applied after buffering

Location: server/api/sync/push.post.ts:53-59; shared/sync/schemas.ts:362-373

Why this is bad: the full batch is read before the size check.

Consequence: attackers can still force memory allocation with oversized sync requests.

Fix: enforce byte limits while streaming the request body, then apply structural limits after parsing.

### [MEDIUM] Successful push response may omit serverVersion

Location: shared/sync/schemas.ts:388-440,475-490; server/api/sync/push.post.ts:122-139

Why this is bad: the response contract permits success without the version/cursor needed for deterministic client advancement.

Consequence: clients guess cursor state, replay work, or incorrectly mark operations acknowledged.

Fix: require server version/cursor on every successful batch response and make the schema impossible to construct without it.

### [HIGH] Snapshot endpoint ignores capability gates

Location: server/api/sync/snapshot.post.ts:62-77; server/sync/history-gc-policy.ts:28-39

Why this is bad: snapshot access is not consistently checked against the same history/capability policy used by other sync paths.

Consequence: a client can retrieve data outside its allowed snapshot window or scope.

Fix: enforce capability and retention policy in the gateway before snapshot assembly, and test expired/revoked devices.

### [LOW] Canonical storage fixture has an off-by-one

Location: server/storage/gateway/canonical-storage-fixture.ts:104-105; server/storage/gateway/types.ts:211-214

Why this is bad: fixture metadata and declared byte ranges disagree.

Consequence: tests can miss truncation/corruption behavior or make provider adapters appear correct when they are not.

Fix: derive fixture sizes from actual bytes and assert range/content-length consistency.
