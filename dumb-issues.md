# or3-chat: neckbeard review

Reviewed on 2026-10-14 against the working tree on `or3-cloud`, starting at commit `58993a345ff6669e26c9a22f48f123ed2a92480a`.

**26 findings: 5 P1, 20 P2, 1 P3.** The worst problems are missing webhook mutation guards, webhook access that survives membership revocation, and credentials that cross boundaries they should never cross. P1 means fix promptly; P2 means a concrete correctness, security, or reliability defect; P3 means lower-impact hardening. No P0 claim is warranted by this review.

This is a review of the existing implementation, not only the uncommitted diff. Existing edits were present at the start, and more appeared during review; none were changed. Reviewed paths include authentication/admin access, sync and IndexedDB, webhook routing/delivery, storage and workspace boundaries, wizard persistence, catalog/search, health reporting, and selected plugin and Cloud CLI lifecycle code. This does **not** claim every repository file, deployment combination, or provider was exhaustively exercised. Source locations refer to the working tree inspected during review.

## Remediation progress

Worktree: `/Users/brendon/Documents/or3/.worktrees/neckbeard-findings`
Branch: `codex/neckbeard-findings`; base: `68bed3fb55703375fd1e28fc436ea7fbb92b013d`.

- [x] **01** [P1] Webhook creation accepts a hostile origin's plain HTML form
- [x] **02** [P1] Removing a workspace member leaves their webhook subscription alive
- [x] **03** [P1] Incremental sync can overwrite the supposedly device-only API key
- [x] **04** [P1] Logout leaves API keys in inactive workspace databases
- [x] **05** [P1] Changing the admin password does not revoke existing admin tokens
- [x] **06** [P2] The admin host allowlist skips the authentication APIs
- [x] **07** [P2] Concurrent login attempts are admitted before any attempt is counted
- [x] **08** [P2] Changing the username bypasses all aggregate login throttling
- [x] **09** [P2] Login buffers an unlimited request body before applying its rate limit
- [x] **10** [P2] The password policy accepts characters bcrypt silently ignores
- [x] **11** [P2] The webhook registration quota is a check-then-insert race
- [x] **12** [P2] The 4 KB webhook response cap runs after the whole body is allocated
- [x] **13** [P2] Rate-limited webhook events are cancelled forever, despite a retry timestamp
- [x] **14** [P2] Webhook background loops discard promise rejections
- [x] **15** [P2] Sync completion can overwrite a newer cursor with an older one
- [x] **16** [P2] Invalid pulled records are treated as successfully skipped, then acknowledged
- [x] **17** [P2] Explicitly persisted wizard secrets get world-readable file permissions
- [x] **18** [P2] Wizard persistence truncates the only copy before the replacement is durable
- [x] **19** [P2] Saving two different wizard presets concurrently loses one
- [x] **20** [P2] Wizard readiness accepts HTTP failures as a healthy application
- [x] **21** [P2] The wizard's 45-second readiness timeout does not time out a pending fetch
- [x] **22** [P2] The price endpoint fabricates successful market data when throttled
- [x] **23** [P2] Model catalog requests read credentials from an abandoned storage location
- [x] **24** [P2] A same-size model catalog refresh leaves the search index stale
- [x] **25** [P2] Attachment writes can land in a different workspace after a hook awaits
- [x] **26** [P3] Public deep health returns administrative diagnostic details

All **26 findings are addressed in code** as of 2026-10-15. The findings below preserve the original review baseline and its source locations. Current validation and repeatable commands are in [the remediation receipt](audit-evidence/neckbeard-20261014/remediation-verification.md); fixed-behavior observations are in [remediation-results.jsonl](audit-evidence/neckbeard-20261014/remediation-results.jsonl).

