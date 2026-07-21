# Dependency Cleanup and Upgrade Checklist

**Scope:** `or3-chat` root package only  
**Status:** Phases 1–4 implemented; phases 5 and later remain planning only
**Prepared:** 2026-07-21

Implementation notes for phases 1–4:

- Each phase was developed on a separate branch created from the latest local `or3-cloud` state and merged only after its validation gates passed.
- The full unit suite passes with 3,086 tests; frozen installs, provider-boundary checks, theme validation, SSR builds, static generation, and plugin-runtime production checks pass.
- The repository's pre-existing type-check and lint failures remain unchanged in scope. Two timing-sensitive scroll E2E assertions also reproduce on the exact pre-Phase-3 code, dependency set, and Chromium revision.
- Manual UI checks and live-provider exercises remain unchecked below because they require an interactive environment or external provider state.
- Phase 4 upgrades the complete Tiptap family from lock-resolved 3.15.1 to 3.28.0 and `tiptap-markdown` from 0.8.10 to 0.9.0. ProseMirror packages are explicitly deduplicated because multiple runtime copies have incompatible private types and can break editor plugins.
- Phase 4 adds Markdown regression fixtures for headings, marks, links, lists, code blocks, unsupported inline HTML, empty content, Tiptap 3 command options, undo, and redo. The fixtures produce identical serialized Markdown before and after the 0.9 upgrade.

This checklist is ordered so each phase can be implemented, tested, reviewed, and committed independently. Do not run an unrestricted `bun update`; keep the batches small enough that regressions can be attributed to one change.

## 0. Establish a baseline

- [ ] Create a dedicated dependency-cleanup branch.
- [ ] Confirm the worktree is clean or record unrelated changes.
- [ ] Save the current `bun outdated` output.
- [ ] Run `bun install --frozen-lockfile`.
- [ ] Run `bun run type-check`.
- [ ] Run `bun run test`.
- [ ] Run `bun run check-imports`.
- [ ] Run `bun run theme:validate`.
- [ ] Run `bun run build`.
- [ ] Run `bun run generate:static`.
- [ ] Record existing failures so they are not attributed to upgrades.

### Tips

- Keep cleanup, routine updates, UI migrations, build tooling, and test tooling in separate commits.
- Preserve both SSR and static builds; success in only one mode is insufficient.
- For database upgrades, use disposable test databases and keep a real workspace backup available.

## 1. Remove unused direct dependencies

### `turndown`

- [ ] Re-run `rg -n "turndown" .` while excluding `node_modules` and the lockfile.
- [ ] Remove `turndown`.
- [ ] Run type-check and document/editor tests.
- [ ] Confirm the lockfile no longer contains it unless another dependency introduces it transitively.

**Tip:** Search dynamic imports and scripts as well as static imports before removal.

### `@vitest/ui`

- [ ] Confirm nobody relies on manually running `vitest --ui`.
- [ ] Remove `@vitest/ui`.
- [ ] Run the normal test and watch scripts.
- [ ] Confirm Vitest does not report a missing optional UI package.

**Tip:** If the UI is useful, add an explicit `test:ui` script and keep it. Otherwise, its current presence is undocumented.

### `@eslint/js`

- [ ] Confirm `eslint.config.mjs` does not import `@eslint/js`.
- [ ] Remove the direct dependency.
- [ ] Run `bun run eslint .`.
- [ ] Expect it may remain transitively through ESLint.

**Tip:** The objective is removing the unnecessary direct declaration, not forcing every transitive copy out of `node_modules`.

### `typescript-eslint`

- [ ] Keep `@typescript-eslint/parser`.
- [ ] Keep `@typescript-eslint/eslint-plugin`.
- [ ] Remove the aggregate `typescript-eslint` package.
- [ ] Run the full lint command.

**Tip:** Update the parser and plugin together to avoid AST/type-service mismatches.

### `minimatch`

- [ ] Confirm there are no direct imports or CLI usages.
- [ ] Remove the direct dependency.
- [ ] Run lint, build, and PWA generation.
- [ ] Expect transitive versions to remain.

