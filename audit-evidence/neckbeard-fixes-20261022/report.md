# Review fixes and validation

All six reported issues are addressed. No performance regression was detected in the tested paths.

| Issue | Change | Regression coverage |
| --- | --- | --- |
| Repeated chunk-hit searches | Orama returns the best chunk per distinct resource. Scoped pagination yields between pages and stores at most one accepted hit per resource. Incremental indexing also yields between batches. | Real Orama search returns eight distinct resources in one call despite a large conversation; scoped and substring results remain correct. |
| Whole-workspace chat reloads during streaming | Mutation hooks coalesce originating thread IDs. The coordinator applies a source delta, and indexed Dexie reads fetch affected conversations, reference descendants and necessary ancestors. Sync and unknown/move events retain full reconciliation. | Hook coalescing, full-refresh precedence, partial coordinator updates/removals, real indexed DB reads, and exact inherited reference content. |
| Closed-document cache retention | Each mounted editor owns a DB-bound cache lease. Final release flushes and evicts; other splits and reopened panes retain ownership. Failed saves and conflict drafts remain recoverable. | Mounted split-pane close/save/eviction, reopen during an in-flight save, and existing failed-save, conflict, and workspace-switch suites. |
| Title keystrokes serialize the body | An unchanged immutable ProseMirror document takes a title-only capture path. Title and content reconciliation have separate watchers. | A mounted editor rename makes zero getJSON calls and persists the title without changing its body. |
| Whole-document statistics before paint | Cache immutable block metrics, reuse the word segmenter, and debounce statistics by 150 ms with a one-second maximum wait. Caret/active-heading updates remain on animation frames. | Rich-text, hard-break and table counts; heading positions; unchanged-block reuse; deferred updates and disposal cancellation. |
| Sidebar index failures bypass fallback | Both index creation and insertion failures clear readiness and use substring results. A subsequent rebuild retries the index. Removed unused entity maps. | Both failure stages resolve with results and recover on retry. The regression failed before the fix. |

## Chrome measurements

Baseline is commit `c299552915aa0f3977673bcfa702f539d225a6c8`. Before and after bundles use production source modules in the same Chrome tab. The baseline build substitutes the exact reviewed versions of the search index and insights composable; other dependencies and synthetic fixtures are identical. Browser benchmarking ran against a separate offline development server at `127.0.0.1:3156`, not the user's existing application tabs.

| Measurement | Before median / p95 | After median / p95 |
| --- | --- | --- |
| Search a 16 MB conversation, five samples | 761.6 / 778.5 ms | 5.2 / 7.0 ms |
| Next frame after editing a 2-million-character document, eight samples | 56.3 / 56.9 ms | 0.3 / 0.4 ms |

Every search sample asserted the same single resource without fallback. Both statistics variants returned 320,003 words. The insights measurement isolates the real composable and immutable editor nodes; it is not a full-page INP measurement. Statistics intentionally update after the typing frame.

In the rendered production editor, a separate 467,800-character, 500-paragraph fixture displayed 50,000 words. Renaming through the UI made zero body serialization calls. The renamed title and complete content survived a reload. The full application's command palette found body text, returned a single resource with a preview, opened the document, and allowed closing the modern workspace tab. Cache eviction and split-pane safety were verified by the mounted integration tests. Synthetic local fixture data remains confined to this test origin; no credentials were entered.

![Rendered editor after save and reload](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/audit-evidence/neckbeard-fixes-20261022/chrome-editor.jpg)

![Full application body-search result](https://github.com/Saluana/or3-chat/blob/8e8557404d91eb6057a1d8d49faf9f7de6f34230/audit-evidence/neckbeard-fixes-20261022/chrome-palette.jpg)

## Validation

- Targeted search, sidebar, document composable and mounted editor suites: **29 files, 152 tests passed**.
- `bun run type-check`: passed. Existing duplicate auto-import warnings remain.
- `bun run lint:changed` over the changed application and test files: passed.
- `bun run command-palette:benchmarks:check`: passed on 10,000 resources / 50,000 chunks / 153.8 MB indexed text. Warm query p95 0.11 ms; maximum indexing batch 7.89 ms, within the existing 75 ms / 50 ms budgets. See `standard-search-benchmark.log`.
- `git diff --check`: passed.

These checks cover the changed search and editing paths. They do not establish production Core Web Vitals or paid-provider behavior.

## Reproduce the Chrome benchmark

1. Start an isolated offline dev instance with the production journey harness using the supported wrapper, for example `OR3_PRODUCTION_JOURNEY_TEST_HARNESS=true OR3_DEV_HTTPS_PORT=3456 bun run dev --or3-offline --host 127.0.0.1 --port 3156`.
2. Run `bun audit-evidence/neckbeard-fixes-20261022/build-browser-benchmark.ts` from the repository root. `OR3_REVIEW_BASELINE` can override the recorded baseline revision.
3. Open `/__or3-document-journey-test` in Chrome. Using developer evaluation, import `/.or3-review-performance/before.js`, then call `measureSearch()` and `measureInsights()`. Repeat with `after.js`. Their assertions reject on result/count regressions.
4. Remove the generated `public/.or3-review-performance` directory after testing. The generated browser bundles are not part of the implementation.

Raw measured samples are retained in `results.json`; the repeatable fixture and build script are beside this report.
