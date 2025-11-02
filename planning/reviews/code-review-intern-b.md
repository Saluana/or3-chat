# Intern B Playbook – Cleanup & Tooling

## Scope Guard
- Own `app/plugins/examples`, `public/demo`, `docs/plugins`, `scripts`, and shared test utilities under `tests/utils`.
- Do **not** modify any file under `app/composables/**` or `app/db/**`; those belong to Intern A.
- Coordinate only through new helpers or docs. If you must touch a file outside this list, check in with the team lead first.

## Task List
- [ ] Remove the Snake game plugin and any other example bundles that ship to production.
- [ ] Backfill documentation that shows how to build plugins now that the example code is gone.
- [ ] Extract shared sidebar test helpers into `tests/utils/sidebar.ts` and dedupe existing specs.
- [ ] Run a bundle size check and publish the before/after numbers.
- [ ] Wire up automated hygiene: lint, build, and bundle visualiser scripts.

## 1. Remove the Snake Game Module
Best practice: dead demo code should not live in the production bundle. Delete the source **and** any references.

1. Delete these files outright (use `git rm` so history is tracked):
   - `app/plugins/examples/snake-game.client.ts`
   - `app/plugins/examples/snake-game.ts`
   - `app/plugins/examples/SnakeGamePane.vue`
   - `app/plugins/examples/SnakeGameSidebar.vue`
   - Any snake-specific assets in `public/` (search `rg "SnakeGame"`).
2. Search for imports:
   ```bash
   rg "snake-game" -n app
   rg "SnakeGame" -n
   ```
   Remove leftover exports, lazy-loaded routes, or menu entries.
3. If other example files are >100 lines and unused, either trim them or move them to a new `docs/plugins/examples` folder as `.md` snippets so they never enter the bundle.
4. Keep commits surgical: demo removal in one commit, follow-up fixes in another if practical.

## 2. Write Plugin Author Docs
Best practice: when removing runnable examples, replace them with documented recipes.

1. Create `docs/plugins/sidebar-plugin-guide.md` summarising:
   - How to register a sidebar page and a pane app (reference the Zod constraints Intern A adds).
   - Expected folder structure.
   - Lifecycle hooks with do/don’t lists.
   - Include a minimal code sample that mirrors the old snake game’s intent (e.g., a simple counter pane under 40 lines).
2. Update any index or navigation file that lists docs (check `docs/README.md` or similar) so the new guide is discoverable.
3. Cross-link to Intern A’s new type definitions so plugin authors see the canonical source.

## 3. Extract Shared Test Utilities
Best practice: DRY test setup prevents skew between specs.

1. Create `tests/utils/sidebar-test-helpers.ts` that exposes helpers like `registerTestPane`, `makeSidebarPage`, and fake post builders.
2. Update existing sidebar-related specs to import from that helper instead of re-declaring fixtures. Stick to files outside `app/composables` (e.g., `tests/sidebar/*.test.ts`).
3. When you touch tests, ensure you are not editing the source modules that Intern A owns; only change `tests/**`.
4. Demonstrate helper usage in at least two specs so future contributors follow the pattern.

## 4. Bundle Health Check
Best practice: measure every significant removal. Share the numbers in the PR description.

1. Run the build and bundle analyser:
   ```bash
   bun run build
   npx vite-bundle-visualizer dist/stats.html
   ```
   (If the visualiser isn’t installed, add it as a dev dependency in `package.json`.)
2. Capture the bundle size delta. Put the before/after table in the docs or PR notes.
3. Ensure the analyser output isn’t committed; add it to `.gitignore` if necessary.

## 5. Automation & Hygiene
Best practice: fast feedback prevents regressions.

1. Add an npm script for the bundle report if missing, e.g.:
   ```json
   "analyze": "bun run build && npx vite-bundle-visualizer dist/stats.html"
   ```
   (You can edit `package.json`; Intern A doesn’t need it.)
2. Verify `bun run lint` and `bun test` still pass after your deletions.
3. If removing demos reveals unused dependencies, note them in the PR so the team can follow up (don’t yank them unless you’re sure nothing else uses them).

## Done Criteria
- No `SnakeGame` references remain in repo history (`rg` should return empty).
- New plugin guide lives under `docs/plugins` and links to the official API.
- Sidebar specs share helpers from `tests/utils/sidebar-test-helpers.ts`.
- Bundle size delta recorded and scripts updated for future checks.
- Source files owned by Intern A remain untouched.
