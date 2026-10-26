# Brave mobile network investigation

October 24, 2026. This round investigates production startup on a throttled
mobile viewport, preserving the application's appearance. The checkout remains
on `or3-cloud`; upstream `25c758b2` was fetched before work, with the three prior
repair commits already present locally. Nothing has been merged or deployed.

**The selected mobile investigation and repair are complete.** After macOS
locked, the user authorized Playwright as a fallback. Three cold runs of each
matched production build in installed Brave show median LCP improving from
**13.392 s to 12.776 s**, a **616 ms / 4.6%** improvement. The theme module chain
shortens by **588.5 ms**, removing one serial network boundary and two requests.
All six captured screens are byte-identical. This is a small controlled lab
comparison, not a claim about every device or production deployment.

The owned headless browser and preview server are stopped; the final `.output`
is retained. The original visible Brave tab remains inaccessible while macOS is
locked, so its temporary DevTools preferences still need manual restoration as
described below. That desktop cleanup limitation does not affect the matched
fallback results.

## Investigated and changed

The native Brave DevTools waterfall showed the selected theme's definition,
icons and stylesheet URL module loading in sequence. `prepareThemeEntry()` first
awaits the definition and then its optional icons loader. Each network dependency
therefore adds a round trip on a slow connection, even though the icon module is
small and belongs to that selected theme.

The client-only Rolldown configuration now groups a theme's `theme.ts`, optional
`icons.config.ts` and legacy `app.config.ts` into the same lazy group. The
existing strict module execution order and startup groups remain. Component
replacements and stylesheet/font URL modules retain their existing boundaries.
There is no runtime, template, CSS, token, image, database or sync change. The
public development guide and docmap describe the loading boundary.

The Blank candidate requests its combined definition/icons once and no longer
downloads the separate icons module after the definition. The stylesheet URL
module still follows it. Across the complete build, JavaScript assets decrease
from **398 to 395**. Against the rebuilt unchanged baseline, total JavaScript
changes by **+216 raw bytes and -71 gzip bytes**, effectively the same payload.
This is a request dependency improvement, not a bundle-size repair.

## Native Brave method and controls

The app was run from the supported production build and preview wrappers at
`http://127.0.0.1:3152/chat`. Cloud auth, sync, storage and background streaming
are disabled; this is a normal production build without the journey harness.
The fresh loopback origin has no user conversations or credentials, and no model
request is sent.

- Brave **1.97.56**, Chromium **155.0.8059.40**, arm64 macOS **27.0.1**.
- Native Device Mode: **iPhone 16 Pro Max**, **440 × 956 CSS pixels**, DPR 3.
- Performance panel: **4× CPU slowdown**, **Slow 4G**.
- Exported network conditions: download **180,000 bytes/s**, upload
  **84,375 bytes/s**, latency **562.5 ms**, target latency **150 ms**.
- HTTP cache disabled **and service-worker network bypass enabled**. Disabling
  HTTP cache alone initially yielded a misleading warm PWA result; it was
  excluded from cold comparisons.
- Full manual reload recordings continue until both background and hero images
  finish. The first automatic recording stopped too early and is excluded from
  complete LCP comparisons.

This is desktop Chromium device simulation, not a physical iPhone or WebKit
measurement. The existing browser profile and extensions remain active in both
builds; extension work and normal scheduling add noise. The selected page uses
the Blank theme in light mode. Other themes and saved color modes are checked
separately by the existing browser suite.

The [trace analyzer](brave-mobile/analyze-trace.ts) reads native gzip exports
offline. Checked-in summaries contain only local-origin request details and
selected trace metadata, plus a SHA-256 of each raw export. Raw traces remain in
the temporary directory because they include wider browser/profile information.
Last filmstrip frames are small visual controls, not pixel-perfect screenshots.
The analyzer's summed long-task excess is **not Lighthouse TBT or INP**, and
recordings of different lengths must not be compared using that field.

## Matched Playwright fallback in installed Brave

The user explicitly authorized Playwright when the computer tool could not
access the locked desktop. The official Playwright CLI launched
`/Applications/Brave Browser.app/Contents/MacOS/Brave Browser` headlessly in a
separate disposable context. The browser reports Chromium **155.0.8059.40**;
the installed Brave executable is the same one used in the native investigation.
The [browser identity receipt](brave-mobile/browser-identity.json) also confirms
that `navigator.brave.isBrave()` returns `true` with this launch configuration.
The ordinary user profile, extensions and DevTools preferences are not used by
this context.