**Tip:** Do not add replacement glob code; Nuxt, ESLint, and PWA tooling manage their own transitive copies.

### Tiptap placeholder dependency

- [ ] Add `@tiptap/extensions` as an explicit runtime dependency.
- [ ] Remove `@tiptap/extension-placeholder`.
- [ ] Prefer the explicit subpath import `@tiptap/extensions/placeholder` if supported.
- [ ] Verify placeholders in chat, prompt, and document editors.
- [ ] Verify placeholders during modal overlays and streamed editor updates.

**Tip:** The application imports from `@tiptap/extensions`; relying on StarterKit to provide it transitively is fragile.

## 2. Correct dependency placement

### Move to `devDependencies`

- [ ] Move `@types/node`.
- [ ] Move `@types/streamsaver`.
- [ ] Move `typescript`.
- [ ] Move `convex`.
- [ ] Move `better-sqlite3`.
- [ ] Run a normal install and the full validation suite.
- [ ] Test a production-only installation in a disposable directory or container.
- [ ] Confirm all linked providers resolve their own runtime dependencies.

### Tips

- `typescript` is needed while building and running repository scripts, but not by built application output.
- `convex` is still needed for `bunx convex dev` and project types.
- `better-sqlite3` is still needed by webhook and SQLite tests.
- The production-only install check is essential because local `file:` provider packages can expose hoisting assumptions.

## 3. Routine update batch

### Low-risk libraries

- [ ] Update `@vue-flow/core`.
- [ ] Update `ajv`.
- [ ] Update `lru-cache`.
- [ ] Update `vue` within 3.5.
- [ ] Update `zod` within 4.x.
- [ ] Run type-check and unit tests.

### Tips

- Review type errors carefully after Zod and Vue updates; inference changes can reveal existing assumptions.
- Exercise rate limiting and auth-session caches after updating `lru-cache`.
- Open and interact with the workflow canvas after updating Vue Flow.

### Development tools

- [ ] Update the Carbon, Pixelarticons, and Tabler Iconify packages.
- [ ] Update `@playwright/test`.
- [ ] Update `@typescript-eslint/parser`.
- [ ] Update `@typescript-eslint/eslint-plugin`.
- [ ] Update `@vite-pwa/nuxt` within 1.x.
- [ ] Update `@vue/test-utils`.
- [ ] Update `tsx`.
- [ ] Run lint, unit tests, E2E smoke tests, and static generation.

### Tips

- Verify representative icons from every configured collection.
- Confirm the PWA service worker still excludes or bypasses streaming endpoints correctly.
- Keep Playwright's package and any cached browser binaries compatible.

### `better-sqlite3`

- [ ] Update within 12.x.
- [ ] Confirm Bun installs or builds the native binding successfully.
- [ ] Run webhook SQLite-store tests.
- [ ] Run basic-auth and SQLite provider smoke tests.
- [ ] Test restart and opening an existing database.

### Tips

- Native-module installation success does not prove database behavior.
- Test both an empty database and one created by the previous version.

### `convex`

- [ ] Update from the exact 1.31.3 pin to the chosen 1.32.x release.
- [ ] Keep it pinned if reproducible CLI behavior is important.
- [ ] Run `or3-cloud` Convex validation and dry-run tests.
- [ ] Verify the Convex CLI starts against an existing scaffold.
- [ ] Run auth-token and gateway sync tests.

**Tip:** Update `or3-provider-convex` separately if it has its own Convex SDK constraint; do not assume the host package controls the provider SDK.

### `dexie`

- [ ] Update 4.2 to 4.3 separately from unrelated libraries.
- [ ] Run all schema and migration tests.
- [ ] Test opening a database created by 4.2.
- [ ] Test workspace switching.
- [ ] Test outbox capture and remote-apply suppression.
- [ ] Test export and restore.
- [ ] Test storage-transfer lease recovery.
- [ ] Test logout and database cleanup.

### Tips

