# Tasks

## 1. Compatibility boundaries and typed contracts

- [ ] 1.1 Snapshot the current V1 installer response, runtime-manifest V1 entry, and bundled-manager behavior in focused contract tests.
      Requirements: R1.AC1, R1.AC2, R1.AC3, R1.AC5, R3.AC3
      Done when: tests prove an omitted/`1` manifest takes the existing installer, a legacy-directory V2 artifact is reported as re-install-required without mutation, and a V1-only workspace constructs no V2 loader or manager.

- [ ] 1.2 Extend `shared/plugins/runtime-manifest.ts` with the additive V1/V2 ready union and closed V2 blocked-code state.
      Requirements: R3.AC1, R3.AC2, R3.AC3
      Done when: TypeScript prevents a V2 descriptor from appearing in a V1-only entry and tests serialize every blocked code without package paths.

- [ ] 1.3 Add `pluginModuleLoaderV2WorkspaceIds` / `OR3_PLUGIN_MODULE_LOADER_V2_WORKSPACE_IDS` and the immutable startup policy selector for V2 package activation, composed from SSR mode, module-loader flag, and that dedicated workspace allowlist.
      Requirements: R5.AC1, R5.AC2, R5.AC3
      Done when: unit tests prove flag-off, static mode, and out-of-canary workspaces reject V2 before import; `pluginRuntimeV2WorkspaceIds` remains behaviorally unchanged; and a process-start snapshot ignores later mutations.

## 2. V2 archive intake and package operations

- [ ] 2.1 Extract the minimum shared safe ZIP-inspection/staging seam needed for the current extension installer and V2 candidate intake; preserve legacy extraction limits and validation behavior.
      Requirements: R1.AC1, R2.AC1, R2.AC3
      Done when: unsafe paths, size limits, nested archive prefix handling, and legacy installs retain their existing tests, while a valid V2 archive can be staged without writing to `extensions/plugins`.

- [ ] 2.2 Dispatch `POST /api/admin/extensions/install` by exact manifest version: retain its current V1 branch and call V2 candidate preparation for `manifestVersion: 2`.
      Requirements: R1.AC1, R2.AC1, R2.AC2, R2.AC3
      Done when: a V1 response is unchanged, a V2 response returns candidate digest/status, and a V2 candidate failure leaves legacy inventory and selected pointer unchanged.

- [ ] 2.3 Add the legacy-ID conflict check before V2 candidate preparation.
      Requirements: R1.AC4, R2.AC3
      Done when: a candidate whose ID exists in legacy plugin inventory returns `plugin-id-conflicts-with-legacy-extension` and no package pointer is created.

- [ ] 2.4 Compose owner-only server handlers for candidate status/canary, promotion, rollback, disable, and explicit package deletion using the existing package services.
      Requirements: R2.AC2, R2.AC4, R2.AC5, R5.AC4
      Done when: handlers enforce admin authorization, promotion retains `previous`, disable retains digest/state, and deletion is the only operation that removes package data.

- [ ] 2.5 Add integration tests for prepare → canary/review → promote → rollback and prepare failure cases with a temporary immutable package root.
      Requirements: R2.AC1, R2.AC2, R2.AC3, R2.AC4, R2.AC5
      Done when: tests verify pointer compare-and-swap behavior and prove a malformed/incompatible candidate cannot replace a selected digest.

## 3. Server-authoritative V2 selection

- [ ] 3.1 Implement `SelectedPluginDescriptorResolver` to combine unchanged legacy inventory with selected V2 package pointers into the union runtime manifest.
      Requirements: R1.AC2, R1.AC5, R3.AC1, R3.AC2, R3.AC3
      Done when: V1 entries retain byte-for-byte-compatible descriptor fields, a legacy-directory V2 artifact is not coerced to V1, ready V2 entries contain verified package identity, and blocked V2 entries contain a stable code.

- [ ] 3.2 Resolve V2 reviewed grants, policy, dependency keys, trust mode, workspace enablement, and host mode before producing a ready descriptor.
      Requirements: R3.AC1, R3.AC2, R4.AC4
      Done when: each failed gate produces a blocked entry and no V2 client import can occur for it.

- [ ] 3.3 Include all selected V2 identity and authorization inputs in runtime-manifest revision generation.
      Requirements: R3.AC4
      Done when: tests show the revision changes for digest, workspace enablement, policy, grants, and dependency-resolution changes.

- [ ] 3.4 Require V2 package workspace enablement in the selected package route dispatcher before resolving a server handler.
      Requirements: R3.AC2, R5.AC2
      Done when: an authorized user in an enabled workspace can reach a promoted V2 fixture route and the same user in a disabled workspace receives no executable handler.

## 4. Transactional workspace activation

- [ ] 4.1 Implement `PackageV2WorkspaceManager` using existing lifecycle coordinator primitives without modifying `BundledV1PluginManager`.
      Requirements: R1.AC2, R4.AC2, R4.AC3
      Done when: focused manager tests cover desired-state diff, per-plugin serialization, workspace stop, generation supersession, and healthy-plugin isolation.

- [ ] 4.2 Implement the V2 loader adapter: descriptor identity verification, `ModuleV2Loader` import, SDK definition validation, and host-created context construction.
      Requirements: R4.AC1, R4.AC4, R4.AC5
      Done when: it calls only a matching `setup(context)`, fails before setup for invalid/stale/unapproved descriptors, and honors existing module-loader block results.

