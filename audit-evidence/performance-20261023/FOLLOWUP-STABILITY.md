# Performance follow-up: image streaming and stability

Date: October 23, 2026. Baseline: synced `or3-cloud` at `25c758b2`, after the
previous 22 PRs and the user's other work were merged. These changes are local
in this checkout on `or3-cloud`.

This batch was subsequently committed as `a996424a`. The next
[registered tool-card audit](TOOL-CARD-AUDIT.md) records further update filtering,
stable card metadata, stale preload protection and browser qualification. Its final
report identifies the remaining frame-budget and scroll-position evaluations.

This round preserves appearance. No CSS, theme tokens, typography, spacing,
control sizes, animation styling, scroll settings or dependency versions changed.
Images use the existing renderer, placeholders, dimensions and hydration classes.
The work restores their intended visibility and reduces unnecessary execution.

## Investigated and fixed

1. **Images disappeared when more text arrived.** Normal generation and Continue
   appended image placeholders to the persistence snapshot without adding them to
   the live accumulator used by `ChatContainer`. Both paths now append the same
   placeholder and separator to live text, preserving image/text ordering.
2. **A quiet stream could leave a decoded image unhydrated.** `ChatMessage` dropped
   readiness or Markdown updates arriving inside its 200 ms throttle window.
   It now retains one trailing check, still throttles streaming checks, and clears
   its timer on unmount. Finalization can trigger the immediate existing path.
3. **Delayed Continue intake could publish after navigation.** Image fetch and
   storage now recheck captured request ownership before publishing. The existing
   file-intake owner guard also checks during storage preparation. Superseded or
   stopped requests cannot append a late placeholder to the live accumulator.
4. **An empty tool-card component updated with every text projection.** Replies
   without tool calls now omit `ChatToolCardsEnd`, whose loop rendered nothing.
   Replies with actual tool calls retain the existing component and card behavior.
   The image probe recorded 160 empty-component updates before and zero after.

The canonical tests reproduced missing live placeholders, quiet hydration and
late ownership leakage before their corresponding repairs, then passed afterward.
The foreground cases cover stored images and URL fallback. The existing Continue
quiet-stream table now includes images and superseded image intake. A real mounted
`ChatMessage` protects readiness arriving inside the throttle window. No production
API or test-only export was introduced.

## WebKit failures isolated

The earlier image failures had two independent harness/platform causes:

- **Private-context storage:** direct IndexedDB Blob and File writes fail in
  WebKit 26.6 with `UnknownError: Error preparing Blob/File data to be stored in
  object store`. The retained raw control serves a blank HTML page with no OR3
  or Dexie code. Uint8Array succeeds in the same context. All three types store
  and read back in a disposable persistent WebKit profile and in Chromium.
  Changing `TMPDIR` in an earlier control did not repair private-mode storage.
- **Network interception:** WebKit routes local `blob:` image requests through
  Playwright. The old audit filter allowed only URLs whose hostname was
  `127.0.0.1`; Blob URLs have an empty hostname. A raw canvas-image control fails
  decoding under that filter and decodes at 64 px when the local origin's Blob
  URLs are allowed. The media probe now allows that exact local Blob origin
  while continuing to block external requests.

The updated probe supports explicit disposable persistent profiles and removes
those profiles after closing. The two image-backed fixtures now initialize in
normal-profile WebKit with no captured errors. This is startup qualification,
not a claim that their complete canonical assertions passed in private contexts.

