# Continued stability audit

Current overview: [stability status and latest notification-lifecycle repair](STABILITY-STATUS.md).
It consolidates completed fixes, current validation and remaining evaluations.

Latest: [WebKit compaction import investigation](WEBKIT-IMPORT.md) identifies the
observed loader error as an interrupted warm-up and strengthens the real journey.
The wider audit remains open.

The [rich-content font evaluation and remaining audit work](RICH-FONT-EVALUATION.md)
records three cold/warm pairs, diagnostic controls and the unresolved audit areas.

Follow-up: [October 24 scroll-intent repair](SCROLL-INTENT.md) adds a verified
browsing transition fix and records continued failures of the large-reversal
case. The earlier findings and measurements below retain their original scope.

Date: October 23, 2026. Branch: `or3-cloud`. A fresh fetch found no upstream
changes beyond `25c758b2`; the earlier local image commit remains `a996424a`.
The earlier tool-card fixes, this continuation and their evidence are local and
uncommitted. No push, PR, deployment, schema or dependency change occurred.

The broader audit is still active. This report records progress and remaining
work; it does not claim that every application surface is qualified.

**Remaining evaluation is required.** The source-card scroll race, rich-stream
layout cost and WebKit findings are unresolved observations. Large workspaces,
long sessions, memory growth, repeated workspace switching, physical devices
and the other surfaces listed below still lack full qualification. Passing
targeted fixes does not clear those areas.

## New fix: stop work after a renderer fails

A failed source-card renderer aborted its public context and showed the existing
fallback, but retained the slot's Dexie `liveQuery`. Subsequent writes to that
message still read its persisted card state, even though no card could use it.

`ToolCardSlot` now shares owned-resource cleanup between failure and unmount.
Failure unsubscribes persisted state and disconnects card preload, visibility
and theme observers. The existing resize observer remains until unmount so the
fallback can still be measured. Admitted state writes retain their normal queue,
ownership and persistence behavior.

The regression extends the existing message-transaction suite with a real Dexie
store, failed renderer and healthy control card. Four subsequent writes produced
**four failed-card reads before the fix and zero after it**, while the healthy
card continued reading and displaying every committed state. The failed public
context remains aborted. No production test seam or new global registry was added.

Receipts: [expected baseline failure](tool-card-failed-reads-before.txt),
[23-case owner suite](tool-card-failed-reads-after.txt).

## Frame qualification: capacity explains the intermittent failure

The exact failing 3000 px viewport had **19 visible cards**, with all **12 live
frames visible**. The first card was visible but waiting, alongside six others.
There was no offscreen frame eligible for eviction. The existing documented
policy retains visible frames and resumes waiting ones when capacity frees.
This run was consistent with that policy, rather than evidence of a lost frame.

The existing 30-frame test originally required the first frame to appear while
capacity could still be exhausted by other visible frames. Its original history
and the current budget implementation were inspected. The test still uses the
3000 px viewport and 30 cards, preserves its original cap assertions, and adds a
cap check after scrolling. It then resizes to 900 px to free slots before its
existing first-frame recovery assertion. The separate offscreen-preload/release
case remains intact. No frame cap, eviction rule or production qualification
gate changed.

Both targeted cases pass, and the frame case passes in the full suite. The public
guide now explicitly describes waiting when more than 12 cards are visible.
Portable frames remain production-gated; this fixture does not qualify containment.

Receipt: [failing over-capacity geometry and actual host visibility](tool-card-frame-overcapacity.json).

## Three-card streaming and reload

The existing offline probe now supports one to three real foreground tool rounds.
A new run executed three Quiz calls with distinct IDs/questions and text between
the rounds, then held a continuation open for 120 text chunks at 25 ms intervals.
All three mounted contexts stayed live and connected, with **zero card update
notifications, component updates or subtree mutations** during trailing text.
Card order and text-body order were checked during streaming; all three questions
were restored in order after reload. Model requests continued excluding card metadata. External traffic was
blocked; this uses no live provider.

The current canonical UI projection groups inline tool cards before the message
body and does not populate optional interleaved `UiChatMessage.parts`. The probe's
initial interleaving assertion failed against that existing presentation. Its
final checks follow the current grouping, preserve card order and verify reload;
no layout was changed to satisfy the probe. Interleaved rendering and arbitrary
custom projections are not qualified by this run.

The run recorded 49 message reads; that is a timing-dependent observation, not a
database-read reduction or a production frame-rate claim. Three short calls and a
120-chunk stream do not establish sustained memory or long-argument behavior.

Receipt: [three-card stream and reload](tool-card-multiple-stream.json).

## Source scrolling remains open

The complete Chromium suite again passed 15 of 16 cases. This time the failure
was the source-card saved-state virtualization round trip; the corrected frame
case passed. Earlier passes of the source case did not establish reliability.

A diagnostic captured the failure with the root at **`scrollTop: 1604`** and the
first slot outside the unchanged 600 px preload range. Explicitly returning to
zero mounted that card and restored its saved answer correctly. This separates
scroll positioning from a persistence-loss claim.

The trace records a bottom-follow write from 7090 to 8692 just before the upward
wheel event is observed at 1602, followed by layout compensation to 803 and then
1604. This suggests an interaction between asynchronous wheel delivery,
bottom-follow growth and row measurement; it does not yet prove a complete root
cause or justify changing the scroller's policy. The diagnostic records actual
input and programmatic setter stacks without changing application behavior.

