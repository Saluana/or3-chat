# Chat Tool Reliability Test Suite

Deterministic provider fixtures drive the production chat controller, tool
registry, renderer and workspace database. No model or external tool API decides
which call to make. Test tools are imported only by a development-only route.

## Failure inventory (before implementation)

- Handler throw, non-response, cancellation and late completion can strand loading UI.
- Invalid JSON/types, unadvertised/disabled tools must never reach a handler.
- Parallel calls, duplicate IDs and conflicting arguments can lose results or repeat writes.
- Switching panes/workspace can retarget a late result to a different conversation.
- Failed result persistence must prevent model continuation, while preserving prior messages.
- Reload must restore results without reexecution; uncertain side effects must not replay.
- SSE fragmentation, interleaving, repeated deltas, absent identity, malformed envelopes,
  interrupted arguments and provider errors must preserve exact data or fail explicitly.
- Background claims can race plugin activation; disconnect after execution requires
  journal reconciliation. Revoked origin authority must fence consequential writes.
- Large results must respect independent durable, model and display limits.
- Diagnostics must disclose lifecycle metadata without secrets or argument contents.

## Tasks

- [x] Five controlled tools and a dedicated development harness
- [x] All 15 priority foreground/browser lifecycle cases, composer recovery and reload
- [x] Protocol fixtures and fail-closed call identity
- [x] Background journal/activation/authorization integration coverage
- [x] Redacted development inspector
- [x] Named test lanes, blocking CI gate and repeatable evidence receipts
- [x] Validation and contributor/release smoke-test documentation

## Implementation and validation

The foreground lane covers all 15 priority scenarios, plus result projection,
inspector redaction/restoration and four malformed-provider recovery scenarios.
The Cloud lane uses Basic Auth, installed SQLite and memory jobs with a loopback
provider. It includes real browser closure with running/settled journals, delayed
client registration and revoked-origin claim/result authorization. Fixtures are
excluded from production routes/plugins; harness profiles use separate Vite caches.

An acknowledged assistant execution receipt now precedes handler invocation.
The ledger waits for result and assistant writes before acknowledging completion.
Failed writes retain a running or unresolved durable receipt and block native
Retry before and after reload. Provider history closes missing results with an
uncertainty error and projects duplicate results once without deleting saved rows.
Foreground terminal outcomes survive canonical projection and reload. The parser
rejects absent/conflicting IDs and unfinished calls at `[DONE]` or transport EOF,
and keeps each choice's termination independent.

The browser provider validates matching call/result history. Coordinator receipts
retain all attempts across worker restarts; a deliberate flaky canary verifies
aggregation before the foreground lane runs. Evidence screenshots identify their
retry and worker. Synthetic provider results never become visible message cards.
Harness navigation waits for database/history loading before enabling another
switch, and browser cases verify the selected conversation before recovery.

Post-review validation: 24 foreground browser cases, 9 authenticated Cloud cases,
273 focused source tests, 6,146 core tests (one pre-existing skip), receipt
worker-restart canary, application type-check, changed-file lint and documentation
checks. Initial qualification also passed 16 existing tool-card cases and
38 release-policy tests.
Browser evidence is emitted under `test-results/chat-tools` and
`test-results/chat-tools-cloud`; CI and candidate qualification require both lanes.

Convex, multi-instance job storage, server-restart qualification and the live-model
smoke checklist remain separate deployment/provider qualification work. No live
provider requests were used for this deterministic qualification.
