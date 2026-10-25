# Cold startup repair and Chrome qualification

October 24, 2026. This round follows the [Chrome mobile evaluation](CHROME-MOBILE.md)
and changes startup loading while preserving the existing design. Work continued
on `or3-cloud` after checking upstream: the checkout was five commits ahead and
zero behind. The matched baseline is `0c5ab628`. No deployment or data migration
is included. Responsive image processing was explicitly approved by the user;
the four original artwork files are unchanged.

## Measured outcome

Three baseline and three final production loads used installed Chrome 155 at
390 × 844, DPR 1, 4× CPU, 150 ms latency, 200,000 bytes/s download and 93,750
bytes/s upload. HTTP cache was disabled and service workers bypassed. This is a
local preview with existing profile/database state, not a fresh installation or
a physical mobile device. Desktop Chrome's user agent was retained.

| Median measurement | Baseline | Final |
| --- | ---: | ---: |
| First contentful paint | 1.548 s | 1.740 s |
| Largest contentful paint | 8.316 s | **1.740 s** |
| Editable composer / app-ready observation | 7.435 s | **6.374 s** |
| Cumulative layout shift | 0.0860 | **0** |
| Encoded JavaScript through capture | 819,821 B | 789,867 B |
| Encoded artwork through capture | 347,190 B | **52,064 B** |

LCP improves by 6.576 seconds (79.1%); composer readiness improves by 1.061
seconds (14.3%). Artwork transfers fall by 85%. With the new loading order,
first contentful paint is about 192 ms later, while the complete stable visual
state appears much sooner. The remaining 6.37-second composer delay under this heavy throttle
is not considered fully solved.

Three final warm-cache loads under the same network/CPU throttle have median
LCP **0.640 s** and observed composer readiness **1.434 s**. Three final local
loads without network/CPU throttling, still with HTTP cache disabled, have median
LCP **0.152 s** and readiness **0.238 s**. These local results do not predict
deployed mobile-network performance. All nine final runs record zero CLS.

Readiness is an upper-bound observation of the existing initialization flag
plus an editable Message input. The observer is installed after navigation
returns; paint, LCP and layout-shift entries are buffered. This is not a measured
INP score. Optional post-load prewarming can still be running when capture ends,
so warm/unthrottled JavaScript totals should not be compared as complete budgets.

[Raw runs and medians](cold-startup/summary.json) can be regenerated with:

```sh
bun run audit-evidence/performance-20261024/cold-startup/summarize.mjs
```

The observation sources are retained in [observer.js](chrome-mobile/observer.js)
and [capture-expression.js](chrome-mobile/capture-expression.js).

## Investigated and fixed

- **Late artwork discovery and oversized transfers:** paired public light/dark
  artwork can render in SSR at the original dimensions. Existing pre-paint color
  mode selects the visible image. A viewport-aware preload starts only the
  selected mode's image before application JavaScript. Built-in artwork uses
  responsive WebP and background AVIF copies; custom URLs retain their sources.
  Local blob artwork and differing variant geometry retain client resolution.
- **Layout shift after early paint:** local creation-action availability is
  captured in the SSR payload, avoiding late insertion of action cards. Cloud
  actions retain their authorization-dependent behavior and action-time checks.
- **Unnecessary startup dependencies:** project operation identity capture and
  the existing sync-manager registry are split into lightweight modules. Their
  capture, workspace and cleanup semantics are retained. A test-only editor
  fixture no longer imports runtime editor code into production.
- **Serial shell/theme requests:** SSR manifest aliases make the rendered shell
  and selected theme discoverable for module preloading instead of waiting for
  the entry module to execute.
- **Search work before use:** the command palette mounts on first opening and
  prewarms after window load. Mention indexing starts on the first actual query,
  while retaining refresh behavior and the originating-database guard.
- **Offline/error fallback:** responsive copies are excluded from installation
  precache and use the existing image runtime cache. If a copy fails, the
  original artwork remains the fallback. Replacing the complete picture element
  prevents an old AVIF source from defeating that fallback.

An intermediate full-size image preload improved LCP but delayed composer
readiness to about eight seconds; it was not retained. An earlier preload ran
before the viewport tag and selected an unnecessarily large image; ordering was
corrected. Intermediate `candidate*.json` files are diagnostic evidence, not
additional final qualification runs. `candidate7-diagnostic.json` predates the
layout-shift repair and overlaps browser testing; it is excluded from medians.

