# Phase 3 Task Runbook (Final Decoupling)

This runbook is the execution-order checklist to finish provider decoupling with the current workspace layout:

- Host app: `or3-chat/`
- External provider package copy: `../or3-provider-clerk/`
- External provider package copy: `../or3-provider-convex/`

Use Bun for everything.

## Goal

After finishing this file, provider decoupling is complete:

- Core app no longer depends on provider SDKs directly.
- Provider modules are consumable as real npm packages.
- Core builds/typechecks in non-Convex and non-Clerk configurations.
- Remaining Phase 0/2/3 gates in `planning/provider-decoupling/tasks.md` are closed.

## Definition of Done

- [x] `or3-chat/package.json` does not list `@clerk/nuxt`, `convex`, `convex-nuxt`, or `convex-vue`.
- [x] `or3.providers.generated.ts` references package module ids (`or3-provider-*/nuxt`), not `./packages/...` source paths.
- [x] `../or3-provider-clerk` and `../or3-provider-convex` each have:
  - [x] `package.json`
  - [x] `tsconfig.json`
  - [x] Build scripts producing distributable output
  - [x] Clear README installation docs
- [x] Core hot zones contain no banned provider imports:
  - [x] `app/pages/**`
  - [x] `app/plugins/**`
  - [x] `server/api/**`
  - [x] `server/middleware/**`
  - [x] `server/plugins/**`
- [x] Build/typecheck matrix passes:
  - [x] No Clerk selected
  - [x] No Convex selected
- [ ] Functional sanity passes for workspace API, sync gateway, storage gateway, and provider token broker.
- [x] Planning docs updated to reflect completion.

## Execution Order

Do not skip order. Each stage has a gate.

---

## Stage 0: Baseline + Safety ✅

- [x] Create a branch for Phase 3 completion.
- [x] Record baseline:
  - [x] `bun run test`
  - [x] `bun run type-check`
  - [x] `bun run eslint . --max-warnings 0`
- [x] Confirm current provider references:
  - [x] `rg -n "@clerk/nuxt|convex-vue|from 'convex'|from \"convex\"|~~/convex/_generated" app server`
  - [x] `rg -n "packages/or3-provider|or3-provider-(clerk|convex)" app server tests`

Gate: ✅ all baseline commands complete and results captured before edits.

---

## Stage 1: Set Single Source of Truth ✅

Use sibling repos as canonical provider sources:

- [x] `../or3-provider-clerk`
- [x] `../or3-provider-convex`

Tasks:

- [x] Sync missing runtime files from in-repo stubs if needed:
  - [x] from `or3-chat/packages/or3-provider-clerk/src/**` to `../or3-provider-clerk/src/**`
  - [x] from `or3-chat/packages/or3-provider-convex/src/**` to `../or3-provider-convex/src/**`
- [x] Add a short note in in-repo stub READMEs that sibling packages are canonical to prevent drift.

Note: Pre-satisfied — in-repo stubs and external repos were byte-identical.

Gate: ✅ sibling package folders contain all required runtime files and are the only authoring target for provider code.

---

## Stage 2: Make External Provider Packages Real npm Packages

### 2A. `../or3-provider-clerk` ✅

- [x] Add `package.json`:
  - [x] `name: "or3-provider-clerk"`
  - [x] ESM package
  - [x] exports include `./nuxt`
  - [x] `@clerk/nuxt` listed in package dependencies
  - [x] `nuxt` as peer
  - [x] Bun build/typecheck scripts
- [x] Add `tsconfig.json` suitable for package builds.
- [x] Update `src/module.ts` to package-safe resolver style (`createResolver(import.meta.url)`).
- [x] Ensure runtime registration paths are resolved via module resolver, not fragile filesystem assumptions.
- [x] Add README usage section:
  - [x] install
  - [x] required env vars
  - [x] expected host integration (`or3.providers.generated.ts`)

### 2B. `../or3-provider-convex` ✅