- **01, 02, 11–14:** guarded bounded webhook mutations, durable membership checks and revocation cleanup, atomic provider quotas, bounded response streaming, deferred rate limits, and caught background errors with batch settlement.
- **03, 15, 16:** shared device-only KV policy at admission and incremental application, atomic monotonic cursors, and invalid payloads aborting the batch.
- **04, 23–25:** account-owned keys, credential cleanup across retained workspace databases, canonical catalog authentication, catalog identity changes rebuilding search, and attachment operations retaining their starting database.
- **05–10:** credential-bound admin JWTs, API host restrictions, reserved account and aggregate IP admission before password work, bounded validated JSON, and a shared 72-byte UTF-8 password policy.
- **17–21:** private atomic wizard persistence, serialized preset mutations, and bounded readiness checks requiring a valid OR3 health response.
- **22, 26:** CoinGecko endpoint and client/server tools removed; public health responses redact provider details and raw messages.

**Verification:** OR3 Chat **52 files / 526 tests passed**, full Nuxt typecheck and changed-TypeScript lint passed, and all three audit scripts passed. SQLite provider **8 tests**, build, standalone typecheck and changed-source lint passed. Convex provider quota regression, template pack, build and standalone typecheck passed. Final diffs were inspected.

**Integration prerequisite for 11:** matching SQLite and Convex changes are isolated in sibling worktrees on `codex/neckbeard-webhook-quota`. Published provider `0.0.17` lacks atomic registration limits; host registration fails closed with HTTP 503 against old providers. Provider releases and the matching Convex backend deployment must precede integration. Qualification explicitly aliases the candidate SQLite source. Nothing was released or deployed.

## Evidence and verification

The three scripts in [audit-evidence/neckbeard-20261014](audit-evidence/neckbeard-20261014/) import production modules and use disposable IndexedDB, SQLite, temporary files, in-process H3 requests, and injected responses. They do not access a live deployment or use real credentials. Observations are recorded in [results.jsonl](audit-evidence/neckbeard-20261014/results.jsonl). They support 19 findings; the remaining seven are source-traced. Some probes demonstrate a failing primitive rather than a complete browser/deployment exploit; those limits are stated below.

Run from `or3-chat` with the existing dependencies installed:

```sh
bunx vite-node --config vitest.config.ts audit-evidence/neckbeard-20261014/reproduce.ts
OR3_SQLITE_PROVIDER_SOURCE=/absolute/path/to/candidate/sqlite-webhook-store.ts bunx vite-node --config vitest.config.ts audit-evidence/neckbeard-20261014/webhooks.ts
bunx vite-node --config vitest.config.ts audit-evidence/neckbeard-20261014/client-and-storage.ts
```

Original review-only validation: **7 files, 61 tests passed**, covering conflict resolution, cursors, HLC, admin throttling, webhook routes, dispatcher, and event bridge. The exact command and output are in [verification.txt](audit-evidence/neckbeard-20261014/verification.txt). Passing these tests does not cover the failure cases below. No full build, browser E2E, production load test, or deployment lifecycle test was run for this review-only change.

## 01 — [P1] Webhook creation accepts a hostile origin's plain HTML form

**Location:** `server/api/webhooks/index.post.ts:19–28`; `server/api/webhooks/_helpers.ts:56–88`; also `server/api/webhooks/disable-all.post.ts:1–10`.

These mutations authenticate the session but never run the origin/intent guard used by cloud mutations. `readBody()` accepts form encoding, and repeated `events` fields become the array the schema expects. A simple form can therefore create an enabled webhook without an application intent header.

**Consequence:** With webhooks enabled and a cookie-backed session, a hostile **same-site sibling origin** can register its receiver in the victim's active workspace and receive later message events, including message content. Basic Auth uses SameSite=Lax cookies; same-site cross-origin requests are relevant here. This is not a claim that any unrelated cross-site page bypasses SameSite. CORS does not prevent form submission.

**Evidence:** `cross-origin-form-creates-webhook-without-intent` returned HTTP 200 and created a registration. The fixture supplied an already-resolved authenticated request context; it verifies route acceptance, not browser cookie delivery.