- Do not delete test databases merely to make migration failures disappear.
- Test aborted transactions and page reloads during sync.
- Treat changes in transaction timing as potentially significant even when the API remains compatible.

### OR3 workflow packages

- [ ] Update `or3-workflow-core`.
- [ ] Update `or3-workflow-vue`.
- [ ] Review their release notes or package diffs first.
- [ ] Test foreground execution.
- [ ] Test background execution and reattachment.
- [ ] Test HITL pause and resume.
- [ ] Test workflow persistence and streaming.

**Tip:** Update core and Vue bindings together unless their peer ranges explicitly support mixed versions.

## 4. Tiptap upgrade

### Tiptap 3 package family

- [x] Update all Tiptap packages in one batch.
- [x] Add or update `@tiptap/extensions`.
- [x] Keep `core`, `pm`, `starter-kit`, `suggestion`, and related packages compatible.
- [x] Run editor integration tests.
- [ ] Test document editing and autosave.
- [ ] Test prompt editing.
- [ ] Test chat input placeholder and autocomplete.
- [ ] Test mentions and workflow slash commands.
- [x] Test message editing and Markdown conversion.
- [x] Test undo, redo, lists, and links.
- [ ] Test browser paste behavior interactively.

### Tips

- Published Tiptap packages do not always share an identical latest version. Follow peer ranges rather than forcing a nonexistent version.
- Look for duplicate extension warnings at runtime.
- Verify Markdown serialization does not silently discard custom nodes or marks.

### `tiptap-markdown` 0.8 to 0.9

- [x] Upgrade to 0.9 for Tiptap 3 compatibility.
- [x] Compare Markdown output before and after.
- [x] Test headings, lists, links, code blocks, inline HTML, and empty documents.
- [x] Test Markdown-to-ProseMirror conversion in message actions.
- [x] Add regression fixtures for content users already have stored.
- [x] Open a follow-up task to migrate to official `@tiptap/markdown`.

**Follow-up:** Migrate from the maintenance-only `tiptap-markdown` package to official `@tiptap/markdown` in a separate phase. Compare parser and serializer fixtures before changing the production extension; do not combine that migration with another editor upgrade.

### Tips

- Preserve serialized output where possible; formatting churn can create unnecessary document changes.
- Do not combine the 0.9 compatibility bump with the official Markdown migration.
- The official migration should compare parsing and serialization semantics, not just TypeScript compilation.

## 5. Focused application-library upgrades

### VueUse 13 to 14

- [ ] Upgrade in its own commit.
- [ ] Run type-check.
- [ ] Test debounced search and autosave.
- [ ] Test resize and element-size observers.
- [ ] Test keyboard shortcuts.
- [ ] Test clipboard actions.
- [ ] Test drag/drop and file selection.
- [ ] Test persistent pane and sidebar state.
- [ ] Test event-listener cleanup during unmount and HMR.
- [ ] Watch for changed scheduler or timing behavior.

### Tips

- Fake-timer tests are especially useful for debounce and throttle behavior.
- Check that asynchronous debounced functions still expose the cancellation behavior the application expects.
- Exercise components repeatedly to detect leaked listeners or observers.

### Virtua

- [ ] Update separately.
- [ ] Test the model catalog with an empty list.
- [ ] Test a large model list.
- [ ] Test filtering while scrolled.
- [ ] Test selection and scroll restoration.
- [ ] Check row height and overscan behavior.
- [ ] Verify there is no blank content during rapid scrolling.

**Tip:** Only one application component imports Virtua, so a focused component test plus manual scrolling is more useful than broad unrelated tests.

### Vue Router 5

- [ ] Coordinate the update with Nuxt 4.4 or newer.
- [ ] Run route type-checking.
- [ ] Test notification navigation.
- [ ] Test dynamic plugin routes.
- [ ] Test admin guards and auth redirects.
- [ ] Test static-generated routes.
- [ ] Confirm no `unplugin-vue-router` imports exist.

