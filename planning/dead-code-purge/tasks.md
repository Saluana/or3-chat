# tasks.md

artifact_id: a28c7ab7-0d3c-43b8-8d8f-7cb82ac3383a

## 1. Preparation & Baseline

-   [ ] 1.1 Create feature branch `refactor/dead-code-purge` (Req 9,10).
-   [ ] 1.2 Capture current LOC metrics: `git ls-files | xargs wc -l > baseline-loc.txt` (Req 10).
-   [ ] 1.3 Run full test suite & note pass status (Req 9).
-   [ ] 1.4 Optional: capture bundle analyze baseline (`nuxt build --analyze`) (Req 10).

## 2. Inventory (Static Grep Pass)

-   [ ] 2.1 Grep `{…}` Unicode occurrences (Req 1).
-   [ ] 2.2 Grep `{...}` literal three-dot fallbacks (Req 1).
-   [ ] 2.3 Grep `console.debug(` & `console.log(` (Req 2).
-   [ ] 2.4 Grep suspicious selector fragments (e.g., `message-body )`) (Req 6).
-   [ ] 2.5 Grep `watch(() =>` patterns for candidate watchers (Req 3).
-   [ ] 2.6 Document findings in scratch pad (not committed) mapping each to planned action (Req 1–7).

## 3. Placeholder & Dead Branch Removal

-   [ ] 3.1 Remove / replace each `{…}` block with minimal logic or delete (Req 1).
-   [ ] 3.2 Delete branches with constant false conditions (Req 7).
-   [ ] 3.3 Remove obsolete feature flag references (Req 7).
-   [ ] 3.4 Ensure no orphan variables after deletions (lint) (Req 3,7).

## 4. Debug Log Hardening

-   [ ] 4.1 Wrap necessary logs in `if (import.meta.dev)` (Req 2).
-   [ ] 4.2 Delete non-essential info/debug logs (Req 2).
-   [ ] 4.3 Retain or refine warnings/errors conveying actionable issues (Req 2).

## 5. Watcher Consolidation

-   [ ] 5.1 Remove watchers with empty/comment-only bodies (Req 3).
-   [ ] 5.2 Merge trivially combinable watchers acting on the same sources (Req 3).
-   [ ] 5.3 Re-run tests ensuring no side effects lost (Req 3,9).

## 6. Computed Property Fixes

-   [ ] 6.1 Identify incomplete computed returns (Req 4).
-   [ ] 6.2 Implement explicit desktop/alternate branch strings (Req 4).
-   [ ] 6.3 Confirm no runtime undefined class bindings (manual check / console) (Req 4,9).

## 7. Template Simplification

-   [ ] 7.1 Remove empty structural `<div>` wrappers (Req 5).
-   [ ] 7.2 Validate no layout regressions (manual visual check) (Req 5,9).
-   [ ] 7.3 Ensure accessibility roles not inadvertently removed (Req 5).

## 8. CSS Selector Cleanup

-   [ ] 8.1 Enumerate candidate orphan selectors from inventory (Req 6).
-   [ ] 8.2 Grep usage for each; if zero, delete (Req 6).
-   [ ] 8.3 Rebuild to ensure no missing class references (Req 6,9).

## 9. ESLint Restriction Rule

-   [ ] 9.1 Add rule disallowing `{…}` placeholders (Req 8).
-   [ ] 9.2 Run lint; resolve any residual violations (Req 8).
-   [ ] 9.3 Document in design file that rule is temporary (Req 8).

## 10. Validation & Metrics

-   [ ] 10.1 Run all tests (Req 9).
-   [ ] 10.2 Perform smoke test scenarios (send, stream, attachments, auth) (Req 9).
-   [ ] 10.3 Record post-purge LOC & compute net delta (Req 10).
-   [ ] 10.4 (Optional) Bundle analyze diff (Req 10).
-   [ ] 10.5 Grep re-run confirms zero placeholder & unguarded debug patterns (Req 1,2).

## 11. Documentation & Commit

-   [ ] 11.1 Update planning docs if scope variance occurred (Req 10).
-   [ ] 11.2 Draft commit message summarizing changes & LOC delta (Req 10).
-   [ ] 11.3 Merge via PR with checklist evidence (Req 9,10).

## 12. Post-Merge Follow-Up

-   [ ] 12.1 Monitor error logs for 24h (if prod telemetry) (Req 9).
-   [ ] 12.2 Create ticket to remove temporary ESLint rule after stabilization (Req 8).

## Requirement Mapping Summary

| Task Section | Requirements Covered |
| ------------ | -------------------- |
| 1            | 9,10                 |
| 2            | 1,2,3,6,7            |
| 3            | 1,7                  |
| 4            | 2                    |
| 5            | 3                    |
| 6            | 4                    |
| 7            | 5                    |
| 8            | 6                    |
| 9            | 8                    |
| 10           | 1,2,9,10             |
| 11           | 10                   |
| 12           | 8,9                  |

## Notes

Perform purge after major refactors to minimize merge conflicts. Keep commits focused; avoid mixing unrelated refactors.