**Fix:** Require the established cloud mutation guard on every user webhook mutation before reading the body. Require bounded JSON where a body is needed. Cover sibling-origin forms, missing intent, and legitimate application requests.

## 02 — [P1] Removing a workspace member leaves their webhook subscription alive

**Location:** `server/api/admin/workspace/members/remove.post.ts:47–71`; `server/utils/webhooks/event-bridge.ts:176–209`; `server/utils/webhooks/dispatcher.ts:302–343`. Provider implementation: `../or3-provider-sqlite/src/runtime/server/webhooks/sqlite-webhook-store.ts:352–407` and `../or3-provider-sqlite/src/runtime/server/admin/stores/sqlite-store.ts:238–292`.

Membership removal deletes the membership and invalidates session caches. It does not disable that member's webhook registrations. Event selection checks workspace, scope, event, and enabled state; delivery checks only existence and enabled state. Neither rechecks membership.

**Consequence:** A removed member's endpoint can continue receiving **new** workspace events, including message content. This is a persistent revocation failure, not merely an already-in-flight request finishing.

**Evidence:** `revoked-member-webhooks-still-selected` returned five eligible registrations with zero membership rows in a disposable SQLite fixture. The fixture proves selection ignores membership; the removal and dispatch paths above establish the rest of the chain.

**Fix:** Disable/cancel user registrations during membership revocation and check current access when selecting or dispatching user deliveries. Preserve admin-scope subscriptions separately. Exercise removal followed by a new workspace event.

## 03 — [P1] Incremental sync can overwrite the supposedly device-only API key

**Location:** `app/core/sync/conflict-resolver.ts:280–340`; contrast `app/core/sync/hook-bridge.ts:41–75` and `app/core/sync/snapshot-applier.ts:229–265`; `server/api/sync/push.post.ts:189–196`; `shared/sync/schemas.ts:212`.

Outbound capture and snapshot application exclude local-only KV names such as `openrouter_api_key`. Incremental conflict resolution does not. A valid KV payload with a winning revision goes straight into the local table, including a reserved credential row. Server push validation does not reject those names either.

**Consequence:** A workspace writer or custom provider can poison another device's credential/configuration rows through ordinary incremental sync. Reload/hydration trusts the overwritten key. This proves credential replacement or disruption, not extraction of the victim's original key.

**Evidence:** `incremental-sync-overwrites-device-only-key` confirmed the name is excluded by policy, then replaced the local fixture key with the remote fixture key through `ConflictResolver`.

**Fix:** Enforce the same reserved-name policy on incremental puts/deletes and server admission, preferably from one shared policy definition. Do not rely on well-behaved clients to enforce a security boundary.

## 04 — [P1] Logout leaves API keys in inactive workspace databases

**Location:** `app/utils/logout-cleanup.ts:63–67`; `app/core/auth/useUserApiKey.ts:70–85,125–137,158–167`; `app/utils/workspace-db-logout.ts:59–68`; `app/plugins/00-workspace-db.client.ts:58–75`.

Keys are stored in a workspace database without an account owner. Logout clears only the currently active database's key. Other workspace databases are retained unless individually configured for deletion, and the account-change watcher also clears only the current database.

**Consequence:** Save a key in workspace A, switch to B, and log out. A retains the credential. A later account using the same browser and workspace A can hydrate the previous account's key. Preserving conversation caches should not preserve another account's spending credential.

**Evidence:** `inactive-workspace-key-survives-logout-cleanup` saved a key in A, switched to B, invoked the exact key-clear helper used by logout, and rehydrated the old key after returning to A. This is a storage/cleanup reproduction, not a full sign-in browser flow.

**Fix:** Scope secret ownership to the authenticated account and scrub that account's credentials from all retained workspace databases on logout/account change. Keep offline conversation retention independent of credential retention.

## 05 — [P1] Changing the admin password does not revoke existing admin tokens

