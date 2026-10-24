# Scroll intent follow-up

Latest follow-up: [native wheel reversal](WHEEL-REVERSAL.md) adds owned
frame coalescing and closes the original Chromium reproduction. The report
below records the preceding repair and its then-open evaluations.

Subsequent evaluation: [rich-content fonts and remaining audit work](RICH-FONT-EVALUATION.md)
narrows the cold/warm font finding without clearing the recurring rendering cost.

Date: October 24, 2026. Branch: `or3-cloud`, based on local commit `a996424a`.
This repair and the earlier tool-card changes are uncommitted. No push, PR,
deployment or dependency version change has occurred. The broader audit remains
active; the remaining evaluations below are not cleared by this repair.
A fresh fetch confirms upstream remains `25c758b2`: this checkout is one local
commit ahead and zero behind `origin/or3-cloud`.

## Investigated and fixed

The scroller kept a programmatic marker after an instant bottom-follow write.
If a native offset overtook that write before its queued event was processed,
the marker could suppress the upward delta. Queued viewport work could then
resume bottom following and discard the browsing position.

The existing pinned `or3-scroll` ESM patch now:

- treats an instant write as programmatic only at its expected target;
- recognizes native upward movement in the existing scroll handler before
  queued viewport/row work runs, using the existing browsing classifier;
- retains asynchronous settlement for explicit smooth requests and keyed jumps.

The existing anchor formulas, overscan, preload margins, scheduler and public
API are unchanged. This introduces one owner-local smooth-request flag and a
private marker comparison; it adds no registry, event listener or global state.
The browser handler performs a bounded comparison/classification, not a row scan.
CSS, themes, typography, spacing, sizing, card placement, data and portable-card
production gates are unchanged. This is a stability repair; no frame-rate or
throughput improvement is claimed.

The canonical scroll canary now exercises the actual installed scroller with
an instant bottom write followed by an overtaking offset/event in the same
browser task. It waits for the fixture's decoded tail image and fonts, then
checks the browsing anchor through an append, explicit smooth recovery and a
hidden/restored pane. The hidden-pane control passed without an additional repair.
The fixture only forwards the already-supported smooth option. No production
test seam was introduced. This controls event ordering; it is not physical-device
or compositor qualification.

## Evidence and validation

The browsing regression was run against a temporary restoration of the
original installed dependency, with the existing measurement patch intact.
It failed: an immediate 400 px browsing gap was pulled back to zero. The repaired
dependency preserves `scrollTop: 10738`, anchor `canary-thread-a-91` and offset
`-46` through settlement and a subsequent append. Explicit smooth navigation
then reaches the tail and follows another append.

An initial marker-only candidate still failed. Recognizing the movement before
queued layout work was necessary for the passing repair. Fresh Vite dependency
caches and inspection of the optimized runtime confirmed which code each run
loaded. The original dependency was restored only for the before-fix control;
the final installed module contains the repair.

- [Before-fix regression](scroll-intent-before.json): expected failure at the
  lost browsing gap, rather than setup or network failure.
- [Complete development browser run](scroll-intent-browser.json): **26/26 pass**,
  comprising all 10 scroll canaries and 16 tool-card journeys, without retries.
- [Production browser run](scroll-intent-production.json): **7/7 pass**, covering
  the new regression and sidebar recycling in Blank, Retro and Cyberpunk, each
  in light and dark mode. The later
  [final production owner rerun](scroll-intent-hidden-production.json) also passes
  with the added hidden/restored-pane control; no runtime change followed the
  full runs. These existing journeys check row visibility, time-label reuse,
  menu/focus behavior and intended exit animation. They do not prove pixel
  identity or physical-device performance.
- [Additional original reversal repetitions](scroll-intent-reversal-repeat.json):
  **one pass and two failures**. The large-wheel race remains open.
- [Selected native input/state traces](scroll-intent-traces.json): the original
  trace shows a pending bottom marker suppressing native movement. A repaired
  diagnostic still samples offset 1335 when its saved-card assertion passes;
  its explicit-top control restores the saved answer. Instrumentation changes
  timing, so these are diagnosis rather than a performance comparison.
- [Repository typecheck](scroll-intent-typecheck.txt),
  [production build](scroll-intent-build.txt), documentation checks,
  diagnostic-runner lint, reverse patch applicability and final diff checks pass.
  The build completed in 55 seconds. Existing duplicate-import warnings and the
  trusted-host rebuild qualification notice remain. Prior 66-case owner/sibling unit evidence remains
  in [the preceding report](CONTINUED-STABILITY.md#validation); those unchanged
  suites were not rerun solely for the dependency/browser repair.

The ESM runtime change adds 11 lines and removes 4 relative to the previously
patched installed module. Patch-file bookkeeping also retains all earlier
measurement fixes. The canary/fixture changes add 51 and remove 4 lines. The
retained probe adds optional internal-state tracing; it is diagnostic and does
not turn a caught assertion into a passing canonical test.

## Still requiring evaluation

1. **Large native wheel reversal:** the original saved-state virtualization
   journey still fails intermittently. Before-event compositor positioning and
   dynamic row-height changes need further isolation. Passing state assertions
   and viewport endpoints are separate evidence. Do not broaden this repair
   into a claim that all scrolling is fixed.
2. **Rich-content rendering:** cold/warm font, math layout and worker costs;
   the earlier roughly 33.3 ms p95 at 4× CPU remains unresolved.
3. **Scale and lifecycle:** long tool arguments/results, sustained memory,
   repeated mount/unmount and workspace switches, large workspaces and long
   sessions.
4. **WebKit and devices:** compaction/import errors, private Blob storage,
   physical Safari/iOS and Android scrolling, persistence and recovery.
5. **Other surfaces:** font readiness, reduced-motion idle work, editors,
   search, dialogs, plugins and background/sync combinations.

The [continued stability report](CONTINUED-STABILITY.md) retains the preceding
fixes, controls and wider qualification limits. No appearance change is proposed
to close the remaining findings.

## Reproduction

Run the existing offline development harness with both scroll and tool-card
routes enabled on loopback port 3116, as in the preceding report.

```sh
OR3_SCROLL_TEST_HARNESS=true PW_SKIP_WEB_SERVER=true PW_PORT=3116 bunx playwright test tests/e2e/or3-scroll-canary.spec.ts tests/e2e/tool-cards.spec.ts --workers=1 --reporter=line
PW_SKIP_WEB_SERVER=true PW_PORT=3116 bunx playwright test tests/e2e/tool-cards.spec.ts --grep 'saved card state survives' --repeat-each=3 --workers=1 --reporter=line
bunx tsx audit-evidence/performance-20261023/tool-card-scroll-probe.mjs /tmp/card-scroll-owner.json source '{"traceInternals":true}'
```

The trace option instruments the exact installed ESM runtime in a disposable
browser response and asserts each insertion point. Application files are not
modified by it. Full local command logs and diagnostics remain under
`/tmp/or3-scroll-*`.