No application storage format, migration, Blob representation or provider changed.
Private-mode support and physical Safari/iOS storage remain separate evaluation
items. [WebKit's Blob-storage issue](https://bugs.webkit.org/show_bug.cgi?id=188438)
is related engine context, not proof that every reported Safari version has the
same behavior as this local browser.

## Production evidence

The media journey uses real foreground controllers, stream parsing, file intake,
IndexedDB persistence and rendering, with local synthetic SSE and external traffic
blocked. It sends an image, 80 text chunks, another image, another 80 chunks and a
final marker. The provider stays open while live visibility is sampled. Measurement
starts only once the first inline image is actually hydrated; this also rejects the
quiet-hydration failure before any additional text can hide it.

Blank/light, 1440 × 900, DPR 1:

| Check | Chromium 153, 4× main-thread throttle | WebKit 26.6, persistent profile, no throttle |
| --- | --- | --- |
| First image remains visible throughout sampled trailing text | Pass | Pass |
| Both images hydrated before stream completion | Pass | Pass |
| Both distinct hashes saved in arrival order | Pass | Pass |
| 80 chunks between images, 80 after the second, final marker | Pass | Pass |
| Both images and final marker restored after reload | Pass | Pass |
| Additional thumbnail sync when second image arrives | 1 | 1 |
| Empty `ChatToolCardsEnd` updates | 0 | 0 |

Frame p95 was about 16.8 ms in final Chromium and 18 ms in WebKit. The Chromium
baseline was about 16.7 ms. This establishes less unnecessary work and corrected
content visibility, not a frame-rate gain. Browser visibility sampling is not a
physical-device painted-frame guarantee.

Receipts:

- [Original image-stream baseline](stream-images-before.json).
- [Quiet hydration failure after only the accumulator repair](quiet-hydration-before.json).
- [Final Chromium image stream and reload](stream-images-chromium.json).
- [Final persistent WebKit image stream and reload](stream-images-webkit.json).
- [Raw storage, routing controls and fixture startup](webkit-storage-results.json).

## Validation

- **110 targeted tests pass** across foreground streaming, Continue/retry, the
  stream accumulator, the real chat-container/scroller boundary and mounted
  thumbnail consumers.
- **Five existing Chromium journeys pass:** decoded image prefetch; text-only
  continuation of image history and new-image refusal; native workspace search/read
  navigation; stream/reload; stop with durable partial text.
- Production build, repository typecheck wrapper, documentation checks, targeted
  TypeScript/runner lint and diff checks pass. Typechecking uses the supported basic-auth/SQLite selection
  with sync/storage/background execution disabled; the default Clerk configuration
  initially required absent Cloud credentials. No credentials were added.
- The repository lint policy excludes Vue/test files; the build, typecheck and
  executable suites cover those changes. Existing duplicate auto-import warnings
  and the trusted-host plugin build qualification notice remain unchanged.
- No full repository test run, live-provider request, deployment or physical-device
  qualification was performed.

## Findings still needing evaluation

| Area | Current evidence and next useful work |
| --- | --- |
| Rich code/math streams | A fresh clean concurrent run still reaches **33.3 ms p95 at 4×**, with one long task; both replies save exactly. A separate instrumented run reaches 33.4 ms p95 and has about 261 ms of style calculation and 258 ms of layout, with a largest document layout around 30 ms. These event totals are diagnostic and are not an additive main-thread budget. Vue DOM-property patches, scroller measurement and first math-font invalidations appear in the trace. Isolate cold/warm font, DOM and layout costs before selecting another appearance-preserving change. Worker CPU is not fully qualified by the main-thread profile. |
| Large instantaneous scroll jumps | Previous virtual and fully mounted static controls both showed gaps. This round does not change overscan or the scheduler. Next: compositor/raster capture at realistic input cadence and physical touch inertia, distinguishing engine painting from virtual range updates. |
| Real plugin tool cards | The next [card audit](TOOL-CARD-AUDIT.md) removes redundant notifications/container updates and stale preloads, with a registered-card stream probe and selected lifecycle coverage. Ordered multi-card replies, sustained subscriptions/memory and repeated workspace switching remain open. The tall-viewport frame-budget case is intermittent on the committed baseline; general scroll positioning still needs evaluation. |
| WebKit private storage and devices | Raw private-context Blob writes still fail. Qualify private-mode behavior and actual iOS/Safari persistence/recovery separately from normal-profile results; retain existing data contracts when considering a remedy. |
| Intermittent WebKit compaction/import errors | The earlier intermittent reload/import finding has not been independently isolated in this round. Functional passes elsewhere do not establish error-free compaction/navigation. |
| First font paint and reduced-motion idle work | The prior font-readiness limitation and unattributed waiting-phase paint/layout work remain. Diagnose those with isolated traces; no font or motion appearance change is included here. |
| Visual sizing findings | Blank-theme target sizing and fractional geometry checks remain deferred under the user's explicit appearance-preservation constraint. |
| Broader qualification | Physical iOS/Android, sustained memory and thermal behavior, long sessions, large workspaces, repeated mount/unmount and workspace switching remain unqualified. Dialogs, editors, search, plugin surfaces and background/sync combinations have not all received a full performance audit. |

Current rich-stream receipts: [clean run](rich-stream-current.json) and
[separate diagnostic profile/trace summary](rich-stream-diagnostic.json).

## Reproduction

Use the offline production-journey and scroll harnesses on local port 3147,
following the previous section reports. Build with the supported `bun run build`
wrapper and serve with `bun run preview -- --host 127.0.0.1 --port 3147`.

```sh
bunx tsx audit-evidence/performance-20261022/stream-media-probe.mjs '{"mode":"image","cpuRate":4,"secondImage":true,"verifyLiveImages":true,"verifyReload":true}' /tmp/images-chromium.json
bunx tsx audit-evidence/performance-20261022/stream-media-probe.mjs '{"mode":"image","browser":"webkit","persistent":true,"secondImage":true,"verifyLiveImages":true,"verifyReload":true}' /tmp/images-webkit.json
bunx tsx audit-evidence/performance-20261023/webkit-storage-probe.mjs /tmp/webkit-storage.json
bunx tsx audit-evidence/performance-20261022/run-concurrent-pane-probe.mjs '{"rich":true,"synchronized":true,"cpuRate":4,"dbCounts":false}' /tmp/rich-current.json
```

The rich diagnostic adds `profile`, `trace`, `layoutAudit` and `phaseAudit` to
that last command. Do not compare its timings to clean runs as a speed result.
Command logs and canonical browser artifacts from this round remain local under
`/tmp/or3-followup-*`; the JSON receipts above are retained in the checkout.