**Location:** `server/api/admin/auth/change-password.post.ts:101–109`; `server/admin/auth/jwt.ts:100–146`.

Password change updates the bcrypt hash only. JWT verification checks signature and basic claims but never compares a credential generation or revocation timestamp. Existing tokens remain valid under the same signing secret.

**Consequence:** Password rotation does not evict a stolen super-admin session. The attacker keeps administrative access until token expiry, 24 hours by default and potentially longer by configuration.

**Evidence:** `old-admin-jwt-valid-after-password-rotation` signed a token, changed the persisted credential hash, and successfully verified the old token.

**Fix:** Persist an admin credential/session generation, embed it in issued tokens, and compare it during verification. Increment it on password change and issue a replacement token to the requesting admin if retaining that session is intended.

## 06 — [P2] The admin host allowlist skips the authentication APIs

**Location:** `server/middleware/admin-gate.ts:115–119,144–145`; `server/api/admin/auth/login.post.ts:56–65`; `server/api/admin/auth/change-password.post.ts:45–63`.

The middleware returns unless the path starts with the admin UI base path. `/api/admin/auth/*` never reaches its host guard. Normal admin API helpers have their own checks, but the auth endpoints do not use those helpers.

**Consequence:** An operator can restrict the admin UI to an administrative host while leaving login and password-change APIs reachable on the public application host. This bypasses the configured exposure boundary, though valid credentials or a session are still required for successful authentication/mutation.

**Evidence:** `login-through-disallowed-admin-host` ran the middleware and real login handler with `allowedHosts: ['admin.example.test']`; login on `public.example.test` returned HTTP 200.

**Fix:** Apply the host restriction to the entire admin API namespace, including unauthenticated login. Keep that network/exposure check independent of the requirement to already have an admin session.

## 07 — [P2] Concurrent login attempts are admitted before any attempt is counted

**Location:** `server/admin/auth/rate-limit.ts:80–120`; `server/api/admin/auth/login.post.ts:76–125`.

The limiter checks a counter without reserving an attempt. The counter advances only after asynchronous file access and bcrypt verification fail. A burst sees the same empty or below-limit bucket and every request proceeds.

**Consequence:** The advertised five-attempt limit does not bound simultaneous password guesses or cost-12 bcrypt work. A single client can create a large in-flight workload before the first failure is recorded.

**Evidence:** `concurrent-login-admissions-before-first-failure` admitted all 20 calls for the same IP and username. The route ordering establishes why that admission window exists during real requests.

**Fix:** Consume admission capacity atomically before expensive work. If successful authentication refunds an attempt, make that an explicit completion operation rather than leaving pending attempts uncounted.

## 08 — [P2] Changing the username bypasses all aggregate login throttling

**Location:** `server/admin/auth/rate-limit.ts:54–55`; `server/api/admin/auth/login.post.ts:114–125`.

The only login bucket is keyed by IP plus caller-controlled username. Unknown usernames deliberately incur bcrypt verification too. There is no IP-wide or total work budget.

**Consequence:** Even after fixing concurrent admission, one source can submit a fresh username on every request and sustain expensive authentication work indefinitely. The per-user lockout does not protect server capacity.

**Evidence:** `username-rotation-bypasses-exhausted-ip` exhausted one username's bucket, then admitted another username from the same IP.

**Fix:** Retain the account-specific protection and add an aggregate source-IP/work admission limit ahead of bcrypt. Bound concurrent authentication work as well as failures per account.

## 09 — [P2] Login buffers an unlimited request body before applying its rate limit

**Location:** `server/api/admin/auth/login.post.ts:65–78`.

The public login endpoint calls unbounded `readBody()` before throttle checks. The installed H3 reader buffers the body; the generic `LoginBody` type does not impose a runtime size or shape constraint. There is no route-level body cap here.

**Consequence:** An unauthenticated client can force large allocations and JSON parsing before being rejected. Even an already rate-limited client reaches the body reader first. A reverse proxy may mitigate this in some deployments, but the application boundary itself remains unbounded.

