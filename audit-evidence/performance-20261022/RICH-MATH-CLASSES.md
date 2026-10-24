# Section 12: stop rewriting completed math classes

Baseline: `769e26fc`. This section follows the concurrent rich-streaming
slowdown found in section 11. It removes a demonstrated source of unnecessary
DOM writes. **The remaining frame-time bottleneck is not resolved.**

## Finding and repair

The installed `streamdown-vue@1.0.35` ESM renderer reconstructs VNodes from
cached HAST trees as later text arrives. Its attribute adapter passed HAST
`className` arrays directly to Vue. Vue treats that name as a DOM property;
a fresh array makes it assign the property again even when the completed
formula and its classes have not changed.

The pinned dependency patch maps `className` to Vue's `class` prop.
Vue normalizes these arrays into comparable class strings, allowing unchanged
classes to remain untouched and preserving multiple class tokens correctly.
Parsing, cached trees, URL/image filtering, component overrides, and actual
content edits keep their existing owners. There is no extra cache or registry.

The patch targets the ESM renderer used by this Nuxt application. The unused
CommonJS distribution is unchanged. Existing install, Docker, and generated
source-project patch steps apply it. `patches/README.md` records scope and
the conditions for removing it after an upstream release is qualified.

## Regression and production evidence

The canonical real-renderer math test now appends three text updates after a
completed formula, observes that formula's DOM, and then edits the formula.
It failed on the baseline with **42 mutations** and passes with **zero**.
It also checks inline/block math, normalized combined math classes, and that
changing the formula from `x^2` to `x^3` still updates its annotation.
Existing grammar/alias/fallback and custom-element checks remain in that suite.

The production probe observes the first completed heading, code block, and
formula after at least 512 response characters have been produced. In the
diagnostic baseline these retained nodes received **1,824 mutations**, with
class-attribute assignments in the examples. With the patch the same diagnostic
records **zero**; all three original nodes remain connected. Every clean
production repeat also records zero.

Both synthetic responses are saved exactly. The left pane stays at its original
history anchor while its offscreen response grows, the right remains at the
bottom, and the normal scroll-to-bottom button reveals the left end marker.
The expected Retry-button enablement at stream completion is recorded separately.

The workload and environment are inherited from section 11: two real workspace
pane controllers, 120 history messages per conversation, approximately 3 KB
per response, Chromium, Blank/light at 90% scale, 1440×900 DPR 1, and local-only
routing. Each response contains 12 TypeScript fences and 12 standalone
double-dollar math expressions. Its 12 single-dollar inline examples remain
literal text under the current host Markdown processing; they are not evidence
of additional rendered formulas. The final screenshot confirms readable code
and math in both panes.

| Clean production, 4× CPU | Before (one run) | After (three runs) |
| --- | --- | --- |
| Frame interval p95 (ms) | 58.3 | 58.2 / 65.3 / 58.7 |
| Maximum interval (ms) | 292.2 | 258.3 / 224.6 / 292.3 |
| Long tasks | 19 | 19 / 17 / 15 |

These results do not demonstrate a meaningful frame-time improvement.
At normal CPU speed the after run records p95 16.4 ms, a 50 ms maximum interval,
and one 51 ms long task; the earlier baseline was 10.2 / 58.4 ms with no long
tasks. Neither isolated run is a general smoothness guarantee.

## Diagnosis and remaining work

A CPU profile attributes much of the measured time to native browser work,
with syntax-tokenizer frames and the virtual-scroller measurement callback also
visible. A timeline trace shows layout and style work as the recurring cost.
Controlled removal of the page-layout `:has()` selector, viewport containment,
and row containment did not materially improve the steady intervals. Those
experiments were disposable browser changes and were not adopted.

Before/after diagnostic traces use the same page-layout selector control and
have substantial tracing overhead. Aggregate layout durations remain about
1,321 / 1,365 ms and style updates about 640 / 770 ms. They corroborate that
eliminating completed-math writes does not solve the larger layout cost.
They are not clean timing samples and aggregate event categories can overlap.

Further work must investigate the remaining broad style invalidations and
layout passes, plus the roughly 200 ms cold highlighter task at 4× CPU.
Tool streams, other browsers, physical mobile devices, and every painted
scroll frame remain outside this section's qualification.

## Validation and reproduction

- 25 focused real-renderer and ChatContainer tests pass.
- Five production browser journeys pass: responsive rich content and touch
  editing in Blank, Retro, and Cyberpunk, plus stream/reload and partial-stop
  persistence. Responsive cases check 390, 320, 844, and 1920 px widths.
- Production build and application typecheck pass.
- The patch applies cleanly to a reconstructed unmodified installed ESM file;
  applying it produces a byte-for-byte match to the tested file.
- Changed-file lint and diff whitespace checks pass.

Use `concurrent-pane-stream-probe.js` with
`{ cpuRate: 4, rich: true, synchronized: true }`, or `cpuRate: 1`.
It now supports optional CPU profiles, timeline diagnostics, and screenshots.
CSS control options are diagnostics only and are off by default.

Receipts:
- `pane-history-results.json`: clean pre-fix rich samples.
- `concurrent-rich-profile.json` and `concurrent-rich-trace.json`: initial diagnosis.
- `concurrent-rich-controls.json`: rejected CSS controls and pre-fix DOM diagnostic.
- `concurrent-rich-class-results.json`: three clean 4× after samples, normal CPU,
  and the matched diagnostic trace.
- Local visual artifact: `.playwright-mcp/concurrent-rich-render-final.png`.

No package version was changed and no external publication was performed.

