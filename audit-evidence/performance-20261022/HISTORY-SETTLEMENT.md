# Section 18: unchanged presentation rows across canonical refreshes

Baseline: `f38f1bc7`. Profiling the remaining rich-stream cost exposed a separate
pause after transport completion. Canonical history refreshes rebuilt every UI
message object, including unchanged settled rows. A diagnostic observed 101
settled-message updates after transport, all with identical message fields.
Some updates legitimately change Retry and compaction availability; others came
only from a new message-object identity.

## Repair and boundaries

`useChat.replaceCanonicalHistory()` still builds the full canonical/provider
history and derives presentation through `ensureUiMessage()` and the existing
tool-result association helper. It then reuses a previous UI row with the same
ID only when the complete own-key set and every shallow field value match.
Ordering, insertion, and removal follow the new array. The previous-row map is
local to one refresh; there is no persistent cache or second authority store.

Canonical-only metadata still refreshes even when it has no UI consequence.
Changed text, reasoning, errors, attachment references, tools, usage, navigation
metadata, or removed fields replace the affected projection. New object/array
references conservatively replace it too; this is not deep deduplication of
unchanged complex payloads. Nested reactive metadata remains reactive.
Admission, transport, persistence, stale-history guards, and workspace ownership
are unchanged.

## Diagnosis and rejected controls

Two initial CPU/timeline profiles showed recurring layout and HTML insertion
work, with substantial completion work mixed into the original whole-run
metrics. The expanded probe now separates transport, the boundary-spanning
frame/task, and post-transport settlement. Trace phase marks use the first
synthetic chunk and final transport closure; trace category durations can
overlap and must not be added as independent CPU totals.

An owned diagnostic wraps `Element.innerHTML` in the disposable browser realm.
It records assigned-string lengths and repeated assigned inputs, not private
message text. An isolated run observed 36 connected code-body writes during
transport, with zero repeated inputs. This does not establish redundant HTML
replacement. Native accessors are restored at the end and the context is closed.

The existing page-scale selector control left rich p95 at 33.4 ms and did not
remove the recurring layout cost. A second served-bundle control skipped the
scroller's immediate measurement-state read only while following bottom. It
also left p95 at 33.4 ms and layout-event counts essentially unchanged. Neither
experiment is an application change.

One exploratory diagnostic overlapped an unintended full-repository lint. That
lint exhausted its Node heap; the concurrent diagnostic is excluded from timing
claims. The final targeted audit-script lint passes. The isolated diagnostic
and subsequent comparisons run without other test, lint, build, or typecheck
processes.

## Same-build comparison

The history control replaces exactly one matched function fragment in the
served production bundle. It applies the same own-field comparison as the
source repair. The probe asserts one replacement per fetched body and records
two fetched bodies across its initial navigation and reload; baseline has zero.
It never modifies application files or persisted history.

The workload uses two real controllers, 120 synthetic history rows per pane,
and synchronized local SSE delivering 64 characters every requested 16 ms.
Each approximately 3 KB reply has 12 TypeScript blocks and 12 standalone math
formulas. The left pane browses settled history; the right follows the tail.
Fresh Chromium 153.0.8010.12 contexts use Blank/light, 90% scale, 1440 × 900,
DPR 1, and 4× main-thread CPU throttling. External requests are blocked.
The syntax worker is not equivalently CPU-throttled.

The instrumented history pair reduces settled-message updates after transport
from 101 to 56. Remaining updates change Retry/compaction availability. Active
message updates still carry changed text; editor transactions and sidebar DOM
mutations remain zero during transport. Component hooks observe only instances
mounted when measurement starts, not every subsequent mounted row.

Three alternating baseline/control pairs omit component hooks and profiling.
The post-transport phase includes normal completion, saved-history delivery,
the existing Send-control readiness check, and a 500 ms settling window.

| 4× CPU, post-transport phase | Baseline | Reuse control |
| --- | --- | --- |
| p95 frame interval (ms) | 66.6 / 50.0 / 50.0 | 16.8 / 16.8 / 16.8 |
| Maximum frame interval (ms) | 66.7 / 66.7 / 66.6 | 33.4 / 83.3 / 50.1 |
| Long tasks | 2 / 1 / 1 | 0 / 0 / 0 |