**Evidence:** Source-traced against the installed H3 implementation and the route; no memory-exhaustion load test was attempted.

**Fix:** Use the existing bounded JSON reader with a small login-specific limit and runtime string validation. Apply any source-only admission check before body parsing, then account-specific checks after validation.

## 10 — [P2] The password policy accepts characters bcrypt silently ignores

**Location:** `server/admin/auth/hash.ts:13–25,39–58`; `shared/cloud/wizard/admin-dashboard.ts:50–64`.

The policy accepts arbitrarily long passwords, but bcrypt only incorporates the first 72 bytes. Length checks are in JavaScript characters and never enforce the bcrypt byte boundary.

**Consequence:** Two passwords with the same first 72 bytes authenticate identically. Changing only a long password's suffix appears to rotate the password without actually changing what authenticates. Non-ASCII passwords reach the byte boundary sooner than a character count suggests.

**Evidence:** `bcrypt-ignores-distinct-password-suffix` accepted an over-limit password under the policy and authenticated a different suffix against its hash.

**Fix:** Reject passwords over 72 UTF-8 bytes consistently during setup/change, with a clear explanation, or move to a password hash that supports the intended input length through a deliberate migration. Do not silently truncate or change verification of existing hashes.

## 11 — [P2] The webhook registration quota is a check-then-insert race

**Location:** `server/api/webhooks/index.post.ts:31–55`.

The route lists registrations, checks their count, performs asynchronous target validation, then inserts. Those operations are not one transaction or atomic provider operation.

**Consequence:** Concurrent requests all observe available capacity and each adds a registration. The configured per-user limit does not bound event fan-out or persistent registrations.

**Evidence:** `two-webhook-quota-bypassed-by-concurrency` configured a limit of two, started with one registration, and accepted four concurrent creations: five total.

**Fix:** Enforce count plus insert atomically inside the store, scoped to the intended user/workspace quota. A process-local route mutex is insufficient for multiple server processes.

## 12 — [P2] The 4 KB webhook response cap runs after the whole body is allocated

**Location:** `server/utils/webhooks/dispatcher.ts:269–278,398–401`.

`truncateResponseBody(await response.text())` limits the stored string, not the bytes read or allocated. A delivery timeout limits duration, not memory consumption during that duration.

**Consequence:** A user-controlled webhook receiver can send large responses into every concurrent delivery and create substantial memory pressure on the application server. Truncating the log afterward does nothing to protect the read.

**Evidence:** `4k-webhook-response-cap-reads-entire-megabyte` consumed 1,048,576 bytes to retain 4,096 characters, using an injected stream and the real dispatcher.

**Fix:** Read a bounded response prefix from the stream and cancel the remainder. Define the limit in bytes and decode safely; retain status and timing without buffering the rest.

## 13 — [P2] Rate-limited webhook events are cancelled forever, despite a retry timestamp

**Location:** `server/utils/webhooks/dispatcher.ts:405–430`; `../or3-provider-sqlite/src/runtime/server/webhooks/sqlite-webhook-store.ts:605–636`.

An over-limit enqueue creates a `cancelled` log with `next_retry_at` and a message saying to retry later. The claim query selects only `pending` rows. Nothing automatically promotes this cancelled row when the timestamp arrives.

**Consequence:** Ordinary event bursts permanently lose deliveries. The persisted retry timestamp and message misleadingly suggest recovery is scheduled.

**Evidence:** `rate-limit-permanently-cancels-event` enqueued two events under a one-event limit. The second became `cancelled` with a non-null retry time; the claim predicate excludes it.

**Fix:** Persist deferred events as pending with the next eligible time, and enforce the delivery rate when claiming/sending. If dropping excess events is the intended product policy, explicitly report a terminal drop and remove the fake retry state.

## 14 — [P2] Webhook background loops discard promise rejections

