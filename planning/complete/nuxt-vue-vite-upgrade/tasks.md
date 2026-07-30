# Tasks

## 1. Reconcile evidence and lock the baseline

- [x] 1.1 Mark only evidence-backed items complete in `planning/dependency-cleanup-checklist.md`; leave manual/live-provider checks open. (R1)
- [x] 1.2 Record current and target versions for every direct Nuxt, Vue, and Vite dependency. (R2, R6)
- [x] 1.3 Run the frozen install, import check, theme validation, available tests, type-check comparison, SSR build, and static generation. (R8)
- [x] 1.4 Commit planning and checklist reconciliation without user-owned editor files. (R8, R9)

**Done when:** The plan, checklist, clean baseline, known failures, and dependency inventory are reviewable in one documentation commit.

## 2. Install the peer-compatible framework checkpoint

- [x] 2.1 Set Nuxt to 4.4.8, Vue Router to 5.2.0, Nuxt UI to 4.10.0, VueUse to 14.3.0, and direct Tailwind CSS to 4.3.3; keep Vite on 7.x. (R3, R4)
- [x] 2.2 Install with Bun and inspect the resolved Nuxt/Vue/Router/UI/VueUse/Vite tree for incompatible duplicate majors or peers. (R2, R3, R4, R6)
- [x] 2.3 Run focused route-generation, notification-navigation, plugin-route, admin-guard, and auth-redirect tests. (R3)
- [x] 2.4 Run import, theme, type-check comparison, available unit, SSR build, and static-generation gates. (R3, R8)
- [x] 2.5 Do not accept or commit the checkpoint until the Nuxt UI migration in task 3 is green. (R4, R8)

**Done when:** The framework tree is peer-compatible, Vite remains 7.x, route checks pass, and the checkpoint is ready for the UI source migration.

## 3. Migrate Nuxt UI 4 and VueUse 14

- [x] 3.1 Confirm the versions installed in task 2 match the framework inventory. (R4)
- [x] 3.2 Replace all `UButtonGroup` uses with `UFieldGroup` and all `buttonGroup` theme keys with `fieldGroup`. (R4)
- [x] 3.3 Audit every `UForm` for nullable state, nesting, names, transforms, and error behavior. (R4)
- [x] 3.4 Run focused tests for debounce/autosave, persistence, observers, keyboard, clipboard, drag/drop, cleanup, forms, and theme generation. (R4)
- [x] 3.5 Run available unit, type-check comparison, SSR/static/PWA, and plugin-runtime gates. (R4, R8)
- [x] 3.6 Browser-smoke high-use screens and all supported themes without modifying real user data. (R4, R8)
- [x] 3.7 Commit the green framework/UI checkpoint independently. (R8)

**Done when:** Removed Nuxt UI APIs are absent, VueUse behavior is covered, themes compile, route checks remain green, and automated plus browser gates are green.

### Framework checkpoint evidence

- Resolved root versions: Nuxt 4.4.8, Nuxt UI 4.10.0, Vue 3.5.40, Vue Router 5.2.0, VueUse 14.3.0, Tailwind CSS 4.3.3, and Vite 7.x.
- Peer inspection confirmed the host framework graph is compatible. Older VueUse releases remain only where Vue Flow and `vaul-vue` require their own transitive lines.
- Focused routing, notification, auth-guard, image, clipboard, resize, and UI tests passed.
- Available suite: 441 files and 3,083 tests passed; 56 tests are intentionally skipped. Two unavailable untracked-fixture suites remain excluded exactly as at baseline.
- Type-check contains the recorded baseline diagnostics only after adapting a nullable admin `UInput` to Nuxt UI 4's model type.
- Import boundaries, three theme compiles, SSR build, static/PWA build, and both plugin-runtime production validators passed.
- Computer Use smoke verified welcome modal rendering, home/chat layout, light/dark switching, Blank/Cyberpunk/Retro theme selection, workflow tabs, and the create-workflow modal on a disposable localhost origin without creating data.

## 4. Migrate Nuxt 4.5 and Vite 8

- [x] 4.1 Set Nuxt to 4.5.0, Vite to 8.1.5, and `@vitejs/plugin-vue` to 6.0.8. (R5)
- [x] 4.2 Replace deprecated Rollup-facing manual chunk configuration with supported Rolldown code splitting. (R5)
- [x] 4.3 Compile and exercise the custom theme compiler hooks with Vite 8-compatible public types. (R5)
- [x] 4.4 Inspect resolved Vue/Vite trees and all peer warnings. (R2, R5, R6)
- [x] 4.5 Run dev-server smoke, available unit, type-check comparison, SSR/static/PWA, and plugin-runtime gates. (R5, R8)
- [x] 4.6 Commit the green Rolldown checkpoint independently. (R8)

**Done when:** Nuxt 4.5 and Vite 8 build both deployment modes, custom Vite integrations run, and no new peer or runtime regression exists.

### Rolldown checkpoint evidence

