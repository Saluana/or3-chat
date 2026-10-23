# Section 3: sidebar mount work and pagination admission

Baseline: `61671ffa`, including section 2's minimal `or3-scroll` scheduling
patch. This section changes the app, not the installed scroller.

## Findings and changes

Every newly mounted virtual row initialized a complete popover even if its
actions were never opened. Rows now render the same themed button first and
initialize the popover on first activation. After activation it stays mounted
for that row's lifetime, so Reka still owns closing, transitions and focus
restoration. Workspace-scoped action eligibility and cleanup remain intact.

The pagination composable used its empty-list loading indicator as its
request guard. That indicator stays false when existing rows are visible.
Three bottom events could therefore admit three overlapping pages, growing
50 rows to all 160 fixture rows. A separate pending-page guard now admits one
page at a time without displaying a loading overlay over existing rows. It is
released by the current subscription's result/error and lifecycle cleanup.

## Production measurements

`sidebar-work-results.json` contains all three runs per variant, including
sampled CPU frames. The shared probe uses 160 synthetic threads, twenty native
wheel gestures, 4× CPU throttling, Blank at 90% scale, a 1200×689 viewport at
DPR 2, and a 552 px sidebar viewport. Each run starts with 31 mounted rows.
External requests are blocked. Timing includes profiling overhead.

| Per-run measurement | Baseline | Menu only | Final menu + pagination |
| --- | --- | --- | --- |
| Frame interval p95 (ms) | 74.3 / 76.6 / 75.1 | 60.1 / 67.2 / 67.2 | 66.3 / 66.3 / 66.6 |
| Maximum frame interval (ms) | 102.0 / 291.4 / 107.3 | 82.9 / 90.8 / 91.8 | 84.4 / 92.3 / 90.6 |
| Long tasks | 15 / 20 / 17 | 10 / 14 / 13 | 10 / 12 / 13 |
| Date/time formatting calls | 411 / 572 / 411 | 411 / 411 / 411 | 411 / 411 / 411 |
| Recycled-row entrance animations | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |

Final median p95 improved about 12%, from 75.1 to 66.3 ms. All final runs
returned to scrollTop 0 with the same 5,521 px measured track. These frame
intervals are still slow; this is an incremental improvement, not a claim of
smooth scrolling on all devices. The pagination guard's strongest evidence is
its deterministic regression, not the small timing difference between variants.

One final probe attempt timed out without a result. The disposable browser
became unresponsive to inspection and close commands and was restarted. The
successful final runs used the same persisted profile and recorded dimensions;
no application cause for the timeout was established. The probe now foregrounds
its tab and bounds frame sampling, recording `timedOut: false` on all final runs.

`sidebar-work-exploration.json` records the earlier trace and diagnostic CSS
ablations. Disabling hover effects/transitions reduced some cost; containment,
removing blur/shadows and formatter caching did not provide a consistent gain.
Those temporary ablations are not shipped. Forced layout and general mount/style
work remain follow-ups. Node/listener allocations in that trace do not establish
a retained memory leak.

## Verification and limits

- Production build passes with both final source changes.
- All 14 mounted sidebar workspace integration tests pass. The pagination case
  uses real Dexie queries and production pagination with the suite's pass-through
  scroller adapter. It checks rendered row counts, not real scrolling geometry.
  The parent implementation fails at 160 rows instead of 100; the fix then
  admits 150 rows after the next completed-page request.
- Seven production browser checks pass: Home/Chats recycling, endpoint,
  Enter/Space activation, Escape focus restoration and outside-click focus
  across Blank, Retro and Cyberpunk in both light/dark modes, plus the existing
  compaction-family action/navigation journey. Actual theme and mode are checked.
- The fixture originally clicked Home while another route was active. That
  initiates navigation and replaces PageShell, invalidating early menu focus.
  The check now navigates directly to the real chat route before interacting.
- Taller themes change the estimated track as rows are measured. Endpoint
  checks use up to four native wheel gestures and require the last row to
  intersect the viewport, rather than treating a mounted offscreen row as proof.
- Application typecheck, changed-file lint and `git diff --check` pass. Vue and
  test files are excluded by repository lint; executable checks and typecheck
  cover them.
- Earlier evidence did not record the theme. Section 1/2 prose is corrected
  rather than attributing those historical measurements to Retro.
- These are Chromium desktop checks. Touch/mobile, other browsers, model and
  project lists, long rich-content streaming and broader startup work remain open.

No deployment or external publication was performed for this section.