**Location:** `server/utils/webhooks/dispatcher.ts:488–498`; error propagation from `claimAndProcess` at `451–469`.

The polling and reaper timers invoke asynchronous store work with `void` and no rejection handler. `claimAndProcess` resets its flag in `finally` but does not handle a rejected claim or delivery-log write.

**Consequence:** Transient database failures escape the service as unhandled rejections. Depending on the host's global policy, that can terminate the process or produce only global error logging with no worker-specific recovery/status. The dispatcher does not own its failure boundary.

**Evidence:** Source-traced; no claim is made that every Nitro deployment exits on these errors.

**Fix:** Catch errors at both timer entry points, log worker/operation context, and keep retry/backoff and shutdown behavior explicit. Await the complete set of delivery workers before releasing the processing guard when one fails.

## 15 — [P2] Sync completion can overwrite a newer cursor with an older one

**Location:** `app/core/sync/cursor-manager.ts:69–78,100–109`.

Both operations read a state object and replace the entire row later. `markSyncComplete()` rewrites the cursor even though it only intends to update the completion timestamp. There is no transaction spanning read and write or monotonic update check.

**Consequence:** Multiple tabs/managers can move the persisted cursor backward, replaying already-applied changes and increasing recovery/network work. This finding demonstrates regression/replay, not skipped records caused by the regression itself.

**Evidence:** `concurrent-sync-complete-regresses-cursor` began at 10, ran `setCursor(11)` concurrently with completion, and finished at 10.

**Fix:** Update only `lastSyncAt` for completion. Advance the cursor inside an IndexedDB transaction using the maximum of current and incoming versions, with explicit reset as a separate operation.

## 16 — [P2] Invalid pulled records are treated as successfully skipped, then acknowledged

**Location:** `app/core/sync/conflict-resolver.ts:286–290`; `app/core/sync/subscription-manager.ts:737–768`.

Payload normalization failure returns the same successful `skipped` result used for legitimate conflict outcomes. The subscription path then advances to the highest received server version and acknowledges that cursor.

**Consequence:** A malformed provider row or incompatible payload from schema skew is omitted locally but counted as consumed. Normal pulls do not revisit it; recovery needs an explicit resnapshot/repair, and server retention may eventually remove the acknowledged history. A console error is not recovery.

**Evidence:** `invalid-remote-row-returns-successful-apply` passed an invalid message payload and received `{applied:0, skipped:1, conflicts:0}` without failure. Cursor advancement was source-traced, not exercised through a complete provider subscription.

**Fix:** Distinguish invalid input from a valid LWW loser. Preserve a durable quarantine/recovery record or fail the batch without acknowledging past the bad version; surface an actionable sync error and define a compatible recovery path.

## 17 — [P2] Explicitly persisted wizard secrets get world-readable file permissions

**Location:** `shared/cloud/wizard/store.ts:58–70`; `shared/cloud/wizard/api.ts:535–548`.

The wizard supports `includeSecrets`, but creates its directories and session files without restrictive modes. With the common `022` umask, the session JSON is `0644` and newly created directories are traversable.

**Consequence:** Where parent directories permit traversal, other local users can read stored deployment/admin credentials. Secrets are excluded by default; this affects the explicit persistence option, not every session.

**Evidence:** `wizard-secret-session-mode-with-normal-umask` saved a secret-bearing fixture under umask `022` and observed mode `644`.

**Fix:** Create wizard directories with `0700` and files with `0600`; repair permissions on existing files/directories when writing secret-bearing state. Keep the explicit persistence choice, but make its storage private.

## 18 — [P2] Wizard persistence truncates the only copy before the replacement is durable

**Location:** `shared/cloud/wizard/store.ts:67–81,106–121`.

Session and preset JSON are written directly to their final paths. A failed/interrupted write can leave an empty or partial file. Session reads throw; preset reads silently convert corruption into an empty array, which a later save can overwrite.

