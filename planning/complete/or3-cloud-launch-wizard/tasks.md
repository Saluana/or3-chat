# tasks.md

artifact_id: 3f7ea845-195b-4ed2-a8f6-f0f9f41a5b74

## Implementation notes

- Pivot: runtime writes now prefer existing canonical keys (`AUTH_PROVIDER`, `OR3_SYNC_ENABLED`, `OR3_STORAGE_ENABLED`) to match current OR3 runtime config readers.
- Compatibility aliases are also written (`OR3_AUTH_PROVIDER`, `OR3_CLOUD_SYNC_ENABLED`, `OR3_CLOUD_STORAGE_ENABLED`) so naming cleanup can happen later without breaking existing instances.

## 0. Planning checkpoints

- [x] Confirm the default path is Basic Auth + SQLite + FS storage
  - Requirements: 2.1, 3.1
- [x] Confirm legacy preset remains selectable as Clerk + Convex + Convex storage
  - Requirements: 2.3, 3.1
- [x] Confirm deployment targets for v1 are only `local-dev` and `prod-build`
  - Requirements: 6.1
- [x] Confirm whether v1 operates “in-place” (current repo) vs scaffolding a fresh instance directory (or both)
  - Requirements: 5.1, 7.1

## 1. Define the Wizard API contract (API-first)

- [x] Create TypeScript types for session/steps/answers/presets
  - Requirements: 1.1, 2.1, 3.1, 3.2, 3.3
- [x] Decide how sessions are persisted for resume (disk vs memory) and define the storage format + location
  - Requirements: 1.2
- [x] Define the step graph (declarative `WizardStep[]`) with copy + defaults
  - Requirements: 2.1, 2.2, 3.1, 3.2, 3.3
- [x] Add a Provider Catalog model (auth/sync/storage) that drives selection + provider-specific prompts
  - Requirements: 2.3, 3.1
  - Subtasks:
    - [x] Define provider descriptors (id/label/implemented/fields/dependencies)
    - [x] Set recommended preset defaults to `basic-auth` + `sqlite` + `fs`
    - [x] Keep legacy preset option `clerk` + `convex` + `convex`
    - [x] Wire provider selection step to generate provider-specific steps
    - [x] Include `OR3_BASIC_AUTH_DB_PATH` and bootstrap credentials in basic-auth provider fields
    - [x] Include `OR3_SQLITE_ALLOW_IN_MEMORY` and `OR3_SQLITE_STRICT` in sqlite provider fields
    - [x] Note: basic-auth and sqlite both depend on `better-sqlite3` (separate DBs)
- [x] Define the API methods (`createSession`, `submitAnswers`, `validate`, `apply`, `deploy`)
  - Requirements: 1.1, 4.1, 5.1, 6.1

## 2. Validation implementation plan

- [x] Implement field-level validation rules
  - Requirements: 2.1, 4.1
  - Subtasks:
    - [x] Secret/path validation for `OR3_BASIC_AUTH_JWT_SECRET`, `OR3_SQLITE_DB_PATH`, `OR3_STORAGE_FS_ROOT`, and `OR3_STORAGE_FS_TOKEN_SECRET` (≥32 chars)
    - [x] Bootstrap credential validation: `OR3_BASIC_AUTH_BOOTSTRAP_EMAIL` (valid email) + `OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD` (both-or-neither rule)
    - [x] Path validation: `OR3_BASIC_AUTH_DB_PATH` defaults to `./.data/or3-basic-auth.sqlite`; `OR3_STORAGE_FS_ROOT` must be absolute path
    - [x] URL parsing validation for `VITE_CONVEX_URL`
    - [x] Basic pattern validation for Clerk keys (non-blocking warnings if unsure)
    - [x] Cross-field validation: OpenRouter rules (`requireUserKey` vs `allowUserOverride`)
    - [x] Strict config validation: `OR3_STRICT_CONFIG` interaction with `NODE_ENV=production` auto-strict
- [x] Implement authoritative validation by calling existing config builders
  - Requirements: 4.1
  - Subtasks:
    - [x] Build env map from answers
    - [x] Implement strict/non-strict validation WITHOUT mutating global `process.env` (prefer `defineOr3CloudConfig(config, { strict })`)
    - [x] Call `buildOr3ConfigFromEnv(env)`
- [x] Add a “redacted summary” generator
  - Requirements: 2.2, 4.2

## 3. Preset support

- [x] Define preset storage location + format (cross-platform)
  - Requirements: 1.2, 2.1, 4.2
- [x] Implement `savePreset`, `listPresets`, `loadPreset`, `deletePreset`
  - Requirements: 1.2
- [x] Ensure secrets are excluded by default
  - Requirements: 4.2

## 4. Apply (write env/config)

