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

- [ ] `or3-chat/package.json` does not list `@clerk/nuxt`, `convex`, `convex-nuxt`, or `convex-vue`.
- [ ] `or3.providers.generated.ts` references package module ids (`or3-provider-*/nuxt`), not `./packages/...` source paths.
- [ ] `../or3-provider-clerk` and `../or3-provider-convex` each have:
  - [ ] `package.json`
  - [ ] `tsconfig.json`
  - [ ] Build scripts producing distributable output
  - [ ] Clear README installation docs
- [ ] Core hot zones contain no banned provider imports:
  - [ ] `app/pages/**`
  - [ ] `app/plugins/**`
  - [ ] `server/api/**`
  - [ ] `server/middleware/**`
  - [ ] `server/plugins/**`
- [ ] Build/typecheck matrix passes:
  - [ ] No Clerk selected
  - [ ] No Convex selected
- [ ] Functional sanity passes for workspace API, sync gateway, storage gateway, and provider token broker.
- [ ] Planning docs updated to reflect completion.

## Execution Order

Do not skip order. Each stage has a gate.

---

## Stage 0: Baseline + Safety

- [ ] Create a branch for Phase 3 completion.
- [ ] Record baseline:
  - [ ] `bun run test`
  - [ ] `bun run type-check`
  - [ ] `bun run eslint . --max-warnings 0`
- [ ] Confirm current provider references:
  - [ ] `rg -n "@clerk/nuxt|convex-vue|from 'convex'|from \"convex\"|~~/convex/_generated" app server`
  - [ ] `rg -n "packages/or3-provider|or3-provider-(clerk|convex)" app server tests`

Gate: all baseline commands complete and results captured before edits.

---

## Stage 1: Set Single Source of Truth

Use sibling repos as canonical provider sources:

- [ ] `../or3-provider-clerk`
- [ ] `../or3-provider-convex`

Tasks:

- [ ] Sync missing runtime files from in-repo stubs if needed:
  - [ ] from `or3-chat/packages/or3-provider-clerk/src/**` to `../or3-provider-clerk/src/**`
  - [ ] from `or3-chat/packages/or3-provider-convex/src/**` to `../or3-provider-convex/src/**`
- [ ] Add a short note in in-repo stub READMEs that sibling packages are canonical to prevent drift.

Gate: sibling package folders contain all required runtime files and are the only authoring target for provider code.

---

## Stage 2: Make External Provider Packages Real npm Packages

### 2A. `../or3-provider-clerk`

- [ ] Add `package.json`:
  - [ ] `name: "or3-provider-clerk"`
  - [ ] ESM package
  - [ ] exports include `./nuxt`
  - [ ] `@clerk/nuxt` listed in package dependencies or peers as decided
  - [ ] `nuxt` as peer
  - [ ] Bun build/typecheck scripts
- [ ] Add `tsconfig.json` suitable for package builds.
- [ ] Update `src/module.ts` to package-safe resolver style (`createResolver(import.meta.url)`).
- [ ] Ensure runtime registration paths are resolved via module resolver, not fragile filesystem assumptions.
- [ ] Add README usage section:
  - [ ] install
  - [ ] required env vars
  - [ ] expected host integration (`or3.providers.generated.ts`)

### 2B. `../or3-provider-convex`

- [ ] Add `package.json`:
  - [ ] `name: "or3-provider-convex"`
  - [ ] exports include `./nuxt`
  - [ ] convex libs listed in package dependencies or peers as decided
  - [ ] `nuxt` as peer
  - [ ] Bun build/typecheck scripts
- [ ] Add `tsconfig.json`.
- [ ] Update `src/module.ts` to resolver pattern (`createResolver(import.meta.url)`).
- [ ] Validate runtime plugin ordering:
  - [ ] Convex context initialization before auth bridge + sync plugin.
- [ ] Add README usage + required env vars.

### 2C. Build Gate

- [ ] Build each package from its own root.
- [ ] Verify package exports resolve (`or3-provider-clerk/nuxt`, `or3-provider-convex/nuxt`).
- [ ] Verify generated artifacts are publishable (not tied to host-only relative source paths).

Gate: both provider packages can be installed and imported as packages, not as `src` path aliases.

---

## Stage 3: Switch `or3-chat` to Consume External Packages

Tasks in `or3-chat/`:

- [ ] Remove direct provider SDK ownership from root `package.json`:
  - [ ] remove `@clerk/nuxt`
  - [ ] remove `convex`
  - [ ] remove `convex-nuxt`
  - [ ] remove `convex-vue`