## Appearance and regression checks

The [baseline](cold-startup/baseline-blank-light.png) and
[final](cold-startup/final-blank-light.png) mobile screenshots preserve the same
design. Composer and input rectangles match exactly. The
[comparison receipt](cold-startup/visual-comparison.json) records a mean absolute
RGB difference of 0.553 on a 0–255 scale across the screenshot. The approved
responsive encodings are lossy; this is not a byte-identical-image claim.

**217 focused tests across nine suites pass**, covering trusted editor clients,
workspace project capture, sync ownership, mention refresh, command-palette
shortcuts and palette behavior. **14 focused Chrome E2Es pass**: eight startup
cases (three themes, light/dark, plus Blank DPR 2), two artwork/control cases,
two image-failure cases and two opted-out-theme cases. They check artwork before
application JavaScript, geometry after hydration, source selection, focus and
fallback behavior. Paid AI requests are blocked in these automated cases.

The meaningful regression assertions were observed failing before repair:
[eager mention indexing](cold-startup/mentions-before.txt) and
[responsive fallback](cold-startup/fallback-before.txt). Final receipts:
[unit tests](cold-startup/unit-tests.txt), [Chrome E2Es](cold-startup/chrome-tests.txt),
[production build](cold-startup/build.txt), [typecheck](cold-startup/typecheck.txt),
[targeted lint](cold-startup/lint.txt), and
[documentation checks](cold-startup/docs-check.txt). Documentation validation
covers 115 files, 103 routes and 20 checked examples. Final diff checks pass.

The existing [build budget gate](cold-startup/budget.txt) still fails the same
three categories on baseline and final: complete JavaScript raw/gzip bytes and
precache bytes. Limits remain unchanged. [Build inventories](cold-startup/build-assets.json)
show raw JavaScript 13,814,716 → 13,809,636 B, gzip 4,409,417 → 4,411,347 B, and
precache 19,378,304 → 19,373,008 B. Thus this is startup scheduling/transfer work,
not a complete-bundle-size fix. Offline-shell `200.html` preload bytes decrease
from 1,819,265 to 1,414,419; that shell inventory is not the full chat route.

## Real AI and manual checks

One additional authorized real **DeepSeek V4.1 Flash 1017** request asks for the
synthetic answer `STARTUP_OK`. The first visible answer arrives in **1.580 s**
and completes in **1.600 s**. The answer persists after reload. The UI reports
4,354 prompt tokens, 43 completion tokens, 39 reasoning tokens and 4,096 cached
tokens. Its displayed `$0` cost is rounded; exact billing and any separate
title-generation cost were not verified. See the
[measurement](cold-startup/final-ai-smoke.json) and
[final screenshot](cold-startup/final-ai-desktop.png).

First-use command-palette opening focuses its search input and finds the new
chat. First-use mention search also finds it. Temporary mention-test text was
cleared through the editor; existing chats and the earlier unsent draft were
preserved. Chrome was restored to its normal viewport, CPU, network, cache and
service-worker settings, with test observers removed. Brave was not accessed.
The final local production preview remains on port 3156 for review.

## Still needs evaluation

1. **Cold composer startup:** roughly 790 KB of encoded JavaScript still arrives
   during the measured cold path. Further dependency/execution profiling is
   needed to reduce the remaining 6.37-second readiness delay on this throttle.
2. **Complete asset budgets and PWA lifecycle:** full JavaScript/precache budgets
   still fail. Missing-image fallback passes, but installed service-worker
   upgrades, eviction and prolonged offline use need dedicated qualification.
3. **Real deployments and devices:** authenticated/sync-enabled provider paths,
   deployed compression/HTTP behavior, physical iOS/Safari and Android, and DPR 3
   image quality/network behavior were not qualified by these emulated tests.
4. **Long and failed AI calls:** long-output/virtualized timing, paid failure
   recovery, tool-heavy responses and admission overhead remain as documented in
   [the previous AI evaluation](CHROME-MOBILE.md). One short success does not
   establish provider latency or failure-recovery guarantees.
5. **Workspace scale and sustained operation:** index memory, legacy sidebar
   scans, repeated account/workspace switching and long-session resource growth
   remain in [WORKSPACE-SCALE.md](WORKSPACE-SCALE.md) and the
   [consolidated inventory](../performance-20261023/STABILITY-STATUS.md).

This completes the selected cold-startup repair round, with those remaining
evaluations explicitly open. It does not qualify every application surface.
