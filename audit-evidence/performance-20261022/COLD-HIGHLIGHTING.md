# Section 14: move host syntax highlighting off the UI thread

Baseline: `09095004`. After section 13 removed broad style invalidations,
the first TypeScript block still caused a roughly 200 ms main-thread task
under 4× CPU throttling. A profile and isolated Shiki experiment attribute
the cold cost to first tokenization. Switching to the WebAssembly engine did
not improve first-highlight wall time in that experiment and added loading
cost; the existing JavaScript engine is retained.

## Implementation and boundaries

Chat, Documentation and Help pass one stable `components.codeblock` override
to Streamdown. Its adapter leases a shared worker and delegates to the existing
CodeBlock component, retaining toolbar actions, line numbers, selection, HTML
escaping and theme handling. The dependency patch adds an optional asynchronous
highlight function; its existing generation guard ignores stale completions,
and unmount invalidates outstanding results. Rejection uses escaped plain code.

The worker client sends one job at a time and retains only the newest queued
snapshot per block. It caps the queue at 64 jobs, declines highlighting above
250,000 characters, and terminates a job after 20 seconds. These limits affect
coloring only. Source text remains intact for display, copy, download and storage.
Worker errors settle every pending promise and do not create a restart loop
while existing owners remain mounted. Releasing the final owner or HMR disposes
the worker. Reactive theme objects are copied into cloneable snapshots.

The pinned patch extracts the existing Shiki registry and highlighter into
`streamdown-vue/shiki`, an ESM entry without DOM-dependent Markdown imports.
The renderer imports that same implementation; there is no second registry in
the UI realm. Host language configuration runs in both UI and worker realms.
Remote loaders recognize workers as browser environments. The trusted plugin
UI kit's raw renderer and highlighter retain their existing main-thread behavior.
Source integrations must configure worker languages through the shared host
language module; UI-only registrations do not cross worker boundaries.

The emitted worker entry is 188.41 kB before compression, plus language chunks
loaded on demand. It is requested only when a code block asks for highlighting.
This is an additional worker asset and heap, not a measured reduction in total
application transfer size. The original attempt imported the entire renderer,
producing a 679.97 kB worker and a `document is not defined` startup failure.
Its plain-fallback timing was rejected and is explicitly excluded from results.

## Paired production measurements

Same build, alternating fresh contexts, local-only synthetic SSE and history,
two simultaneous approximately 3 KB responses, 120 history rows per pane,
Blank/light at 90%, 1440×900 DPR 1 Chromium. Each response has 12 TypeScript
blocks and 12 standalone formulas. Single-dollar examples remain literal text.

The control intercepts exactly one observed production bundle and sets only
the adapter's `highlight` prop to undefined. This activates the original
renderer path with the same UI and grammar configuration. The probe verifies
one control replacement and zero highlighting workers in baseline runs, versus
zero replacements and one shared worker in after runs. Both paths render all
12 highlighted blocks in the measured right pane.

| Per run, 4× main-thread CPU | Main-thread control | Worker |
| --- | --- | --- |
| Frame interval p95 (ms) | 26.7 / 32.5 / 32.2 | 34.7 / 32.5 / 32.2 |
| Maximum interval (ms) | 267.5 / 216.1 / 208.7 | 76.5 / 141.5 / 65.8 |
| Long-task count | 5 / 4 / 5 | 3 / 4 / 3 |
| Largest long task (ms) | 206 / 214 / 204 | 63 / 68 / 61 |

The cold tokenizer long task leaves the main thread. Steady p95 does not
materially improve, and the 141.5 ms maximum in one worker run remains a real
limitation. At normal CPU speed, one control/after pair records p95 9.7 / 9.4 ms,
maximum 51.5 / 16.6 ms and one / zero long tasks.

**CDP throttles the main thread, not this worker's CPU.** The isolated worker
tokenization takes about 53 ms while the throttled main-thread equivalent takes
about 210 ms. These measurements demonstrate responsiveness under UI-thread
pressure, not an equivalent slow-device end-to-end speedup. Actual slow devices
and larger queues remain unqualified.

Every paired run saves both complete responses exactly, preserves the left
reading anchor, follows the right tail, and reveals the left final marker on
request. Completed heading/code/math nodes remain connected with zero mutations.
The four settled Retry-control changes happen after transport completion.
A viewed production screenshot confirms readable code, math, line numbers and
actions: `.playwright-mcp/cold-worker-rich-corrected.png`.

## Validation

- 32 focused tests pass: real renderer, worker pool and ChatContainer. The new
  renderer regression first failed because no async highlight request occurred;
  it now covers out-of-order results, actions, line numbers and escaped fallback.
  Pool checks cover coalescing, ownership, reactive theme snapshots, worker
  errors, message errors, timeout, bounded work and final cleanup.
- Seven Chromium browser journeys pass: rich layout/edit/reload in three themes,
  unavailable-worker download fallback, mixed languages/Copy, and stream/reload
  plus stop/partial persistence.
- Five WebKit journeys pass: the three theme cases, unavailable-worker download,
  and mixed local languages/Copy. The theme cases use the previously established
  `PW_TEST_SCREENSHOT_NO_FONTS_READY=1` workaround; this is functional WebKit
  evidence, not physical iOS qualification.
- The mixed Chromium case supplies a controlled C++ module for the existing
  remote loader and verifies one request. Playwright WebKit did not intercept
  that worker import through either page or context routing, so those exploratory
  remote-control attempts are not passes. The final WebKit case omits the remote
  fence and records `remoteCovered: false`; local aliases, escaped fallback and
  Copy are still exercised. No test is permanently skipped.
- Production build and application typecheck pass. Changed TypeScript lint and
  diff whitespace checks pass; repository lint ignores Vue and test files.
- `patch-package 8.0.1 --error-on-fail` applies the full patch to reconstructed
  original package files. All five resulting files are byte-identical to the
  tested installation. CommonJS remains unchanged; the new entry is ESM-only.

## Reproduction and receipts

Use the production harness/preview flags from prior sections. Run
`concurrent-pane-stream-probe.js` with
`{ rich: true, synchronized: true, cpuRate: 4, dbCounts: false }`.
For the matched control add `mainThreadHighlightControl` from
`cold-worker-results.json`. Its bundle/needle must match the actual build;
the probe fails rather than silently accepting a missing replacement.
Repeat at `cpuRate: 1`. Do not time while a build, typecheck or test runner runs.

The isolated engine experiment can be rebuilt with:

```sh
bun build audit-evidence/performance-20261022/cold-engine-fixture.js audit-evidence/performance-20261022/cold-engine-worker.js --outdir .output/public/__perf-highlighter --target browser --splitting --minify
bun audit-evidence/performance-20261022/serve-cold-engine-fixture.ts
```

Then run `cold-engine-probe.js` through the Playwright browser-code tool.
The fixture server serves only these JavaScript files on localhost:3148.
It is separate from the production preview and should be stopped afterward.

Receipts: `cold-engine-diagnostic.json`, `cold-worker-prototype.json`, and
`cold-worker-results.json`. Local browser artifacts are under
`test-results/cold-worker-*`. The full audit remains open for painted scroll
coverage, touch/trackpad behavior, tool streams, remaining layout tasks and
real-device qualification.
