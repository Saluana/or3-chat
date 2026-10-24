# Section 7: icon setup during virtual row recycling

Baseline: `0add1d15`. Project scrolling still produced one long task on almost
every wheel event under 4× CPU slowdown after the previous mount/CSS fixes.

## Finding and repair

The CPU profile identified Nuxt Icon's `useResolvedName()` setup. Installed
`@nuxt/icon@2.5.1` sorted the shared reactive collection array every time an icon
mounted, even for a qualified `collection:icon` name that needed no lookup.
The array contains 221 collection names in this build. A short project-list
scroll observed 912 such sorts, totaling approximately 225 ms inside the
instrumented sort calls.

A disposable CSS/DOM-independent experiment bypassed those sorts after the
fixture's collection list was already ordered. Warmed project p95 fell to
42.1 ms, with five long tasks per pass. This motivated the dependency repair;
the prototype modification to `Array.prototype.sort` is not shipped.

The small `patches/@nuxt+icon+2.5.1.patch` removes the setup sort. Inside the
existing computed resolver, a read-only scan chooses the longest matching
collection prefix for a hyphenated name. Qualified names skip the collection
scan entirely. Aliases, custom collections and reactive collection changes
remain supported. It adds no shared cache, parallel registry or lifecycle.

The real installed-resolver regression failed before the patch because a lookup
reordered the caller's configuration. It passes afterward and exercises prefix
stripping, longest custom collection selection, explicit names, unknown names,
alias updates and a newly added longer collection. Existing host icon-consumer
tests use stubs and could not catch this dependency-level mutation; the new test
uses the actual resolver with only Nuxt config and generated bundle boundaries
supplied by the test environment.

## Production measurements

`catalog-project-scroll-probe.js` seeds 600 projects and 600 models in a fresh
disposable context for each CPU case. Each list receives three passes of ten
+600 px and ten -600 px wheel gestures, separated by 80 ms. Later passes revisit
the same range. No test runner, build or typecheck runs during these measurements.
External requests are blocked. The production browser profile is Chromium,
Blank/light, 90% zoom, 1200×689 at DPR 2. Project viewport: 552 px, 30 mounted
rows. Model viewport: 415 px, 15 mounted rows.

| At 4× slowdown, runs 1 / 2 / 3 | Before | After |
| --- | --- | --- |
| Project frame interval p95 (ms) | 66.3 / 65.0 / 66.6 | 43.4 / 42.9 / 42.6 |
| Project maximum frame interval (ms) | 92.5 / 68.0 / 75.2 | 56.3 / 50.8 / 51.2 |
| Project long tasks | 19 / 19 / 19 | 10 / 4 / 5 |
| Model frame interval p95 (ms) | 41.5 / 34.8 / 34.7 | 32.0 / 26.7 / 26.0 |
| Model maximum frame interval (ms) | 43.4 / 43.3 / 42.3 | 35.2 / 41.7 / 43.4 |
| Model long tasks | 0 / 0 / 0 | 0 / 0 / 0 |

Median project p95 improved about 35%; model p95 improved about 23%.
At normal CPU speed, both lists recorded zero long tasks before and after.
Project p95 was 9.9/16.5/16.6 ms before and 9.2/16.6/16.6 ms after; model p95
was approximately 16.5–16.6 ms in both builds. Frame cadence varied between
passes, so these normal-speed runs do not establish a meaningful p95 gain.

A second diagnostic profile recorded zero collection sorts after the patch.
Profiler/sort instrumentation affects timing and is not mixed into the production
table. Remaining profile cost includes Nuxt UI prop filtering and style/layout.

The final project's first 4× pass ended 3 px from the top as measured row heights
settled (baseline: 1 px); later passes and all model passes returned to zero.
Project/model tracks remained 26,846/42,348 px. These bounded gestures do not
traverse all 600 entries and do not prove full-list endpoint or perfect anchoring
behavior. The remaining project long tasks mean slow-device smoothness is not
yet qualified.

Raw baseline, profile summaries, sort counts and ablation results are in
`icon-resolution-baseline.json`. Final production measurements and diagnostic
profile summaries are in `icon-resolution-results.json`. The shared probe accepts
`{ cpuRate: 1 }` for a normal-speed control; its default remains 4×.

## Validation and integration

- Twelve focused tests pass across the installed resolver, icon registry,
  mounted theme consumers and AppIcon fallback behavior. The existing consumer
  test emits an unrelated missing-UKbd-stub warning.
- Eight production browser checks pass: virtual sidebar rows in three themes ×
  two modes, project card/pin click behavior, and project management including
  keyboard menu activation, focus restoration, saved drafts, rename and deletion.
- Production build, application typecheck, changed-file lint and diff checks pass.
- Reverse-applying the patch restored the original installed file, then the
  normal `bunx patch-package --error-on-fail` applied both dependency patches
  successfully. Existing install, Docker and generated-project paths already
  apply every checked-in patch. No version or public API changes were made.
- Larger workspaces, full endpoints, touch scrolling, multiple panes and remaining
  cold highlighting/animation work are still part of the active audit.

No external publication or deployment was performed for this section.
