# Section 22: keep attachment loading idle during text streaming

Base: `1828bea4`. Branch: `codex/perf-stream-thumbnails`.

`useMessageThumbnails` normalized attachment hashes into a fresh array whenever
the streamed message projection changed. Its watcher therefore synchronized
unchanged attachments on every displayed text frame. While a thumbnail was
loading, each synchronization called `getFileMeta` again. The shared URL cache
deduplicated blob decoding, but metadata reads happened before that cache.

The computed hash list now reuses its previous value when the normalized
contents and order match. It still reads the message on each projection:
foreground streaming appends to a raw hash array, so caching the array input
by identity would miss later images. Workspace-generation guards, cache
retention and cleanup, the user preview limit, and all assistant images remain
owned by the existing code. No persistence, provider or public API changes.

## Production measurements

The local production journey uses real workspace controllers, stream parsing,
file intake, IndexedDB persistence and chat rendering. A disposable transport
emits one PNG, then 160 text chunks at a requested 25 ms interval. Another case
runs the fixture's native workspace search/read tools before those text chunks.
External requests are blocked. All runs use Blank/light at 1440 × 900, DPR 1.

Instrumentation counts actual thumbnail watcher entries in the served module,
IndexedDB file reads, selected Vue updates, DOM mutations, and animation-frame
intervals. A validated single-match bundle replacement can restore only the
original hash computed for a same-build control. Browser hooks, timers and
observers are removed afterward; no application measurement API was added.

The window starts after initial content is shown and ends after all trailing
text is displayed, before stream completion. Initial image intake is excluded.
The slow case delays an otherwise successful thumbnail decode by 1.5 seconds.

| Chromium 153, 4× main-thread CPU throttle | Original | Final |
| --- | ---: | ---: |
| Thumbnail syncs, normal decoded image | 160 | 0 |
| Thumbnail syncs, delayed decode | 160 | 0 |
| File metadata reads during delayed decode | 59 | 0 |
| Thumbnail syncs, native tools without attachments | 160 | 0 |
| Frame interval p95 across these cases | 16.7–16.8 ms | 16.7–16.8 ms |

The same-build original-behavior control independently reproduced 160 syncs
and 59 metadata reads. This establishes less work, not a demonstrated frame-rate
improvement. The ordinary decoded-image case already performed no file reads.

A second PNG arriving halfway through the final Chromium stream caused exactly
one new thumbnail sync. Both distinct images hydrated after completion, both
hashes persisted, and all 160 text chunks and the final marker were saved.
Its four metadata reads and one blob read include the new image's real intake
and loading; they are not the repeated unchanged-image reads above.

The native tool indicator remained connected with zero observed mutations in
both final Chromium and WebKit runs. WebKit's tool case also recorded zero
thumbnail syncs, with a 19 ms frame p95/max and no CPU throttle. Component
instrumentation did not discover every tool component, so this does not prove
zero internal tool computation. `ChatToolCardsEnd` still updated 160 times
even when empty; that remains a possible follow-up. These native fallback tool
results do not qualify source plugin cards or ordered assistant-part rendering.

Raw receipts: [stream-media-results.json](stream-media-results.json).
Runner: [stream-media-probe.mjs](stream-media-probe.mjs).

## Findings still open

- Generated-image placeholders disappear from the live display once trailing
  text is present in these Chromium runs, then hydrate after completion. Source
  inspection points to `ChatContainer` preferring accumulator text while the
  foreground image path updates the message snapshot without appending its
  placeholder to that accumulator. This is a diagnosis to verify and fix in a
  separate change. Zero image DOM mutations during the measured window cannot
  establish stable inline rendering: the image was absent from that window.
- WebKit's generated-image probes never reached thumbnail decoding or saved a
  file metadata row. The final implementation and the same-build original
  computed both timed out at readiness with empty metadata/cache and no page
  errors. This failure occurs before the work measured here and remains
  unexplained. WebKit image performance is not qualified. The unsuccessful
  second-image attempt likewise supplied no qualifying measurement.
- This change does not introduce general per-hash request deduplication. A
  genuine attachment-list change may still overlap an earlier load. Broader
  loading/removal races are outside this repair.

## Regression and validation

The canonical mounted-thumbnail test now holds an initial metadata read while
replacing message projections with equal attachment contents in array and JSON
forms. It failed on the original code with 31 reads instead of one. It also
checks that a later raw-array append loads the new image. That latter assertion
rejected an intermediate identity-cached input approach before final validation.

- 40 tests pass across mounted workspace thumbnail consumers, shared thumbnail
  cache, and message media prefetch, including workspace changes and cleanup.
- Production build and application typecheck pass.
- Five existing Chromium browser checks pass: image prefetch, text-only model
  image-history continuation, native search/read navigation, stream/reload,
  and stopping with durable partial text.
- Three WebKit journeys pass: native search/read navigation, stream/reload and
  stopping. Two image-backed checks fail before exercising their assertions:
  the scroller fixture stays at `loading`, and image-history initialization
  reports `ERR_INTERNAL` before mounting its composer. The latter stack reaches
  a Dexie mutation callback. These are retained failures, not passes; their
  relationship to the image-intake probe and browser/environment still needs
  investigation. The exact canonical failures were not rerun on the original
  source; only the generated-image probe has the same-build original control.
- Targeted lint passes for production TypeScript and the audit runner. The
  repository lint configuration excludes the unit-test file; executable tests
  provide its validation.

Build and preview use the documented offline production-journey flags from
the other section reports, on local port 3147. Example measurements:

```sh
bunx tsx audit-evidence/performance-20261022/stream-media-probe.mjs '{"mode":"image","cpuRate":4,"decodeDelay":1500}' /tmp/stream-media-slow.json
bunx tsx audit-evidence/performance-20261022/stream-media-probe.mjs '{"mode":"image","cpuRate":4,"secondImage":true}' /tmp/stream-media-second.json
bunx tsx audit-evidence/performance-20261022/stream-media-probe.mjs '{"mode":"tool","browser":"webkit"}' /tmp/stream-media-tool-webkit.json
```

Current-run logs and browser artifacts are local under
`/tmp/stream-thumbnails-*`; committed JSON receipts retain the measurements
and failed WebKit image controls.
