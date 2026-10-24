# Registered tool-card stability and performance audit

A later [continued audit](CONTINUED-STABILITY.md) records a new failure-cleanup
fix, resolves the frame-test capacity ambiguity and captures the still-open source
scroll race. Counts below describe the preceding batch.

Date: October 23, 2026. The checkout was synced to `or3-cloud` at `25c758b2`
after the earlier PRs and the user's other work were merged. The preceding image
fixes were committed as `a996424a` (`[Fix] Preserve streamed images and guard
continuation intake`). This report covers the subsequent local audit batch,
whose tool-card changes and evidence remain uncommitted. Neither batch has been
pushed from this session; no new PR was created for this round.

No CSS, theme, spacing, fonts, control sizes, scroll settings, dependencies,
storage schemas or plugin admission policies changed. Portable/frame tool cards
remain production-gated. The changes preserve the existing renderers and styling.

## Investigated and fixed

1. **Unchanged tool-call projections reparsed data and notified cards.**
   `ToolCardSlot` deeply watched the entire call object. A history refresh that
   replaced it triggered work even when its visible fields were equal. It now
   watches status, arguments, result, error and theme independently. Actual call
   changes still reach the existing context and renderer.
2. **Reply autosaves repeatedly announced unchanged persisted state.** Dexie's
   `liveQuery` re-emits when other message fields change. The context now retains
   the visible object and skips notifications when validated JSON state is equal.
   It still records every committed observation and revision before comparing,
   preserving optimistic-save reconciliation and ordering.
3. **Text-only streaming updated card containers with each message projection.**
   `ChatMessage` now passes stable, typed card metadata containing message ID,
   originating thread and card state. Call lists remain separate reactive props.
   Registry, call and state changes continue to propagate; no memo freeze or
   registry bypass was added. The inline-card stream probe recorded 120 empty
   end-card updates before and zero afterward.
4. **Stale intersection entries mounted distant cards.** Earlier card expansion
   and bottom-follow movement could invalidate positions sampled for later
   observer callbacks. The slot now checks its current position against the
   existing 600 px preload range before mounting. A rejected stale entry re-arms
   the owned observer so a card returning into range can still load. The initial
   cumulative mount count fell from 30 to 19 in the canonical scrolling fixture;
   both source-card scrolling journeys now pass.

Three regressions extend the existing mounted-card/message-transaction suite.
They use the real slot, real Dexie persistence and public card subscriptions.
The two notification cases failed before their repairs: four unchanged call
replacements or four text saves produced four notifications. They now produce
zero, while real argument/state changes arrive and unmount aborts the context.
The geometry case failed before the preload repair because a distant card
mounted from a stale entry; it now waits and mounts after returning into range.
No production test seam was added.

## Streaming and scrolling evidence

The retained stream probe uses the canonical development fixture, registered
source Quiz card, foreground tool execution, model continuation, persistence and
renderer. Synthetic SSE supplies 120 trailing chunks at 25 ms intervals; external
traffic is blocked. It observes the public subscription and component lifecycle.

| Check | Before | Final |
| --- | --- | --- |
| Redundant card notifications during unchanged trailing text | 7 | 0 |
| Empty end-card component updates | 120 | 0 |
| Card subtree DOM mutations | 0 | 0 |
| Connected card, question and live context | Pass | Pass |
| Trailing text chunks | 120 | 120 |
| Source-card initial cumulative mounts, separate scroll fixture | 30 | 19 |

These are development-harness work counts, not production frame-rate benchmarks.
Final stream reads were 35, equal to the baseline; no database-read or frame-rate
improvement is established. Scroll mount counts depend on viewport and startup
layout. The threshold and scroller configuration were unchanged.

Receipts: [stream baseline](tool-card-stream-before.json),
[final stream](tool-card-stream-final.json),
[canonical source scrolling](tool-card-lazy-after.json), and
[scroll geometry before](tool-card-scroll-before.json) /
[after](tool-card-scroll-after.json). The intermediate
[context-only receipt](tool-card-stream-after.json) retains the still-unfixed
120 end-card updates for comparison.

## Validation

- **65 tests pass across three relevant suites:** message transactions, workspace
  thumbnail consumers and the chat-container/scroller boundary. The 22-case
  transaction suite also passed after the observer re-arm change. Coverage
  includes inherited state, source-thread saves, branch sends, concurrent writes,
  normalization, ordering, the three regressions and teardown.
- **15 of 16 cases passed in the full named Chromium tool-card harness.** This
  includes source/trusted execution, attributed answers/reload, delayed cross-pane
  saves, state reconciliation, live status, plugin replacement/disable cleanup,
  action/cooldown/busy guards, placement, theme, 320 px layout, examples, SDK
  helpers, frame bootstrap/navigation and offscreen budget recovery.
