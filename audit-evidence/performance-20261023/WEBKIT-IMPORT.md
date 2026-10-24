# WebKit compaction import investigation

Current audit overview: [stability status](STABILITY-STATUS.md), including the
subsequent notification-lifecycle repair and remaining evaluation areas.

Date: October 24, 2026. Branch: `or3-cloud`, local commit `a996424a`.
A fresh upstream fetch completed for this round. The prior application repairs
remain local and uncommitted; this round changes only the existing browser
journey and audit evidence. No runtime, styling, appearance, dependency, storage,
push, PR or deployment change occurred. The wider audit remains active.

## Finding and correction

The previously reported `TypeError: Importing a module script failed.` is now
isolated for the compaction journey: its first warm-up reload interrupts the
async desktop workspace tab bar in the departing document. The composer can be
visible before that tab bar has loaded. Waiting for the composer alone did not
establish the PageShell readiness the journey intended to warm.

Lightweight request logging records cancellation of the local
`/_nuxt/CbHtDGuD.js` chunk, which exports the installed OpenRouter message-builder
helpers. An additional run also records the tab-bar script and stylesheet being
cancelled. Response-only instrumentation of the existing fixture's error handler
identifies `AsyncComponentWrapper` under `WorkspaceTabsWorkspaceChrome`, with
Vue's async-component-loader error category. The production owner uses
`defineAsyncComponent` for `WorkspaceTabBar` in
`app/components/workspace-tabs/WorkspaceChrome.vue`.

The recorded error belongs to the old document, before its `pagehide`. In one
sample the chunk is cancelled at `1792827343106`, the old document reports its
loader error at `1792827343131`, and that same document emits `pagehide` at
`1792827343151`. Its `performance.timeOrigin` remains `1792827342508`. The
subsequent page completes the compaction, reload, draft and navigation checks.
This is evidence for interrupted warm-up in this journey, not a failed import
in its restored active page or evidence of compaction data loss.

The existing canonical journey now waits for the visible **Compaction original
evidence** tab before the first warm-up reload. It also collects uncaught page
errors and the fixture's captured component errors, and asserts that neither
occurred during the journey. The previous shared guard only failed on Vue
warnings and ResizeObserver errors; logging a component error did not fail it.

This adds 11 test lines. There is no arbitrary delay, error suppression, error
allowlist, production test seam or new test copy. All existing compaction,
cancellation, durable draft, lineage, summary-only continuation, landmark,
tool-evidence and new-conversation assertions remain. Temporary request,
page-lifecycle and served-response instrumentation was removed after diagnosis.

## Evidence and validation

- Three unchanged journeys with full network traces passed without the import
  error. Five unchanged journeys without tracing all passed their old assertions,
  while **four logged the import error**. These small samples demonstrate timing
  sensitivity, not a failure-rate estimate.
- [Lightweight origin evidence](webkit-import-origin.txt) captures the old-document
  async loader and cancelled requests in three runs. Full traces remain under
  `test-results/webkit-import-investigation/`; none of their module responses
  showed an HTTP error. Their local title-generation endpoint returned 502
  “Title generation unavailable”; that is separate from the cancelled import.
- [Guard before readiness correction](webkit-import-before.txt): **one pass and
  two failures**. One failure catches the reproduced module error. The other
  catches Iconify access-control errors after local icon requests were cancelled
  during startup interruption. These are distinct diagnostics; both must be
  reported rather than counting both as module failures.
- [Corrected WebKit journey](webkit-import-after.txt): **five of five pass** with
  the new error guard and the existing full functional assertions.
- [Chromium control](webkit-import-chromium.txt): **one of one passes**, including
  the same error guard.
- Targeted changed-file lint and final diff checks pass. No application build or
  application typecheck was repeated for this test-only change; the installed
  production build is unchanged from the earlier [scroll repair](SCROLL-INTENT.md).

The regression extends the strongest existing owner: the real PageShell browser
journey. Its meaningful contract is a ready workspace performing compaction and
reload/navigation without an uncaught component error. The before run establishes
that the old readiness condition could violate that contract, and the new guard
detects the previously unasserted failure. No unit copy of browser import behavior
was added.

The model transport remains scripted locally and OpenRouter browser requests
are denied by the existing journey. This case did not globally deny every external
icon request; the access-control errors in the before receipt are retained, not
described as successful offline requests. The new guard checks uncaught page and
captured component errors, not every HTTP failure or console warning.

## Still requiring evaluation

The **specific observed compaction import finding is classified as a warm-up
reload race**, and that journey now has stronger qualification. This does not
claim a general Safari loader repair or qualify every interrupted startup. No
application defect requiring a loader/cache workaround was demonstrated here.

Remaining work includes the roughly 33.3 ms rich-stream p95 under 4× CPU, the
intermittent large native wheel reversal, sustained memory and long sessions,
large workspaces, repeated account/workspace and plugin lifecycle changes,
private-context Blob storage, and actual Safari/iOS and Android behavior. Other
editor, search, dialog, font-ready, reduced-motion and background/sync/provider
combinations also remain. The preceding
[rich-font report](RICH-FONT-EVALUATION.md) retains their broader scope.

WebKit still uses `PW_TEST_SCREENSHOT_NO_FONTS_READY=1` here, so these screenshots
do not qualify font-ready visual output. Physical devices, private storage and
arbitrary active-page network failures are not cleared by these runs.

## Reproduction

With the existing local production preview on loopback port 3147:

```sh
OR3_PRODUCTION_JOURNEY_TEST_HARNESS=true PW_SKIP_WEB_SERVER=true PW_PORT=3147 PW_TEST_SCREENSHOT_NO_FONTS_READY=1 bunx playwright test tests/e2e/production-chat-journey.spec.ts --config audit-evidence/performance-20261022/playwright.webkit.config.ts --grep 'PageShell compaction summary reload and original landmark navigation' --repeat-each=5 --workers=1 --reporter=line
OR3_PRODUCTION_JOURNEY_TEST_HARNESS=true PW_SKIP_WEB_SERVER=true PW_PORT=3147 bunx playwright test tests/e2e/production-chat-journey.spec.ts --grep 'PageShell compaction summary reload and original landmark navigation' --workers=1 --reporter=line
```

The before receipt uses the same guard before adding only the visible-tab
readiness check. Diagnostic bundle identifiers in the origin log describe this
exact build and are not reusable instrumentation points after a rebuild.
