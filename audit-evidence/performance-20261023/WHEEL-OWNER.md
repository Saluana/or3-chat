# Native wheel ownership and opening cost

October 24, 2026. This finishes the requested stability/speed repair round.
[The consolidated report](STABILITY-STATUS.md) lists earlier fixes and the work
still requiring evaluation. No appearance change is part of this repair.

## Investigated and fixed

The [cold-opening evaluation](CARD-COLD-OPEN.md) exposed two limits of the
previous automatic-follow frame: extra card mounts on a slower CPU and a
remaining large-wheel endpoint miss. A new bounded
[input/write trace](wheel-owner-trace-before.json) isolates the remaining race.
After the downward wheel settles at 6,034 px, layout growth schedules a bottom
write to 7,636 px. The upward native wheel then reaches the main thread at
1,602 px; later anchor compensation leaves 1,337 px. The 1,602 px displacement
matches the intervening write. Delaying that write by another frame does not
establish ownership over pending compositor input.

The installed `or3-scroll` patch now acknowledges wheel intent before native
scrolling when `maintainBottom` is enabled. The existing handler retires pending
startup navigation and marks the active gesture; automatic next-tick following
also checks that gesture. The added follow frame is removed. The wheel listener
is owned by the component, updates when `maintainBottom` changes and is removed
on unmount. Lists with bottom following disabled, including sidebars and the
model catalog, retain passive wheel handling.

No default wheel action is canceled, delta is translated, corrective wheel is
injected or endpoint scroll is forced. The earlier instant-write/native-movement
classification, measurement/viewport frame coalescing and cleanup remain.
Explicit bottom/smooth navigation, anchor formulas, thresholds, overscan, row
heights, preload distance, CSS and themes retain their existing paths. The
pinned dependency version and unused CommonJS runtime are unchanged.

## Meaningful regression and validation

The existing real-browser saved-state/virtualization case now has normal-CPU
and 4× CPU profiles. The latter starts after cold geometry settles, exposing a
different compositor/main-thread ordering. It uses the same native wheel
sequence, saved answer, persisted reset and actual-zero assertions. The normal
profile keeps its immediate-start workload. No production test interface or
copied scrolling algorithm was introduced.

- [Before repair](wheel-owner-before.json): seven of eight slower-CPU repeats
  pass; one fails at **1,604 px instead of zero**. The extended owner catches the
  intended application failure rather than a mount/transport error.
- [After repair](wheel-owner-repeat.json): **8/8** slower-CPU repeats pass.
- [Complete development controls](wheel-owner-browser.json): **27/27** pass,
  ten scroll canaries and seventeen card journeys, without retries. These cover
  both CPU profiles, persistence, streaming, smooth recovery, hidden panes,
  current-thread anchors, failure handling and portable-frame capacity controls.
- [Production controls](wheel-owner-production.json): **7/7** pass against the
  fresh local artifact: overtaken-write canary and six sidebar theme/mode cases.
  The 30-card fixture remains development-only; these seven cases are not a
  production card-height replay or physical-device qualification.
- Native small-wheel and listener-lifecycle probes pass in
  [development](wheel-owner-lifecycle-dev.json) and
  [production](wheel-owner-lifecycle-production.json). In each, a −120 px wheel
  moves 120 px with default action uncanceled, listener mode changes
  non-passive → passive → non-passive, and cache eviction removes the old root's
  listener. [The runner](scroll-wheel-owner-probe.mjs) uses the real router and
  CDP listener inspection. Nuxt caches three pages; initial detachment retains a
  mounted page and is not reported as a failed unmount. The first diagnostic
  incorrectly equated those states and was corrected. The production probe
  also switched from a development-only Vue element field to the app router;
  its native-default and listener-removal assertions were preserved.
- [Build](wheel-owner-build.txt): succeeds in **56.5 seconds**.
  [Artifact receipt](wheel-owner-build.json) identifies emitted
  `kzepq425.js`, its SHA-256 and the compiled conditional listener. It is local
  harness output, not a deployed release. Existing duplicate-import and trusted
  host rebuild-qualification notices remain.
- [Fresh patch receipt](wheel-owner-patch.json): application to reconstructed
  pristine 0.1.3 exactly matches installed ESM bytes; reverse check passes.
  Documentation checks pass for 115 files, 103 routes and 20 checked examples;
  [log](wheel-owner-docs.txt). Targeted formatting and final diff checks pass.
  Saved terminal logs have trailing whitespace/EOF blank lines normalized for
  Git; structured JSON receipts retain their original observations.

The previous 69-test card-owner/sibling and typecheck evidence remains in
[the workspace report](WORKSPACE-CARDS.md). Those unchanged TypeScript contracts
were not represented as newly tested solely for this private dependency repair.

