# Rich-content font evaluation and remaining audit work

Later qualification: [WebKit compaction import investigation](WEBKIT-IMPORT.md)
classifies the previously observed loader error and corrects the journey's
warm-up readiness. The wider remaining evaluations below retain their scope.

Date: October 24, 2026. Branch: `or3-cloud`, local commit `a996424a`.
The broader audit remains active. **There are still unresolved findings and
areas requiring evaluation.** This report narrows one cause; it does not clear
rich streaming or the wider application.

The earlier [image fixes](FOLLOWUP-STABILITY.md) are committed. The subsequent
[tool-card fixes](CONTINUED-STABILITY.md) and [scroll-intent repair](SCROLL-INTENT.md)
remain uncommitted. This round changes only the retained diagnostic runner and
audit evidence. It adds no production fix, font preload, render cache, CSS,
theme, layout, dependency version, storage or public-contract change. No push,
PR or deployment occurred.

## Investigated

The concurrent rich-stream workload still has roughly 33.3 ms p95 animation-frame
intervals under 4× main-thread CPU throttling. A previous trace included first-use
math-font invalidations, so this round compared cold fonts with the exact observed
font loaded before streaming. Loading the font does not render Markdown or warm
the syntax highlighter/parser.

Each run uses a fresh disposable Chromium 153 context on the same local production
build: Blank/light, 1440 × 900, DPR 1, existing 90% zoom, two real workspace panes
and 120 history rows per pane. One pane browses retained history while the other
follows its streaming tail. Each local response contains 12 TypeScript blocks and
12 display-math expressions. Existing single-dollar examples remain literal text.
The synthetic SSE feeds 64-character chunks at requested 16 ms intervals, with
both transports gated until admitted. External traffic is blocked. Runs are
sequential; worker CPU does not receive equivalent 4× throttling.

The optional runner controls now record KaTeX font-face status/resource timing
and load an explicitly selected face through its existing `FontFace`. The cold
runs all start with no KaTeX faces loaded. The only subsequently loaded face is
`KaTeX_Size1`, normal/400, so the warm control loads that face alone. It waits for
font readiness and two frames before CPU throttling and measurement. No hidden
rich-content render or unrelated font warming is involved.

## Results

Three alternating cold/warm pairs produced the following clean timing samples:

| Run | Streaming p95, ms | Whole-run p95, ms | Maximum interval, ms | KaTeX requests during measurement |
| --- | ---: | ---: | ---: | ---: |
| Cold 1 | 33.3 | 33.3 | 66.7 | 1 |
| Warm 1 | 33.3 | 33.3 | 66.6 | 0 |
| Cold 2 | 33.3 | 33.3 | 50.0 | 1 |
| Warm 2 | 33.3 | 33.3 | 83.3 | 0 |
| Cold 3 | 33.3 | 33.4 | 83.3 | 1 |
| Warm 3 | 33.3 | 33.3 | 83.2 | 0 |

Post-transport p95 is 16.7–16.8 ms in four samples and 33.3–33.4 ms in two
samples, one cold and one warm. Loading this font first does not remove the
recurring slowdown or establish a maximum-interval improvement. These small
local samples are not a production reliability estimate or Core Web Vitals score.

Separate instrumented cold/warm traces support the narrower conclusion:

| Streaming trace event | Cold | Warm |
| --- | ---: | ---: |
| Font-change invalidations | 2 | 0 |
| Layout count / total duration | 137 / 232.7 ms | 131 / 229.6 ms |
| Style calculation count / total duration | 221 / 247.1 ms | 215 / 230.9 ms |
| Largest layout | 30.5 ms | 28.4 ms |