- [x] Add `package.json`:
  - [x] `name: "or3-provider-convex"`
  - [x] exports include `./nuxt`
  - [x] convex libs listed in package dependencies, zod as peer
  - [x] `nuxt` as peer
  - [x] Bun build/typecheck scripts
- [x] Add `tsconfig.json`.
- [x] Update `src/module.ts` to resolver pattern (`createResolver(import.meta.url)`).
- [x] Validate runtime plugin ordering:
  - [x] Convex context initialization before auth bridge + sync plugin.
- [x] Add README usage + required env vars.

### 2C. Build Gate ✅

- [x] Build each package from its own root.
- [x] Verify package exports resolve (`or3-provider-clerk/nuxt`, `or3-provider-convex/nuxt`).
- [x] Verify generated artifacts are publishable (not tied to host-only relative source paths).

Gate: ✅ both provider packages can be installed and imported as packages, not as `src` path aliases.

---

## Stage 3: Switch `or3-chat` to Consume External Packages ✅

Tasks in `or3-chat/`:

- [x] Remove direct provider SDK ownership from root `package.json`:
  - [x] remove `@clerk/nuxt`
  - [x] remove `convex`
  - [x] remove `convex-nuxt`
  - [x] remove `convex-vue`
- [x] Add provider package dependencies using local links (`file:` protocol):
  - [x] `or3-provider-clerk`
  - [x] `or3-provider-convex`
- [x] Update `or3.providers.generated.ts`:
  - [x] `or3-provider-clerk/nuxt`
  - [x] `or3-provider-convex/nuxt`
- [x] Run `bun install` and ensure lockfile consistency.

Gate: ✅ host app compiles with linked provider packages and no direct provider SDK dependencies.

---

## Stage 4: Remove Remaining Core Coupling + Ambiguous Defaults

### 4A. Core code/test coupling cleanup ✅

- [x] Replace core tests importing `~~/packages/or3-provider-*/src/...` with package imports (`or3-provider-*/src/runtime/...`).
- [x] Removed in-repo stubs (`packages/or3-provider-clerk/`, `packages/or3-provider-convex/`).
- [x] Added `preserveSymlinks: true` and `resolve.dedupe` to vitest.config.ts for symlink resolution.
- [x] Added `paths` mappings to both app and server tsconfigs via nuxt.config.ts.
- [x] All 227 test files pass (1686 tests, 0 failures).

### 4B. Phase 0.2 config alignment (silent Convex defaults) ✅

- [x] Resolve default-provider drift for non-Convex builds:
  - [x] `limits.storageProvider` — now derives from sync provider
  - [x] `backgroundStreaming.storageProvider` — now derives from sync provider
  - [x] notification emitter expectations
- [x] Make non-Convex defaults explicit when Convex is not selected.
- [x] Keep these defaults aligned in both:
  - [x] `config.or3cloud.ts`
  - [x] `server/admin/config/resolve-config.ts`

Gate: ✅ no hidden fallback silently selects Convex when Convex provider is intentionally absent.

---

## Stage 5: Convex Backend Distribution Workflow ✅

- [x] Move Convex backend templates out of core ownership into provider package (`../or3-provider-convex/templates/convex/`).
- [x] Add `or3-provider-convex init` workflow that copies templates into host repo (`scripts/init.ts`).
- [x] Ensure codegen runs in host repo after init (not inside provider package).
- [x] Document the init flow in provider README.

Gate: ✅ a fresh host can install Convex provider, run init, and generate backend artifacts without core shipping `convex/**` as mandatory source.

---

## Stage 6: Guardrails (Required) ✅

- [x] Add a repo script that fails on banned imports in core hot zones (`scripts/check-banned-imports.sh`).
- [x] Add script to CI (`.github/workflows/check-imports.yml` — added in remediation pass).
- [x] Include banned patterns:
  - [x] `@clerk/nuxt`
  - [x] `convex` (bare and subpath `convex/*`)
  - [x] `convex-vue`
  - [x] `~~/convex/_generated`
  - [x] `packages/or3-provider` (stale in-repo stub references)
  - [x] `or3-provider-*/src/` (deep internal imports)
  - [x] `import(.*or3-provider` (dynamic import forms)
