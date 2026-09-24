# Mixed client/server tools in background chat

**Goal:** One turn can use browser-only, server-only, and hybrid tools, survive chat navigation, and retain accurate results. Extend the existing job system; reuse SSE for requests and authenticated POSTs for replies.

## Findings and decision

The [current workaround](../app/composables/chat/useAi.ts) moves turns containing client tools into foreground execution and removes server-only tools. The [background runner](../server/utils/background-jobs/stream-handler.ts) rejects client tools and checkpoints only after a complete tool batch. Portable task tools operate on workspace-scoped browser storage through an approved sandbox; moving execution to the backend would not reach that data.

Use **one server-orchestrated turn with execution routed per call**. Server tools stay on the server; client tools run in their originating browser profile/workspace; hybrid tools prefer an admitted server implementation. Preserve the full admitted tool catalog throughout the turn. Static builds keep foreground client/hybrid execution and clearly mark server tools unavailable.

## Execution flow

1. **Checkpoint before delegation.** Persist the assistant’s complete tool-call batch, continuation phase, next call, and any completed results before dispatch. Give each call a stable `(job_id, generation_id, call_id)` identity, argument/definition fingerprint, originating device/workspace binding, deadline, and monotonic revision. Extend the existing tool ledger and provider contract across memory, SQLite, and Convex.
2. **Park durably.** A client call moves execution into `waiting_client`; release the execution lease and worker slot. Recovery must distinguish parked jobs from runnable jobs and resume the saved batch without regenerating model calls. Apply bounded waiting-job quotas and expiry separately from active execution. In-memory development storage retains its existing restart limitations.
3. **Dispatch in the browser.** Add an app-scoped executor using the existing background-job tracker and client tool registry. Keep execution subscriptions independent of visible-chat subscriptions, so navigating away neither stops tools nor changes notification behavior. Discover pending requests on startup/reconnect, then reuse job SSE. An atomic claim POST grants one tab a fenced execution token. Invoke only admitted handlers through the registry and, for portable tools, their approved sandbox.
4. **Return and resume.** Journal execution state/results in browser-local storage and POST the result with the claim token. Atomically accept it once, persist the canonical transcript and continuation, then immediately wake the job through `claimAndRunBackgroundJob` on the receiving server. Replay acknowledged results on duplicate delivery. Preserve current tool ordering; no new broker, WebSocket, or speculative parallel execution.

## Correctness and user experience

- **Interrupted writes:** Persist invocation intent before execution; retry delivery of completed results. A crash between a side effect and its receipt leaves an uncertain outcome. Reinvoke only handlers with explicit idempotency support; otherwise show “Outcome unknown” and require an explicit retry. Claims alone cannot guarantee exactly-once arbitrary browser mutations.
- **Unavailable browser:** Chat navigation remains seamless. A closed/suspended browser or inactive originating workspace leaves calls visibly waiting until reconnect or a bounded deadline. Never substitute another device’s local data. Plugin removal, revoked access, or incompatible definition changes produce explicit errors. Propagate cancellation and reject late results after abort/expiry. Server-only turns continue independently; a mixed turn pauses when it needs browser output.
- **Trustworthy history:** Render live and restored calls from the same versioned durable state; stale snapshots cannot turn completed calls back into loading. Show waiting, running, failed, and uncertain states distinctly. Derive activity labels from tool metadata; failures must never appear as successful edits/searches.
- **Security:** Claim/result endpoints enforce authentication, same-origin checks, `can()`, job ownership/workspace access, claim fencing, exact admitted arguments, and existing size/rate limits. Recheck browser grants, enabled state, and plugin identity before invocation. Device IDs route requests; they do not authorize them. Treat returned content as untrusted tool output.

## Delivery and acceptance

1. Implement provider state transitions, atomic claims/results, and restart-safe checkpoints; then park/resume APIs and cancellation.
2. Add the browser executor, execution journal, reconnect discovery, and shared status rendering. Remove the foreground workaround after mixed execution passes.
3. Verify a single server → task create/search → server turn against actual task storage. Cover navigation, reload, competing tabs, dropped replies, uncertain writes, restart on another replica, abort, workspace changes, revocation, and browser reconnect across provider suites; run relevant authorization tests and typecheck. Update public docs/docmap and provider READMEs.

**Performance target:** Measure claim-to-durable-result overhead excluding tool/model execution: p95 ≤200 ms at ≤30 ms network RTT. Reuse existing SSE connections and limits; parked jobs consume no model requests or worker slots. Capture timings without logging tool arguments.
