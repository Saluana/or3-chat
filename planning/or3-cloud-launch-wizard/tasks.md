# tasks.md

artifact_id: 3f7ea845-195b-4ed2-a8f6-f0f9f41a5b74

## 0. Planning checkpoints

- [ ] Confirm the default path is Basic Auth + SQLite + FS storage
  - Requirements: 2.1, 3.1
- [ ] Confirm legacy preset remains selectable as Clerk + Convex + Convex storage
  - Requirements: 2.3, 3.1
- [ ] Confirm deployment targets for v1 are only `local-dev` and `prod-build`
  - Requirements: 6.1
- [ ] Confirm whether v1 operates “in-place” (current repo) vs scaffolding a fresh instance directory (or both)
  - Requirements: 5.1, 7.1

## 1. Define the Wizard API contract (API-first)

- [ ] Create TypeScript types for session/steps/answers/presets
  - Requirements: 1.1, 2.1, 3.1, 3.2, 3.3
- [ ] Decide how sessions are persisted for resume (disk vs memory) and define the storage format + location
  - Requirements: 1.2
- [ ] Define the step graph (declarative `WizardStep[]`) with copy + defaults
  - Requirements: 2.1, 2.2, 3.1, 3.2, 3.3
- [ ] Add a Provider Catalog model (auth/sync/storage) that drives selection + provider-specific prompts
  - Requirements: 2.3, 3.1
  - Subtasks:
    - [ ] Define provider descriptors (id/label/implemented/fields/dependencies)
    - [ ] Set recommended preset defaults to `basic-auth` + `sqlite` + `fs`
    - [ ] Keep legacy preset option `clerk` + `convex` + `convex`
    - [ ] Wire provider selection step to generate provider-specific steps
- [ ] Define the API methods (`createSession`, `submitAnswers`, `validate`, `apply`, `deploy`)
  - Requirements: 1.1, 4.1, 5.1, 6.1

## 2. Validation implementation plan

- [ ] Implement field-level validation rules
  - Requirements: 2.1, 4.1
  - Subtasks:
    - [ ] Secret/path validation for `OR3_BASIC_AUTH_JWT_SECRET`, `OR3_SQLITE_DB_PATH`, `OR3_STORAGE_FS_ROOT`, and `OR3_STORAGE_FS_TOKEN_SECRET`
    - [ ] URL parsing validation for `VITE_CONVEX_URL`
    - [ ] Basic pattern validation for Clerk keys (non-blocking warnings if unsure)
    - [ ] Cross-field validation: OpenRouter rules (`requireUserKey` vs `allowUserOverride`)
- [ ] Implement authoritative validation by calling existing config builders
  - Requirements: 4.1
  - Subtasks:
    - [ ] Build env map from answers
    - [ ] Implement strict/non-strict validation WITHOUT mutating global `process.env` (prefer `defineOr3CloudConfig(config, { strict })`)
    - [ ] Call `buildOr3ConfigFromEnv(env)`
- [ ] Add a “redacted summary” generator
  - Requirements: 2.2, 4.2

## 3. Preset support

- [ ] Define preset storage location + format (cross-platform)
  - Requirements: 1.2, 2.1, 4.2
- [ ] Implement `savePreset`, `listPresets`, `loadPreset`, `deletePreset`
  - Requirements: 1.2
- [ ] Ensure secrets are excluded by default
  - Requirements: 4.2

## 4. Apply (write env/config)

- [ ] Implement env file read/merge/write
  - Requirements: 5.1
  - Subtasks:
    - [ ] Reuse or extract the existing safe env editor from `server/admin/config/env-file.ts`
    - [ ] Support writing to `(instanceDir, envFile)` instead of only `process.cwd()/.env`
    - [ ] Update only wizard-owned keys
    - [ ] Write in stable order (group by OR3/Cloud/Security)
- [ ] Implement provider module file generation
  - Requirements: 5.1
  - Subtasks:
    - [ ] Generate `or3.providers.generated.ts` from selected providers only
    - [ ] Exclude local/non-package providers from generated module IDs