**Tip:** Standard Vue Router 4 usage should migrate cleanly, but Nuxt owns much of the router integration. Avoid overriding the version independently without checking Nuxt's constraints.

## 6. Nuxt UI 4 migration

- [ ] Create a dedicated migration branch.
- [ ] Update Nuxt to a compatible Nuxt 4 release first.
- [ ] Update `@nuxt/ui` to v4.
- [ ] Add any newly required direct Tailwind dependency.
- [ ] Replace every `UButtonGroup` with `UFieldGroup`.
- [ ] Rename retro-theme `buttonGroup` configuration.
- [ ] Rename blank-theme `buttonGroup` configuration.
- [ ] Search for removed or renamed Nuxt UI components.
- [ ] Review every `UForm` for changed submit and transformation behavior.
- [ ] Check nested forms for required `nested` and `name` props.
- [ ] Search for `nullify` model modifiers.
- [ ] Validate all `app.config.ts` component slots and variants.
- [ ] Run type-check and component tests.
- [ ] Manually inspect chat, sidebar, dashboard, admin, wizard, images, and workflow UI.
- [ ] Test light/dark and retro/blank theme combinations.
- [ ] Run SSR and static builds.

### Tips

- Start with compile errors, then fix theme configuration, then perform visual review.
- Build a short screenshot matrix for high-use screens before upgrading.
- Pay special attention to grouped-button borders, rounding, spacing, focus rings, and disabled states.
- Do not delete custom styling merely because v4's generated classes differ; map the intended design to the new slot structure.

## 7. Nuxt 4.5 and Vite 8 migration

- [ ] Upgrade to the latest Nuxt 4.4 patch first.
- [ ] Validate SSR and static output at 4.4.
- [ ] Commit the 4.4 result independently.
- [ ] Upgrade Nuxt 4.5, Vite 8, and compatible `@vitejs/plugin-vue` together.
- [ ] Review Vite 8 and Rolldown migration notes.
- [ ] Type-check the custom theme compiler plugin.
- [ ] Verify `buildStart`, `configResolved`, and `handleHotUpdate`.
- [ ] Review direct Rollup type imports.
- [ ] Review `build.rollupOptions`.
- [ ] Review dependency optimizer configuration.
- [ ] Run theme compilation in development and production.
- [ ] Test theme HMR.
- [ ] Run SSR build validation.
- [ ] Run static generation validation.
- [ ] Test every enabled provider-module combination.
- [ ] Test PWA generation and service-worker registration.
- [ ] Compare production bundle size and chunk structure.
- [ ] Run plugin-runtime production-build checks.

### Tips

- If Rolldown introduces problems, test the Vite 7 `rolldown-vite` compatibility path first to isolate bundler issues.
- The custom Vite plugin uses standard hooks, but its `rollup` type dependency and Nuxt's Vite configuration deserve explicit review.
- Treat Nuxt 4.5 like a platform migration despite its minor semver number.
- Check startup, generation, and HMR because each exercises different plugin paths.

## 8. Test stack migration

### Vitest 2 to 4

- [ ] Upgrade `vitest` and `@vitest/coverage-v8` as a matched set.
- [ ] Keep `@vitest/ui` removed unless intentionally restored.
- [ ] Update the compatible Vite Vue plugin.
- [ ] Review removed Vitest configuration options.
- [ ] Review mocks that depend on `mockReset` behavior.
- [ ] Review custom reporters or test-runner integrations.
- [ ] Run tests without coverage.
- [ ] Run tests with coverage.
- [ ] Compare coverage thresholds and mapped line numbers.
- [ ] Review snapshot changes rather than updating them wholesale.
- [ ] Run watch mode.

### Tips

- Read both the Vitest 3 and Vitest 4 migration sections because this upgrade skips a major version.
- Coverage totals may legitimately change because Vitest 4 remaps V8 coverage differently.
- Do not automatically accept large snapshot rewrites.

### Benchmark scripts

- [ ] Review scripts that invoke `vite-node`.
- [ ] Decide whether to keep `vite-node` as an explicit dev dependency.
- [ ] Prefer migrating benchmark scripts to the supported Vite module-runner path.
- [ ] Run every plugin-runtime benchmark command.

