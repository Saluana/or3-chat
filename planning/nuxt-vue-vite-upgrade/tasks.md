# Tasks

## 1. Reconcile evidence and lock the baseline

- [x] 1.1 Mark only evidence-backed items complete in `planning/dependency-cleanup-checklist.md`; leave manual/live-provider checks open. (R1)
- [x] 1.2 Record current and target versions for every direct Nuxt, Vue, and Vite dependency. (R2, R6)
- [x] 1.3 Run the frozen install, import check, theme validation, available tests, type-check comparison, SSR build, and static generation. (R8)
- [ ] 1.4 Commit planning and checklist reconciliation without user-owned editor files. (R8, R9)

**Done when:** The plan, checklist, clean baseline, known failures, and dependency inventory are reviewable in one documentation commit.

## 2. Establish the Nuxt 4.4 and Router 5 checkpoint

- [ ] 2.1 Set Nuxt to 4.4.8 and Vue Router to 5.2.0; keep Vite on 7.x. (R3)
- [ ] 2.2 Install with Bun and inspect the resolved Nuxt/Vue/Router/Vite tree for incompatible duplicate majors. (R2, R3, R6)
- [ ] 2.3 Run focused route-generation, notification-navigation, plugin-route, admin-guard, and auth-redirect tests. (R3)
- [ ] 2.4 Run import, theme, type-check comparison, available unit, SSR build, and static-generation gates. (R3, R8)
- [ ] 2.5 Commit the green router checkpoint independently. (R8)

**Done when:** Nuxt resolves to 4.4.8, Router to 5.2.0, Vite remains 7.x, and results are no worse than baseline.

## 3. Migrate Nuxt UI 4 and VueUse 14

- [ ] 3.1 Set Nuxt UI to 4.10.0, VueUse to 14.3.0, and add direct Tailwind CSS 4.3.2. (R4)
- [ ] 3.2 Replace all `UButtonGroup` uses with `UFieldGroup` and all `buttonGroup` theme keys with `fieldGroup`. (R4)
- [ ] 3.3 Audit every `UForm` for nullable state, nesting, names, transforms, and error behavior. (R4)
- [ ] 3.4 Run focused tests for debounce/autosave, persistence, observers, keyboard, clipboard, drag/drop, cleanup, forms, and theme generation. (R4)
- [ ] 3.5 Run available unit, type-check comparison, SSR/static/PWA, and plugin-runtime gates. (R4, R8)
- [ ] 3.6 Browser-smoke high-use screens and all supported themes without modifying real user data. (R4, R8)
- [ ] 3.7 Commit the green UI checkpoint independently. (R8)

**Done when:** Removed Nuxt UI APIs are absent, VueUse behavior is covered, themes compile, and automated plus browser gates are green.

## 4. Migrate Nuxt 4.5 and Vite 8

- [ ] 4.1 Set Nuxt to 4.5.0, Vite to 8.1.5, and `@vitejs/plugin-vue` to 6.0.8. (R5)
- [ ] 4.2 Replace deprecated Rollup-facing manual chunk configuration with supported Rolldown code splitting. (R5)
- [ ] 4.3 Compile and exercise the custom theme compiler hooks with Vite 8-compatible public types. (R5)
- [ ] 4.4 Inspect resolved Vue/Vite trees and all peer warnings. (R2, R5, R6)
- [ ] 4.5 Run dev-server smoke, available unit, type-check comparison, SSR/static/PWA, and plugin-runtime gates. (R5, R8)
- [ ] 4.6 Commit the green Rolldown checkpoint independently. (R8)

**Done when:** Nuxt 4.5 and Vite 8 build both deployment modes, custom Vite integrations run, and no new peer or runtime regression exists.

## 5. Upgrade the Vitest stack

- [ ] 5.1 Confirm all application framework checkpoints are green before changing test tooling. (R7)
- [ ] 5.2 Set `vitest` and `@vitest/coverage-v8` to the same 4.1.10 version. (R7)
- [ ] 5.3 Migrate only documented configuration, mock, coverage, or snapshot incompatibilities. (R7)
- [ ] 5.4 Run focused configuration tests, the available full suite, and coverage. (R7, R8)
- [ ] 5.5 Re-run SSR/static/PWA and plugin-runtime gates to catch test-config dependency-tree effects. (R8)
- [ ] 5.6 Commit the green test-stack checkpoint independently. (R8)

**Done when:** Runner and provider match, available tests and coverage pass, and no snapshots were accepted without review.

## 6. Final verification and handoff

- [ ] 6.1 Run a fresh frozen install and inspect direct and transitive framework versions. (R2, R6, R8)
- [ ] 6.2 Run the complete validation ledger and compare every result with baseline. (R8)
- [ ] 6.3 Verify the primary checkout's pre-existing editor changes are untouched. (R9)
- [ ] 6.4 Check off completed upgrade tasks and leave manual, unavailable-fixture, or credentialed checks explicitly open. (R1)
- [ ] 6.5 Review commit scopes and merge only after the branch is green. (R8, R9)

**Done when:** The branch is reproducible from a frozen install, all available gates are green or identical to baseline, open manual checks are explicit, and unrelated work is intact.

## Traceability Matrix

| Requirement | Tasks |
|---|---|
| R1 | 1.1, 6.4 |
| R2 | 1.2, 2.2, 4.4, 6.1 |
| R3 | 2.1–2.5 |
| R4 | 3.1–3.7 |
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
