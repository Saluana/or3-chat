# Section 19: styles before the first math reply

Baseline: `0a558f49`. The remaining rich-stream investigation exposed a separate
first-render flash. `ChatMessage` rendered KaTeX markup immediately but waited
for an idle callback to import its stylesheet. A reply beginning with display
math therefore exposed both unstyled markup and a later geometry change.

## Finding and repair

In a fresh local production context at 4× main-thread CPU throttling, the first
formula had no math styles for three consecutive animation-frame samples. Its
observed height changed from 18 to 22 px when styling arrived about 83 ms after
the first sample. These are DOM/style observations at animation frames, not a
pixel-by-pixel filmstrip. The probe's `mathPaints` field contains
these frame samples.

A same-build control loads the exact existing stylesheet before sending. All
20 formula samples are styled. The new production browser regression delays
the actual stylesheet response by 200 ms, exercises the real chat/controller
path, verifies durable reply text, and records formula styling each frame.
It fails on the unchanged build with 14 unstyled samples, then passes on the
repair with zero. The first exploratory test used a network route that the
journey's in-page transport bypasses; that failure is not the regression proof.

The shared lazy `stream-markdown.ts` module now imports the required CSS as a
dependency. Vite waits for the lazy module's stylesheet before mounting its
renderer. `ChatMessage` no longer scans every text revision for math or creates
per-row idle callbacks. Chat, Documentation, and Help share the same styling
boundary, without a new loading registry or persistent state.

Empty chat still loads neither the renderer's math stylesheet nor its markup;
the browser regression verifies this before sending. Opening a Markdown surface
now loads 29.36 kB of CSS (7.99 kB gzip in this build) even for prose-only content.
This is a deliberate first-render correctness tradeoff, not a transfer-size
reduction. Font files remain requested according to browser font use. A font
swap can still change glyph metrics; this section does not prove every font is
ready before the first frame.

## Remaining layout diagnosis

The local probe gained opt-in geometry-call timing and layout trace context.
The geometry wrapper belongs only to the disposable browser context, restores
native descriptors at the end, and records element classes and call stacks,
not message content. Its overhead means those runs are diagnostic, not clean
frame-time comparisons.

The instrumented rich stream observed about 52–55 ms across roughly 900
`scrollTop` reads, with the slowest individual read around 3–3.5 ms. The trace
still contained roughly 228–261 ms of layout work during transport. These
observations did not justify removing the scroller's geometry reads. Trace
categories can overlap and are not additive independent CPU totals.

Font-related invalidations cluster around the initial math stylesheet rather
than continuing throughout the stream. Inline-size containment and layout/style
containment around code blocks leave rich p95 around 33.4 ms and do not
establish a speedup. They remain disposable controls; no containment change is
part of the repair. The inline-size control also changes initial history layout.

All seven retained diagnostics/controls preserve exact saved replies, the left
reading anchor, right bottom distance zero, final-marker navigation, and
completed rich nodes without mutations. Receipts are in
[first-math-baseline.json](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/audit-evidence/performance-20261022/first-math-baseline.json).

## Final qualification

Production build, application typecheck, targeted renderer/probe lint, and 32
existing renderer/container/worker tests pass. Nine Chromium and six WebKit
production journeys pass, including the new first-math regression, responsive
rich content in Blank/Retro/Cyberpunk, and stream/reload/stop persistence.
Chromium also covers code actions, unavailable-worker fallback and continuation.
WebKit uses the existing `PW_TEST_SCREENSHOT_NO_FONTS_READY=1` workaround; those
passes do not qualify font-ready screenshots or physical devices. This subset
does not exercise the previously intermittent compaction-navigation import error.

Three rebuilt 4× first-math runs and one normal-speed run have zero unstyled
formula samples out of 80 total. The Chromium delayed-stylesheet regression
records three styled samples; WebKit records four, also with zero unstyled.
The viewed Chromium screenshot shows one readable formula and the completed
reply. A separate fresh-context check of the normal `/chat` welcome page also
finds zero math stylesheets among 11 stylesheet requests after the composer and
welcome are visible plus a 500 ms settling window.

| Rebuilt-source workload | p95 frame interval (ms) | Maximum (ms) | Long tasks |
| --- | --- | --- | --- |
| First-math rich, 4×, three runs | 33.4 / 33.4 / 33.4 | 66.6 / 50.0 / 50.1 | 0 / 0 / 1 |
| Original rich, 4×, two clean runs | 33.4 / 33.3 | 83.3 / 49.9 | 1 / 1 |
| Prose, 4×, one clean run | 16.8 | 83.3 | 0 |
| First-math rich, normal CPU | 16.7 | 16.8 | 0 |

The first-math runs include bounded frame/style sampling; the clean runs omit
it. These are after-only qualifications, not matched speedup evidence. Rich p95
remains about 33.4 ms, and completion can still contain long intervals (including
a 50 ms completion p95 in one first-math run). All seven final runs preserve
saved text, anchors, tail following, navigation, and completed rich nodes.
Receipts, browser regression observations and the normal empty-chat check are in
[first-math-results.json](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/audit-evidence/performance-20261022/first-math-results.json).

Local browser artifacts are under `test-results/first-math-journeys/` and
`test-results/first-math-webkit/`, including `first-math-frames.json` and
`first-math-styled.png`. Qualification logs are `/tmp/first-math-build.log`,
`/tmp/first-math-typecheck.log`, `/tmp/first-math-unit-tests.log`,
`/tmp/first-math-journey-tests.log`, and `/tmp/first-math-webkit-tests.log`.

The existing real-renderer tests remain the owner for math DOM retention,
escaping and code behavior. The new browser regression adds the previously
uncovered stylesheet-delivery boundary; it introduces no production test seam.

## Reproduction and scope

Run the established local production preview on port 3147, then:

```sh
bunx tsx audit-evidence/performance-20261022/run-concurrent-pane-probe.mjs '{"rich":true,"mathFirst":true,"mathPaintAudit":true,"synchronized":true,"cpuRate":4,"phaseAudit":true}' /tmp/first-math.json
```

The probe uses fresh Chromium contexts, Blank/light at 90% scale, 1440 × 900,
DPR 1, two 120-row conversations and synchronized synthetic SSE. External
requests are blocked. The syntax worker is not equivalently CPU-throttled.
`geometryAudit`, `layoutAudit` with `trace`, `cssControl`, and `mathStyleControl`
are optional diagnostic controls, not application settings.

The broader audit remains open for recurring rich-stream cost, large wheel-jump
paint gaps, tool/image streams, the intermittent WebKit reload/import error and
physical-device coverage. This section does not establish universal smoothness
or claim that moving styles solves those independent issues.