**Tip:** Vitest 4 no longer supplies `vite-node` internally, so relying on its transitive presence will become unreliable.

### jsdom 25 to 29

- [ ] Upgrade after Vitest 4 is working.
- [ ] Run component and composable tests.
- [ ] Review DOM serialization and snapshot changes.
- [ ] Test focus and keyboard behavior.
- [ ] Test URL, storage, and event behavior.
- [ ] Review global DOM polyfills in `tests/setup.ts`.

**Tip:** Prefer correcting inaccurate test assumptions over recreating obsolete jsdom behavior with more mocks.

### fake-indexeddb 5 to 6

- [ ] Upgrade after the baseline Vitest migration.
- [ ] Run every Dexie and sync test.
- [ ] Test transaction abort and error propagation.
- [ ] Test database deletion and reopening.
- [ ] Test event objects if assertions depend on their concrete class.

**Tip:** Keep this separate from the Dexie upgrade so IndexedDB-emulation regressions can be distinguished from Dexie regressions.

## 9. ESLint 10 migration

- [ ] Confirm the supported Node runtime used by editors and CI.
- [ ] Upgrade ESLint to 10.
- [ ] Upgrade the TypeScript parser and plugin to compatible releases.
- [ ] Keep the existing flat config.
- [ ] Review config lookup behavior from nested directories.
- [ ] Search for obsolete `eslint-env` comments.
- [ ] Review glob patterns.
- [ ] Run lint from the repository root.
- [ ] Run lint from a nested directory if developers do that.
- [ ] Review new findings instead of disabling them globally.

### Tips

- The root config already avoids the obsolete `.eslintrc` format.
- Avoid accidentally enabling a broad recommended preset; the current config intentionally enables only a small rule set.
- Verify editor integrations separately from the command line.

## 10. TypeScript 7 preparation — defer implementation

- [ ] Keep TypeScript 5.9 pinned for the current cleanup.
- [ ] Evaluate TypeScript 6 as an intermediate migration.
- [ ] Catalog every TypeScript compiler-API import.
- [ ] Replace or isolate `transpileModule` usage in `nuxt.config.ts`.
- [ ] Replace or isolate compiler-API usage in plugin-runtime scripts.
- [ ] Remove `baseUrl` from affected configurations.
- [ ] Confirm Nuxt and Vue language tooling officially support TypeScript 7.
- [ ] Consider running TypeScript 6 for API consumers and TypeScript 7 only for CLI checking.
- [ ] Create comparison CI jobs before switching the default.
- [ ] Do not update the main `typescript` dependency until those checks pass.

### Tips

- TypeScript 7 is not a normal compiler bump for this repository because the application consumes the compiler API.
- Avoid aliasing packages until Nuxt, Vue tooling, ESLint, and repository scripts have a documented ownership model.
- Make TypeScript 6 clean, including deprecation warnings, before evaluating TypeScript 7.

## Final acceptance checklist

- [ ] `bun install --frozen-lockfile` succeeds from a fresh checkout.
- [ ] `bun outdated` contains only explicitly deferred upgrades.
- [ ] No direct dependency is used only transitively by accident.
- [ ] No runtime dependency is purely a type package.
- [ ] `bun run type-check` passes.
- [ ] `bun run eslint .` passes.
- [ ] `bun run test` passes.
- [ ] Coverage thresholds pass.
- [ ] `bun run check-imports` passes.
- [ ] `bun run theme:validate` passes.
- [ ] `bun run build` passes.
- [ ] `bun run generate:static` passes.
- [ ] Plugin-runtime compatibility checks pass.
- [ ] Critical E2E auth, sync, storage, editor, and offline flows pass.
- [ ] SSR startup works with cloud providers enabled.
- [ ] Static and local-only startup works with providers disabled.
- [ ] Lockfile changes contain no unexplained packages.
- [ ] Each migration phase has its own reviewable commit.