- [ ] Add “dry-run” mode that prints planned changes without writing
  - Requirements: 4.1, 5.1

## 4.1 Themes selection (plan for install-on-demand)

- [ ] Add a “themes” step (select default + optional install set)
  - Requirements: 3.2.1
  - Subtasks:
    - [ ] Offer at least `blank` + `retro` with “install all” option
    - [ ] Always set `OR3_DEFAULT_THEME`
- [ ] Add a placeholder install pipeline interface (no-op in v1)
  - Requirements: 5.3

## 5. Convex helper step (legacy/mixed stacks only)

- [ ] Add step for setting Convex environment variables (Clerk issuer + admin jwt)
  - Requirements: 3.1
- [ ] Add command runner support for `bunx convex env set ...`
  - Requirements: 6.2
- [ ] Add preflight checks: Convex CLI accessible, instance dir has convex config
  - Requirements: 4.1

## 6. Deploy / boot

- [ ] Implement deploy plan for `local-dev`
  - Requirements: 6.1, 6.2
  - Subtasks:
    - [ ] `bun install`
    - [ ] Start Convex dev (foreground or background) only when a Convex provider is selected
    - [ ] Start Nuxt SSR (`bun run dev:ssr`)
- [ ] Implement deploy plan for `prod-build`
  - Requirements: 6.1, 6.2
  - Subtasks:
    - [ ] `bun install`
    - [ ] `bun run build`
    - [ ] Print “how to run” instructions

## 7. CLI wizard (consumer of the API)

- [ ] Implement `or3-cloud` CLI with commands:
  - Requirements: 2.1, 6.2, 7.1
  - Subtasks:
    - [ ] `or3-cloud init` (interactive wizard)
    - [ ] `or3-cloud validate` (validate current env)
    - [ ] `or3-cloud presets` (list/save/load)
    - [ ] `or3-cloud deploy` (boot/build)
- [ ] CLI UX details
  - Requirements: 2.1
  - Subtasks:
    - [ ] y/n prompts with Enter for default
    - [ ] Clear step titles and progress indicator
    - [ ] Copyable output for env vars when user prefers manual setup

## 7.1 Dependency installation (future capability)

- [ ] Add an install plan step that can list what would be installed
  - Requirements: 5.3, 7.2
  - Subtasks:
    - [ ] List provider dependencies from Provider Catalog
    - [ ] List theme packages/artifacts (when theme packaging exists)
    - [ ] Record changes (packages/files) for transparency
- [ ] Add execution support for Bun installs (`bun add`) behind a feature flag
  - Requirements: 5.3
- [ ] Add npm compatibility mode (print equivalent `npm install` commands or execute when selected)
  - Requirements: 5.3, 7.1

## 8. Packaging and distribution

- [ ] Decide where the CLI lives (repo `scripts/cli` vs publishable package)
  - Requirements: 7.1
- [ ] Add `bin` entry + build strategy so it runs via `bunx` and `npx`
  - Requirements: 7.1
- [ ] Add docs: “one-command install” quickstart for the wizard
  - Requirements: 2.1, 7.1

## 9. Tests

- [ ] Unit tests for:
  - Requirements: 4.1, 5.1
  - Subtasks:
    - [ ] Config validation matrix (strict vs non-strict)
    - [ ] Env merge correctness
    - [ ] Redaction
- [ ] Integration tests (dry-run) that cover the default path
  - Requirements: 3.1, 6.1
  - Subtasks:
    - [ ] Validate recommended preset (`basic-auth` + `sqlite` + `fs`)
    - [ ] Validate legacy preset (`clerk` + `convex` + `convex`)
    - [ ] Validate generated provider module list matches only selected providers

## 10. Documentation updates

- [ ] Add a new docs page describing the wizard flow and what it writes
  - Requirements: 2.1, 5.1
- [ ] Ensure config reference remains authoritative and referenced by wizard help links
  - Requirements: 2.1
- [ ] Fix any env var naming drift in docs that the wizard will link to (e.g. `CONVEX_URL` vs `VITE_CONVEX_URL`)
