# Section 16: stable message handlers across lazy renderers

Baseline: `d587fba9` (application build `a0d04849`; section 15 changed only
audit artifacts). Production observations found that settled message components
were quiet, but their lazy wrappers still updated on almost every token. This
section removes that work and checks the surrounding composers, tabs, and sidebar.

## Finding and repair

The `ChatContainer` row slot created five fresh edit/navigation listeners each
time the virtual window refreshed. Vue's async component wrapper receives these
listeners as vnode props. Unlike the resolved message component, the wrapper
does not declare the message's emitted events, so the changed listeners scheduled
updates even when all message data remained unchanged.

`ChatMessageHost.vue` now owns stable callbacks for each mounted row. It reads
the current `message` prop when a callback runs, preserving the container's
existing navigation checks after same-ID history replacements. Other events
retain their original listeners and arguments through `$attrs`. The small host
is eager; the selected theme renderer remains lazy. Its root is the renderer,
so it adds a Vue instance per mounted row but no DOM wrapper or global cache.
The scroller's unchanged key lookup also uses a stable function.

## Production update counts

The existing concurrent-pane probe opens two real controllers with 120 synthetic
history messages each. The left pane browses retained history while the right
follows the response. Synthetic SSE transports start together, delivering 64
characters every requested 16 ms. Prose is approximately 10.5 KB per response;
rich output is approximately 3 KB with 12 TypeScript fences and 12 standalone
double-dollar formulas. Single-dollar examples remain literal text.

All contexts are fresh and local-only: bundled Chromium 153.0.8010.12, headless,
1440 × 900, DPR 1, Blank/light at 90% scale, 4× main-thread CPU throttling. No
build, typecheck, or other browser runner operates during measurements.

| During transport | Prose before | Prose after | Rich before | Rich after |
| --- | ---: | ---: | ---: | ---: |
| Async wrapper updates | 23,205 | 330 | 6,344 | 93 |
| Resolved message updates | 329 | 330 | 91 | 93 |
| Composer component updates | 0 | 0 | 0 | 0 |
| Visible tab bar component updates | 0 | 0 | 0 | 0 |
| Sidebar DOM mutations | 0 | 0 | 0 | 0 |
| Editor transactions | 0 | 0 | 0 | 0 |

Lazy-wrapper updates fall by 98.6% for prose and 98.5% for rich output. The
remaining streaming wrapper updates match the active resolved message. All five
listener-change counters disappear. Prose scroller `itemKey` changes fall from
662 to zero; row-content revisions continue to update the virtual window.

The diagnostic walks Vue's production vnode tree and adds owned `beforeUpdate`
callbacks only to initially mounted instances. It reads raw shallow props to
avoid adding reactive dependencies and removes its callbacks/listeners afterward.
Newly mounted instances are not counted; these are not whole-app lifetime totals.
There are 8,152 initially observed instances before and 8,222 after in the prose
pair, including 70 new row hosts. These instrumented runs establish update
counts, not clean timing gains.

The sidebar, visible tabs, and both composers have zero DOM mutations during
prose transport. Completion changes six tab nodes and five nodes/attributes in
each composer as status and controls update. Rich output records eight style
mutations around the right scroll-to-bottom control in both cases. Both editors
have zero transactions, document changes, or selection changes. The observed
sidebar resize layout still updates 12–13 times during prose transport without
changed props; its cause and material cost remain follow-up work.

All runs save both replies exactly, retain their own left reading anchor and
scrollTop, finish the right pane at bottom distance zero, and reveal the left
end marker through its normal control. The four settled-message DOM mutations
are Retry controls re-enabling after transport; completed rich nodes remain
connected with zero mutations in both diagnostic runs.

## Timing limits

Three separate prose runs omit component counters and CPU/timeline profiling.
They retain the probe's frame, DOM, and IndexedDB-read observations. Baseline
runs preceded the rebuild; after runs followed it, so they are not an interleaved
same-build experiment.

| 4× CPU prose, per run | Before | After |
| --- | --- | --- |
| Frame interval p95 (ms) | 16.8 / 16.7 / 16.7 | 16.7 / 16.8 / 16.8 |
| Maximum frame interval (ms) | 50.0 / 66.6 / 66.6 | 50.1 / 50.0 / 50.1 |
| Long tasks | 1 / 1 / 2 | 1 / 1 / 1 |

