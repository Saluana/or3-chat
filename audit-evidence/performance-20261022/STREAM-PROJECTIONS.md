# Section 17: stable streaming projections and bottom controls

Baseline: `3ffca670`. After eliminating settled lazy-wrapper updates, the active
message still updated roughly twice per delivered chunk. Production diagnostics
showed that half of those updates had identical top-level message fields.

## Finding and repair

Foreground intake immediately updates the controller's cumulative text and
reasoning for persistence, hooks, tools, and finalization. The display accumulator
publishes its buffered text on animation frames. `ChatContainer` spreads the
controller tail and overlays the accumulator's displayed text/reasoning. Updating
the controller tail therefore created a fresh display object even when that
overlay left every displayed field unchanged; the next accumulator frame created
another object.

The computed projection now compares its complete own-key set and shallow field
values with its previous result, returning the previous projection when they
match. It still reads every dependency before comparison. Changed text,
reasoning, identity, and metadata produce a new projection; nested reactive
metadata remains reactive. Finalization still returns the controller's terminal
message directly. No intake, persistence, hook, accumulator scheduling, or
terminal-state policy changes, and no independent cache or registry is added.

Qualification exposed a second rendering defect in the same container. Its
scroll-to-bottom control used the DOM pixel gap even while `or3-scroll` reported
`isAtBottom: true`. Growing rich content can temporarily make the DOM height lead
the virtual height measurement, exposing the control for a frame. The control now
requires the scroller to report that it is away from the bottom; opacity is zero
at bottom and otherwise retains the existing distance-based fade, clamped at zero.
This reuses existing viewport state and does not change the scroll algorithm.

The existing control regression supplies a six-pixel gap with `isAtBottom: true`.
Its exact opacity assertion fails before the repair (`0.04` instead of `0`) and
passes afterward with `display: none`. Its existing upward-browsing cases still
require opacity 1 at 500 pixels and 0.5 at 75 pixels. An early diagnostic assertion
used a substring that also matched `0.04`; it is not counted as regression proof.

An intermediate same-build browser control disabled only projection reuse in
the served bundle. The following pane's button was exposed for two sampled
frames at opacity 0.0373 without reuse and four frames at maximum opacity 0.1706
with reuse. A further diagnostic sampled the scroller's exposed state: both
observed pulses occurred while it reported bottom. The browsing pane's control
remained at opacity 1 throughout. These are computed-style rAF observations,
not a complete painted-frame capture. Original receipts are retained in
[projection-scroll-control-baseline.json](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/audit-evidence/performance-20261022/projection-scroll-control-baseline.json).

After both repairs, three diagnostics record zero visible frames and zero style
writes on the following pane's control across 126 / 123 / 126 sampled frames.
The browsing pane remains visible at opacity 1 in every corresponding frame.
The first run also contains the message-update instrumentation described below.
The other two omit it. These controls establish the measured visibility behavior,
not a frame-time improvement or exhaustive painted-frame coverage.

## Production update counts

The concurrent-pane probe uses two real controllers, 120 synthetic history
messages each, and two synchronized synthetic SSE streams delivering 64-character
chunks every requested 16 ms. The left pane browses retained history while the
right follows its response. Prose is about 10.5 KB per reply. Rich output is about
3 KB with 12 TypeScript fences and 12 standalone double-dollar formulas;
single-dollar examples remain literal text.

Environment: fresh bundled Chromium 153.0.8010.12 contexts, headless, Blank/light
at 90% scale, 1440 × 900, DPR 1, 4× main-thread CPU throttling. External requests
are blocked. No build, typecheck, or other browser runner overlaps measurements.
CPU throttling does not equivalently throttle the syntax worker.

| During transport | Prose before | Prose after | Rich before | Rich after |
| --- | ---: | ---: | ---: | ---: |
| Active message updates | 329 | 165 | 94 | 46 |
| Updates with identical message fields | 165 | 0 | 47 | 0 |
| Both panes' scroller row-content revisions | 660 | 332 | 189 | 95 |

After the change, each observed active-message update carries changed text.
Finalization still updates the pending state. Different scheduling can combine
chunks into one frame, so the meaningful comparison is removal of identical
projections, not an exact transport-chunk/render ratio. Settled message bodies
and both editors retain the behavior established in section 16 during transport.
History delivery and finalization still cause component updates afterward; this
section does not claim to eliminate that work.

`tailAudit:true` extends the section 16 owned Vue hooks with raw shallow snapshots
of message fields. It records field-change names, equal-field counts, and up to
12 length-only samples per initially mounted message. It does not record new
instances mounted after instrumentation or deeply compare nested data. Hooks
and listeners are removed after observation and the disposable context is closed.
These diagnostic runs are not used for clean timing claims.

