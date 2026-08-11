# Requirements

## Introduction

Make Plugin Runtime V2 packages installable and activatable in a production OR3 Chat workspace without changing the execution path or public contract of already-developed V1 plugins. The work must connect the existing V2 SDK, package store, promotion services, asset route, server resolver, and transactional scope into one explicitly selected runtime path. It must be introduced as an opt-in canary and preserve a startup rollback to the current V1 behavior.

## Context

OR3 Chat is a Nuxt/Bun TypeScript application with Vitest coverage. Its existing ZIP endpoint calls `installExtensionFromZip`, which writes all plugins into the legacy extension inventory; the workspace client constructs only `BundledV1Loader`/`BundledV1WorkspaceManager`, and the runtime-manifest endpoint emits only `BundledV1PluginDescriptor`s. Separately, the repository already has Manifest V2 parsing, `@or3/plugin-sdk`, an immutable package store with candidate/pointer/promotion/lifecycle services, digest asset serving, a server module resolver, and `TransactionalPluginScope`. The V2 module-loader and isolation feature flags are default-off, while the V1-compatible manager flag is already default-on.

## Assumptions

- Existing developed plugins are V1 plugins under the legacy extension inventory and must continue to install, enable, run, and unload exactly as they do today.
- A Manifest V2 package is a new artifact type: it is immutable and selected through a V2 pointer; it is not a modified legacy extension directory. Any V2 archive previously placed in that directory is a non-activated artifact and is re-uploaded through the V2 candidate path; it is never migrated or deleted implicitly.
- The first production release is SSR-only. Static generation continues to report V2 packages as unsupported rather than attempting partial activation.
- Existing V2 UI support remains gated until a real production Nuxt build proves the host ESM facade, SDK/Vue singleton identity, and CSP behavior. A server-only V2 package may be promoted first.
- The current package services are reusable; this plan does not add a database, queue, or a second package registry.

## Out of Scope

- Rewriting, recompiling, or automatically migrating V1 plugin source to the V2 SDK.
- Changing V1 manifest parsing, V1 loader behavior, V1 registry semantics, or private-import compatibility.
- Default-enabling ModuleV2Loader, isolation, Hook Runtime V2, or any contribution-surface adapter.
- Supporting V2 package activation in a static build.
- Silent fallback from an isolated V2 package to `trusted-host` execution.

## Requirements

### R1: Preserve the V1 compatibility lane

**User Story:** As an operator with existing plugins, I want my V1 plugins to continue using their current loader and lifecycle, so that V2 activation work cannot break deployed extensions.

**Acceptance Criteria:**
- R1.AC1: WHEN a ZIP has no `manifestVersion: 2` THEN the system SHALL call the existing legacy installation path and return the existing response shape.
- R1.AC2: WHEN a workspace has only V1 plugins enabled THEN the system SHALL construct only the existing bundled V1 loader/manager path and SHALL NOT import V2 package code.
- R1.AC3: WHEN all V2 feature flags are false THEN V1 install, enable, route dispatch, disable, and restart behavior SHALL match the baseline compatibility test suite.
- R1.AC4: IF a V1 extension and an active V2 package claim the same plugin ID THEN the system SHALL reject the V2 candidate before promotion with a stable conflict code; it SHALL NOT choose an artifact implicitly.
- R1.AC5: IF legacy inventory contains a Manifest V2 archive installed by the previous ZIP endpoint THEN the system SHALL report `legacy-v2-reinstall-required`, SHALL not execute it as V1, and SHALL not move or delete it automatically.

### R2: Route V2 archives to the immutable package workflow

**User Story:** As an operator, I want a valid V2 archive to become a reviewed candidate rather than a legacy directory, so that package identity, promotion, and rollback are enforceable.

**Acceptance Criteria:**
- R2.AC1: WHEN an owner uploads a valid Manifest V2 plugin archive while the existing ZIP installation feature is enabled THEN the system SHALL verify canonical package integrity and store it through `ImmutablePluginPackageStore`.
- R2.AC2: WHEN candidate validation succeeds THEN the system SHALL create an inactive candidate pointer and SHALL return its digest, candidate status, and required review/canary state without marking it workspace-enabled.
- R2.AC3: IF the archive has an invalid manifest, digest, engine range, reviewed grant, dependency, state-compatibility result, or ID conflict THEN the system SHALL not alter the selected package pointer or legacy extension inventory.
- R2.AC4: WHEN an operator promotes a candidate after its required canary/review succeeds THEN the system SHALL atomically select that digest and retain the previous digest for rollback.
- R2.AC5: WHEN an operator rolls back or disables a V2 package THEN the system SHALL retain package bytes and namespaced state unless an explicit delete action is requested.

