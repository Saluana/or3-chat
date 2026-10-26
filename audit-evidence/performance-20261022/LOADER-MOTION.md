# Section 20: composite the generating loader scan

Baseline: `fd2325ff`. While a request waits for its first text, the Retro and
Cyberpunk loaders animate the scan gradient's `background-position-y`. This
repaints the decoration continuously even when the conversation DOM is idle.

## Finding and repair

The production workspace probe submits through the real composer/controller,
holds its disposable SSE response before the first token, then supplies one
partial reply and holds again. Each phase settles for 300 ms and records two
seconds of animation-frame intervals, DOM mutations and, in Chromium, timeline
events. The partial phase removes the loader while leaving generation active.
External requests are blocked; no real provider or user profile is involved.

| Chromium waiting state, 4× main-thread CPU | Baseline Paint events / duration | Transform control | Rebuilt source |
| --- | --- | --- | --- |
| Retro | 240 / 29.5 ms | 0 | 0 in three runs |
| Cyberpunk | 242 / 35.8 ms | 0 | 0 in two runs |
| Blank (scan decoration hidden) | 0 | Not needed | 0 |

`LoadingGenerating.vue` now translates the existing scan layer from 0 to 8 px
instead of moving its background. Extending the layer upward by two 4 px stripe
periods keeps the existing clipped loader covered through the full cycle. The
visible loader dimensions, five-second duration, opacity, gradient, blending,
and reduced-motion rules are preserved. Chromium reports an accelerated
transform animation for this layer. Its observed Retro backing layer grows
from 696 × 58 to 696 × 66 px; this trades a slightly larger layer for avoiding
repeated paints. No permanent `will-change` hint or JavaScript loop is added.

Baseline, control and final waiting/partial phases record zero pane DOM
mutations. Their Chromium p95 remains about 16.7–16.8 ms. The partial phases
already have zero Paint events before the change. This establishes removal of
avoidable paint work, **not a measured frame-rate improvement**. Composited
animations still have style/prepaint bookkeeping in the trace; zero Paint
events does not mean zero CPU or GPU work. Trace duration categories may overlap.

The preceding rich-stream diagnostic also tried disabling the workspace tab's
opacity pulse. It removed animation-related style invalidations but left p95
at 33.4 ms and recorded paint time essentially unchanged. That pulse is already
accelerated, so it remains intact. Both rich diagnostics preserve exact saved
replies, reading anchors, tail following and completed rich nodes. They are
diagnostic traces, not clean timing samples.

Baseline/control receipts, including the tab-pulse comparison, are in
[loader-motion-baseline.json](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/audit-evidence/performance-20261022/loader-motion-baseline.json).

## Appearance and browser checks

On the unchanged build, the probe pauses the original and temporary transform
control at five matching cycle positions (0, 25%, 50%, 75%, 99.9%). Four cases
cover Retro and Cyberpunk on desktop and at 320 × 640, with the Cyberpunk phone
case in dark mode. All 20 screenshot pairs retain identical dimensions and are
pixel-identical at cycle start. The largest channel difference over the other
positions is 2/255 for Retro, 3/255 for desktop Cyberpunk and 4/255 for dark
phone Cyberpunk. At most 3.64% of pixels differ by more than 2/255 in any channel;
maximum mean RGB-channel difference is 0.267/255. These are small raster and
compositing differences, not byte-identical output through the cycle. The
inspected control screenshots show readable text and continuous clipped fill.
Visual-control runs are excluded from the table's baseline timing comparison.

Eight rebuilt Chromium runs cover three Retro, two Cyberpunk, Blank, Retro
reduced motion and Cyberpunk dark phone contexts. All 16 measured phases have
zero Paint/Layout events, zero pane mutations, no recorded long tasks, p95
16.7–16.8 ms and maximum interval 16.8 ms. Geometry sampling finds no uncovered
loader edge at any of the five scan positions. Blank correctly hides the scan.
Reduced-motion measurement has no running loader or tab loops.

Three WebKit 26.6 runs cover Retro desktop, Cyberpunk dark phone and Retro
reduced motion. All finish with the expected text, preserve scan coverage and
record zero pane mutations. Their p95 is 19 ms; maximum is 19 ms except for one
23 ms reduced-motion interval. WebKit has neither CDP trace/CPU throttling nor
long-task entries in this probe: empty trace arrays and null long-task lists
are unavailable measurements, not proof of zero paints or tasks. The existing
`PW_TEST_SCREENSHOT_NO_FONTS_READY=1` workaround is enabled, so screenshots do
not qualify font readiness. Viewed desktop and phone screenshots show the
loader correctly clipped. These are desktop WebKit viewport checks, not
physical Safari/iPhone qualification.

The reduced-motion WebKit run has no loader/tab loops; its initial animation
snapshot also records short unrelated font-size and scrollbar-color
transitions, absent by the partial phase. The existing global reduced-motion
policy permits 100 ms state transitions. This section does not qualify all
startup motion or change that policy.

Final receipts are in [loader-motion-results.json](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/audit-evidence/performance-20261022/loader-motion-results.json).
Visual pairs remain locally under `/tmp/activity-scan-visual/`; final WebKit
screenshots are under `/tmp/activity-scan-final/`.

## Validation and reproduction

The production build, targeted probe lint and `git diff --check` pass. Five
existing Chromium production journeys pass: responsive rich content/touch
editing in Blank, Retro and Cyberpunk, stream/reload persistence, and stopping
with only accepted partial text persisted. No new unit test or application
typecheck was added for this CSS-only application change. The browser evidence
exercises the actual loader rather than asserting CSS source strings.

Logs: `/tmp/activity-motion-build.log`, `/tmp/activity-motion-lint.log` and
`/tmp/activity-motion-journey-tests.log`. Browser artifacts are under
`test-results/loader-motion-journeys/`.

With the established local production harness preview on port 3147:

```sh
bunx tsx audit-evidence/performance-20261022/activity-motion-probe.mjs '{"theme":"retro"}' /tmp/activity.json
PW_TEST_SCREENSHOT_NO_FONTS_READY=1 bunx tsx audit-evidence/performance-20261022/activity-motion-probe.mjs '{"browser":"webkit","theme":"cyberpunk","mode":"dark","viewport":{"width":320,"height":640},"screenshots":"/tmp/activity-webkit"}' /tmp/activity-webkit.json
```

Contexts use DPR 1 and 1440 × 900 unless overridden. Chromium defaults to 4×
main-thread CPU throttling; WebKit runs at normal speed. Optional `cssControl`
and `compareScan` are disposable diagnostics. Run `compareScan` against the
baseline build to compare the original animation with the transform control;
running it on the repaired build compares the repair with itself.

The broader audit remains open for recurring rich-stream cost, large wheel-jump
paint gaps, tool/image streams, unrelated startup transitions, the intermittent
WebKit reload/import error and physical-device coverage.
