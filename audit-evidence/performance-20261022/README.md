# Frontend performance audit — 22 October 2026

## Section 1: settled chat rows during streaming

Baseline: `3aa7b3c0`. `ChatContainer.vue` retains the combined message array
and uses `rowContentRevision` to refresh the mounted scroller window. Its
`compactionActionFor()` still returned a new object for every row on every
refresh. Vue therefore updated every mounted message, including settled
Markdown and its action controls, even when their data was unchanged.

The fix reuses actions by their finite host-authored blocked reason within the
owning pane. The callback reads the current controller when invoked. Changed
message data, retry availability, eligibility, theme props, and lifecycle
events remain reactive. No message snapshots, persistence, stream cadence,
scroll settings, or public component contracts change.

### Browser measurements

`stream-row-probe.js` exercises the real ChatContainer, ChatMessage,
StreamMarkdown, and installed `or3-scroll@0.1.3` on an isolated Vite journey
server. It supplies synthetic UI projections directly to the existing
controller: 160 history messages, 120 text updates on animation frames,
32 initially mounted rows, Chromium with 4× CPU
throttling, three fresh-page runs before and after. External requests are
blocked. Temporary Vue update hooks and DOM observers are removed afterward.

The original prose identified the theme as Retro without recording it in the
receipt. That attribution is withdrawn: these runs establish single-profile
behavior, not theme-specific or cross-theme coverage.

| Measurement per run | Before | After |
| --- | --- | --- |
| Settled message updates | 4,229 / 4,229 / 4,229 | 0 / 0 / 0 |
| Tail message updates | 144 / 144 / 144 | 120 / 120 / 120 |
| Settled message DOM mutations | 0 / 0 / 0 | 0 / 0 / 0 |
| Frame interval p95 (ms) | 18.7 / 17.9 / 25.7 | 10.2 / 10.1 / 10.3 |
| Maximum frame interval (ms) | 50.0 / 50.0 / 57.9 | 34.9 / 40.1 / 41.4 |
| Long tasks | 0 / 0 / 2 | 0 / 0 / 0 |

Every run rendered the final token and ended exactly at the bottom. The raw
receipt is `stream-row-results.json`. This is evidence of eliminated component
work, not a claim that settled DOM was previously replaced. Timing is local
development-build evidence, not a production/device-wide smoothness guarantee.
The probe excludes network transport, persistence, heavy code/math output,
multiple concurrent panes, and offscreen browsing.

Start the disposable server with:

```sh
OR3_LOCAL_PROVIDERS=false OR3_USE_LOCAL_PACKAGES=false OR3_PRODUCTION_JOURNEY_TEST_HARNESS=true OR3_SCROLL_TEST_HARNESS=true bun run dev:offline -- --host 127.0.0.1 --port 3147
```

Pass the absolute `stream-row-probe.js` path to Playwright's
`browser_run_code_unsafe` tool as its `filename` argument in a disposable
browser. The probe installs local-only routing and navigates to the journey
fixture itself. It relies on Vue development metadata for observation and is
not an application API or a production instrumentation hook.

### Regression and validation

- Extended the existing real-scroller component test to count themed message
  updates. Before the fix, three text changes caused nine updates (six
  unnecessary settled-message updates); after, only the tail updates. The same
  test checks subsequent edits, retry disabling, and compaction eligibility.
- 50 focused tests pass: ChatContainer, stream accumulator, and media prefetch.
- All nine browser scroll canaries pass, including bottom following, offscreen
  tail updates while browsing, image prefetch, keyed anchors, and restoration.
- Three production-component browser journeys pass: stop during admission,
  response streaming/reload, and partial-output stop/reload.
- The first stop test run exposed a stale selector: hidden pending assistant
  actions were excluded from its role query, which selected the preceding
  user's enabled Branch button. Inspection confirmed the actual assistant
  button was hidden and disabled. The corrected test scopes to that assistant,
  includes hidden controls, and checks visibility and enabled state after stop.
- Application typecheck passes with installed Basic Auth/SQLite/Filesystem
  providers and a disposable placeholder secret. The wrapper forces SSR;
  unconfigured source defaults initially failed configuration validation.
- Changed-file lint and `git diff --check` pass. Repository lint excludes
  Vue/test files; the typecheck and executable tests cover those files.

### Remaining audit sections

Completed follow-up work is recorded in [virtual sidebar recycling](SIDEBAR.md),
[sidebar mount work and pagination](SIDEBAR-WORK.md), and
[project/model list mount work](CATALOG-PROJECTS.md), and
[rich streaming style invalidation](RICH-STREAMING.md), and
[on-demand syntax grammars](HIGHLIGHTING.md), and
[icon setup during virtual recycling](ICON-RESOLUTION.md), and
[scaled sidebar pointer tracking](SIDEBAR-DRAG.md), with separate raw production
receipts and explicit limits.

The full frontend audit remains open. Section PRs should carry their own
measurements and validation; this section does not qualify the entire app.

1. Chat rendering: long Markdown/code/math/tool streams, multiple panes,
   accumulator/persistence costs, production traces and reduced motion.
2. Virtual scrolling: ChatContainer, SidebarHomePage, SidebarTimeGroupedList,
   SidebarProjectsPage, ModelCatalog; rapid wheel/touch scrolling, overscan,
   mount/measurement cost, blank frames, anchors, and hidden/restored panes.
3. Transitions/animations: validate the merged modal/sidebar work in #279;
   inspect other theme effects, dialogs, nested selectors, and layout shifts.
4. Reactive update scope: composer, sidebar live queries, tabs, editors,
   search, and unrelated workspace changes under active streaming.
5. Startup and overall qualification: production load/interaction traces,
   populated workspaces, mobile viewports and actual device coverage.
