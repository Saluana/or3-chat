# OR3 frontend performance audit report

Completed at the user's requested stopping point on October 23, 2026, after
the streaming-thumbnail round. The audit investigated chat streaming, all five
host virtual scrollers, row/component update scope, theme transitions, loaders,
rich Markdown, and selected startup behavior. It produced 22 separate local
sections, including one section that retained measurements without a product
change.

The work removed substantial unnecessary rendering, repeated database reads,
mount-time work and paint invalidation. It also fixed specific flashing and
geometry defects. It does **not** establish that every interaction is smooth or
that OR3 is faster than other applications. Large wheel jumps, rich-stream
layout costs, image streaming and some WebKit/theme cases remain unresolved.

## Delivery status

The changes are published as a stack above `3aa7b3c0`, with a branch
retained for each section. The final branch is `codex/perf-stream-thumbnails`.
The section reports below contain measurements, reproduction instructions,
regression coverage and limitations. Committed JSON receipts preserve the
numeric evidence; many screenshots, traces and command logs remain local in
`.playwright-mcp/`, test artifact directories or `/tmp` and are not durable
remote attachments.

All 22 branches and their code, tests, patches and audit evidence were published
to public `Saluana/or3-chat` after the user explicitly approved that upload.
The working GitHub connector created the 22 draft PRs indexed below, and each
PR is attached to this task. No PR has been merged, and no deployment, package
publication or live-data migration occurred.

## Published pull requests

All PRs are drafts. Section 15 contains diagnostic evidence without an
application change; the remaining sections include their scoped fixes.

