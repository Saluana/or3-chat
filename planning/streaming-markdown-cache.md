# Streaming Markdown parse cache

## Goal

Reuse completed, unchanged blocks during streaming without changing Markdown output or replacing the parser pipeline. Cache parsed data per `StreamMarkdown` instance, never Vue nodes or component instances. Proceed only if profiling supports a useful benefit; an unchanged public API alone does not establish rendering compatibility.

## Current behavior

- `../streamdown-vue/src/StreamMarkdown.ts` preprocesses LaTeX, repairs incomplete Markdown, calls `parseBlocks`, merges math regions, and repairs individual blocks before calling `processor.parse()` and `processor.runSync()` for every block.
- `../streamdown-vue/lib/parse-blocks.ts` uses Marked and returns block strings. Its public `parseBlocks(markdown): string[]` API should remain compatible.
- Existing streaming tests often create a fresh SSR instance per chunk; those verify output but cannot prove cache reuse across updates.
- At initial inspection, chat consumed `streamdown-vue@1.0.29` and the sibling source reported `1.0.32`. Recheck versions, validate the built package, and review the version difference when integrating.

## Profile first

Use a persistent browser-mounted renderer with repeatable streamed fixtures for prose, code, and math, including a mixed response that exercises fallbacks. Hold chunk size, cadence, viewport, browser, and hardware constant. Record full-document preprocessing/lexing, Unified/KaTeX, Vue render/patch, total main-thread time, slow update frames, allocations, and retained heap with several long messages mounted.

Before implementing, record baseline variation and a practical improvement target. Proceed if repeated parsing is a substantial cost; if preprocessing or Vue dominates, stop and revise the scope. After implementation, repeat the same profiles and require improvement beyond baseline variation without material latency or memory regressions on fallback-heavy inputs. Parse-call counts prove reuse, not smoother streaming. Keep profiling lightweight and local; no new benchmark service or production telemetry.

## Approach

1. **Keep preprocessing and block detection authoritative.** Continue running the current full-input preprocessing, Marked lexer, and math merging. Compare their resulting blocks before deciding what can be reused; the cache must not become a second Markdown parser. This first change reduces repeated Unified/KaTeX work; preprocessing, lexing, comparison, and Vue rendering can still scale with response length, leaving quadratic total work across a growing stream.
2. **Add a small cache owned by component setup.** Retain the previous effective source (including slot precedence), parse mode, and completed-block records containing their exact final parser input and HAST `Root`. Reuse only unchanged records at matching positions within the safe prefix. Treat cached trees as read-only and run the existing `renderChildren` path each render, creating fresh VNodes and retaining link/image hardening, code controls, themes, and custom components.
3. **Always reparse the active or affected region.** The final meaningful block remains active, even after synthetic repairs make it look closed. A block becomes reusable only after a real following boundary confirms it and its prepared parser input remains identical. Ignore whitespace-only tokens when deciding completion. Reparse from the first changed or uncertain block onward.
4. **Fall back conservatively.** Use the rules below instead of trying to implement a new incremental Markdown grammar. If confirming a boundary requires elaborate tracking, bypass reuse for that case. Start with the smallest proven subset, such as ordinary paragraphs and explicitly closed math. Roughly one parse per update is a conditional benefit, not a promise for lists, incomplete constructs, or plugin users.
5. **Retain only the current document's completed blocks.** Replace affected entries rather than keeping versions or a global content cache. Clear on reset, non-append edits, truncation, parse-mode changes, and disposal. Cache only successful parse results; preserve the current error behavior. Retention grows with document size and mounted-instance count, especially for expanded math HAST; current-document scope is not a small fixed memory bound.

## Fallback rules

| Situation | Behavior |
| --- | --- |
| Earlier text edited, shortened, or replaced | Clear the cache and use the current full parse path. |
| `parseIncompleteMarkdown` changes, including stream completion | Invalidate cached results and reparse with the new mode. |
| Reference definitions, reference-style links/images, or footnotes | Bypass reuse for the document; later definitions can affect earlier interpretation. Preserve current parser semantics rather than fixing reference behavior in this change. |
| Lists, blockquotes, or other blocks whose boundaries can extend | Reparse the entire affected enclosing region. Reuse only the safe prefix before it; if its start is uncertain, use the full parse path. Blank lines alone do not establish completion. |
| Incomplete math, matrix environments, or changing math merges | Reparse from the opening affected region. Synthetic closing delimiters never make a region cacheable; fall back fully if the boundary is uncertain. |
| Open/closing code fence, table continuation, or setext-heading ambiguity | Keep the affected block active and compare the prepared prefix again. Preserve the existing progressive open-fence renderer. |
| Custom remark/rehype plugins | Bypass the cache initially, including plugin option tuples; plugins may depend on state or invocation order. Do not invent a plugin cache-key protocol. |

