# Requirements

## Introduction

Upgrade the `or3-chat` Nuxt, Vue, and Vite dependency family without regressing local-first behavior, SSR authentication, static generation, themes, PWA output, or the plugin runtime. The migration must be incremental, independently reversible, and evidence-driven rather than a single unrestricted dependency update.

## Context

`or3-chat` is a Bun-managed Nuxt 4 application with Vue 3, Nuxt UI, a custom Vite theme compiler, SSR and static production modes, linked provider modules, Vitest, and a plugin-runtime production validator. The clean baseline resolves Nuxt 4.2.2, Nuxt UI 3.3.7, Vue 3.5.40, Vue Router 4.6.4, VueUse 13.9.0, Vite 7.3.0, and `@vitejs/plugin-vue` 5.2.4. A frozen install, provider import check, theme validation, and SSR production build pass; 3,083 tests pass while two suites require untracked local fixtures, and the existing type-check error set is reproduced. Current stable registry targets on 2026-07-21 are Nuxt 4.5.0, Nuxt UI 4.10.0, Vue 3.5.40, Vue Router 5.2.0, VueUse 14.3.0, Vite 8.1.5, and `@vitejs/plugin-vue` 6.0.8.

## Assumptions

- The scope is the root `or3-chat` package, matching `planning/dependency-cleanup-checklist.md`; example packages, the plugin SDK package, and sibling provider packages change only if a root compatibility failure requires it.
- “All Nuxt, Vue, and Vite dependencies” includes the direct framework packages, Nuxt UI, Vue Router, VueUse, the Vue Vite plugin, and the Vite-based Vitest stack. Already-current packages are verified and retained rather than changed cosmetically.
- Stable releases are used; Nuxt 5, Vue 4, release candidates, and nightly channels are excluded.
- Nuxt 4.4.8 is an intentional intermediate checkpoint before Nuxt 4.5.0 so Vue Router 5 behavior can be separated from the Vite 8/Rolldown migration.
- The existing user-owned autocomplete work in the primary checkout is not part of this migration. Work occurs in the isolated `chore/nuxt-vue-vite-upgrades` worktree.
- Manual browser verification is required before merge, but lack of external provider credentials does not justify changing provider behavior or storing test credentials.

## Out of Scope

- Nuxt 5 or `future.compatibilityVersion: 5`.
- Vue 4, Pinia major upgrades, unrelated runtime dependencies, and database migrations.
- Redesigning the application or adopting new Nuxt 4.5 features such as experimental SSR streaming.
- Migrating from `tiptap-markdown` to `@tiptap/markdown`.
- Accepting existing type-check failures, snapshots, or visual differences as upgrade fixes without proving causality.

## Requirements

### R1: Reconcile completed cleanup work

**User Story:** As a maintainer, I want completed cleanup tasks accurately checked off, so that the checklist reflects repository evidence.

**Acceptance Criteria:**
- R1.AC1: WHEN a checklist item is supported by a merged commit or recorded validation result THEN the item SHALL be marked complete.
- R1.AC2: IF a task still requires manual UI, live-provider, or unavailable-fixture validation THEN the task SHALL remain unchecked and SHALL state the reason in implementation notes.

### R2: Maintain an explicit dependency inventory

**User Story:** As a maintainer, I want every direct Nuxt, Vue, and Vite package classified, so that no framework dependency is accidentally omitted or upgraded unnecessarily.

**Acceptance Criteria:**
- R2.AC1: WHEN implementation begins THEN the plan SHALL record the resolved current version, stable target version, migration batch, and compatibility owner for every in-scope direct dependency.
- R2.AC2: IF a package is already current THEN its version SHALL remain unchanged unless a peer constraint requires a different declaration.
- R2.AC3: WHEN lockfile installation completes THEN Vue, Vue Router, VueUse, Nuxt, and Vite runtime trees SHALL not contain avoidable incompatible duplicate majors.

### R3: Establish the Nuxt 4.4 and Vue Router 5 checkpoint

**User Story:** As a maintainer, I want routing changes isolated from bundler changes, so that navigation regressions have a narrow cause.

**Acceptance Criteria:**
- R3.AC1: WHEN the first framework batch is installed THEN Nuxt SHALL resolve to 4.4.8 and Vue Router SHALL resolve to 5.2.0 while Vite remains on 7.x.
- R3.AC2: WHEN the checkpoint is validated THEN route generation, auth/admin redirects, dynamic plugin routes, SSR build, and static generation SHALL behave no worse than baseline.
- R3.AC3: IF direct `unplugin-vue-router` usage is found THEN its imports SHALL be migrated according to the Vue Router 5 guide before the checkpoint is accepted.

