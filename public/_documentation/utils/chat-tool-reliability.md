# Chat Tool Reliability Test Suite

This contributor suite deliberately breaks tools with scripted OpenRouter SSE.
It runs the production parser, registry, chat controller, `ChatContainer`, message
renderer and IndexedDB. No live model decides which tool to call.

```bash
bun run test:chat-tools
bun run test:e2e:chat-tools
bun run test:e2e:chat-tools:cloud
```

Install the browser once with `bunx playwright install --with-deps chromium`.
The foreground lane disables Cloud services and clears provider credentials for
its process. The Cloud lane creates disposable Basic Auth and SQLite databases
under `/tmp`, supplies a loopback model endpoint, and deletes its data on exit.
It uses installed provider packages and the memory job provider. Additional
provider qualification remains necessary for Convex and multi-instance deployments.

## Blocking scenarios

All fifteen priority cases run in the foreground browser lane: success, handler
throw, non-response timeout, invalid JSON, invalid argument types, unknown and
disabled tools, two successful calls, mixed success/failure, duplicate IDs,
conflicting IDs, Stop during execution, pane/workspace navigation, result-write
failure, and reload without reexecution. Each case checks recovery by submitting
another message through the native composer, verifies the disappearance of tool
spinners, and fails on unhandled browser exceptions. Large-result bounds and
inspector redaction are additional cases. Browser protocol cases also verify
recovery after malformed event JSON, missing call identity, unfinished arguments
and a provider error after a call starts, with no handler side effects.
The scripted provider rejects unmatched call/result history, including recovery
requests. Native Retry is tested before and after reload for an uncertain write:
the original turn remains visible and the handler's counter stays at one.

The Cloud lane verifies authenticated server execution, throws, duplicate and
conflicting IDs, canonical history persistence, client call origin, one claim,
anonymous/wrong-device rejection, invalid settlement, successful delivery and
rejected duplicate delivery, and fresh origin authorization before claims and
result writes. Authenticated browser tests close and reopen the page with a
running or settled execution journal, proving that the write counter stays at one.
They also leave a call unclaimed until its delayed client handler registers.
Production-backed background integration tests also
cover saved/running browser journals, reconnect after failed delivery, delayed
plugin activation, workspace authorization and worker recovery.

The Checks core job and release-candidate source validation require both browser
lanes. `release:check` includes them as well. CI uploads receipts, screenshots,
and browser failure artifacts from `test-results/chat-tools` and
`test-results/chat-tools-cloud`. Receipts identify the source commit, dirty state,
command, case status and browser version; Cloud receipts describe the isolated
profile and confirm temporary-data removal. These are test evidence, not proof of
a live-model smoke test or durable job storage across server restart.
The foreground coordinator records every attempt, including failures and retries
across replacement workers. Screenshots include retry and worker identities.
`bun run test:chat-tools:receipts` verifies aggregation with a deliberate worker
failure; the named foreground browser command runs this check automatically.

## Controlled tools and inspector

The explicit development route `/__or3-chat-tools-test` mounts the real chat UI
with five fixture tools: `test_echo`, `test_fail`, `test_slow`, `test_large_result`
and `test_write_once`. Enable it with `OR3_CHAT_TOOLS_TEST_HARNESS=true` only in
development. The slow tool waits for the harness's release button or the real
registry timeout/abort. A durable, deliberately non-idempotent counter records
every handler invocation so replay defects remain observable after reload.
Cloud fixture handlers are included only when
`OR3_CHAT_TOOLS_CLOUD_TEST_HARNESS=true` in development. Neither flag enables
these routes or handlers in a production build.

The harness's Tool Call Inspector shows identity, runtime, validation/execution
evidence, timing, saved-result state, generation state and execution outcome.
Arguments and results are entirely redacted. It never exposes credentials or
raw error payloads. The inspector is a development harness surface.

## Recovery guarantees

Legacy renderer statuses remain compatible; foreground calls additionally record
`completed`, `failed`, `timed_out`, `canceled` or `unresolved` as their execution
outcome. Interrupted streams finalize visible pending calls. A successful handler
is not a saved result: an assistant execution receipt must be acknowledged before
the handler starts, and both the result row and assistant checkpoint must be
acknowledged before continuation. A failed write leaves a durable running or
unresolved receipt that blocks native Retry, including after reload. Timeouts and
cancellation also retain uncertainty when execution may still have side effects.
For later chat requests, missing durable results are represented by an explicit
provider-only uncertainty error. This closes the protocol pair without claiming
an unsaved success or creating a stored result row. Duplicate result records
remain saved, while the provider receives the final result for each parent/call
pair once. Completed calls retain their identity and results
when another call fails or the user navigates.

The shared SSE parser reconstructs byte fragments and interleaved call indices
exactly. Missing/conflicting call IDs and unfinished calls at stream termination
raise protocol errors at both `[DONE]` and transport EOF. A finish reason closes
only calls belonging to that choice. It does not invent provider identity. Repeated standard
argument deltas remain data; cumulative snapshots require explicit opt-in.

## Release smoke test

After deterministic gates pass, manually check a release candidate with a real
model. For each item verify final response, tool status, saved history and the
ability to send another message:

- [ ] Search existing chats and read one result.
- [ ] Create a disposable document and verify it exists.
- [ ] Reject a tool approval.
- [ ] Trigger an unavailable tool or error and continue chatting.
- [ ] Stop a slow call and immediately submit another message.
- [ ] Reload a multi-tool turn and inspect saved results.
- [ ] Navigate away from an eligible Cloud background tool and return.

Live-model checks supplement these fixtures. Retry of a consequential operation
must consult execution receipts; an uncertain write must not be repeated merely
because a retry control is available.
