# OR3 Chat — full chat-system hardening review

Reviewed **2026-10-24** at commit `8e8557404d91eb6057a1d8d49faf9f7de6f34230`.

**32 actionable findings: 5 P1, 25 P2, 2 P3.** Thirty-one concern product behavior; one concerns misleading regression coverage. The most urgent failures cross workspace boundaries or remove the only local response/write intent. No P0 is established.

The findings below describe the **2026-10-24 baseline source review**, not the current repaired branch. At that review stage, runtime suites and provider databases had not been exercised. Subsequent implementation and qualification are recorded in the remediation ledger and completion state. Source links in the historical findings point to the reviewed baseline commit; repairs live on this branch and in the provider worktrees listed below. No packages have been published and no live data has been changed.

A review cannot certify “never an issue ever” or prove every remaining issue has been found. This report supplies a substantial, prioritized repair backlog and names the residual validation work. Existing safeguards were checked before reporting failures; speculative deployment claims are separated below.

The checkout was clean at the starting inspection. Other reviews' untracked `audit-evidence/document-editor-review-20261024/` and `audit-evidence/sync-review-20261024/` appeared during this review and were left untouched. The prior root [dumb-issues.md](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/dumb-issues.md) is preserved; its historical findings are not automatically re-reported here.

P1 means urgent cross-workspace or durable-data risk. P2 means a concrete correctness, availability, resource-control or contract defect under the stated conditions. P3 means lower-impact product/test confidence work. These are remediation priorities, not CVSS scores.

## Remediation progress

Implementation branch: `codex/chat-hardening`, in the separate `chat-hardening` worktree. The review below describes the baseline; this ledger records subsequent repairs. No release or provider publication has been performed.

| Findings | Status | Repair and validation |
| --- | --- | --- |
| 01, 06 | Fixed; focused checks passed | The editor captures its DB, workspace generation and account/authorization identity when editing begins; fresh-row content patches check the live message and parent in one write transaction. Stale UI owners receive no completion update. Twelve integration cases failed against the baseline and pass after repair, including workspace switch/return, account/permission/revision/expiry changes, metadata edits and deleted/missing parents/messages. Editor plus existing message transaction suites: **31 passed**. Targeted ESLint passed. |
| 04 | Fixed; focused checks passed | Snapshot installation retains local foreground rows separately from the outbox in its atomic transaction, checks live parents and existing revision ordering, and leaves token progress unsynced until finalization. Three loss regressions failed on baseline. Snapshot owner/bootstrap/recovery suites: **31 passed**, including six canonical deletion/supersession controls. |
| 05 | Fixed; focused checks passed | Desired-state lifecycle queue serializes start/stop, includes account and authorization revision, fences stale starts/retries, and preserves active-DB write capture while route transport pauses. Four lifecycle cases pass with real Dexie capture: route return, A→B→A, account change during stop, and account-only change. Repeated stop/restart also passes. Baseline route-return and account-only failures reproduced. |
| 02, 17 | Fixed; focused checks passed | Send and Continue capture media workspace generation/account ownership before asynchronous work and pass it into file creation. Storage failures propagate to failed generation settlement. Real Dexie intake coverage: **12 passed** (eight baseline failures, two existing mid-intake safety controls, two successful current-workspace writes). |
| 03 | Fixed; focused checks passed | Hydration byte caches now exist only within one captured build, bounded by entry count and string bytes. Local hashes require live metadata before cache access and after conversion; reads use the captured DB and reject workspace/account changes. All six real-store regressions failed on baseline and pass after repair. |
| 16 | Fixed; focused checks passed | Shared bounded download reader holds its deadline through the body, cancels on caller abort, and stops reading when the limit is crossed. Input images keep the existing 5 MiB cap; generated-image downloads/data URLs have a 20 MiB cap. Native Send/Continue pass cancellation into preparation and generated-image fetching. All six body-cancellation/size regressions failed on baseline. The six related media suites pass **87 tests**. Targeted ESLint passed. |
| 07, 18 | Fixed; focused checks passed | Composer acceptance requires the matching request's provider receipt; multipart final-only content retains every text part without duplicating streamed text. Three baseline failures reproduced. Composer/input/parser suites: **107 passed**. |
| 15 | Fixed; focused checks passed | Retry forwarding closes its inner iterator in finally. Body cancellation remains attached while a prefetched queue is full. Both regressions failed on baseline; stream/deadline suites: **66 passed**. |
| 10, 23, 26, 32 | Fixed; focused checks passed | Append checks its live parent inside the write transaction. Normalization uses index/order_key/id ordering. Tool execution identity uses versioned SHA-256; legacy diagnostic receipts fail closed rather than establish replay equality. All five product regressions failed before repair. Replaced the fictitious rejecting-action assertion with a real hook engine callback-failure contract. Message transaction/ledger suites: **29 passed**. |
| 22 | Fixed; focused checks passed | Preferences merge retained and pending states, snapshot before unload, and hydrate replacements before debounce. Both opposite-default regressions failed on baseline; registry profile suite: **10 passed**. |
| 11–13 | Fixed; focused checks passed | Continuation claims compare the fresh row revision/pending state and live parent atomically before dispatch. Continue counts existing metadata plus accepted escaped text/reasoning. The shared reducer counts JSON escape expansion incrementally, retaining compatibility with persisted snapshots. Five baseline failures reproduced; continuation suites **43 passed**, reducer/background-tool suites **62 passed**. |
| 28, 31 | Fixed; focused checks passed | Large-paste interception preserves the original editor document; PDF galleries expose the existing local download path. Both regressions failed on baseline using a real structured editor and mounted gallery. Attachment/composer suites: **33 passed**. |
| 27, 29 | Fixed; focused checks passed | Failed history observers retry with bounded backoff and scoped cleanup. Thread selection returns its outcome, retains outgoing contents until accepted, and passes activation ownership into async selection. Veto rejects activation so existing tab rollback runs. Both regressions failed on baseline; pane/host/tab suites: **66 passed**. |
| 24 | Fixed; focused checks passed | read_thread uses the shared lineage/supersession projection before its existing message/character caps. Its real-store regression failed on baseline and passes with inherited reference history, obsolete retries removed, and the anchor cutoff respected. |
| 19 | Fixed; focused checks passed | Viewer snapshot queues exclude private execution inputs and worker leases from both retention and byte accounting. A >1 MiB input regression failed before repair; SSE serialization/batching suites: **33 passed**, including canonical terminal delivery. |
| 21 | Fixed; focused checks passed | Detached completion writes through NotificationService captured to the originating DB and retains its normal storage filter; active-workspace push listeners cannot redirect it. Navigation actions carry workspace identity and refuse stale clicks before/after marking read. Both real-store/UI regressions failed on baseline. Tracker/notification suites: **79 passed**; action component: **6 passed**. |
| 25 | Fixed; focused checks passed | Plugin preparation/completion actions run outside IndexedDB write transactions; writes re-read current rows and guard live parents. Insert rejects a stale ordering plan. All ten real asynchronous-hook cases failed on baseline; hook/message transaction suites: **33 passed**. |
| 30 | Fixed in provider source; focused checks passed | Isolated SQLite provider source supplies missing admission order_key from admission HLC and preserves it through finalization/reopen. Regression failed on baseline; gateway suite: **122 passed, 10 skipped**. Source lives in `/private/tmp/or3-chat-hardening-sqlite`; installed provider remains unchanged pending normal release/activation. |
| 09 | Fixed; focused checks passed | Retry supplies captured row revisions to append admission. Preparation hooks run before one messages/threads/outbox transaction that validates and supersedes the whole old turn while admitting its replacement. A persistent second-row failure reproduced partial supersession before repair and now rolls everything back without dispatch. Retry/database/lineage suites: **156 passed, 1 skipped**. |
| 20 | Fixed in host/provider source; focused checks passed | Memory, SQLite/D1 and Convex claims count live worker leases (plus workflows), enforcing both global and per-user caps atomically. Settled browser results remain durable and ready while claims defer. Each backend reproduced the bypass before repair. Memory lifecycle: **28 passed**; SQLite jobs: **29 passed**; Convex snapshot/adapter: **74 passed**. External provider changes remain source-only. |
| 08 | Fixed in host/provider source; checks passed | Live Stop records durable cancellation intent without publishing a terminal checkpoint. The fenced worker saves buffered text, reasoning and tool state before terminal delivery; expired-worker recovery settles its durable checkpoint without paid redispatch. Native text/reasoning cases in both tool modes, provider lease/finalization fences, API and recovery suites pass. External provider changes require release/activation. |
| 14 | Fixed in host/provider source; checks passed | Accepted output retains the existing 256 KiB raw limit. Results above 16 KiB of escaped JSON use immutable workspace KV chunks with a checksum and bounded transcript reference. Foreground chunks/message/outbox commit atomically; background providers enforce membership, generation ownership, replay, tombstones and contiguous versions. Reload hydration and full-result downloads verify complete bytes; incomplete/corrupt/stale-owner reads fail visibly. ASCII, escaped/control output, real outbox capture, HTTP receipt acceptance and both provider backends pass. Older background providers fail before model/tool dispatch. |