This supports reduced completion work, not elimination of every long frame:
one control still has an 83.3 ms interval. Whole-run rich p95 remains about
33.4 ms. The recurring transport/layout cost remains open.

All 13 retained baseline/diagnostic/control runs preserve exact saved replies,
the left anchor and scrollTop, right bottom distance zero, and normal end-marker
navigation. Completed heading, code, and math nodes stay connected with zero
recorded mutations. Receipts are in
[history-settlement-baseline.json](history-settlement-baseline.json).

The rebuilt source, without interception, repeats the rich diagnostic's 56
settled-message updates and zero unchanged-field active-message updates. The
following pane's bottom control stays hidden in all 130 sampled frames, with
zero style writes; the browsing pane's control remains visible throughout.
The prose diagnostic has 53 settled updates associated with action availability,
matching the earlier section's prose count, and no unchanged active updates.

Three final rich runs have post-transport p95 16.8 / 16.8 / 16.7 ms, maximum
50.0 / 50.0 / 83.3 ms, and zero long tasks in that phase. Whole-run p95 remains
33.4 / 33.3 / 33.4 ms; transport still contains long tasks. One final 4× prose
run records p95 16.7 ms, maximum 33.4 ms, and no long tasks. A normal-speed rich
run records p95 and maximum 16.8 ms with no long tasks. These last two are
after-only qualification, not matched speedup evidence.

All seven rebuilt-source runs pass the same saved-text, anchor, navigation,
bottom-distance, and retained-rich-node checks. Final receipts are in
[history-settlement-results.json](history-settlement-results.json).

## Regression and final qualification

The regression extends the existing real-controller integration suite and mounts
Vue row consumers of its actual projections. On the baseline, a canonical-only
index refresh updates both unchanged rows, failing the zero-update assertion.
The repair passes while canonical indices still refresh. The case then checks
reordering/insertion, a same-length text edit, reasoning/tool/attachment changes,
a nested tool-status update, metadata removal, and row deletion.

An early metadata assertion omitted the existing generated-image placeholder
that the real projection appends for assistant attachments. That expectation was
corrected; the demonstrated baseline failure remains the unchanged-row update.

The three relevant suites pass 141 tests. One existing optional integration
requires `OR3_WORKFLOWS_SOURCE` and remains skipped; it is not counted as a pass.
Production build and application typecheck pass, as does targeted source/probe
lint. Nine Chromium scroll canaries, ten Chromium production journeys, and four
WebKit production journeys pass. These cover stream continuation/stop, reload,
partial-stop persistence, and compaction navigation, alongside the Chromium
responsive rich-message and workspace cases.

The WebKit compaction journey again logs `TypeError: Importing a module script
failed.` while its functional assertions pass. This is the previously observed
reload/import issue; this run does not establish its root cause or qualify
error-free navigation. WebKit uses the existing
`PW_TEST_SCREENSHOT_NO_FONTS_READY=1` workaround, so it does not qualify
font-ready visual output. Browser artifacts remain in
`test-results/history-settlement-scroll/`,
`test-results/history-settlement-journeys/`, and
`test-results/history-settlement-webkit/`; logs are
`/tmp/history-settlement-{scroll,journey,webkit}-tests.log`.

## Reproduction and scope

Use the established local production harness on port 3147, then run:

```sh
bunx tsx audit-evidence/performance-20261022/run-concurrent-pane-probe.mjs '{"rich":true,"synchronized":true,"cpuRate":4,"phaseAudit":true}' /tmp/history-settlement.json
```

Add `tailAudit:true` for component/field counts, `domWorkAudit:true` for HTML
assignments, or `trace:true` for timeline categories. Diagnostic runs are not
clean timing samples. `bundleControl` requires an exact observed bundle, needle,
and replacement; stale build identifiers fail instead of silently doing nothing.

This section does not qualify tool-heavy or generated-image streaming, every
painted frame, physical devices, or the previously observed large wheel-jump
gaps and intermittent WebKit reload/import error. Those remain broader audit
work. No external publication or deployment is performed here.