**Consequence:** A crash or disk-write failure can destroy resumable setup state or saved presets even though an older valid copy existed before the write. This is separate from concurrent lost updates in the next finding.

**Evidence:** Source-traced; no crash or disk-failure injection was performed.

**Fix:** Write a private temporary file in the same directory, flush as appropriate, and atomically rename it over the destination. Preserve/report corrupt preset files rather than treating corruption as an empty configuration.

## 19 — [P2] Saving two different wizard presets concurrently loses one

**Location:** `shared/cloud/wizard/store.ts:133–138,148–151`.

Each preset save/delete reads the whole array, changes its private copy, and writes the whole file. There is no serialization across that read-modify-write operation. Atomic file replacement alone would not fix this race.

**Consequence:** Two browser requests or wizard processes can successfully save distinct presets while only one survives. Deletes can likewise resurrect data from another writer's stale snapshot.

**Evidence:** `concurrent-preset-saves-lose-an-entry` concurrently saved `one` and `two`; the final file contained only `one` on the recorded run. Which entry survives is timing-dependent.

**Fix:** Serialize the complete read-modify-write operation with a lock that covers all supported writer processes, in addition to atomic file replacement. Surface failure instead of returning success for a lost mutation.

## 20 — [P2] Wizard readiness accepts HTTP failures as a healthy application

**Location:** `app/wizard/composables/useWizardSession.ts:234–245,266–272`.

The readiness probe returns true whenever `fetch()` resolves. Fetch resolves on HTTP error statuses too. For cross-origin access URLs, `mode: 'no-cors'` yields an opaque response whose status/body cannot be validated anyway.

**Consequence:** A proxy 502, wrong service's 404, or application 500 can trigger wizard shutdown and redirect the user to a broken deployment. The function checks that something answered, not that OR3 is ready.

**Evidence:** Source-traced. This is the final browser redirect check; it does not claim earlier deployment checks are absent.

**Fix:** Probe readiness through the wizard server or an explicitly supported CORS endpoint and validate the expected OR3 response before shutdown. Keep the wizard available when readiness fails.

## 21 — [P2] The wizard's 45-second readiness timeout does not time out a pending fetch

**Location:** `app/wizard/composables/useWizardSession.ts:234–250`.

The deadline is checked only between loop iterations. The awaited fetch has no abort signal, so a single hanging request prevents the loop from reaching its next deadline check.

**Consequence:** The final setup flow can remain waiting well beyond its declared timeout when the target accepts a connection but does not finish responding. This is independent of whether successful responses are validated correctly.

**Evidence:** Source-traced.

**Fix:** Bound each probe with an abort signal tied to the remaining total budget, and stop polling on component disposal/cancellation. Preserve the overall deadline rather than restarting a full timeout on each attempt.

## 22 — [P2] The price endpoint fabricates successful market data when throttled

**Resolved 2026-10-15:** Removed the demo's client tool, built-in server tool, price API route, and route tests. The historical observation remains in `results.jsonl`; the executable audit script no longer imports the removed route.

**Location:** `server/api/coingecko/price.get.ts:84–100,154–159,184–204`.

When CoinGecko returns 429 without cached data, the endpoint generates hard-coded prices plus deterministic jitter and returns them with HTTP 200 in the normal price schema. Currency changes only the jitter seed. The header is the only marker, and callers sharing an in-flight result get `X-Or3-Cache: inflight` instead of the simulated marker.

**Consequence:** Consumers can display or feed an LLM invented numbers as retrieved prices. This is corrupted data, not a degraded fallback. It also produces obviously invalid unit conversions.

**Evidence:** `throttled-price-endpoint-invents-btc-btc-rate` injected a 429 and requested Bitcoin denominated in BTC. The route returned HTTP 200 with approximately **68,015 BTC per BTC**, not 1. No real market lookup was performed or needed for this unit-identity check.

**Fix:** Return a clear unavailable/throttled result, or explicitly marked genuine stale data with its timestamp. Keep fabricated demo values behind an explicit demo-only interface/schema, outside the live price endpoint.