Validation command: `bunx vitest run --project=core-app --project=app-integration app/composables/chat/__tests__/useMessageEditing.integration.test.ts app/db/__tests__/messages-transactions.test.ts --reporter=dot --silent=passed-only`.

## Finding index

| ID | Priority | Finding |
| --- | --- | --- |
| 01 | P1 | Message edits can copy a private row into the newly active workspace |
| 02 | P1 | Generated-image intake can store and upload A’s image in workspace B |
| 03 | P1 | Global attachment caches bypass the current workspace’s file ownership |
| 04 | P1 | Snapshot recovery deletes foreground replies that have no outbox record |
| 05 | P1 | A start request during sync teardown is discarded, leaving write capture stopped |
| 06 | P2 | Message editing resurrects deletions and overwrites concurrent metadata |
| 07 | P2 | The composer clears before provider acceptance |
| 08 | P2 | Stop loses background output accepted since the last checkpoint |
| 09 | P2 | Retry can permanently supersede only part of the old turn |
| 10 | P2 | Native append writes messages into deleted or missing threads |
| 11 | P2 | Two panes can both claim and bill a continuation of the same assistant |
| 12 | P2 | Foreground Continue omits the output budget entirely |
| 13 | P2 | The normal output budget ignores JSON escape expansion |
| 14 | P2 | Tool results accepted by the registry cannot always fit durable storage |
| 15 | P2 | Closing the retry wrapper leaves its provider iterator open |
| 16 | P2 | Media hydration can hang Stop and buffer arbitrarily large responses |
| 17 | P2 | Generated-image storage failure is silently reported as success |
| 18 | P2 | Final-only multipart SSE content is truncated after its first text part |
| 19 | P2 | Large input history breaks the background viewer queue and causes reconnect churn |
| 20 | P2 | Parked browser-tool jobs resume without reserving concurrency capacity |
| 21 | P2 | Detached completion notifications are written into the wrong workspace |
| 22 | P2 | Unloading a tool erases the user’s enabled/disabled preference |
| 23 | P2 | A diagnostic 32-bit hash decides tool execution identity |
| 24 | P2 | read_thread returns obsolete retries and omits inherited branch history |
| 25 | P2 | Several chat database APIs await arbitrary hooks inside transactions |
| 26 | P2 | Index normalization changes the canonical order of colliding messages |
| 27 | P2 | One history-observer error leaves an open conversation permanently stale |
| 28 | P2 | A large paste strips existing structured mentions from the composer |
| 29 | P2 | A vetoed thread selection destroys the outgoing pane but reports activation |
| 30 | P2 | SQLite background admission omits a stable message order_key |
| 31 | P3 | Saved PDFs have no retrieval action in the native message gallery |
| 32 | P3 | An append preparation test proves a mock behavior the real hook engine suppresses |

## Findings

### 01 — [P1] Message edits can copy a private row into the newly active workspace

