# Section 5: style invalidation during rich streaming

Baseline: `9feacea5`. This section measures the production controller, Markdown
renderer and persistence with synthetic local SSE. It does not change transport,
stream cadence, persistence or the Markdown parser.

## Cause and change

CPU and style-invalidation traces identified two globally generated Nuxt UI
focus utilities. Their `:is(:where(.group):has(:focus-visible) *)` selector shape
made Chromium invalidate the HTML subtree on unrelated DOM mutations, even when
neither component was mounted. As rich output accumulated, every subsequent
chunk incurred style work across the growing document.

The application stylesheet excludes just these two generated candidates and
supplies equivalent rules with the group as an explicit ancestor. Class names,
specificity and 115%/105% focus scale effects are preserved. Tailwind documents
the [explicit source exclusion syntax](https://tailwindcss.com/docs/detecting-classes-in-source-files#explicitly-excluding-classes).
The built stylesheet contains only the scoped forms. No dependency patch is
needed for this section.

The existing performance browser suite now checks the actual shipped CSS:
twelve DOM replacements produced eleven matching document-wide invalidations
before the change and zero afterward. It requires positive style-update events
so a missing trace cannot silently pass. It also verifies keyboard focus applies
the original scale effects to the corresponding group only, with an unmatched
target remaining unchanged. The test fails against the original production
build and passes against the fixed build.

## Streaming evidence

`rich-stream-probe.js` uses fresh disposable Chromium contexts, local-only
routing, the existing production journey fixture, and native Send. A synthetic
fetch response supplies 64-character SSE chunks every 16 ms. Controller intake,
rendering, completion and IndexedDB persistence are real. The rich reply is
9,924 ASCII characters: twelve sections containing prose, lists, twelve-line
TypeScript blocks, math and tables. The prose control is 9,767 characters.

Recorded profile: Blank theme, zoom 1, 1200×800, DPR 1, foreground page, 1× or
4× CPU slowdown. Timing includes 400 ms after completion. It is local Chromium
evidence, not an actual mobile-device result or a universal frame-rate budget.

| Single production run | Before p95 / max (ms) | After p95 / max (ms) | Long tasks before → after |
| --- | --- | --- | --- |
| Prose, 1× | 9.8 / 10.4 | 9.3 / 10.3 | 0 → 0 |
| Rich, 1× | 9.6 / 75.8 | 9.7 / 76.1 | 1 → 1 |
| Prose, 4× | 10.1 / 40.8 | 10.1 / 59.0 | 0 → 0 |
| Rich, 4× | 50.0 / 375.1 | 18.3 / 375.1 | 26 → 3 |

An alternating paired repeat on the fixed build restores only the two original
selectors through CSSOM for its control, retaining all declarations. Each case
has a fresh context. This isolates the selector change from other build changes:

| Rich stream at 4×, repeats 1 / 2 / 3 | Original selectors | Scoped selectors |
| --- | --- | --- |
| Frame interval p95 (ms) | 50.9 / 50.0 / 49.9 | 18.2 / 18.4 / 23.7 |
| Long tasks | 27 / 22 / 28 | 2 / 1 / 4 |
| Elapsed time including final wait (ms) | 7,611 / 7,287 / 7,381 | 4,288 / 4,324 / 4,440 |

Median p95 improved about 63% in the paired repeat. Every baseline, final and
paired case saved the exact expected assistant text and rendered the final
marker. Rich cases rendered twelve code blocks and twelve math expressions,
had 2,988 nodes in the chat root and ended at zero bottom distance. A completed
first paragraph had zero observed mutations after the probe attached. The prose
control's first paragraph keeps growing, so its mutation count is expected and
does not represent replacement of completed content.

The first Shiki initialization remains a long task: approximately 73–75 ms at
1× and 298–317 ms at 4× in these runs. Maximum frame intervals therefore did not
improve. This section removes repeated global styling work; it does not qualify
cold highlighting or claim stutter-free streaming.

## Other scrollers

The existing sidebar and project/model probes were rerun on the final build:
Blank/light, 90% zoom, 1200×689, DPR 2, 4× CPU slowdown. The same bounded native
wheel gestures and sampling windows were retained. Later passes revisit a warm
range; they do not qualify full-list endpoints.

| p95 (ms), runs 1 / 2 / 3 | Earlier section's final build | Scoped selectors |
| --- | --- | --- |
| Chat rows | 66.3 / 66.3 / 66.6 | 51.2 / 57.9 / 59.3 |
| Projects | 74.9 / 73.5 / 66.9 | 58.3 / 58.9 / 58.0 |
| Models | 57.8 / 50.7 / 50.8 | 34.7 / 33.2 / 33.3 |

Chat long tasks fell from 10/12/13 to 0/2/1. Model long tasks fell from 0/1/1
to zero in all passes. Projects still incurred nineteen long tasks per pass.
The chat comparison uses section 3's final receipt (`3d90841d`); section 4 only
changed project/model owners. Project/model comparisons use section 4's final
receipt (`9feacea5`). These are separate production runs, not the paired
CSSOM experiment above. Timing remains variable.

Raw evidence: `rich-stream-baseline.json` includes original measurements,
profile summaries and a representative global invalidation event.
`rich-stream-results.json` contains final measurements, paired repeats and
cross-scroller results with their baseline provenance.

## Validation and remaining work

- Production build, application typecheck, changed-file lint and diff checks pass.
- New style-scope regression fails before the fix and passes afterward, including
  the final test cleanup change.
- Seventeen existing production browser checks pass: nine scroll canaries, six
  sidebar theme/mode cases, complete-stream reload and stop/partial persistence.
- No public API, data schema, dependency version or deployment change.
- Cold highlighting, larger/mixed code streams, concurrent panes, tools,
  offscreen streaming, touch input and actual mobile devices remain open.

The overall frontend audit remains active. No external publication was performed.
