---
artifact_id: a1f8c2e4-9b3d-4e71-8c05-6d2a91f0b847
title: tasks.md
status: draft
owner: or3-chat
date: 2026-07-19
supersedes: planning/hook-system-v2
---

# Tasks

Lifecycle-first. Prefer small reversible PRs from the sequence in design § migration.

## 0. V1 P0 foundations (landed — do not reopen)

- [x] 0.1 Inventory preserves `runtime`; install 409 + atomic backup/swap; uninstall ID/path safety
      Requirements: R7 (packages later builds on this), R1
      Done when: existing extension tests green.

- [x] 0.2 Exact-owner handles on shared registries + workspace tool dispose
      Requirements: R4.AC5
      Done when: registry ownership tests green.

- [x] 0.3 Workspace generation checks; runtime-manifest `loadAllowed`; route write perms; auth fail-closed; sync thenables / onceAction
      Requirements: R3.AC6, R5.AC6, R1.AC2
      Done when: related unit suites green.

## Milestone 0 — Freeze and measure V1 contract

- [ ] M0.1 Snapshot public plugin/hook exports and add compile fixtures for example plugins
      Requirements: R1.AC1, R9.AC3
      Done when: fixture package(s) typecheck against current public APIs in CI.

- [ ] M0.2 Record golden ordering/error behavior for hooks and per-surface registries
      Requirements: R1.AC2, R4.AC2
      Done when: golden tests encode current tie-break and error-continue behavior.

- [ ] M0.3 Add production-build integration fixtures (not only mocked unit tests)
      Requirements: R9.AC3
      Done when: one prod-build path loads a bundled V1 plugin or documents harness limitation.

- [ ] M0.4 Benchmark baseline: hook dispatch, registry updates, workspace reconcile, diagnostics memory
      Requirements: R9.AC4
      Done when: CI artifact or committed baseline numbers exist.

## Milestone 1 — Manager contracts in shadow mode

- [ ] M1.1 Add `PluginDescriptor`, instance key helper, `PluginRuntimeRecord`, state machine types
      Requirements: R2.AC1, R2.AC2, R2.AC3
      Done when: unit tests cover key composition and status transitions as pure functions.

- [ ] M1.2 Adapt runtime-manifest → descriptors without changing load path
      Requirements: R2.AC1
      Done when: shadow descriptors match enabled/loadAllowed IDs.

- [ ] M1.3 Shadow PluginManager observes loader events and publishes status
      Requirements: R2.AC3, R9.AC1
      Done when: admin/devtools can read shadow status; loading path unchanged.

- [ ] M1.4 Rollback path: remove shadow observer only
      Requirements: R9.AC2
      Done when: documented in PR template.

## Milestone 2 — PluginScope + awaited lifecycle

- [ ] M2.1 Implement PluginScope (abort, stage, commit, activate, rollback, LIFO awaited dispose + timeouts)
      Requirements: R3.AC1–R3.AC4
      Done when: unit tests cover throw-before-reg, throw-after-stage, cleanup throw/delay.

- [ ] M2.2 Legacy workspace API backed by scope (`createLegacyWorkspacePluginApi`)
      Requirements: R3.AC5, R1.AC1
      Done when: existing `Or3WorkspacePlugin` examples register through adapter.

- [ ] M2.3 Make instance disposal async/awaited; per-plugin operation mutex
      Requirements: R3.AC4, R3.AC6, R7.AC5
      Done when: replacement waits for old dispose; concurrent same-ID ops serialize.

- [ ] M2.4 Gate: failed registration → zero contributions; workspace switch → zero stale; stale disposer safe
      Requirements: R3, R4.AC5
      Done when: lifecycle adversarial tests green.

## Milestone 3 — Reconcile through PluginManager (BundledV1Loader only)

- [ ] M3.1 Replace `managedPluginIds` with descriptor-keyed active instances
      Requirements: R2.AC2, R2.AC3
      Done when: same-ID version and digest changes reload; ID-only skip removed.

- [ ] M3.2 Implement reconcile (stop/replace/start) with generation abort
      Requirements: R2, R3
      Done when: workspace A cannot commit after switch to B; one failure does not block others.

- [ ] M3.3 Retry + quarantine + real admin runtime status API
      Requirements: R2.AC5, R9.AC1
      Done when: status shows preparing/active/failed/quarantined with last error.

- [ ] M3.4 Wire `pluginRuntimeV2Enabled` (+ optional workspace canaries)
      Requirements: R2.AC6, R9.AC2
      Done when: flag false restores prior loader behavior.

## Milestone 4 — ContributionRegistry + surface adapters

- [ ] M4.1 Implement ContributionRegistry kernel (batch, conflict, inspect, subscribe)
      Requirements: R4.AC1
      Done when: kernel unit tests cover ownership and batching.

- [ ] M4.2 Migrate simple action registries with legacy ordering profiles
      Requirements: R4.AC2–R4.AC4
      Done when: message/header/footer/composer/history/project/editor-toolbar golden tests pass.

- [ ] M4.3 Migrate pane, sidebar, dashboard, editor extensions, admin; tools via adapter
      Requirements: R4.AC4
      Done when: public imports unchanged; HMR + 1k enable/disable leak test passes.

- [ ] M4.4 Independent per-surface rollback documented
      Requirements: R9.AC2
      Done when: each adapter PR lists revert steps.

## Milestone 5 — Hook Engine V2 behind facade

- [ ] M5.1 Definitions + auto-legacy policy for unknown hooks; owner records; plan cache + LRU
      Requirements: R5.AC1, R5.AC2, R5.AC4
      Done when: V1 hook contract tests pass; exact dispatch ≤ baseline noise margin.

