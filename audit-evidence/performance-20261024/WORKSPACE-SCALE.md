# Workspace scale: initial chat search repair

October 24, 2026. This round fixes a measured search preparation pause and adds
repeatable real-browser scale qualification. It does **not** finish the entire
workspace-scale audit or introduce automatic chat archiving.

## Scope and repository state

Work began on `or3-cloud` after fetching upstream, with no upstream commits
missing and the two earlier audit commits preserved. The baseline is
`bec4a591`; the earlier audit remains in PR #304. This search change is packaged
separately on `codex/workspace-search-scale`, based on that PR's branch, so its
review contains only the new repair. No merge or deployment is part of this round.

No templates, CSS, themes, geometry, schemas, storage limits, sync protocol,
provider authority or stored user records changed. The browser fixtures use
disposable IndexedDB databases and do not modify the active workspace.

## Investigated and fixed

The initial command-palette chat loader used two unbounded reads: every thread,
then every raw message. At 10,000 chats and 104,990 messages, one response
materialized all 104,990 raw messages, including unused tool payloads. Preparing
the normalized conversation resources then blocked the main thread.

The loader now:

- Reads threads and messages in 500-row primary-key pages. This includes legacy
  messages without `order_key`; compound-order indexes would omit those rows.
- Retains searchable text and the metadata needed for canonical order, retry
  filtering and reference-branch anchors, without retaining raw tool/reasoning
  payloads in the preparation corpus.
- Uses the existing canonical conversation projector for full and incremental
  loads, preserving non-visible anchor rows, inherited slices and incomplete
  history behavior.
- Yields after approximately 8 ms of conversation-resource preparation and checks
  cancellation before subsequent reads and resource work. Already issued reads
  may finish; cancellation is not a promise of interrupting IndexedDB mid-request.

All history remains searchable. This is a bounded-read and scheduling repair;
the full search corpus/index still uses memory proportional to searchable history.
One extremely large record or conversation can still exceed a work budget.

## Measurements

The same agent-browser Chromium session, warm development server and deterministic
fixture were used for three before/after diagnostic samples. The fixture includes
10,000 chats, 104,990 messages, a 5,000-message conversation, reference branches,
legacy ordering-key omissions and unused tool payloads. A 10 ms timer measures
heartbeat gaps; these are **not INP measurements**. Browser environment is retained
in [the environment receipt](search-browser-environment.json).

| Observation | Before | Paged loader |
| --- | --- | --- |
| Largest database result | 104,990 rows | 500 rows |
| Source heartbeat gaps, three samples | 293.5 / 295.7 / 317.8 ms | 25.0 / 28.9 / 22.7 ms |
| Source long tasks observed | 288 / 290 / 314 ms | None observed in these samples |
| Source elapsed time | 908 / 975 / 1,046 ms | 944 / 905 / 882 ms |
| Returned chat resources | 10,000 | 10,000 |
| Content/metadata diagnostic checksum | 638767308 | 638767308 |

[Before receipt](search-before-10000.json),
[matched paged receipt](search-paged-10000.json). Checksums are diagnostic comparisons,
with independent canonical-content assertions in the owner regression; they are
not a collision-free byte equivalence proof. The [1,000-chat baseline](search-before-1000.json)
contains the smaller profile. A [compact Chrome trace summary](search-before-trace-summary.json)
also records the original IndexedDB result-processing stall. Its whole-operation
events include diagnostic checksum work and nested durations must not be summed.
The 321 MiB raw trace was kept out of Git.

The named Playwright harness independently qualifies three repetitions at each
size and CPU profile. These use Playwright's browser, so their timings are not
substituted into the matched agent-browser comparison above.

| Profile | Source heartbeat range | Result |
| --- | --- | --- |
| 1,000 chats, normal CPU | 10.8–13.4 ms | 3/3 repetitions pass |
| 10,000 chats, normal CPU | 16.4–25.7 ms | 3/3 repetitions pass |
| 1,000 chats, 4× CPU slowdown | 18.5–26.0 ms | 3/3 repetitions pass |
| 10,000 chats, 4× CPU slowdown | 34.0–52.0 ms | 3/3 repetitions pass |

[Normal 1,000](search-normal-1000.json), [normal 10,000](search-normal-10000.json),
[slow 1,000](search-slow-1000.json), [slow 10,000](search-slow-10000.json).
The harness asserts resource coverage, tail/long-conversation search hits without
fallback, bounded row transfers, full row counts and cancellation. It records
source/index timing, queries, sidebar reads and approximate heap usage. Approximate
heap readings and three disposed-index cycles do not qualify leaks or sustained memory.