The samples do not establish a recurring frame-time improvement. A normal-speed
after-only control has p95 16.7 ms, maximum 16.8 ms, and no long tasks. One
separate before/after CPU and timeline profile records FunctionCall totals of
320 / 304 ms and layout totals of 224 / 209 ms, but both have a 100 ms worst
frame interval under profiling. These single diagnostic traces do not establish
a reliable CPU percentage or remove the remaining worst-frame concern.

## Validation and reproduction

The existing real-scroller component regression now wraps its renderer in
`defineAsyncComponent`. Before the fix, three tail changes also update two
settled lazy wrappers six times; afterward both the lazy boundary and resolved
renderer update only the tail. Existing coverage also checks eligibility and
edited content. Additional assertions protect same-ID compaction replacement
and edit/save bottom-following behavior. All 22 ChatContainer tests pass.

Production build and application typecheck pass. Typecheck uses the installed
Basic Auth/SQLite/Filesystem providers with a disposable placeholder secret.
Existing duplicate-import and generated-code warnings remain.

All nine Chromium scroll canaries pass. Six production Chromium journeys pass
for rapid branching, responsive rich messages/edit cancellation in all three
themes, stream/reload, and stop/partial-output reload. The compaction source and
landmark navigation journey also passes after correcting two stale test assumptions:

- It expected reload to erase a source draft, despite the existing documented
  durable-draft contract. It now requires the original draft to remain, without
  filling it again. The initial Chromium run was six passed, one failed at that
  old empty-draft expectation; earlier source navigation checks had passed.
- Its immediate bounding-box dereference failed in WebKit. Three diagnostic
  repeats each observed a null first Playwright box followed by a valid box on
  the next poll. Direct DOM geometry and scrollTop were unchanged across those
  samples, with the row intersecting the scroller. The same viewport assertion
  now polls for a valid intersecting box; temporary geometry instrumentation is
  removed. The samples are retained in
  [shell-wrapper-webkit-navigation.json](shell-wrapper-webkit-navigation.json).

WebKit passes the three responsive theme journeys and the corrected navigation
journey. Its initial run was three passed, one failed at the immediate box read;
the three diagnostic navigation repeats also pass. WebKit screenshots use the
existing `PW_TEST_SCREENSHOT_NO_FONTS_READY=1` audit workaround; those runs are
functional coverage, not font-ready visual or timing qualification. Final
navigation reruns use the simplified production test in both browsers.

The passing final WebKit navigation run also logged an intermittent module-import
error. Three additional traced repeats all pass; one records the same error
during the first reload, before its navigation commits. The affected module and
root cause remain unidentified, so this is not an error-free WebKit qualification.
The timing excerpt is retained in
[shell-wrapper-webkit-import.json](shell-wrapper-webkit-import.json); full local
traces are under `test-results/shell-wrapper-webkit-import/`. This reload/import
behavior remains follow-up audit work rather than a reason to suppress errors.

`git diff --check` passes. ESLint checks the audit scripts successfully but
ignores the changed Vue and test files under the repository configuration;
it supplies no validation of those ignored files. Local functional artifacts
are under `test-results/shell-wrapper-*`.

Use the established production journey/scroll build and preview flags on port
3147, then run:

```sh
bunx tsx audit-evidence/performance-20261022/run-concurrent-pane-probe.mjs '{"shellAudit":true,"synchronized":true,"cpuRate":4}' /tmp/shell-prose.json
```

Add `"rich":true` for rich diagnostics; omit `shellAudit` for the timing workload.
Use `cpuRate:1` for normal speed or `profile:true,trace:true` for diagnostics.
The runner creates and closes its own browser, blocks external requests, resets
throttling, and has a 90-second watchdog.

Raw receipts are [shell-wrapper-baseline.json](shell-wrapper-baseline.json) and
[shell-wrapper-results.json](shell-wrapper-results.json). An earlier exploratory
baseline observed a hidden tablist rather than the visible tab bar; it is excluded
from these receipts. This section does not qualify physical devices, all themes'
streaming performance, tool output, every painted frame, search updates, or the
large-jump gaps recorded in section 15.