## 23 — [P2] Model catalog requests read credentials from an abandoned storage location

**Location:** `app/core/auth/models-service.ts:52–59,137–151`; compare `app/core/auth/useUserApiKey.ts:70–85` and `app/core/auth/useOpenrouter.ts:178`.

The catalog service reads `localStorage.openrouter_api_key`. The canonical connection path persists the key in workspace KV, and the OpenRouter flow removes the legacy localStorage value. The catalog service therefore commonly sends an empty API key after a successful connection.

**Consequence:** The default public catalog can mask the defect, but a configured OpenRouter-compatible catalog endpoint that requires authentication fails despite the user having connected a valid key. Stale legacy localStorage can also select a different credential than chat uses.

**Evidence:** Source-traced across credential persistence, legacy cleanup, and SDK construction. No external provider call was made.

**Fix:** Read the canonical, hydrated credential state through the established credential API, respecting workspace/account changes. Remove this separate localStorage credential reader.

## 24 — [P2] A same-size model catalog refresh leaves the search index stale

**Location:** `app/core/search/useModelSearch.ts:99–122,178–188,200–216`.

Index invalidation compares only array length. Replacing descriptions/modalities while retaining the model count leaves the old index intact. Even the exposed `rebuild()` function takes the same count-based early return. Stale nonempty hits overwrite the fresh substring fallback.

**Consequence:** Search results can keep matching a model's old description and omit the newly correct match until the count changes or the component is recreated.

**Evidence:** `same-count-refresh-searches-old-descriptions` moved `astronomy` from Alpha's description to Beta's, retaining both IDs and the count. Search returned Alpha before and after, including after explicit `rebuild()`; Beta was expected afterward.

**Fix:** Invalidate on catalog replacement/revision, not count alone, and make explicit rebuild actually rebuild. Ensure a completed async build still corresponds to the current catalog revision.

## 25 — [P2] Attachment writes can land in a different workspace after a hook awaits

**Location:** `app/db/attachments.ts:42–59,80–95,122–139`.

The helper obtains `getDb()` after asynchronous hooks rather than capturing the database/workspace when the operation begins. A workspace change during those hooks changes the write target. Soft-delete also repeatedly resolves the global database during a transaction.

**Consequence:** A caller starting a write in workspace A can insert attachment metadata into workspace B. This is a documented public legacy helper, even though the current built-in upload path uses newer file APIs; integrations using the helper inherit the boundary bug.

**Evidence:** `attachment-write-follows-workspace-switch` switched workspaces inside the input filter. The resulting row was absent from A and present in B.

**Fix:** Capture the database before any await, use it consistently throughout the operation/transaction, and apply the established workspace-generation guard if stale operations should be cancelled. Use the same rule for create, upsert, and deletes.

## 26 — [P3] Public deep health returns administrative diagnostic details

**Location:** `server/api/health.get.ts:60–90,106–145`. Provider examples: `../or3-provider-basic-auth/src/runtime/server/admin/adapters/auth-basic-auth.ts:34–35`; `../or3-provider-fs/src/runtime/server/admin/adapters/storage-fs.ts:53–54`; `../or3-provider-sqlite/src/runtime/server/admin/adapters/sync-sqlite.ts:74–79`.

The unauthenticated endpoint forwards `status.details`, warning messages, and caught exception messages from administrative provider adapters. Those details include database paths, filesystem roots, and configured Turso URLs.

**Consequence:** Anyone can retrieve deployment layout and provider diagnostics that belong in the admin view. The demonstrated exposure is paths/topology and raw diagnostic messages, not a proven credential disclosure.

**Evidence:** Source-traced from the public response to the first-party adapter fields. HTTP 200 for liveness is documented and is not being reported as a defect.

**Fix:** Return a small allowlisted public health shape with availability and stable error codes. Keep paths, URLs, and raw exception text in authenticated diagnostics/server logs.