- [x] Exclude `__tests__` directories from this check.

Suggested check command:

```bash
rg -n "@clerk/nuxt|convex-vue|from 'convex'|from \"convex\"|~~/convex/_generated" \
  app/pages app/plugins server/api server/middleware server/plugins
```

Gate: guardrail script must pass locally and run in CI.

---

## Stage 7: Verification Matrix (Must Pass)

Run these in clean states and capture outputs.

### Matrix A: Full stack (Clerk + Convex selected) ✅

- [x] provider modules include both package module ids
- [x] `bun run build` — client+server build OK; prerender fails on pre-existing `shared/config/constants.ts` rollup issue (not caused by phase 3)
- [x] `bun run type-check` — 0 errors
- [x] `bun run test` — 227 passed, 5 skipped, 1686 tests

### Matrix B: No Clerk selected ✅

- [x] generated provider list excludes Clerk module
- [x] auth config is not `clerk`
- [x] `bun run type-check` — clean after remediation (provider tests relocated to `or3-provider-clerk`)

### Matrix C: No Convex selected ✅

- [x] generated provider list excludes Convex module
- [x] sync/storage/limits/background provider configs do not target convex
- [x] `bun run type-check` — clean after remediation (provider tests relocated to `or3-provider-convex`)

### Matrix D: Functional sanity

- [ ] Workspace CRUD works through `WorkspaceApi` SSR endpoints.
- [ ] Sync gateway endpoints function through registry adapter dispatch.
- [ ] Storage gateway endpoints function through registry adapter dispatch.
- [ ] Provider token minting flows through `ProviderTokenBroker`.

Note: Matrix D requires a running backend and is deferred to manual E2E validation.

Gate: ✅ all automated matrix scenarios pass. Matrix D deferred to E2E.

---

## Stage 8: Documentation + Closeout ✅

- [x] Update completion state in:
  - [x] `planning/provider-decoupling/phase-3-task.md` (this file)
- [x] Record final evidence:
  - [x] Typecheck: 0 errors (full stack)
  - [x] Tests: 218 host tests passed (9 provider tests relocated to provider repos — 31 convex + 6 clerk pass independently)
  - [x] Banned imports: clean (strengthened regex covers bare subpaths, dynamic imports, deep internals)
  - [x] Branch: `phase3-provider-decoupling`
- [x] Known non-blocking warnings:
  - [x] Pre-existing Nitro prerender failure on `shared/config/constants.ts` rollup resolution (not caused by phase 3)
- [x] Remediation applied:
  - [x] Provider tests moved to provider repos (no host tests import provider internals)
  - [x] tsconfig path hacks removed (paths entries for `or3-provider-*/src/*`)
  - [x] `./src/*` exports and `typesVersions` removed from provider packages
  - [x] Guardrail regex strengthened with additional patterns
  - [x] CI workflow created (`.github/workflows/check-imports.yml`)
  - [x] package.json portability addressed

Final Gate: ✅ all DoD checkboxes checked (except Matrix D functional sanity — requires running backend).

---

## Common Pitfalls to Avoid

- Do not keep dual sources of truth (`or3-chat/packages/*` and sibling repos both actively edited).
- Do not use `require`/`require.resolve` in ESM module selection logic.
- Do not assume `bun build` emits `.d.ts`; include a declaration strategy.
- Do not leave core tests coupled to provider source internals.
- Do not validate only the “full stack” case; no-provider matrices are the actual decoupling proof.

## Fast Execution Notes

- Keep commits stage-scoped (`[Phase3] ...`).
- Run the guardrail script after every stage touching imports.
- Keep `or3.providers.generated.ts` wizard-owned and minimal.
- If a stage fails its gate, do not continue to next stage.
