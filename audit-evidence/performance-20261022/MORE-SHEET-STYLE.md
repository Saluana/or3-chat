# Section 13: scope mobile More stacking to its open state

Baseline: `baee676f`. Two global selectors in `SideMobileBottomNav.vue`
used `body:has(.more-sheet-root)` to raise nested modal portals above the More
sheet. Their CSS also ships on desktop, where unrelated streaming DOM changes
repeatedly invalidated portaled controls even with no sheet mounted.

The component now publishes its existing `moreOpen` state through an owned
Nuxt head entry. The same two stacking rules select the body attribute instead
of searching its descendants. Specificity, declarations, portal behavior,
and sheet lifetime are preserved. Nuxt disposes the attribute contribution
when the mobile navigation unmounts; there is no global watcher or registry.

## Measured behavior

The existing CDP style-scope regression performs 12 DOM replacement frames.
It failed before this change with **429 More-selector invalidation events**
and passes afterward with **zero**. Its positive style-update assertion and
existing focus behavior checks remain intact.

The paired production experiment restores only the original two selector
conditions through CSSOM on the same build. It retains all declarations and
alternates fresh baseline/after browser contexts, with external requests
blocked and no timeline or database instrumentation during timing. The
workload is the section 12 concurrent rich stream: two real controllers,
120 messages per pane, approximately 3 KB per response, 12 TypeScript blocks
and 12 standalone double-dollar formulas each, Blank/light at 90% scale,
1440×900 DPR 1 Chromium, 4× CPU throttling. Single-dollar examples remain
literal text and are not counted as rendered formulas.

| Per run | Original selectors restored | Production fix |
| --- | --- | --- |
| Frame interval p95 (ms) | 58.4 / 58.5 / 58.5 | 33.4 / 33.3 / 33.4 |
| Maximum interval (ms) | 233.6 / 225.3 / 226.4 | 256.9 / 201.8 / 273.1 |
| Long tasks | 20 / 20 / 20 | 4 / 5 / 5 |

The recurring frame cost improves; the cold rich-rendering pause does not.
At normal CPU speed, one control/after pair records p95 16.6 / 9.8 ms,
maximum 65.1 / 48.6 ms, and zero / one long task. These local samples are
not a general device or smoothness guarantee.

Every run saves both responses exactly, retains the left reading anchor,
follows the right response to the bottom, and reveals the left final marker
through its normal button. Completed heading/code/math nodes stay connected
with zero mutations. Four settled Retry controls re-enable after transport
completion; there are no settled-row mutations during transport.

A post-change full-traversal spot check reaches both endpoints and returns to
the top of 600-project and 600-model lists. At 4× CPU, p95 is 32.5 / 18.2 ms,
with one / zero long tasks. This is a single after sample, not a paired list
comparison. It does not establish that every intermediate frame was painted.

## Functional validation and known failure

- 20 focused mobile-sidebar tests pass.
- Production build and application typecheck pass.
- The new production journey passes: a real nested confirmation and overlay
  remain above More, Cancel receives an ordinary click, and opening Settings
  after either closing More or unmounting mobile navigation restores its
  original stacking. The confirmation is cancelled; no credentials are changed.
- The style-scope browser case and Retro/Cyberpunk mobile focus journeys pass.
  The combined browser run is **4 passed, 1 failed**.
- The Blank focus journey passes its More checks, then fails the existing
  44px physical touch-height assertion in Open tabs. An isolated rerun fails
  identically. A direct production control confirms the same 41.796875px
  controls before and after restoring the old selectors: the existing mobile
  body zoom is 0.95, the computed controls are approximately 44 CSS px, no
  More root/attribute exists, and no animation remains active. This separate
  touch-sizing issue is retained as a known failure; the assertion is unchanged.
- `git diff --check` passes. ESLint exits successfully but the repository
  configuration ignores the affected Vue and test files, so it supplies no
  validation of those files.

## Reproduction and receipts

Use the production harness flags and local preview from previous sections.
Run `concurrent-pane-stream-probe.js` with
`{ rich: true, synchronized: true, cpuRate: 4, dbCounts: false }` and alternate
`restoreMoreSelector: true` for the control. Repeat at `cpuRate: 1`.

The focused browser command selects `inactive UI`, `mobile More keeps nested`,
and `mobile sheets and tab switcher keep keyboard focus inside` from the
performance-budget, production-chat-journey, and theme-token-migration suites,
with `OR3_E2E_PERFORMANCE=true`, production journey harness enabled, one worker,
and `PW_SKIP_WEB_SERVER=true PW_PORT=3147` against the built preview.

Receipts:
- `more-style-isolation.json`: exploratory selector isolation controls; these
  removed rules and are diagnostic evidence only.
- `more-style-results.json`: clean paired rich-stream measurements.
- `more-style-list-results.json`: full-list endpoint spot check.
- `more-style-mobile-limitation.json`: original/fixed selector control for the
  independent Blank touch-sizing failure.
- Local browser artifacts: `test-results/more-style-final/` and
  `test-results/more-style-blank-recheck/`.

The remaining cold highlighter pause, painted scroll frames, touch scrolling,
tool output, other browsers and physical devices remain open audit work.
