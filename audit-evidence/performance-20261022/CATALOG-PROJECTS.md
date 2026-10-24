# Section 4: project and model list mount work

Baseline: `3d90841d`. These are the remaining two `Or3Scroll` component
consumers after ChatContainer, SidebarHomePage and SidebarTimeGroupedList.
Measuring each consumer does not establish that all scrollers are smooth.

## Changes

- Project action menus initialized a popover for every virtual row, even if
  never opened. Like chat/document rows, they now initialize it on first use
  and retain it for that row's lifetime. Native keyboard activation, disabled
  state, menu dismissal and Reka focus restoration remain available.
- Model cards format prices for both responsive layouts. Each call constructed
  a new `Intl.NumberFormat`, totaling 716 constructions during each short scroll
  run. `formatPerMillion` now lazily retains one USD formatter. Non-USD currency
  arguments keep the existing behavior; there is no unbounded currency cache.

## Evidence

`catalog-project-scroll-probe.js` creates a fresh disposable browser context,
seeds 600 projects and 600 synthetic models, blocks external requests and
measures three down/up passes for each list. Each pass contains ten +600 px and
ten -600 px wheel events, separated by 80 ms. Sampling is bounded and cleans up
its observer, frame callback, timer and temporary formatter instrumentation.

The recorded production environment is Chromium, Blank/light, 90% scale,
1200×689 at DPR 2, with 4× CPU throttling. Project viewport: 552 px, 30 mounted
rows. Model viewport: 415 px, 15 mounted rows. Passes two and three revisit the
same measured range; they are not independent cold starts. These gestures do
not traverse all 600 entries or qualify the endpoint of either list.

| Measurement, runs 1 / 2 / 3 | Before | After |
| --- | --- | --- |
| Project frame interval p95 (ms) | 83.4 / 75.0 / 76.4 | 74.9 / 73.5 / 66.9 |
| Project maximum frame interval (ms) | 101.6 / 76.7 / 84.4 | 116.4 / 76.5 / 68.1 |
| Project long tasks | 23 / 19 / 19 | 22 / 19 / 19 |
| Model frame interval p95 (ms) | 58.4 / 56.8 / 56.8 | 57.8 / 50.7 / 50.8 |
| Model maximum frame interval (ms) | 65.3 / 60.3 / 66.7 | 58.7 / 59.4 / 83.4 |
| Model long tasks | 3 / 4 / 2 | 0 / 1 / 1 |
| Model currency formatter constructions | 716 / 716 / 716 | 0 / 0 / 0 |

Project median p95 improved about 4%; model median p95 improved about 11%.
The construction reduction is deterministic in these receipts. Timing is
variable, and maximum-frame samples did not consistently improve. Project
scrolling still produces many long tasks. Model USD formatting initializes
before the sampling window; zero means no additional constructions while
scrolling, not that the app never creates a formatter.

The final project run's first pass stopped 2.5 px from the top after native
wheel input while measured heights changed; later passes returned to zero.
The measured track remained 26,846 px. Model passes returned to zero with the
same 42,348 px track. This is observation, not an assertion of perfect anchoring.

`catalog-project-results.json` holds the comparable before/after receipts.
`catalog-project-baseline.json` is the earlier exploratory run without formatter
instrumentation and is not substituted for the table's baseline.

## Validation and remaining work

- Production build, application typecheck, changed-file lint and diff checks
  pass. Repository lint excludes Vue/test files, which use executable checks
  and typecheck.
- Existing model-catalog utility suite: 35 tests pass, including price formatting
  and malformed/unknown values.
- Existing project management browser journey passes, extended to cover first-use
  Enter activation, expanded state, Escape restoration and Space reopening. The
  same journey then renames a project beyond Home's shortcut limit, preserves and
  saves its draft, and deletes through the project header menu.
- No new production test seam, dependency, public API or release change.
- These measurements use one desktop theme/mode and synthetic data. Project/model
  touch input, theme matrix, search/selection under scrolling, full endpoints and
  richer model distributions still need qualification. Continued traces should
  focus on remaining mount/style/layout and hover-transition costs.

No deployment or external publication was performed for this section.