The [CLI configuration](brave-mobile/playwright-cli.json) sets a **440 × 956**
mobile/touch viewport, DPR 3 and light color scheme. Both builds use the Blank
theme and the same previously dismissed welcome. The [measurement function](brave-mobile/measure.js)
applies **4× CPU slowdown**, the exact network throughput/latency values above,
HTTP cache disabled and service-worker bypass through CDP. Service-worker
registration is also blocked in the context. Its [only console warning](brave-mobile/automated-console.txt)
is that deliberate registration block.

Three baseline reloads precede three final reloads in the same isolated session.
Each waits for the application ready signal, editor and both artwork downloads;
the screenshot follows the measurements. Native Chrome timeline traces are
saved separately, and each JSON receipt records its raw trace and screenshot
SHA-256. Browser paint/navigation APIs and Resource Timing supply the metrics.
No build or test runs concurrently with these recordings.

| Measure | Rebuilt unchanged baseline | Final group | Interpretation |
| --- | ---: | ---: | --- |
| LCP, median (range) | 13.392 s (13.304–13.492) | 12.776 s (12.752–12.908) | 616 ms lower median; the background remains the LCP element. |
| Theme definition request → stylesheet URL module received, median | 1.7993 s | 1.2108 s | 588.5 ms shorter dependency chain. |
| App ready signal + editor present, median | 13.200 s | 12.583 s | Startup readiness diagnostic, not INP. |
| FCP, median | 1.784 s | 1.784 s | No first-paint gain. |
| DOMContentLoaded, median | 6.712 s | 6.666 s | Small difference; no material gain claimed. |
| Load, median | 8.253 s | 8.210 s | Small difference; load precedes late artwork. |
| Completed local page requests | 74 in every run | 72 in every run | Separate icons and a small parallel theme dependency are folded into the theme chunk. |
| Local Resource Timing transfer bytes | 1,450,584 | 1,449,915 | Only 669 bytes less; this is chiefly a round-trip improvement. |
| Observed layout-shift score sum | 0.05431 | 0.05431 | Unchanged diagnostic sum; not a session-window CLS calculation. |

[Summary and individual samples](brave-mobile/automated-summary.json) retain
the numbers, geometry and errors. All six PNGs have the identical SHA-256
`6a28b080a62e52280c055b1901790192696a062c385d5d392845e907a81576de`.
The [baseline screenshot](brave-mobile/automated-baseline-1.png) and
[final screenshot](brave-mobile/automated-final-3.png) are byte-identical, as are
all composer, editor, settings and navigation rectangles. All six runs report
zero page or hydration errors. Fonts have the same paths and encoded sizes in
every receipt, addressing the earlier build-state confound.

The final Brave page also accepts and clears an unsent draft, opens and closes
[chat settings](brave-mobile/settings.png), and opens the mobile
[navigation drawer](brave-mobile/navigation.png) with a visible
[`Navigation` dialog](brave-mobile/navigation-snapshot.txt). No message is sent.
The remaining performance cost is substantial: this selected 4× CPU / Slow 4G
page still takes roughly 12.8 seconds to reach its final LCP. Headless Chromium
simulation does not establish physical-phone, WebKit or real-network behavior.

## Earlier native samples and a build-state confound

| Recording | FCP / LCP | DOMContentLoaded / load | Local requests / transferred bytes | Interpretation |
| --- | --- | --- | --- | --- |
| [Original baseline](brave-mobile/baseline-2.json) | 2.12 s / 12.69 s | 7.61 s / 10.45 s | 73 / 1,413,710 | Full trace, but lacks three font preloads present in later builds. |
| [Broader experiment](brave-mobile/candidate-1.json) | 2.07 s / 12.29 s | 8.10 s / 10.02 s | 73 / 1,466,914 | Discarded group also included stylesheet URL modules. |
| [Final narrow group, first run](brave-mobile/final-1.json) | 1.93 s / 13.04 s | 8.07 s / 10.79 s | 74 / 1,467,155 | Full trace; requires the rebuilt baseline for a fair timing comparison. |

Later builds preload about **53 KB** of IBM Plex Sans, Press Start 2P and VT323
fonts. This initially looked related to grouping stylesheet URL modules, so the
group was narrowed. An exact unchanged-source rebuild also reproduced the font
preloads. The font difference is therefore a build-state confound, not evidence
that this configuration change added those downloads. The generated font
metadata/cache is the likely source; its precise owner remains to be evaluated.

