# Current stability audit report

Updated October 24, 2026. **The requested repair round is wrapped up; further
evaluations remain open below.** Work is limited to stability and speed while
preserving appearance. This is not a claim that every application surface or
physical device has been qualified.

The subsequent [workspace-scale repair](../performance-20261024/WORKSPACE-SCALE.md)
pages initial chat-search reads and removes the measured large preparation pause,
with 1,000/10,000-chat browser qualification at normal and slower CPU settings.
Total index memory, long sessions and the measured legacy sidebar family scan
remain open; that report is the current evidence for this selected scale path.

The subsequent [Brave mobile investigation](../performance-20261024/BRAVE-MOBILE.md)
groups each theme's definition and optional icons to remove one serial activation
boundary and two page requests. After macOS locked, the user-authorized Playwright
fallback completed three cold runs per matched build in installed Brave at
440 × 956, Slow 4G and 4× CPU. Median LCP improves from **13.392 to 12.776 s**;
all six screenshots are byte-identical, with matching control geometry.
Production builds, 112 theme tests and six mobile startup controls pass. The
existing complete-JavaScript/precache budgets still fail on baseline and
candidate. The owned headless browser and preview are stopped; the original
visible tab's DevTools preferences still need restoration after unlocking the
Mac. Startup graph size, late artwork, font build reproducibility, deployed HTML
compression and physical-device/provider qualification remain open in that report.

The subsequent [Chrome mobile and real AI evaluation](../performance-20261024/CHROME-MOBILE.md)
uses installed Chrome, 390 × 844, throttled 4G and 4× CPU. Median current-build
LCP is **8.364 s with HTTP cache disabled and 1.296 s with it enabled**; this is
not a matched optimization or browser comparison. Five real DeepSeek foreground
calls cover short/rich output and stopping. A stopped partial answer and an
unsent draft survive reload. No new production or appearance change was made.
Cold startup, admission cost, long-output timing, paid failure recovery and
physical-device/provider combinations remain open in that report. Chrome's
temporary emulation and injected observers are removed; its preview remains
running on port 3156 for review. The previous Brave cleanup limitation remains
historical and Brave was not accessed for the Chrome round.

The subsequent [cold-startup repair](../performance-20261024/COLD-STARTUP.md)
uses matched three-run Chrome measurements and user-approved responsive artwork
copies. Median cold LCP improves from **8.316 to 1.740 s**, observed composer
readiness from **7.435 to 6.374 s**, and CLS from **0.0860 to zero** under the
same 4× CPU/throttled-network profile. The existing design and original artwork
are preserved. Earlier artwork discovery, lighter import boundaries, selected
shell/theme preloads and deferred search initialization are implemented fixes.
**217 focused tests and 14 Chrome E2Es pass**, as do build, typecheck, lint and
documentation checks. One additional real DeepSeek call produces a visible
answer in 1.580 s and persists through reload. Cold composer readiness, complete
JavaScript/precache budget failures, deployed/provider paths, full PWA lifecycle
and physical devices remain open. Chrome's temporary settings are restored;
the final production preview remains available on port 3156.

The subsequent [composer startup repair](../performance-20261024/COMPOSER-STARTUP.md)
reduces matched cold composer readiness from **6.396 to 5.991 s** by compressing
rendered HTML and reusing parsed theme stylesheets. LCP improves from **1.748 to
1.360 s**, with zero CLS and unchanged composer geometry/artwork. **35 focused
tests and 22 Chrome E2Es pass**. This is a 6.3% readiness improvement, not a claim
that cold startup is fast: about 752 KB of encoded JavaScript still loads before
the observation. The report records rejected experiments and remaining deployed,
provider, physical-device and complete-asset-budget evaluations.

Work began on `or3-cloud`, freshly synced with upstream `25c758b2`, preserving
image commit `a996424a`. The subsequent card, notification, workspace-lifecycle,
scroll and browser-qualification changes and their evidence are included in the
wrap-up review branch `codex/stability-audit-roundup`, targeting `or3-cloud`.
No merge, deployment, dependency-version change, schema change, provider migration
or live-data replacement is part of this round.

## Final repair: own wheel intent and remove opening amplification

The [wheel-owner report](WHEEL-OWNER.md) traces the residual race and records the
final repair. With bottom following enabled, the existing wheel-intent handler
now runs before native scrolling; the default action is not canceled. The owned
listener updates with `maintainBottom` and is removed on unmount. Lists with
bottom following disabled retain passive input. Layout following returns to its
next-tick path, checks active gestures, and no longer adds the extra follow frame.

The expanded owner fails before repair at 1,604 px; after repair, **8/8 slower-CPU
repeats, all 27 development scroll/card journeys and seven production controls
pass**. Native defaults, passive-mode changes and actual unmount cleanup pass
against development and production. The new local harness build and fresh patch
application pass. No CSS, theme, geometry or component-appearance change was made.