| Section | Pull request | Scope |
| --- | --- | --- |
| 1 | [#281](https://github.com/Saluana/or3-chat/pull/281) | Keep settled chat rows idle during streaming |
| 2 | [#282](https://github.com/Saluana/or3-chat/pull/282) | Stabilize virtual sidebar row recycling |
| 3 | [#283](https://github.com/Saluana/or3-chat/pull/283) | Reduce sidebar mount and pagination work |
| 4 | [#284](https://github.com/Saluana/or3-chat/pull/284) | Reduce project and model list mount work |
| 5 | [#285](https://github.com/Saluana/or3-chat/pull/285) | Scope focus selectors during streaming |
| 6 | [#286](https://github.com/Saluana/or3-chat/pull/286) | Load syntax grammars on demand |
| 7 | [#287](https://github.com/Saluana/or3-chat/pull/287) | Avoid repeated icon collection sorting |
| 8 | [#288](https://github.com/Saluana/or3-chat/pull/288) | Keep scaled sidebar dragging aligned |
| 9 | [#289](https://github.com/Saluana/or3-chat/pull/289) | Restore sidebar geometry before first paint |
| 10 | [#290](https://github.com/Saluana/or3-chat/pull/290) | Keep project pin handlers stable while scrolling |
| 11 | [#291](https://github.com/Saluana/or3-chat/pull/291) | Scope live pane history to each conversation |
| 12 | [#292](https://github.com/Saluana/or3-chat/pull/292) | Preserve completed math classes during streaming |
| 13 | [#293](https://github.com/Saluana/or3-chat/pull/293) | Scope mobile More stacking to its open state |
| 14 | [#294](https://github.com/Saluana/or3-chat/pull/294) | Highlight host code blocks in an owned worker |
| 15 | [#295](https://github.com/Saluana/or3-chat/pull/295) | Record painted coverage across host scrollers |
| 16 | [#296](https://github.com/Saluana/or3-chat/pull/296) | Keep lazy message wrappers idle during streaming |
| 17 | [#297](https://github.com/Saluana/or3-chat/pull/297) | Keep streaming projections and follow controls stable |
| 18 | [#298](https://github.com/Saluana/or3-chat/pull/298) | Keep unchanged history rows idle after streaming |
| 19 | [#299](https://github.com/Saluana/or3-chat/pull/299) | Load math styles before the first formula renders |
| 20 | [#300](https://github.com/Saluana/or3-chat/pull/300) | Composite the generating loader scan animation |
| 21 | [#301](https://github.com/Saluana/or3-chat/pull/301) | Apply reduced-motion state changes immediately |
| 22 | [#302](https://github.com/Saluana/or3-chat/pull/302) | Keep thumbnail loading idle during text streaming |

## What was investigated and fixed

Each linked report defines its own environment. The numbers below come from
different workloads and must not be added together or treated as one universal
speedup. Most later measurements use a local production build and disposable
synthetic data; the first row-stability measurements used a development build.

| Section | Investigation and retained result | Evidence |
| --- | --- | --- |
| 1 | Stabilized per-row compaction action props. Settled message component updates fell from 4,229 to zero during the measured stream. Settled DOM mutations were already zero. | [Streaming row stability](README.md) |
| 2 | Removed entry fades from recycled virtual rows, moved date formatting into item projections, corrected a row-height estimate and coalesced ResizeObserver work through the scroller's owned animation-frame scheduler. A tracked package patch carries the scheduler repair. | [Virtual sidebar recycling](SIDEBAR.md) |
| 3 | Deferred unopened row popovers and guarded pagination admission so repeated bottom events cannot admit overlapping pages. Median p95 in the measured sidebar workload fell from 75.1 to 66.3 ms; scrolling was still slow. | [Sidebar mount and pagination](SIDEBAR-WORK.md) |
| 4 | Deferred project popovers and reused the USD price formatter. Model-list formatter constructions fell from 716 to zero during the measured scroll. Project/model timing improved modestly; long tasks remained. | [Project and model lists](CATALOG-PROJECTS.md) |
| 5 | Scoped focus-related selectors to avoid broad style invalidation while streaming. The measured focus-selector invalidations fell from 11 to zero. | [Rich-stream style scope](RICH-STREAMING.md) |
| 6 | Loaded syntax grammars on demand. The measured cold JavaScript payload dropped by about 703 kB for the 16 previously eager grammars. | [Lazy highlighting](HIGHLIGHTING.md) |
| 7 | Removed repeated reactive sorting of icon collections during resolution. The measured 912 sorts, consuming about 225 ms, disappeared. | [Icon resolution](ICON-RESOLUTION.md) |
| 8 | Corrected sidebar dragging under CSS scale and coalesced pointer updates. Verified alignment and owned cleanup rather than making a general frame-rate claim. | [Sidebar dragging](SIDEBAR-DRAG.md) |
| 9 | Restored saved sidebar geometry before first paint. Measured startup CLS fell from about 0.176 to 0.00424 in Blank and 0.199 to 0.00903 in Retro. | [Sidebar startup](SIDEBAR-STARTUP.md) |
| 10 | Stabilized project pin handlers during virtual scrolling and checked full-list endpoints. Measured handler-driven updates fell from 150 to zero. | [Project row handlers](PROJECT-ROW-HANDLERS.md) |
| 11 | Scoped live history observers to each conversation. An idle neighboring pane's history reads fell from 13 to zero during another pane's stream. | [Pane history observers](PANE-HISTORY.md) |
| 12 | Preserved completed math classes through the Streamdown HAST-to-Vue boundary. Repeated math DOM mutations fell from 1,824 to zero; frame p95 did not improve. | [Completed math DOM](RICH-MATH-CLASSES.md) |
| 13 | Replaced broad mobile More-sheet relational selectors with owned open-state tracking. Measured selector invalidations fell from 429 to zero; rich-stream p95 improved from roughly 58 to 33 ms in that workload. | [More-sheet style scope](MORE-SHEET-STYLE.md) |
| 14 | Moved host code highlighting to an owned worker with bounded work, timeout and cleanup. The cold main-thread maximum fell from roughly 206–214 to 61–68 ms. Chromium's 4× throttle did not throttle the worker. | [Cold highlighting](COLD-HIGHLIGHTING.md) |
| 15 | Measured painted coverage across all five host scrollers. Small-step wheel/touch cases had zero detected gaps in 1,880 captured frames. Large-jump gaps persisted, including with every row statically mounted. No speculative overscan/CSS/scheduler fix was retained. | [Painted scroll coverage](SCROLL-PAINT.md) |
| 16 | Stabilized lazy message-wrapper handlers. Wrapper updates fell from 23,205 to 330 for prose and 6,344 to 93 for rich content in the measured runs. | [Lazy message wrappers](SHELL-WRAPPERS.md) |
| 17 | Reused identical streaming projections and stabilized bottom-follow controls. Active message updates fell from 329 to 165 for prose and 94 to 46 for rich content; no p95 gain was established. | [Stream projections](STREAM-PROJECTIONS.md) |
| 18 | Reused unchanged UI rows after canonical history settlement while refreshing the canonical data. Completion-phase p95 fell from roughly 50–66 to 16.8 ms in the measured runs; a worst frame around 83.3 ms remained. | [History settlement](HISTORY-SETTLEMENT.md) |
| 19 | Made math CSS a dependency of the lazy Markdown renderer instead of importing it after rendering. First-formula unstyled samples fell from three to zero; the delayed-CSS regression fell from 14 to zero. The tradeoff is 7.99 kB gzip CSS on first Markdown use, including prose. | [First math styles](FIRST-MATH-STYLES.md) |
| 20 | Replaced the generating loader's animated background position with a translated scan layer. Retro/Cyberpunk waiting-phase paint events fell from 240/242 per two-second sample to zero under normal motion. Frame p95 stayed around 16.8 ms. | [Loader motion](LOADER-MOTION.md) |
| 21 | Made reduced-motion CSS state changes immediate. Roughly 550 transition starts fell to zero in the Chromium typography probe; style recalculation fell from about 110 to 10–17 ms. All 24 focused browser combinations passed, with separate Blank sizing failures retained. | [Reduced motion](REDUCED-MOTION.md) |
| 22 | Reused equal normalized attachment lists during text streaming. For 160 text chunks, thumbnail syncs fell from 160 to zero; with a delayed decode, repeated metadata reads fell from 59 to zero. A later image still triggered one new sync. Frame p95 stayed around 16.8 ms. | [Streaming thumbnails](STREAM-THUMBNAILS.md) |

The five virtual scroller consumers were ChatContainer, SidebarHomePage,
SidebarTimeGroupedList, SidebarProjectsPage and ModelCatalog. Their coverage
includes recycling, mounting, pagination, selected endpoints, image prefetch,
bottom following, browsing anchors, restoration and painted coverage. This is
coverage of those paths, not a smoothness guarantee for every gesture or device.

## Validation at the stopping point

The final thumbnail round passed 40 targeted unit tests, the production build,
application typecheck, targeted production/audit-runner lint and diff checks.
The repository excludes the unit-test file from lint; its executable suite
passed. Its new regression failed on the original code with 31 metadata reads
instead of one and also protects later images appended through the producer's
raw array.

Five existing Chromium journeys passed: image prefetch, continuation of an image
conversation on a text-only model, native workspace search/read navigation,
stream-and-reload, and stopping with durable partial text. WebKit passed the
last three. Its image-prefetch fixture stayed at loading, and image-history
initialization failed before mounting the composer. Those two failures remain
open; they were not converted into skips or relaxed assertions.

The final performance probes saved every text chunk and the end marker.
Chromium saved and hydrated both images in the two-image case. A same-build
control restoring the original thumbnail computed reproduced the 160 syncs
and 59 repeated reads. Native tool indicators stayed connected without observed
DOM mutations during trailing text in Chromium and WebKit, but internal tool
component coverage was incomplete.

Earlier sections retain their own targeted suites and browser receipts. Their
test counts overlap and are not summed here. A complete repository test run or
release qualification was not performed after the final patch.

## What still needs evaluation

| Priority | Known gap or finding | Next useful evaluation |
| --- | --- | --- |
| High | Generated images are absent from the live Chromium display after trailing text starts, then hydrate at completion. Source inspection suggests the accumulator projection omits image placeholders added only to the message snapshot. | Reproduce image → text → image ordering through the real foreground stream; repair the projection/accumulator contract and verify continuous visibility, stop, reload and persistence. |
| High | WebKit generated-image probes save no metadata and never reach decoding. The original-behavior control fails the same way. Two canonical image-backed fixtures also fail during startup. | Isolate file intake/IndexedDB mutation errors in the actual WebKit environment, compare original and final source, and distinguish harness/engine failures from product defects before claiming Safari image support or performance. |
| High | Large instantaneous wheel jumps still expose blank regions. The headed 4× comparison observed gaps in 17/109 virtual frames and 8/77 static-control frames. | Capture compositor/raster behavior with realistic wheel cadence and touch inertia, then repeat on physical devices. The static control rules out virtualization as a necessary cause, not as every possible contributor. Do not increase overscan without evidence. |
| High | Rich code/math streams still reach about 33.4 ms p95 at 4× main-thread throttle, with appreciable layout work. Early list workloads also retained long tasks. | Separate parsing, font loading, layout, measurement and scrolling costs in representative long replies and populated lists. Measure cold and warm runs without diagnostic geometry wrappers, including worker CPU cost. |
| Medium | Blank-theme mobile targets and scaled geometry fail existing checks: 41.796875 px tab-switcher targets against 44 px, 40 px density controls against 44 px, and fractional tab/outline expectations. | Resolve actual target-size defects and distinguish rounding-sensitive assertions from accessibility failures across scale, viewport and color modes. Original-CSS controls reproduced representative failures. |
| Medium | `ChatToolCardsEnd` still updates on every text projection, including when empty. The ordered assistant-part path and source plugin tool cards were not qualified by the native-tool probe. | Exercise registered cards, argument/result updates, bridge subscriptions, visibility gating and cleanup during long text/tool streams. Optimize only demonstrated work; preserve card state and tool-execution boundaries. |
| Medium | Intermittent WebKit compaction/import errors occurred in earlier streaming checks. Font readiness is not guaranteed by the math-CSS repair, and WebKit screenshots used the existing font-wait workaround. Reduced-motion waiting traces contained some unattributed paint/layout work. | Reproduce each independently with error/trace evidence; qualify first font paint and reduced-motion idle behavior without treating functional passes as error-free runs. |
| Broader qualification | Startup fixes covered sidebar restoration and selected cold modules. Not every dialog, editor, search path, plugin surface, workspace size or background/sync combination was audited. Physical iOS/Android, inertial touch, sustained memory usage and thermal pressure remain unqualified. | Run a prioritized device/workload matrix on representative local-first datasets, including repeated mount/unmount, workspace switching, concurrent panes and long sessions. Establish practical latency/paint/memory budgets per interaction. |

The highest-value follow-up is to resolve the image-stream correctness and
WebKit intake failures, then continue large-jump painting and rich-stream layout
diagnosis. The current goal ends at this report, as requested; these items are
an explicit handoff, not background work scheduled to continue automatically.

## Reviewing and maintaining the stack

Review the PRs in section order. The first targets `or3-cloud`; each subsequent
PR targets the preceding section's branch. Retarget the next PR after its
predecessor lands. Preserve commit ancestry when merging, or rebase the
remaining stack after a squash/rebase merge so earlier changes do not reappear
in later review diffs. Keep base branches until dependent PRs are retargeted.
Preserve each section's measurements and limitations in its PR.

The `or3-scroll@0.1.3` scheduling patch is a local installation patch;
follow [its removal criteria](../../patches/README.md) when adopting an upstream
replacement. No upstream library checkout was modified as part of that handoff.

Use [the section index](README.md) and each linked report for exact commands and
raw receipts. Current final-round logs and browser artifacts use
`/tmp/stream-thumbnails-*`; copy needed temporary artifacts before cleaning the
machine or sharing the review. The committed evidence remains available even
when those temporary files are removed.