- [ ] M5.2 Bounded diagnostics snapshot/reset; inspector migration; no dual execution
      Requirements: R5.AC3, R5.AC5, R9.AC4
      Done when: long-session memory bounded; inspector uses snapshots.

- [ ] M5.3 `hookEngineV2Enabled` rollback
      Requirements: R5.AC1, R9.AC2
      Done when: flag restores prior core behind same facade.

## Milestone 6 — Manifest V2 + stable SDK

- [ ] M6.1 Additive manifest parsing (`manifestVersion` default 1); engines/integrity/grants/deps fields
      Requirements: R6.AC1–R6.AC3
      Done when: V1 packages install unchanged; bad V2 rejected pre-activation.

- [ ] M6.2 Publish `@or3/plugin-sdk` + conformance (no `~/` / `#imports` in V2 packages)
      Requirements: R6.AC4, R6.AC5
      Done when: sample V2 package builds against SDK only.

- [ ] M6.3 Persist reviewed grants separately from access policy
      Requirements: R6.AC3
      Done when: grant deny is structured and tested on mediated APIs.

## Milestone 7 — Post-build modules + immutable store

- [ ] M7.1 Content-addressed `.store` + `active.json` + per-plugin locks
      Requirements: R7.AC4, R7.AC5
      Done when: concurrent install/uninstall same ID is safe.

- [ ] M7.2 ModuleV2Loader (client) + TrustedServerV2Loader (digest URLs/paths)
      Requirements: R7.AC2, R7.AC3
      Done when: prod-build install→enable→load without Nuxt rebuild; server update without process restart.

- [ ] M7.3 Rollback to previous digest; `pluginModuleLoaderV2Enabled` flag
      Requirements: R7.AC4, R9.AC2
      Done when: one-click/admin rollback restores prior digest.

## Milestone 8 — Isolation

- [ ] M8.1 Isolated client loader (iframe/Worker + grant RPC)
      Requirements: R8.AC1, R8.AC2, R8.AC4
      Done when: adversarial DOM/global/network tests deny outside RPC.

- [ ] M8.2 Isolated server loader (process/isolate + budgets)
      Requirements: R8.AC3
      Done when: fs/env/network deny-by-default tests pass.

- [ ] M8.3 `pluginIsolationEnabled` rollback leaves trusted-host available
      Requirements: R8.AC5
      Done when: flag matrix documented and tested.

## Milestone 9 — Tooling and deprecation policy

- [ ] M9.1 Warnings/codemods for app-internal imports; migration guide
      Requirements: R1, R6
      Done when: docs + docmap updated; V1 supported for full V2 line.

- [ ] M9.2 CLI: create/dev/validate/test/build/pack/inspect (sign later)
      Requirements: R6, R9
      Done when: documented next-step commands work on sample plugin.

- [ ] M9.3 Safe mode + signing/revocation hooks (marketplace prep, not marketplace)
      Requirements: R8, R9
      Done when: safe-mode disables non-core before startup; signing interface stubbed.

## Suggested PR sequence

1. `test(plugin-runtime): freeze v1 contracts and add production fixtures`
2. `feat(plugin-runtime): add descriptor and state-machine contracts`
3. `feat(plugin-runtime): add shadow manager status`
4. `feat(plugin-runtime): add scoped registrations and awaited cleanup`
5. `refactor(plugin-runtime): reconcile workspace plugins through manager`
6. `feat(registry): add contribution registry kernel`
7. `refactor(registry): migrate simple action registries`
8. `refactor(registry): migrate pane, sidebar, dashboard, editor, and admin surfaces`
9. `feat(hooks): add v2 runtime behind legacy facade`
10. `feat(plugin-manifest): add manifest v2 and compatibility checks`
11. `feat(plugin-sdk): publish stable sdk and conformance harness`
12. `feat(plugin-packages): add content-addressed store and module loader`
13. `feat(plugin-security): add grants and isolated client runtime`
14. `feat(plugin-security): add isolated server runtime`
15. `feat(plugin-devtools): add health, traces, rollback, and safe mode`

## Traceability Matrix

| Requirement | Design component | Tasks |
|---|---|---|
| R1 Compatibility | Adapters, BundledV1Loader, legacy policy | 0.x, M0, M2.2, M4, M5 |
| R2 PluginManager | Descriptor, status, reconcile | M1, M3 |
| R3 PluginScope | Scope + cleanup + mutex | M2, M3 |
| R4 ContributionRegistry | Kernel + adapters | M4 |
| R5 Hook Engine V2 | Facade + plans + diagnostics | M5 |
| R6 Manifest/SDK/grants | Manifest V2 + SDK | M6 |
| R7 Loaders/store | Module loaders + `.store` | M7 (builds on 0.1) |
| R8 Isolation | Isolated loaders | M8 |
| R9 Operability/tests | Flags, admin, CI, benchmarks | M0, M1.3, M3.3–3.4, M9 |

## Definition of Done

- V1 plugins/hooks work unchanged under default flags.
- Every managed plugin has observable status + generation + descriptor key.
- Managed contributions/callbacks have exact owners; V2 setup is transactional; cleanup is awaited.
- Updates key on digest (and policy/grants), not ID alone.
- V2 packages can install/load post-build; server updates reload by digest; rollback works.
- Diagnostics bounded and owner-attributed; grants host-bound; isolation optional and real.
- CI covers compatibility, lifecycle, performance, and security suites for shipped milestones.
- First shipped slice is lifecycle ownership—not hook rewrite first.
