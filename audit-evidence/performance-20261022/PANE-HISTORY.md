# Section 11: scope live history to each conversation

Baseline: `4251a9c6`. The two-pane production audit found unnecessary IndexedDB
reads and reactive history replacement in an idle pane while its neighbor
streamed. This section isolates the existing history observers and qualifies
concurrent sends, persistence, and browsing away from an active response.

## Finding and repair

`useMultiPane` previously combined all open conversations in one Dexie
`liveQuery(Promise.all(...))`. A write in any observed conversation reran every
query and assigned every pane a newly projected history array. Idle
`ChatContainer` watchers then passed that array to `replaceCanonicalHistory`,
which cloned its messages and UI projections again.

There is now one owned live query per distinct open conversation. Panes showing
the same conversation share its observer. Binding changes retain observers for
conversations that remain open, release those with no remaining panes, and add
only newly opened conversations. Deliveries check both observer identity and
the captured database. Workspace changes and scope disposal release all
observers. Existing initial reads and foreground stream generation guards remain
in their current owners.

The canonical integration test uses real Dexie writes and Vue effects. A
neighboring edit must leave the idle history unchanged, shared views must both
receive it, closing one shared view must preserve the other, and rebinding the
last view must detach the old conversation. It failed on the baseline because
the idle history watcher fired, and passes with this repair. Existing integration
coverage continues to exercise incoming rows, edits, deletes, workspace switches,
old-workspace writes, and disposal.

## Single active stream

The production probe opens two real workspace panes, each with 120 synthetic
messages. The left pane browses the middle of its history while the right sends
a 10,354-character Markdown reply through the existing foreground controller and
persistence path. Only the transport is synthetic: 64-character SSE chunks every
16 ms. A disposable context blocks external requests.

Environment: Chromium, 1440×900, DPR 1, Blank/light at 90% scale, standard OR3
workspace profile. IndexedDB instrumentation counts actual indexed message
history reads. Frame intervals are rAF samples; no build or test runner operates
concurrently.

| 4× CPU single stream | Before | After |
| --- | --- | --- |
| Idle conversation history reads | 13 | **0** |
| Active conversation history reads | 14 | 13 |
| Idle pane DOM mutations | 0 | 0 |
| Frame interval p95 (ms) | 35.3 | 33.8 |
| Maximum frame interval (ms) | 82.0 | 64.7 |
| Long tasks | 0 | 0 |

Both runs retain their own initial scroll position and message anchor exactly,
save the complete expected reply, render its end marker, and finish at the
right pane's bottom. The sampled anchors differ between contexts; this is not a
pixel-for-pixel comparison of identical layout. The reliable gain is eliminated
idle history work, not proof of a timing improvement or a repaired visible jump.
Settled DOM was already unchanged before the fix.

A normal-CPU after control also has zero idle reads and mutations, exact saved
output, an unchanged anchor, and zero bottom distance. Its frame p95 is 9.2 ms,
maximum 16.9 ms, with no long tasks.

## Concurrent streams and offscreen browsing

`concurrent-pane-stream-probe.js` sends through both real pane controllers,
then browses the left history while the right follows its response. It observes
the visible settled message nodes and measures their original anchor. Both
conversations are read only as their own pending/saved rows change.

| After-only qualification | Prose, 4× CPU | Prose, normal | Code/math, 4× CPU | Code/math, normal |
| --- | --- | --- | --- | --- |
| Frame interval p95 (ms) | 34.5 | 9.1 | 58.3 | 10.2 |
| Maximum frame interval (ms) | 83.4 | 16.6 | 292.2 | 58.4 |
| Long tasks | 1 | 0 | 19 | 0 |
| Transport overlap (ms) | 3,805 | 2,755 | 2,852 | 936 |

Every qualifying run saves both replies exactly, keeps the left anchor connected
at the same offset and scrollTop, and ends the right pane at bottom distance
zero. The left response remains outside the rendered window until the normal
scroll-to-bottom control reveals its end marker. The four observed settled
message mutations are Retry buttons losing their disabled attribute after the
left transport finishes; their content does not change.

Prose output is approximately 10.5 KB per pane. Its measurement starts after both
sends and the browsing gesture, excluding earlier admission/output. Code/math
output is approximately 3 KB per pane, with 12 TypeScript fences, 12 inline
expressions, and 12 display expressions. Its synthetic transports wait until
both sends are admitted and the left pane is scrolled up, then begin together.
This includes cold rich rendering. An initial ungated rich diagnostic could not
establish stream overlap and was rejected by the probe; it is not a qualifying
sample.

The rich 4× run exposes remaining work: a 203 ms long task and repeated 50–83 ms
tasks. These results do **not** establish smooth concurrent rich rendering.
Profiling that path is the next section. Normal CPU's zero long tasks also does
not excuse its 58 ms worst frame interval.

## Validation and reproduction

- 47 focused tests pass across `useMultiPane.sync.integration`,
  `useMultiPane.test`, and `ChatContainer.test`.
- Four existing production browser journeys pass: stream/reload,
  partial-output stop/reload, interrupted-stream recovery, and continuation stop.
- The existing pane-swap browser test passes after correcting stale setup and
  geometry assumptions. Fresh local workspaces require the public Dismiss
  welcome action. Blank's first pane owns the internal divider, and its 90%
  zoom reports a one-screen-pixel border as 1.11111 logical CSS pixels. The
  test retains hover/focus, active-pane identity, swapping, and reload checks.
  Initial runs failed at onboarding, then at old outer-border expectations,
  then at the unscaled width assertion; none was a history-observer failure.
- Production build, application typecheck, changed-file lint, and diff whitespace
  validation pass. Typecheck uses installed Basic Auth/SQLite/Filesystem
  providers and a disposable placeholder secret.

Start the production journey/scroll harness with the established audit build and
preview flags on port 3147. Pass `multi-pane-stream-probe.js` or
`concurrent-pane-stream-probe.js` to Playwright's unsafe runner as `filename`.
For options, load the function into a code callback and invoke it with
`{ cpuRate: 1 }` or `{ cpuRate: 4, rich: true, synchronized: true }`.
Both probes own and close their disposable contexts, reset CPU throttling,
and deny external requests.

Raw receipts are `pane-history-baseline.json` and `pane-history-results.json`.
These are single local measurements, not repeated medians, mobile-device
qualification, a proof of every painted frame, tool-stream coverage, or a
cross-browser guarantee.