- [ ] 4.3 Bridge SDK hooks and contributions to `TransactionalPluginScope` and wire validation, pre-activation, publication, and LIFO cleanup.
      Requirements: R4.AC1, R4.AC2, R4.AC3
      Done when: a setup failure leaves no visible records; replacement publishes only the current generation; disable removes all records and invokes cleanup exactly once.

- [ ] 4.4 Replace the startup plugin-entry orchestration with `WorkspacePluginRuntimeCoordinator`, retaining the current V1 manager and adding the V2 manager as a sibling.
      Requirements: R1.AC2, R1.AC3, R3.AC1, R4.AC1, R4.AC3
      Done when: the coordinator routes each manifest descriptor by `manifestVersion`, starts no V2 manager for a V1-only manifest, and stops V2 safely on session change/HMR.

- [ ] 4.5 Add deterministic activation-fault tests for import, setup, validation, pre-activation, publication, stale generation, and cleanup errors.
      Requirements: R4.AC2, R4.AC3, R4.AC4, R6.AC4
      Done when: every fault preserves the prior active generation or leaves the plugin cleanly inactive, with no leaked registrations.

## 5. Operator visibility and rollout controls

- [ ] 5.1 Extend runtime records, server logs, and Runtime Inspector data with V2 digest, generation, trust, state, and stable block/failure codes.
      Requirements: R5.AC4
      Done when: all V2 lifecycle transitions are observable without logging grants, settings, source paths, or secrets.

- [ ] 5.2 Add explicit UI/API messaging for V2 package status: candidate, canary-required, promoted-but-disabled, blocked, active, degraded, and rolled back.
      Requirements: R2.AC2, R2.AC4, R5.AC4
      Done when: operators can distinguish successful package storage from workspace activation and can execute promotion/rollback without inferring state from flags.

- [ ] 5.3 Document startup-only rollout and rollback: enable the module loader only for a bounded `pluginModuleLoaderV2WorkspaceIds` canary; roll back by disabling the flag and restarting.
      Requirements: R5.AC1, R5.AC2, R5.AC3
      Done when: operator documentation states that `pluginRuntimeV2Enabled`/`pluginRuntimeV2WorkspaceIds` select the V1 manager, names `OR3_PLUGIN_MODULE_LOADER_V2_ENABLED` plus `OR3_PLUGIN_MODULE_LOADER_V2_WORKSPACE_IDS` as V2 package gates, and includes a no-data-deletion rollback drill.

## 6. Production qualification and phased enablement

- [ ] 6.1 Add an SSR production-build E2E fixture for the server-only V2 profile covering upload, candidate, review/canary, promotion, workspace enablement, authorized route call, update, rollback, disable, and residual-route denial.
      Requirements: R6.AC1, R6.AC4
      Done when: the test runs against a built server rather than mocked loader classes and all lifecycle assertions pass.

- [ ] 6.2 Add a simultaneous V1 production-build regression fixture.
      Requirements: R1.AC3, R6.AC2
      Done when: the V1 fixture uses the bundled loader through the same canary run and its route/disable behavior remains unchanged.

- [ ] 6.3 Run a real trusted-host UI facade qualification: prove ESM facade resolution, singleton Vue/SDK identity, authorized digest asset import, and CSP on the built Nuxt host.
      Requirements: R4.AC5, R6.AC3
      Done when: the proof suite is green and its result is recorded; otherwise client V2 descriptors remain blocked with `trusted-host-ui-abi-unproven`.

- [ ] 6.4 Perform an operational canary with the server-only profile, record activation/error/rollback outcomes, and review the evidence before enabling further workspaces.
      Requirements: R5.AC1, R5.AC2, R5.AC3, R6.AC1
      Done when: a bounded production workspace has completed a successful activation and a startup-flag rollback drill with no V1 regression.

## Traceability Matrix

| Requirement | Design component | Tasks |
|---|---|---|
| R1 | PluginArchiveIntake; WorkspacePluginRuntimeCoordinator | 1.1, 2.1, 2.2, 2.3, 3.1, 4.1, 4.4, 6.2 |
| R2 | PluginArchiveIntake; V2PackageOperations | 2.1–2.5, 5.2 |
| R3 | SelectedPluginDescriptorResolver; WorkspacePluginRuntimeCoordinator | 1.2, 3.1–3.4, 4.4 |
| R4 | PackageV2WorkspaceManager; Transactional SDK activation | 3.2, 4.1–4.5, 6.3 |
| R5 | V2RuntimeObservability; startup policy | 1.3, 2.4, 5.1–5.3, 6.4 |
| R6 | Production qualification | 4.5, 6.1–6.4 |

## Definition of Done

- All R1–R6 acceptance criteria pass with no traceability gaps.
- Focused unit/integration tests and the relevant `bun run plugin-runtime:*:check` gates are green.
- The production SSR E2E suite proves V1 continuity and the server-only V2 install-to-disable lifecycle.
- Trusted-host V2 UI stays blocked until its separate production facade/CSP qualification passes.
- A bounded operational canary and startup-flag rollback drill are recorded before any default is changed.