All before/after diagnostics save both replies exactly, preserve their own left
reading anchor and scrollTop, finish the right pane at bottom distance zero, and
reveal the left end marker using its normal control. Completed rich nodes remain
connected with zero recorded mutations. The four observed settled-message DOM
mutations re-enable Retry controls after transport, as before.

## Timing limits

Separate timing runs omit the Vue component counters and CPU/timeline profiling,
while retaining the probe's frame, DOM, and indexed-read observations. Three
prose/rich pairs ran before rebuilding, followed by three pairs after rebuilding.
They are not interleaved same-build controls.

| 4× CPU, per run | Before | After |
| --- | --- | --- |
| Prose p95 frame interval (ms) | 16.8 / 16.7 / 16.8 | 16.8 / 16.8 / 16.8 |
| Prose maximum interval (ms) | 66.5 / 50.0 / 66.7 | 83.4 / 99.9 / 50.0 |
| Prose long tasks | 1 / 1 / 2 | 1 / 1 / 1 |
| Rich p95 frame interval (ms) | 33.4 / 33.3 / 33.4 | 33.3 / 33.4 / 33.4 |
| Rich maximum interval (ms) | 83.4 / 116.6 / 83.4 | 66.6 / 66.7 / 66.6 |
| Rich long tasks | 3 / 3 / 4 | 3 / 2 / 3 |

The reliable result is less component work, not a demonstrated recurring
frame-time improvement. Maximum intervals vary; the final prose samples include
83.4 and 99.9 ms intervals, worse than the measured baseline maxima. A
normal-speed rich after-only control records p95 and maximum 16.8 ms with no
long tasks. These results do not establish stutter-free rich streaming.
All 19 baseline/final runs pass the saved-text and scroll-integrity
checks; completed rich nodes remain connected with zero recorded mutations.
Final receipts are in [projection-results.json](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/audit-evidence/performance-20261022/projection-results.json).
The earlier projection-only qualification is retained separately in
[projection-reuse-results.json](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/audit-evidence/performance-20261022/projection-reuse-results.json); its timing
samples are not mixed into the final table.

## Regression and reproduction

The canonical real-scroller component regression now performs both stages of
each chunk: immediate controller-tail update, then accumulator publication.
It fails on the baseline with six row-content revisions for three text changes;
the repair produces three revisions and three updates at both lazy and resolved
renderer boundaries. Existing coverage still protects same-length replacements,
reasoning, finalization, cancellation, and history identity. The existing tool
metadata case also checks nested status changes and field removal. All 22
ChatContainer tests pass.

Production build and application typecheck pass. The typecheck uses installed
Basic Auth/SQLite/Filesystem providers and a disposable placeholder secret.
Audit-script lint passes; the repository's lint configuration ignores Vue and
test files, so it provides no validation of those files.

All nine Chromium scroll canaries pass. Eight existing production Chromium
journeys pass: rich responsive rendering/edit cancellation across Blank, Retro,
and Cyberpunk; stream/reload; partial-output stop/reload; continuation stop;
workspace search/read navigation; and durable native-document tool creation.
These tool journeys check functionality, not tool-stream performance. Local
artifacts are under `test-results/projection-final-scroll/` and
`test-results/projection-final-journeys/`.

Three WebKit production journeys also pass on the final build: stream/reload,
partial-output stop/reload, and continuation stop. These are functional checks;
`PW_TEST_SCREENSHOT_NO_FONTS_READY=1` bypasses the screenshot font-ready wait, so
they do not qualify fully settled font rendering. Local artifacts are under
`test-results/projection-final-webkit/`.

Start the established production journey/scroll harness on port 3147, then run:

```sh
bunx tsx audit-evidence/performance-20261022/run-concurrent-pane-probe.mjs '{"tailAudit":true,"synchronized":true,"cpuRate":4}' /tmp/projection-prose.json
```

Add `rich:true` for code/math diagnostics and `scrollControlAudit:true` for
computed control opacity, style writes, and exposed bottom-state observations.
Omit both diagnostic flags for timing runs and use `cpuRate:1` for normal speed.
The runner owns its browser, resets throttling,
blocks external requests, and enforces a 90-second watchdog. Baseline receipts
are in [projection-baseline.json](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/audit-evidence/performance-20261022/projection-baseline.json).

This section does not qualify every painted frame, background transports,
physical devices, generated-image streaming, or tool-heavy stream performance.
The large wheel-jump gaps and intermittent WebKit reload/import error from
sections 15 and 16 remain open audit work.
