# Section 6: initialize syntax grammars on demand

Baseline: `2143f9b2` (section 5's scoped focus selectors). The first highlighted
block still paused the main thread after the repeated CSS invalidation was fixed.

## Change

The default `streamdown-vue@1.0.35` entry initializes all sixteen local language
loaders when its shared highlighter first starts. Even a TypeScript-only reply
therefore loads and initializes unrelated Python, Rust, Go, Vue and other
grammars. The existing `lazy` registration option supports loading each grammar
on its first code fence.

`app/utils/stream-markdown.ts` configures those local loaders through the
renderer-owned registry and re-exports the same renderer/highlighter for Chat,
Documentation and Help. It retains the existing lazy component boundaries,
language aliases, theme behavior and unknown-language plain-text fallback.
Bundled grammars may include their required embedded languages. Existing remote
language registrations remain as provided by the dependency.

`@shikijs/langs@4.5.0` is now a direct dependency because the host imports its
loaders. Both lockfiles already resolved that exact version, so no package
version changes or new grammar binaries were introduced.

## Measurements

The same synthetic SSE probe from section 5 exercises the real production
controller, twelve TypeScript blocks, twelve math expressions and persistence.
Fresh disposable Chromium contexts use Blank, zoom 1, 1200×800 at DPR 1, external
requests blocked, and either normal CPU speed or 4× slowdown. No test runner,
build or typecheck was active during the repeated final measurements.

| Rich stream at 4×, repeats 1 / 2 / 3 | Before | After |
| --- | --- | --- |
| Initial long task (ms) | 298 / 301 / 309 | 216 / 218 / 216 |
| Maximum frame interval (ms) | 376.5 / 375.6 / 366.5 | 233.7 / 217.0 / 208.5 |
| Frame interval p95 (ms) | 18.2 / 18.4 / 23.7 | 18.5 / 18.4 / 18.6 |
| Long-task count | 2 / 1 / 4 | 3 / 1 / 3 |

The initial task's median fell about 28%; maximum frame interval's median fell
about 42%. Steady streaming p95 remained approximately unchanged. These are
separate build runs, not a paired in-document ablation.

At normal CPU speed, final repeated maximum intervals were 49.7/40.7/48.5 ms,
with one 50–51 ms initial task each. Section 5's single normal-speed baseline
had a 76.1 ms maximum interval and a 73 ms task. An initial final-build sample
recorded no long task, but it overlapped typechecking and is not substituted for
the repeat evidence. The residual cold stall remains an open issue.

The baseline diagnostic fetched 82 JavaScript resources totaling 1,749,871
encoded-body bytes. Each final repeat fetched 67 totaling 1,046,866 bytes:
15 fewer requests and 703,005 fewer bytes (about 40% of JavaScript fetched for
this journey). This measures fetched resources, not the total emitted bundle,
compressed transfer overhead, or every language's loading cost.

All six final rich repeats rendered twelve `pre.shiki` blocks and twelve math
expressions, saved the exact expected assistant text, preserved the completed
first paragraph without mutations, and ended at zero bottom distance. The
initial prose controls also saved exactly and recorded no long tasks.

Raw evidence: `highlight-baseline-profile.json` includes the earlier cold profile
and resource list. `highlight-results.json` includes the exploratory sample and
six final repeats with resource lists. Baseline timings come from
`rich-stream-results.json`, `pairedRich` entries with `selector: production`.
The shared `rich-stream-probe.js` now records highlighted block counts and script
resources after its timing window.

## Validation and open checks

- The existing real-renderer suite gained one regression. Before configuration,
  warming the highlighter initialized 34 language IDs/aliases rather than zero.
  Afterward it loads TypeScript through `ts` on demand, leaves Python unloaded
  until a `py` fence arrives, and retains safe plain text for an unknown language.
  All three tests pass, including existing KaTeX and custom-element behavior.
- Production build, application typecheck, changed-file lint, lock drift and
  diff checks pass. Both completion/reload and stop/partial-persistence browser
  journeys pass with the required journey flag enabled.
- Two additional existing JavaScript-disabled startup geometry checks failed:
  desktop expected 320 px but observed 288 px; mobile expected a 390 px computed
  maximum width but observed 410.526 px. Their expectations assume scale 1 while
  the unchanged Blank theme specifies 0.9 desktop / 0.95 mobile and the shell
  compensates viewport units for zoom. These checks are not claimed as passes;
  theme-aware startup qualification is a separate follow-up. The original
  combined invocation omitted the journey flag and skipped its two stream tests;
  the corrected invocation ran and passed both.
- TypeScript is still highlighted synchronously on the main thread. Larger code
  blocks, mixed/embedded languages, highlighter offloading and slow actual
  devices remain unqualified. The full frontend audit remains active.

No external publication or deployment was performed for this section.