The rebuilt baseline and final build have equal CSS byte totals. Their large
startup stylesheet differs only in the ordering of independent fallback
`@font-face` blocks: sorted blocks and the remaining CSS have identical hashes
in the [CSS control](brave-mobile/css-control.json). A comparison of **all 42
public CSS files** also matches after that same normalization. Four emitted files
have different font-face ordering; all other CSS bytes and all font-face contents
match in the [complete CSS control](brave-mobile/all-css-control.json). The
original-baseline LCP and native final-run LCP above must not be used to claim
either a speedup or a regression from this change. The separate matched fallback
above is the evidence for the final gain. The native rebuilt-baseline control
was recorded but could not be exported after the desktop locked; it is not
counted as evidence in the result.

Asset inventories retain the [original baseline](brave-mobile/baseline-assets.json),
[discarded experiment](brave-mobile/candidate-assets.json),
[rebuilt unchanged baseline](brave-mobile/rebuilt-baseline-assets.json) and
[final configuration](brave-mobile/final-assets.json).

## Verification

- **Six matched cold Brave recordings** complete with the consistent request
  reduction and lower LCP ranges above. Screens and geometry are identical;
  the selected draft/settings/navigation interactions pass.
- **112/112 existing theme tests** pass across 15 files:
  [receipt](brave-mobile/theme-tests.txt).
- **6/6 existing Chromium mobile startup journeys** pass on the final production
  preview: Blank, Retro and Cyberpunk, each light and dark. Composer, editor,
  settings and navigation rectangles have **zero measured geometry change**
  between blocked-JavaScript first paint and hydrated state. Saved color modes,
  draft typing, mobile sidebar interaction and hydration error checks pass.
  These are supplementary headless Chromium checks, not the native Brave
  performance recordings. [Receipt](brave-mobile/mobile-geometry.txt),
  [geometry summaries](brave-mobile/geometry-summary.json),
  [screenshots and rectangles](brave-mobile/geometry/blank-light.json).
- Supported application [typecheck](brave-mobile/typecheck.txt), targeted
  [typed lint](brave-mobile/lint.txt) and [documentation checks](brave-mobile/docs.txt)
  pass. Existing duplicate-import warnings remain. Documentation validation
  reports 115 files, 103 routes and 20 checked examples in its existing scope.
- Four production builds pass, including the final group and unchanged-source
  control. The existing plugin build check passes its supported built-in/V1
  boundary; its trusted-host V2 UI qualification remains rebuild-required.
- **The existing production asset budget fails.** Both baseline and candidate
  exceed it; limits and assertions are retained. [Failure receipt](brave-mobile/production-budget.txt).

| Failing budget | Rebuilt baseline | Final | Existing limit |
| --- | ---: | ---: | ---: |
| Complete JavaScript raw bytes | 13,814,500 | 13,814,716 | 13,480,000 |
| Complete JavaScript gzip bytes | 4,409,488 | 4,409,417 | 4,200,000 |
| Precache raw bytes | 19,378,088 | 19,378,304 | 18,400,000 |

## Remaining evaluation

1. **Initial JavaScript and serial work.** The cold page transfers about 835 KB
   of compressed JavaScript in these traces. Theme grouping removes one serial
   request but does not make the initial graph small. Inspect startup ownership,
   CSS URL activation and subsequent plugin/component gates before further
   grouping; preserve lazy optional features and execution order.
2. **HTML compression in the serving path.** Local dynamic `/chat` responses are
   about 107 KB uncompressed while static JS/CSS use Brotli. Evaluate compression
   at the deployed proxy/server and its streaming/caching behavior; local preview
   headers do not establish how production ingress behaves.
3. **Late artwork discovery.** The 135.6 KB background and 212.1 KB hero begin
   near the end of startup; the background becomes the final LCP candidate.
   Evaluate earlier selected-theme discovery or lossless delivery choices without
   changing artwork, layout, theme selection or first-paint appearance.
4. **Font build reproducibility and unused preloads.** Explain the generated
   fallback/preload state, then assess per-theme font delivery with matched
   builds. Do not remove fonts or alter text rendering based on this observation.
5. **Asset budget and PWA updates.** Investigate why complete JS/precache exceed
   the existing budgets and qualify updates, repeat visits, offline startup and
   actual storage pressure. The bypassed-service-worker trace does not cover them.
6. **Broader devices and providers.** Physical mobile hardware, real network
   loss, actual Safari/iOS, authenticated Cloud startup and background/provider
   combinations remain outside this isolated local run. Earlier scale, memory,
   streaming and scrolling items in the [consolidated report](../performance-20261023/STABILITY-STATUS.md)
   remain open.