Both instrumented runs record 33.4 ms whole-run p95. Instrumentation changes
timing, and event durations are not an additive main-thread budget or a matched
speedup claim. The warm trace still samples Vue DOM-property writes, HTML creation
and insertion work. The parser already reuses completed parsed trees but rebuilds
their render nodes. A separate served-response control reuses those completed
nodes after their first reuse; it also records 33.3 ms p95. This one diagnostic
does not qualify a general render cache, theme/prop invalidation or plugin overrides.
No production cache change is retained.

All nine probe runs preserve exact durable replies in both panes, the browsing
anchor and offset, zero right-pane bottom distance, both completion/navigation
markers, and 12 highlighted right-pane code blocks. The sampled completed heading,
code and math nodes remain connected with zero observed subtree mutations.
These checks do not establish pixel identity, every painted frame or device behavior.

Receipt: [full run results and diagnostic summaries](rich-font-controls.json).
It records browser/options, execution order, font states/resources, frame phases,
content/anchor checks, the exact served-bundle control and selected trace/profile
details. Raw local outputs remain under `/tmp/or3-rich-font-*` and
`/tmp/or3-rich-vnode-control-1.*`.

## Fixed so far, and what still needs evaluation

Earlier verified fixes preserve streamed image placeholders and intake ownership,
complete quiet image hydration, remove redundant card updates/preloads, release
failed-card subscriptions and preserve browsing when native scrolling overtakes
an instant programmatic write. Their regressions and qualifications are in the
linked reports above. This round adds diagnostic font controls; it does not claim
another application defect is repaired.

Remaining work includes:

1. **Recurring rich-content cost:** attribute the remaining per-update DOM,
   style/layout and worker work, including long arguments/results. Font readiness
   alone is now ruled out as sufficient to remove this workload's p95 slowdown;
   first-font paint and other formulas still require separate qualification.
2. **Rapid native scroll reversal:** the original large-wheel saved-card journey
   still failed two of three extra repetitions after the narrower intent repair.
   Compositor/event ordering and settling row geometry remain unresolved. A saved
   card assertion can pass while the viewport remains below the requested top.
3. **WebKit and devices:** isolate the intermittent compaction/module-import
   error; evaluate private-context Blob storage separately from normal-profile
   results; qualify actual Safari/iOS and Android persistence, scrolling and recovery.
4. **Scale and lifecycle:** sustained memory, long sessions, large workspaces,
   repeated mounts/unmounts and account/workspace switches, plus plugin resource
   cleanup beyond the selected card cases.
5. **Other surfaces and combinations:** font-ready output, reduced-motion idle
   work, editors, search, dialogs and background/sync/provider combinations.

The next rich-stream investigation should attribute the remaining changing DOM
and layout work before choosing a repair. The evidence does not justify a global
font preload or a render cache. Appearance must remain unchanged.

## Validation and reproduction

The six clean comparisons, two traces and one served-response control completed
with the checks above. Targeted diagnostic-runner lint and diff checks pass.
Application tests, typecheck and build were not repeated for this diagnostic-only
change; the current production build and earlier application validation are
recorded in [the scroll-intent report](SCROLL-INTENT.md#evidence-and-validation).

With the existing offline production preview on loopback port 3147:

```sh
bunx tsx audit-evidence/performance-20261022/run-concurrent-pane-probe.mjs '{"rich":true,"synchronized":true,"cpuRate":4,"dbCounts":false,"fontAudit":true,"phaseAudit":true}' /tmp/rich-font-cold.json
bunx tsx audit-evidence/performance-20261022/run-concurrent-pane-probe.mjs '{"rich":true,"synchronized":true,"cpuRate":4,"dbCounts":false,"fontAudit":true,"phaseAudit":true,"warmFonts":[{"family":"KaTeX_Size1","style":"normal","weight":"400"}]}' /tmp/rich-font-warm.json
```

Use fresh contexts and alternate conditions. Add `trace:true`, `profile:true`
and `layoutAudit:true` only for separate diagnostic runs. Existing bundle controls
assert the exact build and unique replacement; their old identifiers must not be
silently reused after a rebuild.
