# PRs 304–308 audit

Reviewed on 2026-10-24 (America/Los_Angeles). The user authorized merging the
five PRs after review, with appearance preserved. This is the audit checkpoint;
GitHub's PR records are the authority for subsequent merge and CI status.

## Scope and conclusion

| PR | Reviewed behavior | Conclusion |
| --- | --- | --- |
| [304](https://github.com/Saluana/or3-chat/pull/304) | Image placeholders in live and persisted streams; continuation ownership; trailing thumbnail hydration; tool-card snapshots, workspace retirement and notification disposal; native wheel handling and scroller patch ownership | No new blocking defect found. Existing wheel-latency qualification limits remain. |
| [305](https://github.com/Saluana/or3-chat/pull/305) | Bounded initial Dexie reads, cancellation, legacy ordering, superseded messages, workflow output and reference-branch anchors | No new blocking defect found. Paging improves responsiveness without bounding total index memory. |
| [306](https://github.com/Saluana/or3-chat/pull/306) | Theme chunk grouping and activation order; measurement tooling and receipts | One confirmed CI blocker repaired before merge. |
| [307](https://github.com/Saluana/or3-chat/pull/307) | SSR light/dark artwork, responsive fallback and preload behavior; lazy palette/mention initialization; project operation and sync registry extraction | No new blocking defect found. Existing workspace guards and original artwork remain in place. |
| [308](https://github.com/Saluana/or3-chat/pull/308) | HTML gzip negotiation, cookies/cache headers, fallback cases and stylesheet URL normalization/reuse | No new blocking defect found. Compression outside the qualified Node preview remains an evaluation item. |

The review compared the PRs against their dependency branches and inspected
changed runtime code, callers, public contracts, focused regression coverage,
CI, and existing browser/build evidence. No redesign, storage deletion,
workspace schema change, credential change, or provider migration was added.

## Finding and repair

**PR #306 — measurement script failed the required lint gate.** The script
`chrome-mobile/summarize.ts` assigned untyped `JSON.parse` values to measured
fields. GitHub reported unsafe assignments, and lint over the complete stack
reproduced eleven errors in that one file. Later PRs' narrower changed-file
checks did not cover it.

Commit `840ea448ce84015853bab5116610f5ef488ab8a4` adds explicit receipt shapes,
keeps opaque receipt values `unknown`, and reports missing paint/call samples
clearly. The targeted lint command passes. Running the actual summary generator
reproduces the committed `chrome-mobile/summary.json` byte for byte. No measured
result or application behavior changed.

## Validation performed during this audit

- **337 tests in 40 suites passed**, covering foreground/continuation streams,
  message transactions and card lifecycle, command-palette search, subscription
  ownership, workspace DB cleanup, theme loading, mentions, thumbnails and HTTP
  compression. These are focused core-app/core-node suites, not a new full-suite run.
- Complete-stack changed-source lint reproduced only the #306 script issue;
  that file then passed lint after repair. Existing code and tests were not
  changed to silence failures.
- Regenerated the Chrome summary and verified an empty diff for its JSON output;
  checked the repair diff for whitespace errors.
- Inspected all five PRs' current CI and review threads. At the audit checkpoint,
  #304, #305, #307 and #308 had passing Core and Contracts checks; #306's repaired
  head was submitted for fresh CI. No unresolved review threads were returned.
- Checked changed audit receipts for common OpenRouter/GitHub token and private-key
  patterns without printing values; no matches were found. This is a bounded
  credential-pattern check, not an exhaustive secrets certification.
- Existing production builds, typechecks, Chrome visual/interaction journeys and
  performance receipts retain their original scope. No new paid AI calls or
  browser performance measurements were needed for this audit-only repair.

Merge order is #304 → #305 → #306 → #307 → #308, retargeting each dependent PR
to `or3-cloud` after its predecessor lands. Use merge commits to preserve stack
ancestry and the expected head SHA to reject a merge if reviewed code changes.
The repository's normal post-merge development-image workflow remains separate
from this source review; it is not proof of deployment or a stable release.

## What still needs evaluation

- Cold composer readiness remains about **5.99 s** in the recorded heavily
  throttled Chrome profile. Full JavaScript/precache budgets still fail; their
  limits were not relaxed. See [composer startup](COMPOSER-STARTUP.md).
- Large-workspace initial index memory, sustained session growth, legacy sidebar
  family scans, quota pressure and Cloud cold-history caching remain open.
  The pre-existing 408 px versus 390 px mobile search-width assertion is also
  unresolved. See [workspace scale](WORKSPACE-SCALE.md).
- Physical mobile/Safari behavior, private storage, PWA update/offline lifecycle,
  deployed compression/proxy combinations and authenticated provider paths need
  broader qualification. See [cold startup](COLD-STARTUP.md).
- Continuous physical wheel input under main-thread pressure, long rich streams,
  portable-frame containment/teardown, paid failure recovery and background/provider
  combinations remain open. See [stability status](../performance-20261023/STABILITY-STATUS.md)
  and [Chrome/real-AI evaluation](CHROME-MOBILE.md).

These limits are not newly discovered merge blockers, and this audit does not
claim every browser, provider, workload or performance target is qualified.