Prefer token metadata from the existing lexer for boundary/context checks. If metadata must be carried internally through block preparation, keep it alongside the existing strings and preserve the exported `parseBlocks` result. Unrecognized or uncertain cases take the full parse path. Keep the reuse decision beside the final prepared-input/processor boundary, and document that future preparation or processor changes must preserve its assumptions and rerun differential tests.

## Implementation checklist

- [x] **1. Profile and decide.** The checked-in Chromium harness and paired results in `../streamdown-vue/docs/performance.md` show 50–64% lower update work on eligible fixtures, with fallback ranges overlapping.
- [x] **2. Establish regression coverage.** Persistent cached-vs-bypassed rendering is compared at every chunk in `../streamdown-vue/__tests__/parse-cache.test.ts`, including lifecycle and instance-isolation cases.
- [x] **3. Implement the smallest per-instance cache.** The cache remains internal around the final Unified parse/transform boundary and retains records by position.
- [x] **4. Verify correctness, speed, and retention.** Full Streamdown tests, typecheck, build, package-consumer smoke, slow-update/frame measurements, and forced-GC mounted/post-disposal heap checks pass. Four mounted mixed instances retain about 2.97 MiB more than bypass and return within 0.07 MiB of baseline after disposal.
- [ ] **5. Qualify a focused release.** Document scope and plugin bypasses in Streamdown's README. Build/test the exports and validate a prerelease in OR3 before a stable release through the normal process. Run chat's Markdown regression and scroll canary against that exact artifact, then pin the qualified stable version and lockfile. Keep unrelated parser fixes and dependency upgrades out where possible; keep the cache change easy to revert. If checks regress, do not promote; retain the current stable dependency. Publication is not authorized by this planning request.

## Validation and acceptance

- Instrument actual Unified parse/transform calls in tests. After a completed paragraph/math prefix is established, repeated appends to one active paragraph must not reparse the safe prefix. Compare 10 and 1,000 completed blocks with the same number of tail updates; count calls after setup rather than using flaky timing thresholds. Unsafe cases may intentionally reparse everything.
- For every progressive fixture, cached and uncached output must agree at every chunk, not only at completion. Also verify persistent-component interactions and two simultaneous instances with different components/security settings. Existing security, code, math, custom-component, and SSR tests must remain green. Normalize only existing nondeterministic identifiers if necessary.
- Recursively freeze cached HAST in tests and render through the production path to detect mutation, including nested properties exposed to custom components. Keep this check out of the production hot path. VNodes, DOM nodes, and mounted component state are never cached.
- Measure retained heap with multiple long messages, including math, and again after reset/unmount and garbage collection. The cache must retain no prior-document versions or disposed instances. Record the CPU/memory tradeoff; narrow eligibility or defer the change if retained HAST costs outweigh the measured benefit.
- Use Bun throughout. In Streamdown: targeted `bun test` files while developing, then its full Bun test lane and `bun run typecheck`. Build with `bun run clean`, `bun run build:types`, `bun run build:vite`, and `bun build-css.mjs`; run `bun tests/package-consumer-smoke.mjs` for package validation. These explicit commands avoid the package scripts that currently invoke Node directly.
- In chat: run `bunx vitest run --project=core-app app/components/chat/__tests__/StreamMarkdownXmlRender.test.ts --reporter=dot`, `bun run test:e2e:scroll`, `bun run type-check`, and `bun run build` after the dependency update. Inspect the final diff; keep unrelated parser/dependency changes out of this optimization where possible.

Done when unchanged eligible blocks skip Unified parsing, browser profiles meet the recorded improvement target, memory checks pass, every fallback retains baseline output, and the prerelease plus package/consumer checks qualify the exact artifact used by chat. No application changes, profiling, tests, or releases are executed as part of updating this plan.