## Validation and encountered failures

- The new real-Dexie owner regression [fails before repair](search-regression-before.txt)
  on a 1,201-row response exceeding the independent 1,000-row transfer budget.
  The [final search suites](search-owner-tests-final.txt) pass **82/82 tests in
  18 files**, including legacy text, workflow output, deleted/superseded content,
  non-visible branch anchors, cancellation and existing workspace isolation.
- [Normal browser qualification](search-browser-normal-final.txt) and
  [4× CPU qualification](search-browser-slow.txt) each pass both sizes, three
  repetitions per size, without retries. The first normal run also passed;
  the final run retains standalone JSON receipts.
- Three existing [interaction controls](search-interaction-final.txt) pass after
  restoration of the repaired loader: focus/overlay ownership, preview selection
  and immediate-Enter stale-result protection.
- The fourth selected [interaction case](search-interaction.txt), mobile palette
  width, reports `scrollWidth=408` against a 390 px limit. It fails identically
  with the committed pre-repair loader: [baseline run](search-mobile-baseline.txt),
  [source restoration receipt](search-mobile-baseline.json). No appearance or
  assertion change was made. Whether this reflects visible overflow or a
  theme/coordinate measurement issue still needs evaluation.
- [Application typecheck](search-typecheck.txt), [targeted lint](search-lint.txt),
  [documentation examples](search-docs.txt), formatting of new files and final
  diff checks pass. The first typecheck launch hit the sandbox's IPC restriction;
  the next lacked configured Clerk/Convex credentials. The successful supported
  wrapper run selects installed Basic Auth/SQLite/filesystem providers, without
  changing saved configuration. Existing duplicate-import warnings remain.
- A fixture accounting failure in the first wider suite counted four setup reads;
  observation now starts after setup. No production limit or assertion budget
  was loosened. The [initial suite log](search-owner-tests.txt) is retained.

No full repository suite or production build was rerun. Qualification here is
the browser development owner and selected integration paths, not a deployed
production artifact, Cloud/provider matrix or physical-device certification.
[Source and fixture hashes](search-source-hashes.json) identify the delivered inputs.

## Repeat the browser qualification

```sh
bun run test:e2e:workspace-scale
OR3_SCALE_CPU_RATE=4 bun run test:e2e:workspace-scale
```

The named lane starts an isolated local server on port 3151 with Cloud services
disabled. To reuse an already configured matching server, set `PW_SKIP_WEB_SERVER=true`.
Detailed JSON files are retained under `test-results/workspace-scale`; the report
copies above preserve this round's results. The probe can also be loaded from
`tests/e2e/fixtures/workspace-search-probe.js` with a named agent-browser session's
`eval --stdin`, followed by `__workspaceScale.seed(10000)`, `run()`, `abort()` and
`close()`. Lazy search dependency import is warmed before timed phases.

## Still needs evaluation

1. **Initial indexing and total memory:** the 10,000-chat full index still takes
   roughly 3.1–3.4 seconds at normal CPU in the retained final runs. The repair
   does not bound total index size. Evaluate long-session retained heaps, much
   longer individual conversations, dense reference ancestry, other content
   sources and multi-source concurrent indexing before selecting a memory budget
   or introducing worker/persistent indexing.
2. **Sidebar family compatibility:** the ordinary 50-row sidebar reads 100 thread
   headers in this fixture, but expanding a two-member family reads 10,001 header
   rows because legacy discovery scans the workspace. Before samples take about
   58–59 ms with yielding. This linear compatibility cost is measured and remains
   unchanged; any optimization must preserve legacy family discovery.
3. **Storage pressure and offline policy:** no byte/chat cap or 30-day removal
   rule was added. Browser quotas, protected local originals, existing verified
   file-cache eviction and offline availability require separate qualification.
   Cold chat eviction needs explicit partial-replication support, preserving
   sync cursors, branch dependencies, search/export/context coverage and pending
   writes. Ordinary synced deletion must not be used for cache eviction.
4. **Devices and other surfaces:** actual Safari/iOS/Android behavior, slow disks,
   quota failures, repeated account/workspace changes, attachment-heavy workspaces,
   editors and sync/background/provider combinations remain open. The mobile
   palette width assertion above also remains open under the appearance constraint.

These are concrete remaining evaluations and limitations, not claims that every
listed area contains a confirmed defect.