- [x] Implement env file read/merge/write
  - Requirements: 5.1
  - Subtasks:
    - [x] Reuse or extract the existing safe env editor from `server/admin/config/env-file.ts`
    - [x] Support writing to `(instanceDir, envFile)` instead of only `process.cwd()/.env`
    - [x] Update only wizard-owned keys
    - [x] Write in stable order (group by OR3/Cloud/Security)
- [x] Implement provider module file generation
  - Requirements: 5.1
  - Subtasks:
    - [x] Generate `or3.providers.generated.ts` from selected providers only
    - [x] Exclude local/non-package providers from generated module IDs
- [x] Add “dry-run” mode that prints planned changes without writing
  - Requirements: 4.1, 5.1

## 4.1 Themes selection (plan for install-on-demand)

- [x] Add a “themes” step (select default + optional install set)
  - Requirements: 3.2.1
  - Subtasks:
    - [x] Offer at least `blank` + `retro` with “install all” option
    - [x] Always set `OR3_DEFAULT_THEME`
- [x] Add a placeholder install pipeline interface (no-op in v1)
  - Requirements: 5.3

## 5. Convex helper step (legacy/mixed stacks only)

- [x] Add step for setting Convex environment variables (Clerk issuer + admin jwt)
  - Requirements: 3.1
- [x] Add command runner support for `bunx convex env set ...`
  - Requirements: 6.2
- [x] Add preflight checks: Convex CLI accessible, instance dir has convex config
  - Requirements: 4.1

## 6. Deploy / boot

- [x] Implement deploy plan for `local-dev`
  - Requirements: 6.1, 6.2
  - Subtasks:
    - [x] `bun install`
    - [x] Start Convex dev (foreground or background) only when a Convex provider is selected
    - [x] Start Nuxt SSR (`bun run dev:ssr`)
- [x] Implement deploy plan for `prod-build`
  - Requirements: 6.1, 6.2
  - Subtasks:
    - [x] `bun install`
    - [x] `bun run build`
    - [x] Print “how to run” instructions

## 7. CLI wizard (consumer of the API)

- [x] Implement `or3-cloud` CLI with commands:
  - Requirements: 2.1, 6.2, 7.1
  - Subtasks:
    - [x] `or3-cloud init` (interactive wizard)
    - [x] `or3-cloud validate` (validate current env)
    - [x] `or3-cloud presets` (list/save/load)
    - [x] `or3-cloud deploy` (boot/build)
- [x] CLI UX details
  - Requirements: 2.1
  - Subtasks:
    - [x] y/n prompts with Enter for default
    - [x] Clear step titles and progress indicator
    - [x] Copyable output for env vars when user prefers manual setup

## 7.1 Dependency installation (future capability)

- [x] Add an install plan step that can list what would be installed
  - Requirements: 5.3, 7.2
  - Subtasks:
    - [x] List provider dependencies from Provider Catalog
    - [x] List theme packages/artifacts (when theme packaging exists)
    - [x] Record changes (packages/files) for transparency
- [x] Add execution support for Bun installs (`bun add`) behind a feature flag
  - Requirements: 5.3
- [x] Add npm compatibility mode (print equivalent `npm install` commands or execute when selected)
  - Requirements: 5.3, 7.1

## 8. Packaging and distribution

- [x] Decide where the CLI lives (repo `scripts/cli` vs publishable package)
  - Requirements: 7.1
- [x] Add `bin` entry + build strategy so it runs via `bunx` and `npx`
  - Requirements: 7.1
- [x] Add docs: “one-command install” quickstart for the wizard
  - Requirements: 2.1, 7.1

## 9. Tests

- [x] Unit tests for:
  - Requirements: 4.1, 5.1
  - Subtasks:
    - [x] Config validation matrix (strict vs non-strict)
    - [x] Env merge correctness
    - [x] Redaction
- [x] Integration tests (dry-run) that cover the default path
  - Requirements: 3.1, 6.1
  - Subtasks:
    - [x] Validate recommended preset (`basic-auth` + `sqlite` + `fs`) incl. bootstrap credentials
    - [x] Validate legacy preset (`clerk` + `convex` + `convex`)
    - [x] Validate generated provider module list matches only selected providers
    - [x] Validate correct env var names (`OR3_AUTH_PROVIDER`, `OR3_CLOUD_SYNC_ENABLED`, `OR3_CLOUD_STORAGE_ENABLED`, `NUXT_PUBLIC_STORAGE_PROVIDER`)

## 10. Documentation updates

- [x] Add a new docs page describing the wizard flow and what it writes
  - Requirements: 2.1, 5.1
- [x] Ensure config reference remains authoritative and referenced by wizard help links
  - Requirements: 2.1
- [x] Fix any env var naming drift in docs that the wizard will link to (e.g. `CONVEX_URL` vs `VITE_CONVEX_URL`)