Receipt: [failed input/scroll/intersection trace and successful explicit-top control](tool-card-scroll-input-failure.json).
The normal browser assertion remains unchanged and continues exposing the issue.
No scroll tuning, wheel interception or appearance workaround was added.

### Follow-up controls

Eight fresh disposable Chromium contexts compared two runs of each input/control
condition using the retained scroll probe. The immediate reversal preserves the
original journey's input and assertions. Other conditions are diagnostic controls;
they do not replace that journey or establish a reliability rate.

| Return condition | Final scroll offsets | Saved-state assertion |
| --- | --- | --- |
| Immediate 20,000 px reverse wheel | 1871, 1335 | One failed; one passed while still below the top |
| Wait for stable offset/height before reversing | 0, 0 | Both passed |
| Return in 300 px wheel steps | 0, 0 | Both passed |
| Static 30-row DOM control, same large reversal | 0, 0 | Existing disabled markup retained and first card visible |

The static control clones actual saved/unsaved card markup into normal flow and
detaches the Vue-owned root, removing virtual-range updates and framework scroll
handlers from the displayed list. It repeats the unsaved row, has a different
total height, and does not exercise persistence or card lifecycle. Its successful
endpoint is a useful comparison, not proof that every native scroll path is safe.

The difference narrows the failure to quick reversals while dynamic geometry is
settling. A separate controlled append/input canary passed on the existing
scroller, so it did not demonstrate the proposed queued-callback defect. That
temporary test and the proposed dependency change were not retained. No complete
root cause or scroller repair is claimed. The native case that passed its
disabled-button assertion at offset 1335 also shows why card state and viewport
position must be evaluated independently.

Receipt: [input/control matrix with geometry and selected input/write traces](tool-card-scroll-controls.json).

## Validation

- **66 tests pass** across message transactions, workspace thumbnail consumers and
  the real chat-container/scroller boundary. The owner suite has 23 passing cases.
- **15 of 16 Chromium journeys pass**, with the source scrolling failure described
  above. Receipts: [browser results](tool-card-continued-browser.json) and
  [full output](tool-card-continued-browser.txt).
- Repository typecheck, production build, targeted TypeScript/probe lint,
  documentation and final diff checks pass. Typecheck uses the supported
  basic-auth/SQLite selection with Cloud services disabled. The regression's
  Dexie spy required widening its overloaded key argument for typechecking;
  the corrected 23-case suite passed again. Existing duplicate-import/build
  warnings and the trusted-host rebuild qualification notice remain unchanged.
- No physical-device, full-repository, live-provider, sustained-memory or complete
  portable containment qualification was performed.

Compared with the preceding local audit, this continuation adds 8 and removes
4 production lines, adds 49 regression-test lines and 9 browser-test lines, and
adds 52 lines to the two retained diagnostic runners. The cumulative production
diff from `a996424a` is 77 additions and 22 deletions across five files. The new
read regression protects resource lifetime; the existing frame test is retained
with a capacity precondition supported by the observed failure and public policy.

## Next evaluations

1. Complete the source-card scroll root-cause investigation. The initial static,
   settled and small-step controls above pass, while immediate reversal remains
   unreliable. Trace the ordering of native scroll delivery and height/anchor
   writes before selecting a repair. Preserve saved-state assertions and browser
   evidence; do not infer storage loss from an unmounted or distant slot.
2. Continue rich code/math profiling with cold and warm font/layout controls.
   The prior roughly 33.3 ms p95 result at 4× CPU remains unresolved.
3. Qualify long arguments/results, repeated workspace switches, large workspaces,
   card mount/unmount cycles and sustained subscription/memory behavior.
4. Isolate WebKit compaction/import errors separately from its already reproduced
   private-context Blob-storage issue; qualify physical Safari/iOS and Android.
5. Continue font-readiness, reduced-motion idle, editor, search, dialog and
   background/sync investigations. Preserve theme, typography, spacing and
   control sizing throughout.

The earlier [card report](TOOL-CARD-AUDIT.md) and
[image/rich-stream report](FOLLOWUP-STABILITY.md) retain their original evidence.
This continuation resolves the frame-test ambiguity and failed-card resource
cleanup, and leaves the evaluations above open.

## Reproduction

Use the existing offline tool-card development harness on loopback port 3116.

```sh
PW_SKIP_WEB_SERVER=true bun run test:e2e:tool-cards
bunx tsx audit-evidence/performance-20261023/tool-card-stream-probe.mjs /tmp/three-cards.json 3
bunx tsx audit-evidence/performance-20261023/tool-card-scroll-probe.mjs /tmp/card-scroll.json
bunx tsx audit-evidence/performance-20261023/tool-card-scroll-probe.mjs /tmp/card-static.json source '{"staticRows":true}'
bunx tsx audit-evidence/performance-20261023/tool-card-scroll-probe.mjs /tmp/card-settled.json source '{"settleBeforeReturn":true}'
bunx tsx audit-evidence/performance-20261023/tool-card-scroll-probe.mjs /tmp/card-steps.json source '{"stepSize":300}'
bunx vitest run app/db/__tests__/messages-transactions.test.ts --reporter=dot --silent=passed-only --hideSkippedTests
```

The scrolling runner is diagnostic: it retains errors and state in JSON even
when its recovery assertion fails. The canonical Playwright test supplies the
pass/fail result. Additional local artifacts/logs are under `/tmp/or3-card-*`.
