# Section 9: saved sidebar geometry before hydration

Baseline: `1134d8b4`. Startup checks with default preferences concealed a large
layout jump for returning users. A saved wide sidebar initially rendered at the
default width; a saved collapsed rail did the same. Restoring preferences in
`onMounted()` then displaced the entire main pane by 144–256 physical pixels.

The default app shell now emits a small inline head script that reads the existing
local width and collapse preferences before application bundles download. It
supplies bounded geometry through temporary CSS variables. Server and client Vue
markup remain identical until mount restores the same preferences into component
state; the component removes the temporary variables after that update. A saved
collapse choice that differs from the server default holds sidebar controls hidden
until the correct content is ready, instead of painting the wrong expanded/rail
layout. The main pane and sidebar background retain their final geometry.

No cookie, server-side preference store, network request or production test seam
was added. Custom component storage keys keep their existing mount-time restore.
The configured initial collapse choice is also used consistently in SSR markup.

A separate restore defect lived in the same owner: expanding after a collapsed
reload used a second, uninitialized remembered-width ref. A saved 400 px width
was replaced and persisted as 320 px. That redundant ref is removed. Collapse
changes only the rendered width, leaving the existing expanded-width state
intact for both the button and the exposed expansion API.

## Production evidence

`saved-sidebar-probe.js` uses fresh Chromium contexts, normal CPU speed, 1280×720
at DPR 1, light appearance and default theme scale. It holds application scripts
until initial geometry is captured, samples actual frame widths, then releases
scripts and observes hydration. External requests are blocked. No test runner,
build or typecheck runs during the probe. The workspace is empty.

| Theme / preference | Sidebar width before → hydrated, baseline (px) | Final (px) | Layout shift before | After |
| --- | --- | --- | --- | --- |
| Blank / default | 288 → 288 | 288 → 288 | 0.00348 | 0.00348 |
| Blank / 480 px saved | 288 → 432 | 432 → 432 | 0.09112 | 0.00297 |
| Blank / collapsed | 288 → 57.59 | 57.59 → 57.59 | 0.17616 | 0.00424 |
| Retro / default | 320 → 320 | 320 → 320 | 0.00709 | 0.00709 |
| Retro / 480 px saved | 320 → 480 | 480 → 480 | 0.09985 | 0.00588 |
| Retro / collapsed | 320 → 64 | 64 → 64 | 0.19903 | 0.00903 |

Every final probe recorded one stable sidebar width across hydration. Remaining
layout shifts come from other startup content, including rail-footer and workspace
header changes; this is not a zero-CLS claim. These deliberately delayed scripts
make the geometry defect repeatable, not a prediction of network load time.
Raw before/after geometry, paint changes and shift entries are retained in
`saved-sidebar-baseline.json` and `saved-sidebar-results.json`.

The dedicated browser regression covers wide, collapsed, oversized and invalid
width preferences in Blank and Retro. Six cases fail on the original build;
the two invalid-value controls already pass. All eight now pass in Chromium and
WebKit, with zero measured width variation across their hydration-frame samples.
Collapsed cases then expand and verify that the 400 px stored width survives.
`saved-sidebar-expand-control.json` retains the original 400 → 320 failure;
`saved-sidebar-geometry-results.json` retains both engines' final geometry and
WebKit's six mobile startup results.

## Cross-browser qualification and validation

- 38 unique Chromium checks pass across targeted runs: all 32 cases in the
  performance file plus six production virtual-sidebar theme/mode checks.
- 29 selected desktop WebKit checks pass: six JavaScript-disabled theme/viewport
  layouts, eight saved-preference startups, six mobile hydration cases, eight
  scale/motion pointer cases and one keyboard/collapse/responsive journey.
- WebKit's existing delayed-script mobile screenshots initially hung on
  Playwright's implicit `document.fonts.ready` wait. The installed screenshot
  hook `PW_TEST_SCREENSHOT_NO_FONTS_READY=1` avoids that wait for this audit;
  the test still explicitly loads its visible fonts before capture and retains
  its geometry, color-frame and interaction assertions. The initial run was
  stopped after the same hang occurred twice. This is a harness workaround,
  not an application change or a claim that the default WebKit run passes.
- Two WebKit drag checks initially differed by 1.19 px at 120% scale because
  native pointer-down rounded 376.80 to 376, while the synthetic release kept
  its fractional coordinate. `sidebar-webkit-coordinate-control.json` records
  those events and correct native tracking. Tests and the shared drag probe now
  use integer coordinates for both paths. All eight drag cases pass in each
  browser with the original 1 px bound, including the same-frame release.
- The isolated default-preference warm-navigation gate passes: FCP 36 ms,
  LCP 240 ms, CLS 0.00347, blocking time 1 ms. The zero event-duration result
  still does not qualify full-workflow INP. Receipt: `saved-sidebar-vitals.json`.
- Production build, application typecheck, changed-file lint and diff checks
  pass. No public runtime API or wire contract changed.

To repeat the WebKit checks against the local production preview (the checked-in
configuration only changes the browser and preserves the repository harness):

```sh
NODE_ENV=production PW_SKIP_WEB_SERVER=true PW_PORT=3147 \
PW_TEST_SCREENSHOT_NO_FONTS_READY=1 OR3_E2E_PERFORMANCE=true \
OR3_PRODUCTION_JOURNEY_TEST_HARNESS=true bunx playwright test \
tests/e2e/performance-budgets.e2e.ts \
--config audit-evidence/performance-20261022/playwright.webkit.config.ts \
--grep 'initial .* shell|mobile startup keeps|saved sidebar geometry|sidebar drag tracks|sidebar resizing persists' \
--workers=1 --reporter=line
```

Desktop WebKit with mobile viewports is not an actual iPhone/touch-device result.
Populated startup, saved typography/scale overrides, full list endpoints,
concurrent panes and remaining slow-device rendering costs are still open audit
work. No external publication or deployment was performed for this section.