At 4× CPU, the matched comparison records 20–28 startup mounts before versus
eight after. Normal-CPU counts do not improve; no universal speed claim is made.
A non-passive listener can delay wheel input on a busy main thread. That explicit
tradeoff, continuous/physical input and broader lifecycle/performance work remain
in the evaluation inventory. The earlier failed prototypes below were not retained.

## Earlier experiments and why they were replaced

The earlier [frame-follow repair](WHEEL-REVERSAL.md) passed its 26 development
and seven production controls, but the expanded
[cold-opening evaluation](CARD-COLD-OPEN.md) then exposed startup amplification
and a slower-CPU endpoint miss. Two response-only optimization prototypes also
missed endpoints and were rejected. Thirty diagnostic runs, including failures,
remain available with their original scope; they are not presented as passing
tests. The final ownership repair above supersedes that implementation.

The epoch control still uses its existing settled-viewport helper after a
disposable 70-frame comparison showed that a previous assertion sampled a
transient row-growth gap. Its current-thread, tail and visible-row assertions
remain intact. The native card fixture remains development-only, and the new
local `.output` includes the final code without being deployed.

## Previous fix: retire card work when the workspace changes

An old card host could remain mounted during a workspace switch. Its existing
guards rejected stale writes and persisted values, but its database subscription
continued reading and later call snapshots were still parsed. The abort signal
was not retired until Vue unmount.

The slot now subscribes to the existing workspace-change service and immediately
stops its state subscription, lazy-mount, visibility and theme observers, removes
that subscription and aborts the card. Retired contexts ignore later snapshots.
The current host keeps updating, and normal renderer teardown still runs once.
No template, CSS, appearance, save ordering or data authority changed.

Two real-Dexie mounted-owner cases fail before repair and pass after it. In the
switch-away case, three unnecessary old-host reads become zero; on return to
the same database, six combined reads become the current host's three. These
are controlled resource counts, not a sustained-memory or frame-rate benchmark.

**69/69 owner/sibling tests, 4/4 existing Chromium journeys, typecheck, lint,
docs and diff checks pass.** The browser controls cover quiz persistence, crash
fallback, trusted activation teardown and lazy remounts; the new workspace
behavior is covered at the mounted owner boundary. See the
[workspace report and receipts](WORKSPACE-CARDS.md) for before/after evidence,
test scope and remaining evaluation. That round's production `.output` predated
these repairs; the final local build described above now contains them.

## Previous fix: stop the rest of a disposed card's notification batch

The host copied a card's update listeners before invoking them. If a listener
threw, the existing error handler failed the card, stopped its live resources
and aborted its public signal. The copied batch still invoked later listeners,
allowing work to run after disposal.

`createToolCardContext` now rechecks its existing abort signal before each
listener. This is one production-line addition. It stops the remaining batch
when disposal occurs, while preserving normal notifications, other cards,
accepted state saves and existing fallback presentation. No rendering, CSS,
theme, size, layout, frame cap, preload margin or timing policy changed.

The existing real-Dexie failed-renderer regression now covers both failure
during mount and failure during a persisted-state update. In the update case,
one listener fails on the stored value `1`, and a later listener records any
invocation after the card aborts. On the immediately preceding source, it records
**one post-abort callback** and the intended assertion fails. With the guard it
records **zero**. The failed renderer's cleanup runs once; later writes produce
no failed-card state reads, while a separate healthy card receives all four
subsequent persisted values.

This extends the existing owner-boundary test instead of creating another
dispatcher mock or test-only production interface. The prior failed-read case
covered failure before notification; it could not catch disposal midway through
an already copied batch. The public card guide/docmap clarify the same lifecycle
behavior. This repair does not establish a frame-rate or sustained-memory gain.

### Validation of the notification-batch round

- [Before-fix owner regression](card-notify-before.txt): mount-failure control
  passes; update-failure case fails specifically on the post-abort callback.
- [Owner and sibling suites](card-notify-after.txt): **67/67 pass** across message
  transactions, workspace thumbnail consumers and ChatContainer. The owner has
  24 cases, including the expanded two-phase failure table.
- [Selected Chromium lifecycle journeys](card-notify-browser.txt): **3/3 pass**
  for crash fallback/timer isolation, trusted Vue activation teardown and lazy
  mounting without rerunning tools. [Browser receipt](card-notify-browser.json)
  retains actual launch requirements and results. Its extra 30-card scroll
  measurement is a diagnostic inside the lazy journey, not a fourth test or
  speedup proof.
- [Initial browser launch](card-notify-browser-initial.txt): two cases passed;
  the trusted case could not mount because the harness omitted its required
  `chat-tool-cards` contribution selection. The local launch setting was
  corrected and all three unchanged cases reran successfully. No production gate
  was weakened and no assertion was changed for that configuration failure.
- [Supported application typecheck](card-notify-typecheck.txt), targeted lint,
  documentation checks and final diff checks pass. Existing duplicate-import
  warnings remain. Documentation validation covers 115 files, 103 routes and
  20 checked examples under its existing scope.