- The two previously failing source-card scrolling cases passed after the preload
  repair and again after observer re-arming. The remaining frame-scroll failure
  also occurs on the committed source: **one of three baseline control runs
  failed**, while two passed. All five temporarily replaced production files
  were restored byte-for-byte. No assertion or frame policy was weakened.
- Final repository typecheck, production build, documentation, targeted
  TypeScript/probe lint and diff checks pass. The final three-suite rerun also
  passes all 65 tests. The initial typecheck caught a missing `this: HTMLElement`
  annotation in the new geometry stub; it was corrected. Typechecking used the
  supported basic-auth/SQLite selection with Cloud services disabled. Existing
  duplicate-import/build warnings and the trusted-host rebuild qualification
  notice remain; no provider credentials were added.

The production diff adds 69 and removes 18 lines across five files. Regression
coverage adds 87 lines to the existing suite. Two new diagnostic runners add
217 lines, with their retained JSON/log receipts separate from production code.

Receipts: [final unit run](tool-card-unit-final.txt),
[full browser run](tool-card-full-after.json),
[full output](tool-card-full-after.txt),
[final observer scrolling check](tool-card-scroll-final.txt), and
[committed-source frame control](tool-card-frame-baseline.txt).
Earlier [selected output](tool-card-browser-after.txt) and
[scrolling baseline](tool-card-browser-baseline.txt) describe the intermediate
patch before the preload fix, not the final outcome.

The repository lint policy excludes Vue/test files; executable suites, typecheck
and build validate those changes. No full repository suite, live provider,
deployment or physical-device qualification was run. Frame-harness passes do not
qualify production portable-card containment.

## Still needs evaluation

1. **Frame budget and tall viewports.** The remaining case uses a 3000 px
   viewport, 30 cards and a 12-frame cap. The existing budget deliberately keeps
   visible frames rather than cycling them when more than 12 are visible. The
   first card can remain without an admitted frame after scrolling in failing
   runs. The committed control proves this predates this batch; it does not
   establish the complete cause. A separate instrumented
   [frame run](tool-card-frame-diagnostic.json) passed. Trace actual visibility,
   admission and resize ordering on a failing run before changing policy or
   qualification assertions. Portable frames remain production-gated.
2. **Scroll anchoring and large jumps.** The saved source-card state survived and
   the canonical round trip passes, but one diagnostic ended at `scrollTop: 532`
   with the first mounted card above the viewport; explicitly scrolling to zero
   restored it. The lazy-mount fix does not qualify general scroll positioning,
   raster gaps, realistic touch inertia or compositor behavior.
3. **Broader registered-card lifecycles.** Qualify ordered multi-card replies,
   long argument/result streams, repeated workspace changes, sustained memory
   and subscription counts. Current coverage is selected source/trusted and
   fixture frame behavior, not every plugin or lifecycle.
4. **Rich code/math streams.** Prior clean concurrent evidence remains around
   33.3 ms p95 at 4× CPU throttle. Isolate cold/warm font, DOM and layout costs
   before choosing another appearance-preserving change.
5. **WebKit and devices.** Private-context Blob storage failure, intermittent
   compaction/import errors, physical Safari/iOS persistence/recovery and
   Android behavior remain unqualified by this card round.
6. **Other application surfaces.** First font paint, reduced-motion idle work,
   long sessions, large workspaces, editors, search, dialogs, plugin surfaces and
   background/sync combinations still need targeted qualification. Visual sizing
   changes remain deferred under the appearance constraint.

The [preceding report](FOLLOWUP-STABILITY.md#findings-still-needing-evaluation)
contains the earlier evidence and next steps. This concludes the requested fix
round; the remaining evaluations above are explicitly open.

## Reproduction

Start the existing tool-card development harness on loopback port 3116 with
`OR3_TOOL_CARDS_TEST_HARNESS=true`, the `chat-tool-cards` contribution surface,
installed provider packages selected, and Cloud auth/sync/storage/background
execution disabled.

```sh
bunx tsx audit-evidence/performance-20261023/tool-card-stream-probe.mjs /tmp/cards.json
bunx tsx audit-evidence/performance-20261023/tool-card-scroll-probe.mjs /tmp/cards-scroll.json
bunx tsx audit-evidence/performance-20261023/tool-card-scroll-probe.mjs /tmp/cards-frame-scroll.json frame
PW_SKIP_WEB_SERVER=true bun run test:e2e:tool-cards
bunx vitest run app/db/__tests__/messages-transactions.test.ts --reporter=dot --silent=passed-only --hideSkippedTests
```

The geometry probe captures diagnostic errors in JSON so it can retain state on
failure; the canonical Playwright suite supplies the pass/fail qualification.
Additional logs/screenshots remain local under `/tmp/or3-card-*`.