- [ ] Add provider package dependencies using local links (or workspace equivalent):
  - [ ] `or3-provider-clerk`
  - [ ] `or3-provider-convex`
- [ ] Update `or3.providers.generated.ts`:
  - [ ] `or3-provider-clerk/nuxt`
  - [ ] `or3-provider-convex/nuxt`
- [ ] Run `bun install` and ensure lockfile consistency.

Gate: host app compiles with linked provider packages and no direct provider SDK dependencies.

---

## Stage 4: Remove Remaining Core Coupling + Ambiguous Defaults

### 4A. Core code/test coupling cleanup

- [ ] Replace core tests importing `~~/packages/or3-provider-*/src/...` with package imports or move tests to provider repos.
- [ ] Remove stale provider-impl test folders that imply core-owned implementations:
  - [ ] `server/auth/store/impls/__tests__`
  - [ ] `server/sync/gateway/impls/__tests__`
  - [ ] `server/storage/gateway/impls/__tests__`
- [ ] Ensure `app/plugins/convex-sync.client.ts` remains provider-agnostic core logic only.

### 4B. Phase 0.2 config alignment (silent Convex defaults)

- [ ] Resolve default-provider drift for non-Convex builds:
  - [ ] `limits.storageProvider`
  - [ ] `backgroundStreaming.storageProvider`
  - [ ] notification emitter expectations
- [ ] Make non-Convex defaults explicit when Convex is not selected.
- [ ] Keep these defaults aligned in both:
  - [ ] `config.or3cloud.ts`
  - [ ] `server/admin/config/resolve-config.ts`

Gate: no hidden fallback silently selects Convex when Convex provider is intentionally absent.

---

## Stage 5: Convex Backend Distribution Workflow

- [ ] Move Convex backend templates out of core ownership into provider package (template folder in `../or3-provider-convex`).
- [ ] Add `or3-provider-convex init` workflow that copies templates into host repo.
- [ ] Ensure codegen runs in host repo after init (not inside provider package).
- [ ] Document the init flow in provider README and this project’s setup docs.

Gate: a fresh host can install Convex provider, run init, and generate backend artifacts without core shipping `convex/**` as mandatory source.

---

## Stage 6: Guardrails (Required)

- [ ] Add a repo script that fails on banned imports in core hot zones.
- [ ] Add script to CI.
- [ ] Include banned patterns:
  - [ ] `@clerk/nuxt`
  - [ ] `convex`
  - [ ] `convex-vue`
  - [ ] `~~/convex/_generated`
- [ ] Exclude provider package repos/folders from this check.

Suggested check command:

```bash
rg -n "@clerk/nuxt|convex-vue|from 'convex'|from \"convex\"|~~/convex/_generated" \
  app/pages app/plugins server/api server/middleware server/plugins
```

Gate: guardrail script must pass locally and run in CI.

---

## Stage 7: Verification Matrix (Must Pass)

Run these in clean states and capture outputs.

### Matrix A: Full stack (Clerk + Convex selected)

- [ ] provider modules include both package module ids
- [ ] `bun run build`
- [ ] `bun run type-check`
- [ ] `bun run test`

### Matrix B: No Clerk selected

- [ ] generated provider list excludes Clerk module
- [ ] auth config is not `clerk`
- [ ] `bun run build`
- [ ] `bun run type-check`

### Matrix C: No Convex selected

- [ ] generated provider list excludes Convex module
- [ ] sync/storage/limits/background provider configs do not target convex
- [ ] `bun run build`
- [ ] `bun run type-check`

### Matrix D: Functional sanity

- [ ] Workspace CRUD works through `WorkspaceApi` SSR endpoints.
- [ ] Sync gateway endpoints function through registry adapter dispatch.
- [ ] Storage gateway endpoints function through registry adapter dispatch.
- [ ] Provider token minting flows through `ProviderTokenBroker`.

Gate: all matrix scenarios pass.

---

## Stage 8: Documentation + Closeout

- [ ] Update completion state in:
  - [ ] `planning/provider-decoupling/tasks.md`
  - [ ] `planning/provider-decoupling/PROGRESS_SUMMARY.md`
  - [ ] `planning/provider-decoupling/FINAL_STATUS.md`
- [ ] Add references to this runbook in planning index docs.
- [ ] Record final evidence:
  - [ ] command outputs
  - [ ] key PR links or commits
  - [ ] known non-blocking warnings

Final Gate: all DoD checkboxes at top are checked.

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
