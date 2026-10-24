# Section 15: painted coverage across the five host scrollers

Baseline and measured production build: `a0d04849`. No application change is
retained in this section. The final small-step wheel and native touch matrix
contains 1,880 captured frames with no detected gaps. Large instantaneous wheel
jumps still expose blank regions, including in a static control with every row
mounted. That behavior remains unresolved; increasing overscan or changing the
scroll scheduler was not supported by the experiments.

## Final coverage matrix

The final matrix uses fresh, local-only contexts in bundled Chromium
153.0.8010.12, headless, at 1200 × 800, DPR 1, Blank/light and 90% zoom. Each
context seeds 600 conversations, 600 projects, 600 model cards, and 240
variable-height prose messages in one conversation. Model responses are local
fixtures; external requests are blocked.

Wheel sequences send 18 native wheel events of 120 pixels in each direction,
with a requested 16 ms interval after each awaited event. This is not an exact
16 ms input cadence. Touch sequences use three gestures in each direction,
each made of 16 native CDP touch moves, a 16 ms requested interval, and a 100 ms
hold before release to limit fling. Gesture distance is bounded by the visible
scroll area: 449–600 pixels. Touch is emulated on the desktop layout.

| Surface | Wheel 1×: captured frames | Wheel 4×: captured frames | Touch 4×: captured frames | Detected gaps |
| --- | ---: | ---: | ---: | ---: |
| Sidebar Home | 133 | 143 | 211 | 0 |
| Sidebar Chats / time-grouped list | 108 | 118 | 208 | 0 |
| Projects | 84 | 86 | 170 | 0 |
| Model Catalog | 111 | 123 | 138 | 0 |
| Chat history | 63 | 65 | 119 | 0 |

All 15 sequences returned to scrollTop 0. All positive controls had 100% marker
coverage and all negative controls had 0%. No sequence reached the probe's
500-frame retention limit. The sidebar sequences include loading another page
of conversations. Their existing `loading` state only covers an empty list;
the suspected pagination overlay flash was not reproduced.

Raw results: [scroll-paint-results.json](scroll-paint-results.json).

## Large-jump comparison

A fresh comparison uses installed Chrome 155.0.8059.85, headed, 4× main-thread
CPU throttling, and 18 wheel events of 600 pixels in each direction. Both cases
use the same production build and capture method. The static control clones
600 existing row DOM subtrees into a normal-flow list, detaches the original
Vue-owned scroller root, and has no virtual-range updates or framework scroll
handlers.

| Projects case | Captured frames | Frames with a missing run over 8 px | Largest missing run |
| --- | ---: | ---: | ---: |
| Production virtual list | 109 | 17 | 414 px |
| Static 600-row control | 77 | 8 | 418 px |

The worst frames were inspected visually. Both show a blank lower region after
the first large wheel movement. The static result establishes that virtual
range updates are not necessary to produce this symptom in this environment.
It does not establish the entire cause or exclude a contribution from the
virtualizer in other frames.

Raw comparison: [scroll-paint-comparison.json](scroll-paint-comparison.json).
Representative PNGs remain local under `.playwright-mcp/paint-final-large/`.

Earlier same-build controls are retained in
[scroll-paint-diagnostic.json](scroll-paint-diagnostic.json) and
[scroll-paint-controls.json](scroll-paint-controls.json). These explored:

- Computing the range immediately in the scroll listener instead of waiting
  for its scheduled callback: gaps persisted.
- Doubling overscan: initial project rows increased from 33 to 50 and a middle
  window from about 51 to 84, without eliminating captured gaps.
- Removing the slice's `will-change: transform`, positioning it with `top`,
  adding `will-change: scroll-position`, and forcing body zoom to 100%: none
  reliably removed the symptom.
- A geometry trace showing a rendered slice extending past the viewport while
  a nearby compositor capture still exposed a blank region.

These are diagnostics, not clean timing comparisons. No speculative CSS,
overscan increase, or scheduler patch is retained. The initial diagnostic run
included one stale frame from its deliberately hidden negative control; it is
flagged in that receipt and excluded from the final results above.

## What the probe establishes

`scroll-paint-probe.js` adds a four-pixel magenta pseudo-element down each
rendered row, without changing row dimensions. It records best-effort CDP
screencast PNGs, acknowledges them promptly, and checks one vertical pixel
column after scrolling finishes. The scan excludes edge padding and the chat
composer area. Each run first captures a settled positive control and then a
negative control with the slice hidden. Failed calibration rejects the run.

The marker and capture machinery affect painting, so this is separate from the
clean frame-time and long-task measurements in earlier sections. It checks
painted row-container coverage in the captured samples, not every displayed
frame, text opacity, or every pixel of a card. Zero detected gaps is not a
universal smoothness guarantee. CPU throttling affects the main thread and
does not reproduce a uniformly slower GPU or device.

The first analyzer allocated a full-size canvas per image and transferred all
PNGs in one browser call. Larger runs lost their renderer during analysis.
The final version reuses a one-pixel canvas and transfers eight images at a
time. Incomplete runs are excluded. A synthesized scroll-gesture attempt also
timed out and is excluded; the successful touch matrix uses explicit native
touch events. Chat calibration initially caught unsettled startup geometry;
the final probe waits for loaded history, the editor, and fonts before sampling.

## Reproduction and validation

Use the production journey/scroll harness preview on port 3147 described in
the preceding sections. The runner creates and closes its own browser and
disposable contexts:

```sh
bunx tsx audit-evidence/performance-20261022/run-scroll-paint-probe.mjs '{"surface":"projects","delta":120,"cpuRate":4}' /tmp/paint-projects.json
bunx tsx audit-evidence/performance-20261022/run-scroll-paint-probe.mjs '{"surface":"chat","input":"touch","steps":3,"delta":600,"cpuRate":4}' /tmp/paint-chat-touch.json
```

Supported surfaces are `home`, `chats`, `projects`, `models`, and `chat`.
Use `headed: true, channel: "chrome"` for the installed Chrome comparison,
`staticRows: true` for its static control, and `outputDir` to retain inspected
PNG controls and worst-frame neighbors. The runner has a 90-second execution
watchdog. The probe can also run through the browser tool's filename wrapper.

Validation consists of the 15 final coverage sequences and the two large-jump
controls, visual inspection of representative frames, and diff inspection.
Application code, packages, patches, types, and public contracts are unchanged,
so no application build or unit-test rerun was needed for this section.

Still open: actual mobile devices and inertia, WebKit painted-frame coverage,
rich/image-heavy history, hidden/restored panes, longer traversals, and the
large-jump blank regions. Earlier anchor and full-list endpoint canaries remain
separate evidence; they do not fill those gaps.