### R4: Migrate Nuxt UI and VueUse

**User Story:** As a user, I want the interface to retain its behavior and themes after Nuxt UI 4 and VueUse 14, so that the framework refresh does not become a redesign.

**Acceptance Criteria:**
- R4.AC1: WHEN Nuxt UI 4 is installed THEN `tailwindcss` SHALL be declared directly and all removed or renamed Nuxt UI components and configuration keys SHALL be migrated.
- R4.AC2: WHEN `UButtonGroup` is removed THEN every use and every `buttonGroup` theme configuration SHALL be represented by the Nuxt UI 4 `FieldGroup` equivalent.
- R4.AC3: WHEN forms are reviewed THEN `nullify`, nested-form state, submit transformations, and form names SHALL conform to Nuxt UI 4 behavior.
- R4.AC4: WHEN VueUse 14 is installed THEN debouncing, persistent state, resize observers, keyboard handling, clipboard, drag/drop, and lifecycle cleanup SHALL retain their tested behavior.
- R4.AC5: WHEN UI migration validation runs THEN retro, blank, light, and dark theme outputs SHALL compile and high-use screens SHALL receive browser smoke coverage.

### R5: Migrate Nuxt to Vite 8

**User Story:** As a maintainer, I want Nuxt 4.5 and Vite 8 adopted together, so that Nuxt owns a supported Rolldown-based build stack.

**Acceptance Criteria:**
- R5.AC1: WHEN the build-tool batch is installed THEN Nuxt SHALL resolve to 4.5.0, Vite to 8.1.5, and `@vitejs/plugin-vue` to 6.0.8.
- R5.AC2: WHEN custom Vite configuration is migrated THEN deprecated `build.rollupOptions` usage SHALL be replaced with the supported Rolldown equivalent unless Nuxt documents a required compatibility exception.
- R5.AC3: WHEN the custom theme compiler is checked THEN `buildStart`, `configResolved`, and `handleHotUpdate` SHALL compile and run without relying on incompatible Rollup-only types.
- R5.AC4: WHEN production validation runs THEN both SSR and static output, PWA generation, manual chunking, provider boundaries, and plugin-runtime checks SHALL pass.

### R6: Preserve Vue runtime compatibility

**User Story:** As a maintainer, I want one compatible Vue runtime, so that linked modules do not fail through duplicate reactivity or component identities.

**Acceptance Criteria:**
- R6.AC1: WHEN dependency resolution completes THEN Vue SHALL remain on stable 3.5.40 unless a newer stable 3.5 patch is published and independently validated.
- R6.AC2: WHEN lockfile inspection runs THEN linked providers and root UI packages SHALL resolve the host Vue runtime where their peer ranges allow it.
- R6.AC3: IF an override is retained THEN the selected version SHALL satisfy every installed direct framework peer range.

### R7: Upgrade the Vite test stack separately

**User Story:** As a maintainer, I want Vitest migration isolated from application builds, so that test-runner failures are distinguishable from runtime regressions.

**Acceptance Criteria:**
- R7.AC1: WHEN Vitest is upgraded THEN `vitest` and `@vitest/coverage-v8` SHALL use the same 4.x version line.
- R7.AC2: WHEN tests run THEN configuration removals, mock-reset changes, coverage remapping, and snapshot changes SHALL be reviewed rather than accepted wholesale.
- R7.AC3: IF the application framework batches are not green THEN the Vitest batch SHALL not begin.

### R8: Enforce staged validation and rollback

**User Story:** As a maintainer, I want every batch gated and reversible, so that a regression cannot be hidden inside a large framework commit.

**Acceptance Criteria:**
- R8.AC1: WHEN a batch changes dependencies THEN it SHALL have its own commit after focused validation.
- R8.AC2: IF a validation result is worse than baseline THEN the batch SHALL not be merged forward until the cause is fixed or the batch is explicitly deferred.
- R8.AC3: WHEN final validation completes THEN frozen install, import checks, theme validation, unit tests, type-check comparison, SSR build, static generation, PWA output, and plugin-runtime checks SHALL be recorded.
- R8.AC4: WHEN browser validation occurs THEN no real user document, prompt, conversation, credential, or provider data SHALL be modified for testing.

### R9: Preserve unrelated work

**User Story:** As a contributor, I want my in-progress editor changes preserved, so that the dependency migration cannot overwrite or commit them.

**Acceptance Criteria:**
- R9.AC1: WHILE the migration is implemented THEN the primary checkout’s existing modified and untracked editor files SHALL remain unchanged.
- R9.AC2: WHEN commits are created THEN they SHALL contain only checklist, planning, dependency, compatibility, migration, and validation changes belonging to this upgrade.