Cloud services were disabled for the local harness; the browser cases use their
existing scripted model transport. That round did not repeat the full repository
suite or a production build. That round's `.output` artifact predated both the
one-line notification guard and the subsequent workspace repair. The latest
local harness build now includes them. Neither has been activated in a deployed
artifact.

## Earlier investigated and fixed work

| Area | Result and evidence |
| --- | --- |
| Streamed images | Preserve live image placeholders through later text, complete quiet hydration and fence delayed Continue intake. Committed in `a996424a`; [image report](FOLLOWUP-STABILITY.md). |
| Tool-card repeated work | Stable private metadata, quiet unchanged snapshots, stale preload protection and failed-renderer subscription cleanup. [Card audit](TOOL-CARD-AUDIT.md), [continued audit](CONTINUED-STABILITY.md). |
| Scroll intent | Recognize upward movement overtaking an instant write, acknowledge wheel intent before native scrolling when following is enabled, and avoid the extra follow frame. Smooth recovery, hidden-pane and production sidebar controls pass; [final wheel report](WHEEL-OWNER.md). Earlier [intent](SCROLL-INTENT.md) and [frame-follow](WHEEL-REVERSAL.md) receipts remain historical evidence. Broader input qualification remains open. |
| WebKit import observation | Classified as the warm-up reload cancelling an async tab-bar loader in the departing document. Corrected real-journey readiness and added an error guard; five WebKit and one Chromium runs pass. This is a test-startup correction, not an application loader workaround; [WebKit report](WEBKIT-IMPORT.md). |
| Rich-content fonts | Three cold/warm pairs retain about 33.3 ms streaming p95 at 4× CPU. Warming the observed math font removes its in-stream request/invalidations but does not remove recurring cost. No production preload or render cache was justified; [font report](RICH-FONT-EVALUATION.md). |

These results retain the scope and limitations of their original receipts. The
latest 69-test result does not turn every historical browser or device observation
into a pass.

## Still needs evaluation

The latest [cold-startup report](../performance-20261024/COLD-STARTUP.md) adds the
specific remaining composer, full-bundle, PWA and deployed-device evaluation
items. Its visual load improvement does not close the broader inventory below.

1. **Rich streaming:** remaining changing-DOM, style/layout and worker costs;
   long tool arguments/results; first-use behavior beyond the observed font and
   formulas. The roughly 33.3 ms p95 under 4× main-thread CPU remains unresolved.
2. **Broader native scrolling:** the recorded large-wheel Chromium case is now
   repaired, with endpoint and persisted-reset assertions. Physical wheel/touch
   behavior on other devices and engines, different gesture sequences and
   sustained workloads still need evaluation; the selected runs do not qualify
   all compositor/geometry combinations.
3. **Sustained lifecycle and scale:** the final repair removes the recorded
   slower-CPU opening amplification and passes the expanded endpoint controls;
   see [the final wheel report](WHEEL-OWNER.md). Busy-main-thread wheel latency,
   continuous input and physical-device qualification remain open. Memory over long sessions, large workspaces,
   repeated account/workspace switches, many mount/unmount cycles and plugin
   resource ownership and portable frame teardown. The mounted workspace-switch
   regression and four browser controls cover selected paths, not a complete
   heap, account-switch or frame-lifecycle audit. The earlier 22-versus-40 traces
   had different initial timing; the new controls replace that uncertainty.
   No speed gain is claimed from the endpoint fix.
4. **WebKit and physical devices:** private-context Blob storage, actual Safari/iOS
   and Android persistence, scrolling and recovery. The classified warm-up error
   does not clear arbitrary active-page imports or interrupted startups. The
   WebKit screenshot font-readiness workaround remains unqualified visual scope.
5. **Other surfaces and combinations:** editors, search, dialogs, font-ready
   output, reduced-motion idle work and background/sync/provider combinations.

These remain open evaluations rather than claims that each contains a confirmed
defect. No appearance change is proposed to close them.

## Card lifecycle reproduction (previous round)

```sh
bun run test --project=core-app app/db/__tests__/messages-transactions.test.ts app/components/chat/__tests__/workspace-thumbnails.test.ts app/components/chat/__tests__/ChatContainer.test.ts
```

For the browser controls, start the existing development harness on loopback
port 3116 with `OR3_TOOL_CARDS_TEST_HARNESS=true`,
`OR3_PLUGIN_CONTRIBUTION_V2_SURFACES=chat-tool-cards`, installed provider packages
selected and Cloud services disabled, then run:

```sh
PW_SKIP_WEB_SERVER=true PW_PORT=3116 bunx playwright test tests/e2e/tool-cards.spec.ts --grep 'quiz executes inline|legacy placement, crashing card fallback|trusted Vue card uses|lazy cards mount' --workers=1 --reporter=line
```

Do not treat this selected run as the entire tool-card suite or portable-frame
containment qualification. The existing production isolation gates remain.