- Resolved host versions: Nuxt 4.5.0, Vite 8.1.5, `@vitejs/plugin-vue` 6.0.8, Vue 3.5.40, and Vue Router 5.2.0.
- The tokenizer chunk rule now uses `build.rolldownOptions.output.codeSplitting.groups`; the theme compiler uses a narrow structural context instead of Rollup's `PluginContext`.
- `vite-plugin-pwa` is overridden to 1.3.0 because it is the first stable release declaring Vite 8 support. A frozen install resolves only that version, and static generation reports PWA 1.3.0.
- Available suite remained identical to baseline: 441 files and 3,083 tests passed; 56 tests are intentionally skipped. The same two unavailable local-fixture suites remain excluded.
- Type-check reproduced the recorded baseline diagnostics without a new Vite configuration or theme-plugin type failure.
- Import boundaries, three theme compiles, SSR build, static/PWA build, and both plugin-runtime production validators passed.
- Computer Use verified the welcome flow, home/chat shell, and light/dark interaction. A harmless theme-file touch exercised the Vite 8 HMR hook, regenerated theme CSS, issued a full reload, and left the UI rendered.
- Vite 8's stricter CSS minifier now reports pre-existing `:deep(...)` selectors in the global `or3-prose.css`; this is recorded as a separate styling cleanup rather than mixed into the framework upgrade.
- Checkpoint commit: `d083c1a8` (`[Update] Upgrade Nuxt and Vite build stack`).

## 5. Upgrade the Vitest stack

- [x] 5.1 Confirm all application framework checkpoints are green before changing test tooling. (R7)
- [x] 5.2 Set `vitest` and `@vitest/coverage-v8` to the same 4.1.10 version. (R7)
- [x] 5.3 Migrate only documented configuration, mock, coverage, or snapshot incompatibilities. (R7)
- [x] 5.4 Run focused configuration tests, the available full suite, and coverage. (R7, R8)
- [x] 5.5 Re-run SSR/static/PWA and plugin-runtime gates to catch test-config dependency-tree effects. (R8)
- [x] 5.6 Commit the green test-stack checkpoint independently. (R8)

**Done when:** Runner and provider match, available tests and coverage pass, and no snapshots were accepted without review.

### Test-stack checkpoint evidence

- Resolved root versions: Vitest 4.1.10 and `@vitest/coverage-v8` 4.1.10, both using the host Vite 8.1.5 line. Linked provider packages retain their package-owned development trees and do not alter the host runner.
- Vitest 4 constructor and module-mock lifecycle changes were handled only in affected tests; no snapshots were updated or accepted.
- The coverage include typo was corrected to the real stream accumulator source. Focused tests cover the fallback scheduler and cancellation paths instead of lowering the existing thresholds.
- Available suite with coverage: 441 files and 3,087 tests passed; 56 tests are intentionally skipped. The same two unavailable untracked-fixture suites remain excluded.
- Coverage passes at 98.83% statements, 97.43% branches, 100% functions, and 100% lines.
- Type-check returned to the recorded baseline diagnostic set after narrowing one Vitest 4 mock type; no new runner or configuration errors remain.
- Import boundaries, three theme compiles, SSR build, static/PWA build, and both plugin-runtime production validators passed.
- Checkpoint commit: `0e8fc664` (`[Update] Upgrade Vitest test stack`).

## 6. Final verification and handoff

- [x] 6.1 Run a fresh frozen install and inspect direct and transitive framework versions. (R2, R6, R8)
- [x] 6.2 Run the complete validation ledger and compare every result with baseline. (R8)
- [x] 6.3 Verify the primary checkout's pre-existing editor changes are untouched. (R9)
- [x] 6.4 Check off completed upgrade tasks and leave manual, unavailable-fixture, or credentialed checks explicitly open. (R1)
- [x] 6.5 Review commit scopes and merge only after the branch is green. (R8, R9)

**Done when:** The branch is reproducible from a frozen install, all available gates are green or identical to baseline, open manual checks are explicit, and unrelated work is intact.

## Traceability Matrix

| Requirement | Tasks |
|---|---|
| R1 | 1.1, 6.4 |
| R2 | 1.2, 2.2, 4.4, 6.1 |
| R3 | 2.1–2.5, 3.7 |
| R4 | 2.1–2.2, 2.5, 3.1–3.7 |
| R5 | 4.1–4.6 |
| R6 | 1.2, 2.2, 4.4, 6.1 |
| R7 | 5.1–5.6 |
| R8 | 1.3–1.4, 2.4–2.5, 3.5–3.7, 4.5–4.6, 5.4–5.6, 6.1–6.5 |
| R9 | 1.4, 6.3, 6.5 |

## Definition of Done

- Every in-scope direct dependency is at its stable target or explicitly verified as already current.
- Every checkpoint has a narrow commit and results no worse than the baseline.
- Nuxt UI, VueUse, Vue Router, Vite/Rolldown, and Vitest migration surfaces have focused coverage.
- Frozen install, import boundaries, themes, available tests, type-check comparison, SSR, static, PWA, and plugin-runtime validation are recorded.
- Manual/live-provider checks remain visible until genuinely performed.
- The primary checkout's unrelated files are unchanged and absent from all commits.
