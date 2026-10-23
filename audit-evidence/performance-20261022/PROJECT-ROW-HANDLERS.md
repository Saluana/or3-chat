# Section 10: retained project pin buttons and full-list endpoints

Baseline: `07b23e45`. The earlier short-wheel measurements left the full project
and model endpoints unverified and project scrolling still produced long tasks
under CPU slowdown. This section extends the existing production probe to reach
both ends of each 600-entry synthetic list, then removes a measured source of
unnecessary work in retained project rows.

## Finding and repair

The current production profile again identified Nuxt UI's `pickLinkProps()` as
the leading named JavaScript function during project scrolling. This function
enumerates a component's reactive props before forwarding link attributes.
The profile alone did not justify replacing the library or its behavior.

The project virtual slot constructed a new pin-button click callback whenever
its render window changed. Nuxt UI declares `onClick` as a prop, so retained
buttons received changed props and repeated the forwarding work even though
the project and pin state were unchanged. The callback now belongs to the
existing computed project-row projection. It stays stable during scrolling,
is rebuilt when the list data/filter changes, and invokes the existing `run()`
and `pin()` owners. No extra cache, registry, new component or dependency patch
is introduced.

A separate diagnostic instruments only the actual profiled link-prop helper
in a disposable browser response. It recognizes the project pin button's class
and records which prop objects were present before scrolling. For the same
20 wheel events, calls fell from **2,178 to 304**, and calls on initially mounted
buttons fell from **150 to zero**. The checked-in optional probe mode reproduces
the final 304/0 result. It is a revision-specific diagnostic, not shipped code
or a source-text assertion in the test suite.

## Full-list production measurements

`catalog-project-scroll-probe.js` now accepts `fullTraverse: true` and `runs`.
Each direction sends 600 px native wheel gestures 80 ms apart until the viewport
is within 1 px of the endpoint for three consecutive checks, bounded at 150
gestures. It records endpoint rows, geometry, frame intervals and long tasks.
Endpoint geometry reads add some diagnostic overhead; both sides use the same
probe. No build or test runner runs concurrently with measurements.

Contexts are fresh Chromium, Blank/light at 90% scale, 1200×689, DPR 2. External
requests are blocked. There are 600 seeded projects plus the fixture's existing
synthetic project, and 600 seeded models. The project viewport is 552 px with
about 30 mounted rows; the model viewport is 415 px with about 15 mounted rows.

| Project full down/up traversal | Before | After |
| --- | --- | --- |
| Wheel events | 78 | 78 |
| 4× CPU frame p95 (ms) | 42.7 | 35.0 |
| 4× CPU maximum frame interval (ms) | 51.7 | 48.7 |
| 4× CPU long tasks | 16 | 1 |
| Normal CPU frame p95 (ms) | 10.0 | 9.3 |
| Normal CPU maximum frame interval (ms) | 25.1 | 16.8 |
| Normal CPU long tasks | 0 | 0 |

Both project passes reach the bottom, show the final seeded project and fixture
project, then return to scrollTop zero with project 599 at the top. After the
full traversal, the project track stabilizes at 22,492 px. The initial
28,573 px estimate converges as rows are visited; the earlier short pass had
only converged to 26,846 px. This is consistent with height-measurement refinement;
the endpoint receipts alone do not establish that every intermediate row painted.

The model audit, which required no change in this section, reaches model 599 and
returns to model 000 in 132 wheel events. It records zero long tasks at both CPU
rates; p95 is 32.6 ms at 4× and 15.2 ms at normal speed. Its final measured track
is 38,420 px, also below the initial estimate. All endpoint checks succeed.

These tables contain one complete traversal per case, not repeated-run medians.
The eliminated repeated prop work is the strongest causal evidence; timing
differences are local samples. A 35 ms slow-device p95 and one remaining long
task do not establish stutter-free behavior. Full endpoints do not prove that
every intervening frame was free of blank space, and these checks do not cover
touch devices, all themes, concurrent streaming or the other scrollers.

## Validation and reproduction

- Eight production checks pass: project card padding and keyboard activation,
  pin/unpin without unintended navigation, navigation while pin storage is
  pending, project management/draft/rename/delete behavior, and virtual sidebar
  recycling in three themes × light/dark appearance.
- A separate browser action scrolls back to recycled project 000, pins it, then
  returns to the top and observes that same project's Unpin button and pinned
  heading. The callback still addresses the correct project after recycling.
- Production build, application typecheck, changed-file lint and diff checks
  pass. Existing functional suites cover the action contract; the performance
  diagnostic records the extra work directly without a new production seam.
- Raw baseline/profile/helper counts and final receipts are in
  `project-row-handlers-baseline.json` and `project-row-handlers-results.json`.

Run the shared probe in the disposable local preview with
`{ cpuRate: 4, fullTraverse: true, runs: 1 }` for endpoint measurements, or
`{ cpuRate: 1, fullTraverse: true, runs: 1 }` for the normal-speed control.
For the final revision's diagnostic, use
`{ cpuRate: 4, runs: 1, surfaces: ['projects'], pinProps: { bundle: 'DVf7XaQA.js', helper: 'Yc' } }`.
The baseline diagnostic used `C44GSYWi.js` and the same helper. A new build can
rename these; profile and inspect its actual helper before supplying new values.
Instrumented timings are deliberately separate from the production table.

No external publication or deployment was performed for this section.