### R3: Publish an unambiguous selected runtime descriptor

**User Story:** As a workspace runtime, I want one server-authoritative descriptor per enabled plugin, so that the client knows exactly whether to activate V1 or V2 code.

**Acceptance Criteria:**
- R3.AC1: WHEN an enabled plugin has a selected V2 package pointer and the V2 loader flag is enabled in an SSR host THEN the runtime manifest SHALL emit a verified `PackageV2PluginDescriptor` containing the selected digest, entrypoints, reviewed grants, trust mode, dependency keys, policy revision, and descriptor key.
- R3.AC2: WHEN a V2 package is not selected, is disabled, is blocked by policy/review/dependency checks, or the host is static or feature-disabled THEN the runtime manifest SHALL not advertise it as loadable and SHALL expose a machine-readable reason.
- R3.AC3: WHEN a V1 plugin is selected THEN the runtime manifest SHALL continue to emit the existing `BundledV1PluginDescriptor` contract unchanged.
- R3.AC4: WHEN the selected V2 digest, grants, policy, dependency resolution, or workspace enablement changes THEN the runtime-manifest revision SHALL change.

### R4: Activate V2 packages transactionally and cleanly

**User Story:** As a user in an enabled workspace, I want an approved V2 package to load only with its reviewed authority and disappear completely when replaced or disabled.

**Acceptance Criteria:**
- R4.AC1: WHEN a runtime manifest presents a ready V2 descriptor and startup flags permit its trust mode THEN the workspace client SHALL load its digest-addressed entry through `ModuleV2Loader`, construct a host-owned SDK context, and invoke only the validated V2 definition's `setup` method.
- R4.AC2: WHEN V2 setup, validation, pre-activation, import, or publication fails THEN the system SHALL dispose staged resources, retain the previous visible generation, and record an activation failure without affecting other plugins.
- R4.AC3: WHEN a V2 descriptor changes, becomes disabled, or the workspace changes THEN the system SHALL abort its generation, remove its published contributions/hooks, and run cleanup exactly once before making a successor generation visible.
- R4.AC4: IF a V2 module is stale, has an unapproved grant, requests an unsupported feature, or declares an unavailable trust mode THEN the system SHALL block it before setup and SHALL not downgrade it to another execution mode.
- R4.AC5: WHEN the V2 client trust mode is `trusted-host` THEN the system SHALL keep client activation blocked until the production ESM facade, singleton identity, and CSP proof gate passes.

### R5: Deliver a reversible, observable rollout

**User Story:** As an operator, I want to canary V2 packages and rapidly revert to the known V1 path, so that an activation defect has a bounded blast radius.

**Acceptance Criteria:**
- R5.AC1: WHEN `OR3_PLUGIN_MODULE_LOADER_V2_ENABLED=false` at process startup THEN the system SHALL not discover or activate V2 package client code, and bundled V1 plugins SHALL remain available.
- R5.AC2: WHEN a workspace is outside the dedicated V2 package canary allowlist THEN the system SHALL not activate V2 packages for that workspace.
- R5.AC3: WHEN the module-loader flag is turned off and the process restarts THEN all V2 package code SHALL be inactive without deleting pointers, packages, grants, settings, or state.
- R5.AC4: WHEN activation is attempted, blocked, succeeds, replaces a generation, disables, or rolls back THEN the Runtime Inspector and server logs SHALL report plugin ID, selected digest, generation, outcome, and stable block/failure code without exposing secrets.

### R6: Prove the production path before promotion

**User Story:** As a maintainer, I want automated evidence for the complete V2 path, so that passing unit tests cannot be mistaken for a production-ready feature.

**Acceptance Criteria:**
- R6.AC1: WHEN a production SSR build receives a signed-off server-only V2 fixture THEN an end-to-end test SHALL upload, candidate-check, promote, enable, dispatch an authorized route, update, roll back, disable, and verify no handler remains reachable.
- R6.AC2: WHEN a legacy V1 fixture follows the same workspace lifecycle during the V2 canary THEN the end-to-end test SHALL confirm it keeps its current bundled loader and route behavior.
- R6.AC3: WHEN trusted-host V2 UI activation is proposed THEN a production-build test SHALL prove one host SDK/Vue identity, authorized same-origin digest asset loading, and the configured CSP before that profile can be enabled.
- R6.AC4: WHEN a test injects an import, setup, publication, cleanup, or pointer failure THEN it SHALL verify the previous selected and visible generation is preserved or the plugin is cleanly inactive.
