# OR3 Wizard UX Improvements — Tasks

## 1. Add wizard mode model and template branching
Requirements: 1.1, 1.2, 1.3, 1.4, 6.1, 8.1

- [x] 1.1 Add `WizardMode` type and `wizardMode` field to `WizardAnswers` in `shared/cloud/wizard/types.ts`.
- [x] 1.2 Set sensible default for `wizardMode` in `createDefaultAnswers()` in `shared/cloud/wizard/catalog.ts`.
- [x] 1.3 Update template step options in `shared/cloud/wizard/steps.ts` to include:
  - [x] `preset-local`
  - [x] `preset-clerk-convex`
  - [x] `custom`
- [x] 1.4 Ensure template selection updates provider defaults and mode coherently (preset fast path vs custom).
- [x] 1.5 Update template UX copy to explicitly state which paths skip manual provider selection.

## 2. Add advanced-settings model and defaults
Requirements: 8.1, 8.2, 8.3, 8.6, 7.3

- [x] 2.1 Add advanced toggle fields to `WizardAnswers` in `shared/cloud/wizard/types.ts`:
  - [x] `allAdvancedEnabled`
  - [x] `baseAdvancedEnabled`
  - [x] `authAdvancedEnabled`
  - [x] `syncAdvancedEnabled`
  - [x] `storageAdvancedEnabled`
  - [x] `cloudAdvancedEnabled`
- [x] 2.2 Set sensible defaults for advanced toggles in `createDefaultAnswers()`.
- [x] 2.3 Ensure legacy sessions without advanced toggles normalize safely.

## 3. Implement field-level visibility
Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 8.3

- [x] 3.1 Extend `WizardField` with `visibleWhen` predicate in `shared/cloud/wizard/types.ts`.
- [x] 3.2 Add visibility predicates in `shared/cloud/wizard/steps.ts` for:
  - [x] limits numeric fields and limits backend field (`limitsEnabled === true`)
  - [x] `themesToInstall` (`themeInstallMode === 'install-selected'`)
  - [x] `forwardedForHeader` (`trustProxy === true`)
- [x] section advanced fields gated by matching advanced toggle
- [x] 3.3 Ensure provider detail fields are hidden/skipped when provider/feature is disabled.

## 4. Add section-level advanced prompts
Requirements: 8.1, 8.2, 8.3, 8.6

- [x] 4.1 Add a dedicated advanced-gates step in `shared/cloud/wizard/steps.ts`.
- [x] 4.2 Implement global expert mode (`allAdvancedEnabled`) behavior.
- [x] 4.3 Implement per-section advanced prompt behavior when global expert mode is off.
- [x] 4.4 Ensure skip-advanced path applies documented defaults.

## 5. Make provider step conditional by mode
Requirements: 1.1, 1.2, 1.3, 2.4

- [x] 5.1 Update step generation in `shared/cloud/wizard/steps.ts` so `providers` step is only visible for `wizardMode='custom'`.
- [x] 5.2 Preserve provider detail steps for preset modes when required values are missing.
- [x] 5.3 Validate no duplicate/conflicting step insertion with dynamic graph recomputation.

## 6. Refactor CLI prompt loop to use visible fields/steps
Requirements: 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 6.2, 8.1, 8.3

- [x] 6.1 Add helper functions in `scripts/cli/or3-cloud.ts` for visible step/field filtering.
- [x] 6.2 Iterate only visible fields in each step prompt loop.
- [x] 6.3 Update `/next` behavior to jump to next visible field/step.
- [x] 6.4 Update `/back` behavior to jump to previous visible field/step.
- [x] 6.5 Auto-skip steps with zero visible fields.
- [x] 6.6 Update progress rendering to dynamic counts:
  - [x] `Step X of Y` from visible steps
  - [x] `Question A of B` from visible fields

## 7. Align validation with conditional UX
Requirements: 5.1, 5.2, 5.3, 7.2, 8.5

- [x] 7.1 Gate limits numeric validation behind `limitsEnabled` in `shared/cloud/wizard/validation.ts`.
- [x] 7.2 Verify provider-specific validation remains gated by provider enablement/selection.
- [x] 7.3 Confirm no hidden-field validation failures in common preset and custom paths.
- [x] 7.4 Ensure skipped advanced fields validate via effective defaults, not required input.

## 8. Session normalization and compatibility
Requirements: 7.3

- [x] 8.1 Ensure `normalizeAnswers()` in `scripts/cli/or3-cloud.ts` handles sessions without `wizardMode` and advanced toggles.
- [x] 8.2 Add fallback inference from existing `presetName` for old sessions.
- [x] 8.3 Ensure API operations (`createSession`, `submitAnswers`, `getSession`) remain backward compatible.

## 9. Update unit tests
Requirements: 6.3, 7.1, 7.2, 7.3, 8.4, 8.5, 8.6

- [x] 9.1 Update/add tests in `tests/unit/or3-cloud-wizard.test.ts` for template branching:
  - [x] preset-local skips manual provider step
  - [x] preset-clerk-convex skips manual provider step
  - [x] custom includes manual provider step
- [x] 9.2 Add visibility tests for limits/theme/proxy conditional fields.
- [x] 9.3 Add validation tests for limits disabled vs enabled behavior.
- [x] 9.4 Add tests for advanced gate behavior per section and global expert mode.
- [x] 9.5 Add tests that review output includes effective defaults when advanced is skipped.

## 10. Update integration tests
Requirements: 3.1, 3.2, 4.1, 4.2, 4.3, 6.3, 8.1, 8.2, 8.3

- [x] 10.1 Extend `tests/integration/or3-cloud-wizard-dry-run.test.ts` to cover all three template modes.
- [x] 10.2 Add assertions for visible-step progression and expected answers for each mode.
- [x] 10.3 Add navigation edge-case coverage for `/back` and `/next` with hidden fields.
- [x] 10.4 Add scenarios for skipping and enabling advanced settings per section.

## 11. Docs and QA pass
Requirements: 6.1, 6.2, 7.1, 8.1, 8.2, 8.4

- [x] 11.1 Update wizard text/help to match true behavior in `shared/cloud/wizard/steps.ts`.
- [x] 11.2 Document which fields are “advanced” per section and their defaults.
- [x] 11.3 Validate docs references if wizard flow wording appears in user-facing documentation.
- [x] 11.4 Run verification:
  - [x] `bunx vitest`
  - [x] `bunx nuxi typecheck`
  - [x] manual `bun run or3-cloud:init` smoke for modes 1/2/3 + advanced on/off paths