## Matched opening comparison

The [cold-opening runner](card-cold-open-probe.mjs) alternates the installed
runtime with the captured previous frame-follow runtime in fresh contexts,
with the same fixture, 1280×720 viewport, disabled HTTP cache and warm server.
The [reference optimizer input](scroll-follow-frame-reference.mjs) is read as
text, never imported by the repository. The runner substitutes only this
server's rewritten Vue import URL so both modes use the same Vue instance.
Original, reference and delivered hashes are recorded per response.

| CPU | Previous frame scheduler: startup mounts | Installed repair: startup mounts |
| --- | --- | --- |
| 4× | 20, 28, 25 | **8, 8, 8** |
| 1× | 25, 25, 25 | 28, 28, 27 |

[Slow comparison](wheel-owner-cost-slow.json),
[normal comparison](wheel-owner-cost-normal.json),
[summary](wheel-owner-cost-summary.json). All six installed native replays reach
zero and retain saved state. The six reference controls in this comparison also
reach zero; the separate owner/trace failures remain part of the evidence.

At 4× CPU, median recorded script work is approximately 448 → 417 ms and layout
work 71.5 → 56.2 ms. Normal-CPU mount counts do not improve. These are three
instrumented development runs per mode, not a production latency, memory or
universal scrolling-speed claim. The quiet window and automation contribute to
elapsed times; no CWV score is inferred. The main scoped performance result is
removing the slower-CPU startup mount amplification from the extra follow frame.

## Tradeoff and remaining evaluation

A non-passive wheel listener makes the browser wait for main-thread delivery,
even though this handler never cancels the default action. That is the mechanism
that prevents the observed competing write, and also a responsiveness tradeoff
when the main thread is busy. This follows the browser's documented
[passive wheel behavior](https://developer.chrome.com/blog/scrolling-intervention-2/)
and [wheel cancelability contract](https://w3c.github.io/uievents/split/wheel-events.html).
It is scoped to `maintainBottom`; no claim is made that all wheel latency is
lower. Continuous trackpad input and busy-main-thread latency need physical
browser/device qualification before treating this as a universal improvement.

The recorded endpoint reproduction and slower-CPU startup amplification are
repaired under the retained controls. Still open: long sessions and heap growth,
large workspaces, repeated account/plugin lifecycles, portable-frame teardown,
rich-streaming layout/worker cost and long arguments/results, Safari/private Blob
storage, physical iOS/Android persistence and input, editors/search/dialogs,
reduced-motion idle work, and background/sync/provider combinations. These are
explicit follow-up evaluations, not assertions that each contains a defect.

Work began on freshly synced `or3-cloud` at upstream `25c758b2`, preserving the
earlier image commit `a996424a`. The wrap-up changes are proposed for review via
the `codex/stability-audit-roundup` branch; no merge, release publication,
deployment, schema change, provider migration or live-data replacement is part
of this round. Owned local servers were stopped after qualification.

## Reproduce

With the existing scroll/card development harness on loopback 3116 and the
installed provider packages selected, Cloud services disabled, and
`chat-tool-cards` selected:

```sh
PW_SKIP_WEB_SERVER=true PW_PORT=3116 bunx playwright test tests/e2e/tool-cards.spec.ts --grep 'with a slower CPU' --repeat-each=8 --workers=1 --reporter=line
OR3_SCROLL_TEST_HARNESS=true PW_SKIP_WEB_SERVER=true PW_PORT=3116 bunx playwright test tests/e2e/or3-scroll-canary.spec.ts tests/e2e/tool-cards.spec.ts --workers=1 --reporter=line
OR3_AUDIT_CPU=4 OR3_AUDIT_REFERENCE_MODULE=audit-evidence/performance-20261023/scroll-follow-frame-reference.mjs OR3_AUDIT_MODES=frame,installed,installed,frame,frame,installed bun audit-evidence/performance-20261023/card-cold-open-probe.mjs /tmp/wheel-cost-slow.json
OR3_AUDIT_REFERENCE_MODULE=audit-evidence/performance-20261023/scroll-follow-frame-reference.mjs OR3_AUDIT_MODES=frame,installed,installed,frame,frame,installed bun audit-evidence/performance-20261023/card-cold-open-probe.mjs /tmp/wheel-cost-normal.json
bun audit-evidence/performance-20261023/scroll-wheel-owner-probe.mjs /tmp/wheel-lifecycle.json http://127.0.0.1:3116
```

For production controls, build and preview with the existing scroll and
production-journey harness flags, then use the seven-case command in the prior
[wheel report](WHEEL-REVERSAL.md) and point the lifecycle probe at loopback 3147.