## Desktop cleanup limitation

The headless context resets its CPU/network emulation after each sample and is
closed at the end; the local preview is stopped. The original visible Brave
audit tab could not be reached because the computer tool still reports macOS
locked. Its native recording and DevTools state were preserved. When back at
the Mac, restore **No throttling** for network, **No throttling** for CPU, turn
off **Disable cache** and **Service workers → Bypass for network**, and turn
off the device toolbar. The original Network filter was
`localhost:3000/api/`; restore it if retaining the earlier panel setup. These
are browser audit settings, not application configuration changes.

Method references: [Chrome Device Mode](https://developer.chrome.com/docs/devtools/device-mode),
[network throttling/cache controls](https://developer.chrome.com/docs/devtools/network/reference#throttling)
and [Rolldown code splitting](https://rolldown.rs/in-depth/manual-code-splitting).

## Review and activation

The repair is prepared for review on `codex/brave-mobile-theme-loading`, stacked
on `codex/workspace-search-scale` (#305) so the PR isolates this round. The
checkout remains on `or3-cloud`, freshly fetched again before commit with no
upstream changes. The retained production `.output` contains the final narrow
group. The preview and owned headless sessions are stopped. Nothing is merged,
deployed or published; GitHub checks for the new commit remain separate from
the local results above. The full repository test suite was not repeated.

## Reproduce

Use the normal supported production build/preview with installed basic-auth,
SQLite and filesystem providers selected and Cloud services disabled:

```sh
env SSR_AUTH_ENABLED=false OR3_AUTH_PROVIDER=basic-auth OR3_SYNC_PROVIDER=sqlite \
  NUXT_PUBLIC_STORAGE_PROVIDER=fs OR3_SYNC_ENABLED=false OR3_CLOUD_SYNC_ENABLED=false \
  OR3_STORAGE_ENABLED=false OR3_CLOUD_STORAGE_ENABLED=false \
  OR3_BACKGROUND_STREAMING_ENABLED=false OR3_USE_LOCAL_PACKAGES=false \
  OR3_LOCAL_PROVIDERS=false bun run build

env SSR_AUTH_ENABLED=false OR3_AUTH_PROVIDER=basic-auth OR3_SYNC_PROVIDER=sqlite \
  NUXT_PUBLIC_STORAGE_PROVIDER=fs OR3_SYNC_ENABLED=false OR3_CLOUD_SYNC_ENABLED=false \
  OR3_STORAGE_ENABLED=false OR3_CLOUD_STORAGE_ENABLED=false \
  OR3_BACKGROUND_STREAMING_ENABLED=false \
  bun run preview -- --host 127.0.0.1 --port 3152
```

For the approved fallback, launch the official CLI with the saved configuration,
set the `or3_active_theme=blank` cookie for `127.0.0.1`, load `/chat` and dismiss
the first-run welcome through its button. Run the measurement function once per
sample; preserve its JSON result, the latest PNG and temporary trace before
the next run. Use the unchanged rebuilt baseline first and then the final build;
stop the preview before replacing `.output`. Keep both builds' generated font
preloads identical.

```sh
bunx --package @playwright/cli playwright-cli -s=or3-brave-mobile open about:blank \
  --config=audit-evidence/performance-20261024/brave-mobile/playwright-cli.json
bunx --package @playwright/cli playwright-cli -s=or3-brave-mobile run-code \
  --filename=audit-evidence/performance-20261024/brave-mobile/measure.js
bunx --package @playwright/cli playwright-cli -s=or3-brave-mobile close
```

For native DevTools, enable the stated device, CPU/network profile, Disable cache
and service-worker bypass. Record a manual reload long enough for artwork to
finish, then export gzip without resource contents or source maps. The existing
supplementary checks are:

```sh
bun audit-evidence/performance-20261024/brave-mobile/analyze-trace.ts \
  /private/tmp/or3-brave-mobile-final-1.json.gz \
  audit-evidence/performance-20261024/brave-mobile/final-1.json

OR3_E2E_PERFORMANCE=true PW_SKIP_WEB_SERVER=true PW_PORT=3152 \
  bunx playwright test tests/e2e/performance-budgets.e2e.ts \
  --grep 'mobile startup keeps' --workers=1 --reporter=line

bunx vitest run app/theme/_shared/__tests__ --reporter=dot --silent=passed-only
bun run performance:production-build:check
```

The last command currently fails on the three retained budgets above. Do not
interpret the headless mobile suite as a replacement for the native throttled run.