**Source:** [app/composables/chat/useMessageEditing.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/composables/chat/useMessageEditing.ts#L176); [app/db/messages.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/db/messages.ts#L156).

Save captures A’s database, awaits the message read, then calls the global `upsert.message()`, which resolves `getDb()` again. If the active workspace becomes B during that await, the full A record is written into B. Upsert does not require an existing row or live parent thread in B. Unmount does not cancel the outstanding save.

**Trigger:** Pause the initial message read, switch A → B, then resolve the read and finish Save.

**Consequence:** Cross-workspace local disclosure/corruption of content, metadata and attachment references. This is already a defect even if subsequent server sync rejects the foreign parent ID.

**Fix:** Keep the captured DB and account/workspace guard through the operation. Patch only edited content through `patchMessageInDb`, with current-owner and live-record predicates; fence completion UI updates too.

**Regression to add or extend:** Add a native edit integration case with a held read and workspace switch. Assert B has no new message or outbox row.

### 02 — [P1] Generated-image intake can store and upload A’s image in workspace B

**Source:** [app/utils/chat/useAi-internal/foregroundStream.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/utils/chat/useAi-internal/foregroundStream.ts#L470); [app/utils/chat/useAi-internal/continue.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/utils/chat/useAi-internal/continue.ts#L739); [app/db/files.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/db/files.ts#L232).

Both stream consumers call `createOrRefFile(blob, 'gen-image')` without originating ownership. The helper captures the active DB when called, not the request DB. Foreground requests intentionally survive disposal. Continuation also checks ownership before an awaited image fetch and does not recheck before file creation.

**Trigger:** Start an image response in A, hold the image download or delivery, switch to B, and let the image arrive.

**Consequence:** Private generated bytes can enter B’s file tables and Cloud upload queue while their assistant belongs to A. The helper’s own guard only protects the workspace selected too late.

**Fix:** Bind generated media intake to the request’s originating workspace/account. Reject a changed owner before file creation/upload, or use a deliberately captured DB API that supports detached persistence safely.

**Regression to add or extend:** Hold image retrieval across a workspace change; inspect both workspaces’ file rows and transfer queues. Cover initial send and Continue.

### 03 — [P1] Global attachment caches bypass the current workspace’s file ownership

**Source:** [app/core/auth/openrouter-build.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/core/auth/openrouter-build.ts#L139); [app/core/auth/openrouter-build.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/core/auth/openrouter-build.ts#L270); [app/core/auth/openrouter-build.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/core/auth/openrouter-build.ts#L348); [app/core/auth/openrouter-build.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/core/auth/openrouter-build.ts#L719).

The process-global data-URL and in-flight maps are keyed only by hash/URL. A cache hit returns bytes before consulting the active store. File parts accept cached bytes directly; image hydration permits missing metadata and then consults the same cache. No workspace/account namespace or cleanup caller was found.

**Trigger:** Hydrate file H in A. Switch to B, where H has neither metadata nor a blob, then prepare a message containing a stale/copied H reference. Cached A bytes are still emitted into the provider request. No hash collision is necessary.

**Consequence:** A file reference can obtain bytes outside the current workspace’s storage boundary. The scenario requires the same application process and a known reference; it is not evidence of arbitrary remote hash guessing or an unauthenticated server download.

**Fix:** Scope cache/in-flight ownership by captured database and account generation, require live authorized metadata before using cached bytes, and clear/fence results on workspace/account changes. Bound cache bytes, not merely entry count.

**Regression to add or extend:** Warm the cache in A, switch to empty B, and assert preparation fails without emitting A’s bytes. Repeat after logout and deletion.

### 04 — [P1] Snapshot recovery deletes foreground replies that have no outbox record

**Source:** [app/core/sync/snapshot-applier.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/core/sync/snapshot-applier.ts#L200); [app/core/sync/snapshot-applier.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/core/sync/snapshot-applier.ts#L225); [app/core/sync/hook-bridge.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/core/sync/hook-bridge.ts#L336); [app/utils/chat/useAi-internal/requestController.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/utils/chat/useAi-internal/requestController.ts#L378).

Expired-cursor recovery replaces message tables and restores replayable outbox operations. Streaming assistant rows deliberately have `pending:true`, so HookBridge never creates their outbox entries. A local partial assistant absent from the server snapshot is cleared. Later progress fails its generation lease check; terminal finalization treats the missing row as superseded and drops its save-recovery obligation. Native checkpoints retain request input, not the missing generated output.

**Trigger:** Run a foreground generation while an expired cursor causes snapshot replacement, or recover an unfinished local generation after a crash before terminal sync.

**Consequence:** The only saved partial response disappears. The completed response can also be discarded as superseded, despite no user deletion or replacement.

**Fix:** Preserve local generation rows separately from syncable outbox intent during the same snapshot transaction. Reconcile with actual tombstones/current generations so protection does not resurrect deleted content.

**Regression to add or extend:** Extend snapshot-recovery integration coverage with a real pending assistant and no message outbox row, then run the real progress persister and finalizer. Existing pending-outbox fixtures do not cover this state.

### 05 — [P1] A start request during sync teardown is discarded, leaving write capture stopped

**Source:** [app/core/sync/client-sync-engine.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/core/sync/client-sync-engine.ts#L88); [app/core/sync/client-sync-engine.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/core/sync/client-sync-engine.ts#L193); [app/core/sync/client-sync-engine.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/core/sync/client-sync-engine.ts#L310).

`startSyncEngine` returns when `engineState` names the requested workspace. Teardown removes HookBridge at line 207, then awaits subscription/provider cleanup, leaving that state populated until line 225. Returning to chat during either await therefore drops the start request. Teardown later clears the state, and no dependency change remains to restart it. Queued starts also lack a final desired-workspace check.

**Trigger:** Hold subscription teardown, navigate chat → admin → chat in the same workspace, then release teardown. Also examine A → B → A while cleanup waits.

**Consequence:** Sync remains off until another transition or reload. New writes made after capture was removed have no outbox entry, so simply restarting cannot drain those missing operations.

**Fix:** Serialize lifecycle reconciliation around one current desired account/workspace/route generation. A stopping engine cannot satisfy a start. Preserve originating-workspace capture for allowed writes independently of transport cleanup.

**Regression to add or extend:** Extend the sync-auth plugin suite with a held teardown and rapid transitions. Assert both a live final engine and a newly captured chat write.

### 06 — [P2] Message editing resurrects deletions and overwrites concurrent metadata

**Source:** [app/composables/chat/useMessageEditing.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/composables/chat/useMessageEditing.ts#L183); [app/db/messages.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/db/messages.ts#L198).

The editor submits a full row read before the write transaction. Upsert awaits hooks and rereads the current row only for its clock, then puts stale fields. A deleted flag, removed row, new usage, or updated tool metadata is overwritten by the old input with a newer clock.

**Trigger:** Pause the upsert before hook, delete the message or update its non-content fields in another pane/device, then finish Save.

**Consequence:** Soft deletes can be undone, hard-deleted rows recreated, and unrelated concurrent updates lost. Passing the correct DB alone does not repair this race.

**Fix:** Use a transactional content-only patch, merge current metadata, reject missing/deleted records, and validate the parent thread. Preserve the original edit revision when conflict detection is required.

**Regression to add or extend:** Hold the real hook across hard deletion, soft deletion and a metadata update. Saving must reject deleted targets and preserve unrelated fields.

### 07 — [P2] The composer clears before provider acceptance

**Source:** [app/components/chat/ChatContainer.vue](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/components/chat/ChatContainer.vue#L1144); [app/components/chat/ChatInputDropper.vue](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/components/chat/ChatInputDropper.vue#L1414); [app/composables/chat/useAi.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/composables/chat/useAi.ts#L2471).

`waitForDurableSendAcceptance` returns accepted on `persisted` or any `streaming` state, without requiring `providerAccepted`. The composer discards its durable draft, clears the editor and releases attachments. The controller publishes persisted before final preparation; subsequent context admission or the server can still refuse the request.

**Trigger:** A final legacy filter expands the body after the user row is saved, or server-side capacity validation rejects it.

**Consequence:** A refused send loses the editable draft and structured references. A durable user row may retain text; this is not total message-byte loss. It contradicts the documented provider-acceptance contract.

**Fix:** Only resolve early acceptance for the matching streaming request with `providerAccepted === true`. Otherwise await its terminal result and preserve unaccepted/context-full drafts.

**Regression to add or extend:** Exercise the real container-to-composer adapter through persisted → context_full and persisted → providerAccepted. Existing tests inject acceptance too early to guard this boundary.

### 08 — [P2] Stop loses background output accepted since the last checkpoint

**Source:** [server/utils/background-jobs/stream-handler.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/server/utils/background-jobs/stream-handler.ts#L880); [server/utils/background-jobs/providers/memory.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/server/utils/background-jobs/providers/memory.ts#L370); [server/utils/background-jobs/providers/memory.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/server/utils/background-jobs/providers/memory.ts#L443); [server/utils/background-jobs/history.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/server/utils/background-jobs/history.ts#L46).

Text/reasoning is broadcast immediately and checkpointed at 16 KiB/500 ms. Abort makes the stored job terminal before the worker can flush. Provider update then refuses non-streaming jobs. The abort catch ignores the failed flush, emits its larger in-memory answer, and returns without saving that snapshot. Canonical history reads the older stored output. The tool loop has the same ordering; the text loop also conditions its abort flush on nonempty text, omitting reasoning-only buffers.

**Trigger:** Receive a small delta, Stop before the next checkpoint, reconcile canonical history, and reload or read from another client.

**Consequence:** Already displayed text/reasoning disappears from saved history. Longest-content merging can hide the loss in the original view.

**Fix:** Separate cancellation intent from terminal settlement, or add a fenced abort-finalization operation that accepts the current worker’s buffered output. Keep crash fallback to the last durable checkpoint.

**Regression to add or extend:** Assert the canonical stopped message after an unflushed text and reasoning delta. Existing abort-status/display tests do not prove durable content. Source verification covers memory and the installed SQLite/Convex implementations; see provider evidence below.

### 09 — [P2] Retry can permanently supersede only part of the old turn

**Source:** [app/utils/chat/useAi-internal/retry.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/utils/chat/useAi-internal/retry.ts#L375); [app/utils/chat/useAi-internal/retry.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/utils/chat/useAi-internal/retry.ts#L428).

Old user/assistant/tool rows are marked superseded in separate transactions, with each failure swallowed. Generation proceeds. A second in-memory pass can heal a one-shot failure, but no durable repair receipt protects against a crash between row commits or a persistent single-row failure.

**Trigger:** Fail one supersession write repeatedly, or close the process after one old row is marked and before the rest.

**Consequence:** Reload can show duplicate user/assistant history or a partially removed turn. Canonical transcript filtering already removes orphan tool results when their assistant is absent; not every missed tool patch causes provider rejection.

**Fix:** Prepare hooks first, then atomically supersede the selected turn with replacement admission, or record a durable repair obligation for an intentional multi-phase contract.

**Regression to add or extend:** Inject failure after the first actual row commit and reload. The result must contain a coherent original turn or coherent replacement.

### 10 — [P2] Native append writes messages into deleted or missing threads

**Source:** [app/db/messages.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/db/messages.ts#L636); [app/db/messages.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/db/messages.ts#L665); [app/composables/chat/useAi.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/composables/chat/useAi.ts#L2386).

Append preparation awaits hooks before the transaction. Inside the transaction, `appendMessageRows` puts the message first and only then reads its parent. A missing thread is allowed; a soft-deleted thread also passes `if (t)`. Earlier native send checks cannot close that interval.

**Trigger:** Pause append preparation, delete the conversation in another window, and resume.

**Consequence:** Orphan message/outbox rows are durably created after deletion. Later dispatch checks can prevent inference; the finding does not depend on a paid request starting.

**Fix:** Require a live parent inside the existing messages+threads transaction before the message put. Retain caller ownership guards.

**Regression to add or extend:** Extend message transaction coverage with hard/soft parent deletion during preparation; assert no message or message outbox entry.

### 11 — [P2] Two panes can both claim and bill a continuation of the same assistant

**Source:** [app/utils/chat/useAi-internal/continue.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/utils/chat/useAi-internal/continue.ts#L250); [app/utils/chat/useAi-internal/continue.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/utils/chat/useAi-internal/continue.ts#L547).

Each controller reads the target, performs asynchronous preparation, and unconditionally replaces its generation ID/lease. Admission does not compare the captured revision or reject an active, deleted or superseded target. Per-controller single-flight cannot serialize two panes.

**Trigger:** Hold two continuations at preparation, then release both against the same assistant.

**Consequence:** Both requests can dispatch inference; the later claim wins persistence and the competing output is discarded. Existing lease/terminal guards do stop the loser from freely overwriting the winner later.

**Fix:** Atomically compare and claim the captured row revision/generation and live parent state. Reject the losing claim before provider dispatch.

**Regression to add or extend:** Use two controllers and a preparation barrier. Assert exactly one provider request, one generation owner, and preserved intervening edits.

### 12 — [P2] Foreground Continue omits the output budget entirely

**Source:** [app/utils/chat/useAi-internal/continue.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/utils/chat/useAi-internal/continue.ts#L710); [app/utils/chat/useAi-internal/continue.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/utils/chat/useAi-internal/continue.ts#L776); [shared/sync/sanitize.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/shared/sync/sanitize.ts#L153).

Normal send uses the bounded normalized reducer. Foreground continuation directly appends text and reasoning to the existing assistant, without the canonical or general stream-output cap. Pending writes bypass sync capture; terminal `pending:false` reaches the 256 KiB payload ceiling and fails.

**Trigger:** Continue an already large assistant, or perform enough continuations to cross the serialized row limit.

**Consequence:** The accepted answer cannot finalize/sync. Save recovery retries the same oversized snapshot, which cannot succeed.

**Fix:** Seed a common serialized-message budget from the existing row and enforce it before each continuation delta. Stop with a durable error and a saveable prefix.

**Regression to add or extend:** Continue a near-limit synced row through the actual finalizer/outbox. Assert bounded stored output and a terminal error rather than a permanent save retry.

### 13 — [P2] The normal output budget ignores JSON escape expansion

**Source:** [shared/chat/normalized-stream-reducer.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/shared/chat/normalized-stream-reducer.ts#L84); [shared/chat/normalized-stream-reducer.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/shared/chat/normalized-stream-reducer.ts#L132); [shared/sync/sanitize.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/shared/sync/sanitize.ts#L184).

The reducer estimates canonical size as twice the raw UTF-8 bytes plus tool/fixed allowances. JSON may expand a one-byte control character into six bytes. The actual message schema stores content in `data`; the proof must not assume the reducer comment’s claimed duplicate content exists in every storage path.

**Trigger:** Accept 50,000 literal U+0000 characters. The reducer projects 104,096 bytes, below 229,376. JSON for only `{data:{content:...}}` is already 300,023 bytes, above the 262,144-byte sync ceiling, before IDs or metadata.

**Consequence:** The supposedly protected stream accepts output that later cannot persist as a terminal message. This applies even with only one stored content copy.

**Fix:** Track actual serialized string/envelope cost, including escape expansion and existing metadata. Preserve the last saveable prefix when a new event would exceed it.

**Regression to add or extend:** Extend reducer-to-persistence coverage with escaped control characters and metadata-heavy rows. The arithmetic above was independently calculated; no provider stream was executed.

### 14 — [P2] Tool results accepted by the registry cannot always fit durable storage

**Source:** [shared/chat/tool-limits.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/shared/chat/tool-limits.ts#L5); [app/utils/chat/tool-registry.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/utils/chat/tool-registry.ts#L577); [app/utils/chat/useAi-internal/foregroundStream.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/utils/chat/useAi-internal/foregroundStream.ts#L678); [shared/chat/canonical-tool-transcript.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/shared/chat/canonical-tool-transcript.ts#L24).

The accepted result limit is 262,144 raw UTF-8 bytes, equal to the entire serialized message limit. IDs, metadata and JSON escaping still have to fit. A result of exactly 262,144 ASCII characters exceeds the limit as soon as it is wrapped; 140,000 quote characters also pass the raw limit but exceed the JSON limit.

**Trigger:** An otherwise successful tool returns either fixture after completing its side effect.

**Consequence:** Result persistence fails and the chat aborts despite the registry accepting the output. Unresolved receipts correctly block replay, but they do not recover the successful result.

**Fix:** Budget the actual durable envelope and provide a supported overflow/blob-reference path for completed effects. Merely lowering a raw-character limit does not account for escaping.

**Regression to add or extend:** Extend the real Dexie/outbox foreground tool boundary with large ASCII and quote-rich results. Assert a durable successful receipt or a deliberate retained overflow reference.

### 15 — [P2] Closing the retry wrapper leaves its provider iterator open

**Source:** [app/utils/chat/openrouterStream.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/utils/chat/openrouterStream.ts#L668); [shared/openrouter/deadlines.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/shared/openrouter/deadlines.ts#L76); [shared/openrouter/deadlines.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/shared/openrouter/deadlines.ts#L128).

The retry wrapper manually drives `iterator.next()` and yields, without a finally calling `iterator.return()`. Consumer failure or early return closes only the wrapper. The parser’s reader-cancelling finally is bypassed. The response deadline removes its caller-abort bridge after headers; the body watchdog listens only while a pull is pending. A full prefetched queue therefore leaves a gap with neither listener.

**Trigger:** Consume one event, allow prefetch to fill, then stop consumption through an output-limit exception or the public generator’s return.

**Consequence:** The actual response reader/request can remain open after the app reports completion/failure; upstream resource use and billed generation may continue.

**Fix:** Guarantee inner iterator closure in finally and retain cancellation for the response body’s lifetime.

**Regression to add or extend:** Assert the underlying ReadableStream cancel callback runs exactly once when the outer generator is returned after one event, including the prefilled-buffer case.

### 16 — [P2] Media hydration can hang Stop and buffer arbitrarily large responses

**Source:** [app/core/auth/openrouter-build.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/core/auth/openrouter-build.ts#L203); [app/utils/chat/files.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/utils/chat/files.ts#L67); [app/utils/chat/useAi-internal/foregroundStream.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/utils/chat/useAi-internal/foregroundStream.ts#L465); [app/utils/chat/useAi-internal/continue.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/utils/chat/useAi-internal/continue.ts#L739).

Request-image hydration clears its eight-second timer immediately after headers, then awaits the entire body and checks 5 MiB only afterward. It accepts no caller cancellation signal. Generated-image `fetchImageBlob` has no deadline, signal or byte ceiling at all. Stream intake awaits that helper.

**Trigger:** Use a permitted image response that sends headers then stalls, or keeps streaming bytes. Stop during that await.

**Consequence:** Preparation/stream settlement can remain stuck; thread switching that waits for request settlement can stall too. Oversized bodies are allocated before file-policy rejection.

**Fix:** Use one bounded media reader with header/body deadlines, a caller abort signal, incremental byte enforcement, MIME validation and guaranteed reader cancellation. Propagate ownership checks after awaits.

**Regression to add or extend:** Use an isolated synthetic body that stalls after headers and one that crosses the byte limit. Assert prompt abort and bounded bytes read; cover both incoming attachments and generated images.

### 17 — [P2] Generated-image storage failure is silently reported as success

**Source:** [app/utils/chat/useAi-internal/foregroundStream.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/utils/chat/useAi-internal/foregroundStream.ts#L469); [app/utils/chat/useAi-internal/continue.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/utils/chat/useAi-internal/continue.ts#L741).

If image download succeeds but `createOrRefFile` rejects, the empty catch discards the error and bytes. The URL fallback only runs when conversion returns no blob, so it does not help a quota, file-policy, IndexedDB or Cloud-storage failure.

**Trigger:** Return an image-only provider result while making file persistence reject.

**Consequence:** A paid successful provider result becomes an empty/missing image while generation can finish successfully. No usable retained result or classified failure explains the loss.

**Fix:** Preserve a recoverable output/reference and surface the storage failure through the existing terminal error path. Only acknowledge the image once the required durable representation exists.

**Regression to add or extend:** Exercise image-only responses against a rejecting file store. Require a visible durable failure or usable retained image, never silent successful omission.

### 18 — [P2] Final-only multipart SSE content is truncated after its first text part

**Source:** [shared/openrouter/parseOpenRouterSSE.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/shared/openrouter/parseOpenRouterSSE.ts#L381).

Each final content-array text part checks whether text has already streamed for that choice. `stageText` sets that flag for the first part inside the same iteration, so the remaining final text parts are skipped.

**Trigger:** A valid final-only message has text parts A and B, optionally separated by an image.

**Consequence:** The parser emits A and reports success while silently dropping B.

**Fix:** Capture whether prior deltas existed before iterating the final array and use that stable decision for all of its text parts.

**Regression to add or extend:** Extend the final-only parser regression beyond its current string case to two text parts and mixed text/image content.

### 19 — [P2] Large input history breaks the background viewer queue and causes reconnect churn

**Source:** [server/api/jobs/[id]/stream.get.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/server/api/jobs/[id]/stream.get.ts#L1148); [app/utils/chat/useAi-internal/backgroundJobs.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/utils/chat/useAi-internal/backgroundJobs.ts#L1241); [app/utils/chat/useAi-internal/backgroundJobs.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/utils/chat/useAi-internal/backgroundJobs.ts#L1396).

Queue accounting serializes the full BackgroundJob, including private `execution.body` and its input history, against a 1 MiB viewer limit. The emitted projection does not include that input. A valid large prompt can therefore close the viewer even with tiny output. The memory provider takes full-snapshot reconciliation; recovery/remote paths can too. After SSE failure, a successful poll immediately upgrades back to SSE without a cooldown.

**Trigger:** Attach to a streaming job with more than 1 MiB of individually valid history rows and a small output.

**Consequence:** Repeated SSE/status reconnects waste auth/database/network work and disrupt smooth progress. This is a size-accounting defect, not a claim that execution credentials are transmitted to the client.

**Fix:** Queue only the bounded public projection plus required authorization identity. Add bounded backoff before retrying SSE after fallback.

**Regression to add or extend:** Give batching/reconciliation fixtures realistic execution bodies. Assert large input with small output stays attached, and repeated transport failure remains rate-bounded.

### 20 — [P2] Parked browser-tool jobs resume without reserving concurrency capacity

**Source:** [server/utils/background-jobs/providers/memory.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/server/utils/background-jobs/providers/memory.ts#L555); [server/utils/background-jobs/providers/memory.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/server/utils/background-jobs/providers/memory.ts#L186); [server/api/jobs/[id]/client-tool/result.post.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/server/api/jobs/[id]/client-tool/result.post.ts#L179).

Initial admission excludes parked client-tool jobs from active counts. Settlement clears the parked marker and lease without reserving a slot. The result route immediately claims the job, and the memory claim path does not check concurrency limits.

**Trigger:** With per-user limit five, park one job on a browser tool, start five other jobs, then settle the parked result.

**Consequence:** Six jobs can execute model requests concurrently; multiple parked jobs increase the overshoot. The separate waiting cap does not enforce the active cap.

**Fix:** Atomically reserve capacity at claim/resume. Keep settled jobs ready but unclaimed while all slots are occupied, with consistent admission/resumption accounting.

**Regression to add or extend:** Extend memory lifecycle coverage from simultaneous initial creation to parked resumption after other work fills the freed capacity. External-provider parity is recorded below.

### 21 — [P2] Detached completion notifications are written into the wrong workspace

**Source:** [app/utils/chat/useAi-internal/backgroundJobNotifications.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/utils/chat/useAi-internal/backgroundJobNotifications.ts#L72); [app/utils/chat/useAi-internal/backgroundJobNotifications.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/utils/chat/useAi-internal/backgroundJobNotifications.ts#L123); [app/composables/notifications/useNotifications.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/composables/notifications/useNotifications.ts#L295).

Completion checks the account and reads mute state from the originating DB, but does not bind delivery to the originating workspace. The hook payload has no workspace; the shared service is rebound to the current DB. The fallback explicitly uses `getDb()`. Navigation includes only threadId.

**Trigger:** Under the same account, start a background job in A, switch to B, and allow local completion notification delivery (for example with server notifications disabled and no visible subscriber).

**Consequence:** A’s notification appears in B and its Open chat action resolves the ID in B. No cross-user disclosure was demonstrated.

**Fix:** Persist via the tracker’s originating DB and use workspace-aware navigation, or suppress delivery in another workspace through the established service contract.

**Regression to add or extend:** Extend the existing A→B notification test to assert destination database and navigation context, not just call count/mute lookup.

### 22 — [P2] Unloading a tool erases the user’s enabled/disabled preference

**Source:** [app/utils/chat/tool-registry.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/utils/chat/tool-registry.ts#L186); [app/utils/chat/tool-registry.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/utils/chat/tool-registry.ts#L294); [app/utils/chat/tool-registry.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/utils/chat/tool-registry.ts#L323).

Preference persistence replaces storage with currently registered tools. Disposal removes a registration and schedules persistence. After the 300 ms debounce, that tool’s choice is gone; registration falls back to its declared default.

**Trigger:** Disable a default-enabled tool, unload it long enough for persistence, then reload it.

**Consequence:** The disabled tool becomes advertised/executable again. Portable tools default false, so they lose prior opt-in instead; immediate replacement before debounce is not the failing case.

**Fix:** Retain user preferences independently of registration lifetime. Merge choice updates and remove them only through an explicit reset/uninstall preference policy.

**Regression to add or extend:** Extend registry profile coverage through disable → dispose → debounce → register. Cover both default-enabled and default-disabled definitions.

### 23 — [P2] A diagnostic 32-bit hash decides tool execution identity

**Source:** [shared/chat/tool-ledger.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/shared/chat/tool-ledger.ts#L22); [shared/chat/tool-ledger.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/shared/chat/tool-ledger.ts#L43); [shared/logging/sensitive-metadata.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/shared/logging/sensitive-metadata.ts#L8).

The ledger uses diagnostic FNV-1a as the only argument-equality check. For tool name `write`, arguments `{"value":"dnzas"}` and `{"value":"1nzqii4"}` both produce `fnv1a32:205e9a81`. With the same call ID and a completed first entry, the different second request is treated as a successful replay.

**Trigger:** Feed the concrete colliding arguments to the same completed ledger call ID.

**Consequence:** The second action is not performed and receives the first result, instead of the required ID-conflict error. This is a concrete correctness failure; the independent SHA-256 client-claim identity prevents treating it as a claim-token bypass.

**Fix:** Compare canonical argument bytes or use a strong versioned digest with explicit compatibility for persisted ledger entries.

**Regression to add or extend:** Add the deterministic collision to the existing ledger contract suite. Validate public foreground/background execution decisions, without duplicating implementation hashing assertions.

### 24 — [P2] read_thread returns obsolete retries and omits inherited branch history

**Source:** [app/utils/chat/thread-chat-tools.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/utils/chat/thread-chat-tools.ts#L174); [app/db/messages.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/db/messages.ts#L446); [app/utils/chat/compaction/history.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/utils/chat/compaction/history.ts#L100).

The tool reads raw messagesByThread rows and filters only deleted/system/tool entries. It does not remove `superseded_by` rows or resolve reference ancestry. The native conversation projection already owns both rules, and workspace_read uses it.

**Trigger:** Read a thread after Retry, or read a reference branch whose visible history is inherited.

**Consequence:** The model sees obsolete and replacement answers together, or gets an empty/incomplete branch transcript despite visible conversation history.

**Fix:** Build tool output from the canonical conversation projection before applying role, count and text limits; retain project provenance checks.

**Regression to add or extend:** Execute read_thread for a retried turn and anchored reference branch. Compare expected canonical evidence at the public tool boundary.

### 25 — [P2] Several chat database APIs await arbitrary hooks inside transactions

**Source:** [app/db/threads.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/db/threads.ts#L579); [app/db/threads.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/db/threads.ts#L592); [app/db/messages.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/db/messages.ts#L527); [shared/hooks/hook-engine-core.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/shared/hooks/hook-engine-core.ts#L485).

System-prompt update reads inside a transaction, awaits a supported asynchronous before action, then writes. Thread upsert/deletion and message delete/move/copy/insert/normalize contain the same pattern. A hook that awaits a timer/network promise can let IndexedDB auto-commit. Installed Dexie and the already-correct prepared append/patch paths establish the transaction constraint.

**Trigger:** Register an async observer on one of these public CRUD hooks, then change a prompt, delete a chat or rearrange messages.

**Consequence:** Later writes fail as transaction inactive; delayed after hooks can report premature commit after a mutation has already succeeded, creating misleading failure/retry behavior.

**Fix:** Prepare before hooks outside transactions, re-read and validate rows within them, and emit after notifications after commit. Reuse the existing prepared-write pattern.

**Regression to add or extend:** Use the real hook engine and Dexie with a timer callback in each affected owner suite. A mock action promise does not prove real hook behavior.

### 26 — [P2] Index normalization changes the canonical order of colliding messages

**Source:** [app/db/messages.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/db/messages.ts#L40); [app/db/messages.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/db/messages.ts#L939); [app/db/messages.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/db/messages.ts#L861).

Canonical order is index, order_key, then id. Normalization reads the index and sorts only by index before assigning new distinct values. Equal-index rows inherit primary-key order, which can oppose their HLC order. Insertion invokes normalization when a sparse gap is exhausted and also fails to locate equal-index successors correctly.

**Trigger:** Use colliding indexes with opposite UUID/HLC order, then normalize or insert into an exhausted gap.

**Consequence:** History is permanently reordered and the changed indexes sync to peers, potentially altering subsequent model input. This is a documented source API/extension defect; no separate native normalization button was identified.

**Fix:** Use the canonical comparator for normalization and successor selection, then recalculate sparse indexes transactionally.

**Regression to add or extend:** Extend normalization/insertion tests with equal indexes and deliberately opposing ID/order_key order.

### 27 — [P2] One history-observer error leaves an open conversation permanently stale

**Source:** [app/composables/core/useMultiPane.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/composables/core/useMultiPane.ts#L401).

The liveQuery error callback removes the observer from a plain Map and only logs in development. Observer creation depends on workspace/pane identity changes; deleting the Map entry does not retrigger it. Recovery of storage alone does not resubscribe.

**Trigger:** Fail one history read/projection, restore storage, then sync another message without changing pane bindings.

**Consequence:** The open chat no longer receives incoming turns/edits/deletes and has no visible failure/retry indication.

**Fix:** Keep an owner-scoped error state and bounded resubscription, cancelled on disposal/workspace change. Retain the last good view and offer manual recovery after retries.

**Regression to add or extend:** Extend shared history-observer coverage with query error → storage recovery → subsequent incoming write.

### 28 — [P2] A large paste strips existing structured mentions from the composer

**Source:** [app/components/chat/chat-input/useChatInputAttachments.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/components/chat/chat-input/useChatInputAttachments.ts#L294); [app/components/chat/chat-input/useChatInputAttachments.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/components/chat/chat-input/useChatInputAttachments.ts#L312); [app/plugins/ChatMentions/useChatMentions.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/plugins/ChatMentions/useChatMentions.ts#L449).

For a paste of at least 600 words, the helper stores the pasted block separately, then restores the preexisting editor through getText/setContent. Mention nodes become plain text. Uploaded txt/md/csv references are also represented as file mentions.

**Trigger:** Insert a document/chat/file mention, then paste a long block and send.

**Consequence:** Its visible label may survive while the source ID is lost. Mention extraction silently omits the requested context from the model request.

**Fix:** Handle the paste before default insertion or preserve complete editor JSON and selection under the captured owner; do not round-trip existing state through plain text.

**Regression to add or extend:** Use a real composer containing a mention and inspect both emitted editorDoc and extracted references after a 600+ word paste.

### 29 — [P2] A vetoed thread selection destroys the outgoing pane but reports activation

**Source:** [app/composables/core/useWorkspaceTabHost.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/composables/core/useWorkspaceTabHost.ts#L76); [app/composables/core/useMultiPane.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/composables/core/useMultiPane.ts#L715); [app/composables/core/useWorkspaceTabs.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/composables/core/useWorkspaceTabs.ts#L263).

The tab host sets chat mode and clears the outgoing document/history before calling setPaneThread. A supported selection filter can return false; setPaneThread returns normally, and the host/tabs report success. Reconciliation does not roll back the destructive prebinding.

**Trigger:** Open a chat from a document pane while ui.pane.thread:filter:select vetoes the selection.

**Consequence:** The user gets a blank/incorrect chat pane instead of keeping the outgoing resource, while callers receive an activated result. This is view/binding loss, not proof of deleted durable document content.

**Fix:** Return a typed selection outcome/effective resource and commit pane replacement only on acceptance; restore prior state and return failure on veto.

**Regression to add or extend:** Integrate the real veto hook through tab host + tabs. Existing lower-level veto tests and always-successful host mocks miss the interaction.

### 30 — [P2] SQLite background admission omits a stable message order_key

**Source:** [node_modules/or3-provider-sqlite/dist/runtime/server/sync/sqlite-sync-gateway-adapter.js](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/node_modules/or3-provider-sqlite/dist/runtime/server/sync/sqlite-sync-gateway-adapter.js#L704); [app/core/sync/sync-payload-normalizer.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/core/sync/sync-payload-normalizer.ts#L90).

Native pending assistants bypass the HookBridge that normally creates order_key. SQLite background admission derives an HLC but materializes the row without supplying a missing order_key. Its canonical reader treats missing keys as empty strings. Browser normalization instead derives a key from the change HLC; finalization changes that HLC while preserving the keyless canonical row. The installed Convex template explicitly derives the key at admission.

**Trigger:** Concurrent devices admit background assistants with equal sparse indexes and UUID order opposite HLC order.

**Consequence:** Server and browser histories can disagree about tie order; the browser’s derived order can change again on completion. Context retrieval and visible chronology lose their shared ordering contract.

**Fix:** In SQLite admission, derive order_key once from the admission HLC when absent. Put the same value in the materialized row and change log and retain it through finalization.

**Regression to add or extend:** In the SQLite provider suite, admit equal-index background assistants and compare canonical and normalized browser ordering before/after finalization. Fix the provider source and release through its documented workflow; do not edit installed node_modules as remediation.

### 31 — [P3] Saved PDFs have no retrieval action in the native message gallery

**Source:** [app/components/chat/MessageAttachmentsGallery.vue](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/components/chat/MessageAttachmentsGallery.vue#L24); [app/components/chat/ChatMessage.vue](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/components/chat/ChatMessage.vue#L79).

View attachment expands the gallery. Its PDF branch renders a static name/badge, while the available download action is restricted to kind file.

**Trigger:** Send/store a PDF, expand its attachment gallery and try to open or download it from the message.

**Consequence:** The saved attachment is not retrievable from its native chat affordance even though its blob still exists.

**Fix:** Expose the existing scoped download action for PDFs, or add a PDF preview with download and keyboard access.

**Regression to add or extend:** Render a persisted PDF and activate a keyboard-operable retrieval action.

### 32 — [P3] An append preparation test proves a mock behavior the real hook engine suppresses

**Source:** [app/db/__tests__/messages-transactions.test.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/db/__tests__/messages-transactions.test.ts#L596); [shared/hooks/hook-engine-core.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/shared/hooks/hook-engine-core.ts#L485).

The test replaces doAction with a rejecting mock and expects rejection/no write. The real engine catches callback exceptions and continues. A plugin throwing in a before action therefore does not establish the safety condition this test claims.

**Trigger:** Replace the mock-only failure with the same failing callback registered in the actual hook engine.

**Consequence:** False confidence in preparation rejection. This is a test-contract issue, not a separate claim that observational hooks are intended authorization gates.

**Fix:** Test the real engine’s intended behavior. Use schema validation or an explicit supported admission mechanism to test rejection; do not alter global hook semantics to satisfy the mock.

**Regression to add or extend:** Retain one owner-boundary regression with the real hook engine and remove/rewrite the misleading mock expectation.

## Production-provider evidence

The host findings were not assumed to match every provider. A targeted read-only pass inspected installed **or3-provider-sqlite 0.0.22** and **or3-provider-convex 0.0.24**, matching the repository package declarations.

| Contract | SQLite installed code | Convex installed package |
| --- | --- | --- |
| Finding 08: abort prevents buffered terminal persistence | [abortJob](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/node_modules/or3-provider-sqlite/dist/runtime/server/background-jobs/sqlite-provider.js#L385) marks terminal and clears lease; progress at 344–356 and terminal save at 559–574 require streaming. | Packed `backgroundJobs.ts` abort at 858–885; terminal save rejects non-streaming at 579–587. [Adapter delegation](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/node_modules/or3-provider-convex/dist/runtime/server/background-jobs/convex-provider.js#L147) follows those mutations. |
| Finding 20: resumed jobs bypass active admission caps | [settlement](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/node_modules/or3-provider-sqlite/dist/runtime/server/background-jobs/sqlite-provider.js#L529) clears parked state/lease; claims at 412–477 lack capacity checks. Initial admission counts parked/runnable work separately at 121–128 and 206–214. | Packed `backgroundJobs.ts`: separate caps 220–244; settlement 810–845; claims 632–694 do not reserve capacity. Adapter claim calls at 206–220 and settlement at 256–268 carry no admission limits. |
| Finding 30: stable message order | [Admission](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/node_modules/or3-provider-sqlite/dist/runtime/server/sync/sqlite-sync-gateway-adapter.js#L704) omits missing order_key; canonical sorting at 604–610 differs from browser fallback. | Packed `sync.ts` 1564–1568 supplies a key before materialization; this is a useful parity reference. |

Convex references above address the unpacked source strings in the gzip JSON's `files["backgroundJobs.ts"]` and `files["sync.ts"]` inside [convex.pack.json.gz](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/node_modules/or3-provider-convex/templates/convex.pack.json.gz). They were read without executing or installing them. The loose repository Convex source is older than this installed template and was not used as proof of current package behavior. The actual deployed backend version remains unverified.

For finding 20, parking N−1 jobs and filling N runnable slots can leave up to 2N−1 runnable jobs after settlement. Actual simultaneous network dispatch also depends on worker scheduling. The provider limit itself is not enforced on that transition.

Focused canonical admission checks found transactional membership checks, fingerprinted admission/finalization receipts, contiguous version allocation and generation/deletion ownership checks in the inspected SQLite/Convex paths. That is evidence about these paths, not certification of every provider or migration.

## Coverage and residual limits

| Area | Inspected evidence | Remaining empirical work |
| --- | --- | --- |
| Native send, retry, Continue, cancellation | Controller, helpers, request/finalization ownership, stream coalescer, parser, transport deadlines, native recovery and related tests | Real two-pane races, crash/reload between writes, aborted media bodies |
| Persistence and synchronization | Message/thread CRUD, branches, ordering, file references, HookBridge, outbox, conflict resolver, snapshot replacement, cursors, subscription coordination and lifecycle | Actual browser IndexedDB transaction timing; multi-device conflict/snapshot fault injection |
| Background execution | Admission, memory provider, recovery/leases, canonical history, status/SSE/abort, browser-tool claims/results, trackers and notifications | Restart/multi-worker fault injection; deployed SQLite/Convex versions and service failures |
| Context, tools and history | Budgets/usage, canonical transcript, replay, registry, tool schemas/limits/ledger, history retrieval, compaction projection, summary path, lossy confirmation and scoped workspace/project tools | Long-running and approval-delayed tool execution, very large actual contexts |
| Composer, panes and attachments | Draft journal/ownership, acceptance adapter, native editing, mentions, intake, galleries, thumbnails, model selection, tab activation and observers | Keyboard/screen-reader/browser interaction, visual layouts, every theme override |
| Credentials and network boundaries | Foreground server route, centralized credential policy, current can/origin patterns, context route, selected title/model/memory calls, hydration/cache and download verification | Cross-tab cookie/session race, actual server headers/proxy deployment, full provider credential lifecycle |
| Rendering and resource limits | Native Markdown/component integration, highlighting worker lifecycle and media paths | Actual third-party sanitizer behavior in browsers, fuzzing, sustained heap/performance profiling |
| External providers | Targeted installed SQLite/Convex background and canonical-history paths | Full provider stores, all migration histories, D1 runtime behavior, FS/S3 implementations and deployment matrix |

At the baseline review, tests were read to assess gaps; remediation test counts are now recorded separately above and below. This remains **not** an exhaustive audit of every test file. Public lifecycle, background, database-safety, source-map and sync contracts guided the review. No previously saved coverage ledger was used as proof that any area was already safe.

### Specific hypotheses needing validation

These are not included in the 32 findings and have no assigned priority.

1. **New-chat pane binding after an awaited create.** [app/composables/chat/useAi.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/composables/chat/useAi.ts#L2339) checks cancellation after creation, then uses the global currently active blank pane. Full workspace-shell rebinding needs an integration test to establish whether a detached A request can bind A's thread into B's pane. Hold create, switch workspace, release, and inspect binding/draft ownership.
2. **One failing canonical-history recovery job may block the rest of a scan.** [server/utils/background-jobs/history.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/server/utils/background-jobs/history.ts#L137) propagates a per-job reconciliation error; inspect the recovery scheduler's next-pass ordering and prove starvation with a bounded poison-job fixture before asserting it.
3. **Human approval may outlive a browser-tool claim.** Claims have a 30-second lease while project approval can wait for a human. Validate renew/reclaim behavior across a delayed approval and require a useful retry outcome; do not weaken the execution authorization fence.
4. **Foreground credential selection under cross-tab account changes.** [app/utils/chat/openrouterStream.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/app/utils/chat/openrouterStream.ts#L469) sends no captured account header, while [server/secrets/openrouter.ts](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/server/secrets/openrouter.ts#L34) selects the currently resolved account. The credential-management route has an explicit expected-account check. A controlled browser test must determine whether stale-tab preparation can dispatch another account's payload/spend before session reconciliation. This review does not assert an exploited billing or disclosure bypass.
5. **Native browser/rendering and deployment claims.** Untrusted Markdown/tool-card sanitization, actual CSP/proxy behavior, resource exhaustion thresholds, accessibility and provider-specific restart behavior need their proper browser/integration harnesses. Source inspection alone cannot certify them.

### Safeguards retained, and claims deliberately rejected

- Cancellation checks around final incoming filters and generation-aware terminal writes are present. Losing continuation writers are fenced; finding 11 concerns admission and duplicate execution.
- Tool result insertion validates generation/thread/parent inside the write transaction. Finding 10 concerns ordinary message append, not that guarded tool append.
- Uncertain tool effects have running/unresolved receipts and are not automatically replayed.
- Transport failures do not automatically fabricate a terminal background generation result; uncertain admission has recovery logic.
- Incremental winner application compares current local revision. Cursor replay after a crash is intentional, and snapshot restoration protects replayable outbox intent.
- File ref_count is treated as derived state; canonical references guard deletion.
- Thumbnail results are epoch-fenced and URLs released on workspace change. Highlighting has bounded queue/code size, timeouts and lease cleanup.
- New draft edits are protected during asynchronous sends. Finding 07 concerns the acceptance predicate, not the already-present draft revision fence.
- Ignoring the foreground server context-admission function's return is currently safe because it mutates the provided max_tokens in place.
- The weak diagnostic tool fingerprint does not defeat the stronger SHA-256 browser-claim identity.
- Project-wide legacy search scope is documented and was not mislabeled as an isolation vulnerability.

## Repair and verification order

1. **Workspace and durable-data safety:** 01–06, 08–10. Close captured-owner gaps, retain local generation state during snapshots, serialize sync lifecycle, and make edits/retries/deletes transactionally coherent.
2. **Execution and resource correctness:** 11–23 and 30. Establish atomic continuation/resume claims, saveable serialized output, cancellation of the actual transport, bounded media handling, explicit storage failure, parser completeness and provider ordering parity.
3. **Canonical user-facing behavior and extension reliability:** 24–29, 31–32. Reuse canonical history, move async hooks outside transactions, recover observers, preserve editor structure and make navigation outcomes truthful.

Each repair should fail a meaningful regression against this baseline and pass after the owning implementation changes. Extend canonical suites; avoid mock-only replicas, source-string checks and duplicate tests. Do not change Cloud invariants or publish provider packages without the documented authorization/release workflow.

Validation lanes identified by the baseline review (subsequent execution is recorded below):

- `bun run test:chat-tools` for the current focused parser/ledger/transcript/stream/persistence/continuation/background authorization lane.
- Targeted `bun run test -- <owner-test-path>` or the appropriate integration project for message, snapshot, sync lifecycle, composer/tab and notification regressions; use the project's configured lane for each file.
- `bun run test:e2e:recovery` after local durability repairs, and the named chat/context/Cloud harnesses for controlled browser and authenticated-provider checks. Inspect their requirements before running credential-writing or paid-network cases.
- Relevant type checks and final diff inspection when contracts change. Broaden to the full lane only when the changes' risk warrants it.

## Completion state

All **32 reported findings have owning source repairs and passing regression
coverage** on `codex/chat-hardening`. This closes the reported backlog in source;
it does not certify that every possible chat defect has been found.

| Qualification | Result |
| --- | --- |
| Host `bun run test:full --bail=0` (all non-live projects) | **745 files passed; 6,868 tests passed, 1 skipped** |
| Host supported Nuxt `bun run type-check` with basic-auth/SQLite/FS configured | Passed; Nuxt reports existing duplicate plugin-coordinator auto-import warnings |
| Changed host TypeScript/Vue ESLint | Passed with zero warnings |
| `bun run check:docs` | Passed: 115 files, 103 mapped routes, 20 typechecked examples |
| SQLite full `bunx vitest run` | **14 files passed; 260 tests passed, 11 skipped** |
| SQLite standalone type check, lint and module build | Passed |
| Convex full `bunx vitest run`, using the current host root | **27 files passed; 309 tests passed** |
| Convex standalone type check, release-contract tests, canonical-history lane and module/template build | Passed; generated template pack and backend contract digest updated |
| Final diffs | Reviewed, including new regression files; whitespace checks passed |

The final artifact boundary rerun passed **146 tests** across foreground durable
storage, mounted downloads, browser-result HTTP acceptance and native background
streaming. A control without SubtleCrypto first reproduced an accidental secure
context dependency in the new checksum path; it now uses the existing portable
SHA-256 library and passes with identical content-addressed references. Convex's
standalone release lane passed **13 tests** and its verified canonical-history
lane passed **69 tests**.

The complete host suite includes the native context, chat tools, server API,
integration, plugin compatibility, scripts and release-policy projects. Early
broad failures exposed fixtures that assumed replacement erased tool preferences,
required output to remain inline, or assumed synchronous bootstrap construction.
Those fixtures now retain their observable assertions: execution authorization,
complete persisted bytes, equivalent contribution profiles and no outbox start
before subscription readiness. The final full run passes.

Host changes are submitted for review on `codex/chat-hardening`; the external
provider patches remain unpublished. The host worktree is
`/Users/brendon/.codex/worktrees/chat-hardening/or3-chat` at base
`8e8557404d91eb6057a1d8d49faf9f7de6f34230`. Provider source worktrees:

- SQLite: `/private/tmp/or3-chat-hardening-sqlite`, base
  `570ada7070df5907629a9dc1826e6edb98a54f11`.
- Convex: `/private/tmp/or3-chat-hardening-convex`, base
  `2465218c2d308aa47c62e9213983458b6b48db4d`.

Portable binary-capable diffs and their base revisions are retained in
[provider-patches/README.md](provider-patches/README.md),
so provider fixes do not depend on temporary worktree retention. No version bump,
package publication, provider installation, backend deployment or application
activation has been performed. The installed SQLite **0.0.22** and Convex
**0.0.24** packages remain unchanged. Background tools require the repaired
provider method; release the provider changes through the normal workflow and
activate the matching Convex schema/mutations and host together.

The SQLite standalone suite retains its reviewed host fixture/provenance. Its
pinned sibling-host integration gate does not accept this uncommitted hardening
branch; that verifier was not weakened or bypassed. Current host behavior is
qualified by native integration tests, and SQLite atomicity/reopen/versioning by
its production-backed provider suite. The skips above and this combined-host
release qualification remain explicit deployment limits.

No live/paid-provider calls, browser chaos/stress/accessibility qualification,
production restart probes or deployment matrix certification were performed.
The residual hypotheses and empirical work above remain outside the established
32-item backlog. These are limits of the evidence, not a claim that they are
confirmed defects. Use the documented release process before activation.

## Follow-up worktree review — 2026-10-25

Reviewed the complete uncommitted host diff, new source and regression files,
public contracts, and retained SQLite/Convex provider patches. Four further
product defects and one coverage defect were established and repaired. Provider
source and installed provider versions were unchanged during this follow-up.

| ID | Priority | Defect, repair and evidence |
| --- | --- | --- |
| R1 | P1 | A rejected continuation claim had already installed terminal-write ownership. If a legacy assistant had no generation ID, finalization overwrote a concurrent edit with the old response. [Continuation](../../../app/utils/chat/useAi-internal/continue.ts#L511) now publishes persistence/UI ownership only after successful admission, while preserving cleanup when later setup fails. The real-Dexie regression failed before repair and passes afterward; rejected claims dispatch no stream and preserve the exact edited row. |
| R2 | P1 | Message move/copy retained tool-result references in the source thread's namespace. Deleting that thread then destroyed output referenced by the destination. [Transfers](../../../app/db/messages.ts#L689) now prepare destination chunks and atomically commit them with the message/outbox. Every source revision is checked, including when output first appears during preparation. Copy/move deletion regressions and both preparation-race cases failed before their respective repairs. Full bytes survive in canonical tool rows, assistant receipts, transcript receipts and model-history hydration; deleting the destination cleans its chunks. |
| R3 | P2 | Pending tab intent used a captured pane index and skipped cleanup after cancellation. Closing a neighboring split or superseding activation left stale intent, and cleanup could address the wrong pane. [Tab host cleanup](../../../app/composables/core/useWorkspaceTabHost.ts#L60) resolves stable pane identity, listens for cancellation, and checks its own intent token before clearing. Both real-pane regressions failed before repair and pass afterward. |
| R4 | P2 | The editor's bracket workaround changed literal `[label](url)` text into an active link after saving/reopening, and its message-wide math switch confused ordinary brackets with formulas. Literal entity text also lost a decoding layer. [MessageEditor](../../../app/components/chat/MessageEditor.vue#L55) now encodes literal brackets/entities and represents genuine LaTeX spans independently, preserving their source in Markdown and clipboard text. Mounted editor/renderer round trips cover literal links, mixed display/inline math, code delimiters and literal entities. Literal-link/entity failures were reproduced before repair; an additional clipboard check caught and corrected delimiter loss in the new math representation. |
| R5 | P3 | The large-paste fixture constructed a real editor but never connected it to the paste handler. Its unchanged-document assertion could pass while the composer still erased mentions. Coverage now lives in the [canonical composer suite](../../../app/components/chat/__tests__/ChatInputDropper.test.ts#L265), dispatches a native paste event through the actual editor, and verifies retained mention IDs, formatting, selection and the attached block. It fails against the original implementation, which replaces those nodes with plain text. The disconnected fixture was removed. |

The targeted continuation/pane/storage checks passed **215 tests, 1 skipped**;
the editor/composer/transfer checks passed **52 tests** before the final clipboard
assertions were added. Final qualification is recorded below.

| Follow-up qualification | Result |
| --- | --- |
| Final host `bun run test:full --bail=0` | **745 files passed; 6,880 tests passed, 1 skipped** |
| Supported Nuxt type check with basic-auth/SQLite/FS configured | Passed; existing duplicate plugin-coordinator auto-import warnings remain |
| ESLint over all changed/new host TypeScript and Vue files | Passed across 91 files; final editor/clipboard edits also rechecked with zero warnings |
| Public guides/docmap/examples | Passed: 115 files, 103 mapped routes, 20 typechecked examples |
| Host and retained provider source whitespace checks | Passed |

One repeat full run alongside the Nuxt type check timed out in the existing
10,000-operation portable plugin conformance case. The isolated plugin/editor
rerun passed **24 tests**, and the final full run on its own passed as recorded
above. No test timeouts, quotas or production limits were relaxed.

Additional manual checks for this follow-up:

- [ ] Prepare Continue in one pane while editing the same legacy reply elsewhere. A refused continuation must preserve that edit and start no second generation.
- [ ] Move and copy a message with a large tool result using the supported message API. Delete its source conversation, reload, expand/download the result and reuse it as model context. Verify complete output remains available. Repeat while a new result arrives during transfer; a changed source must reject for retry.
- [ ] Switch chats while closing a neighboring split, then rapidly supersede the pending activation. Verify the intended pane loads, outgoing content survives a refused selection, and later navigation is not redirected by stale intent.
- [ ] Save and reopen a message containing literal link syntax, literal HTML entity text, code containing math delimiters, and an actual formula together. Verify the text and formula survive; copy the formula and confirm its delimiters are retained.
- [ ] Paste at least 600 words into a composer that already contains a file mention and formatted text. Verify the paste becomes a separate block and the existing mention, formatting and selection remain intact.

The provider activation, live-browser, paid-network and deployment limits in the
preceding completion state still apply. Host changes are prepared for a draft PR;
provider packages, images and backends have not been published or deployed.
