---
artifact_id: a1f8c2e4-9b3d-4e71-8c05-6d2a91f0b847
title: requirements.md
status: draft
owner: or3-chat
date: 2026-07-19
supersedes: planning/hook-system-v2
---

# Requirements

## Introduction

**Plugin Runtime V2** replaces the internal plugin/hook kernel while preserving the V1 public contract. It is opt-in and additive: existing plugins, hook names, imports, manifests, and registry functions continue to work. The real upgrade is ownership and lifecycle (PluginManager + PluginScope), not a bulk rewrite of Hook Engine or plugin call sites.

This plan merges the earlier `planning/hook-system-v2` executable requirements with the stronger strangler / compatibility architecture proposal (descriptor keys, transactional scopes, content-addressed packages, legacy policy defaults, and lifecycle-first sequencing).

## Context

OR3 Chat (`or3-cloud`) already landed V1 P0 repairs that V2 must treat as foundations, not reimplement:

- Exact-owner `RegistrationHandle` on shared registry paths
- Sync thenable rejection; async-correct `onceAction`
- Inventory preserves `runtime`; uninstall ID/path safety; staged install + backup restore
- Deny-only fail-closed auth constraints; mutating routes need `workspace.write`
- Workspace loader generation checks; runtime-manifest `loadAllowed`

Remaining gaps: no central runtime owner; ID-only reconciliation; unawaited cleanup; non-transactional register; build-time-only client load; stale server ESM identity; partial registry consolidation; unsorted-every-call hook dispatch; unbounded diagnostics; grants ≠ sandbox; thin manifests; plugins importing host internals.

## Assumptions

- Bun + vitest remain the test entrypoint.
- Static builds stay valid; SSR plugin runtime stays gated.
- V2 is a strangler: compatibility adapters wrap the new kernel.
- Trusted in-process plugins remain first-class; isolation is a later trust class.
- No flag day and no dual-execution of hook callbacks in production.
- Wire schema for sync/storage stays out of scope.

## Out of Scope (first V2 release)

- Removing any V1 API or rewriting all built-in Nuxt plugins
- Changing default hook ordering / error-continuation semantics
- Converting every plugin to isolated execution
- Claiming in-process grants are a sandbox
- Public marketplace before package identity, signing, compatibility, and rollback exist
- Migrating every extension surface in one PR
- Executing V1 and V2 hook callbacks twice for comparison

## Requirements

### R1: Compatibility contract (strangler)

**User Story:** As a plugin author, I want my existing plugins and imports to keep working, so I am not forced onto a flag-day rewrite.

**Acceptance Criteria:**
- R1.AC1: WHEN a V1 plugin uses `useHooks()`, `createHookEngine()`, registry register helpers, or `Or3WorkspacePlugin.register(api)` THEN it SHALL compile and run without source changes.
- R1.AC2: WHEN a hook has no explicit V2 definition THEN it SHALL receive legacy policy (`actionMode: series`, `errorPolicy: continue`, sync thenables reject-and-continue, no timeout).
- R1.AC3: WHEN a manifest omits `manifestVersion` THEN the host SHALL parse it as V1 and load via `BundledV1Loader` / existing paths.
- R1.AC4: WHEN `import.meta.glob` entries exist THEN `BundledV1Loader` SHALL remain available after ModuleV2Loader ships.
- R1.AC5: ID-based unregister helpers SHALL remain callable; V2 internals SHALL use exact-owner handles only.
- R1.AC6: Extension-over-builtin same-ID precedence SHALL remain the default compatibility policy.

### R2: PluginManager + descriptor identity

**User Story:** As a platform engineer, I want every plugin instance keyed by more than ID, so version/digest/policy changes reload correctly and status is real.

**Acceptance Criteria:**
- R2.AC1: The manager SHALL reconcile immutable `PluginDescriptor` records (id, version, packageDigest, source, workspaceId, policy/grants revisions, api version, entries).
- R2.AC2: Instance keys SHALL include digest and policy/grants revisions, not ID alone.
- R2.AC3: Runtime status SHALL be one of `discovered|verified|blocked|preparing|active|stopping|failed|quarantined` and SHALL be readable by admin/devtools without guessing from enabled IDs.
- R2.AC4: Host-created `PluginContext` SHALL bind identity, grants, AbortSignal, logger, storage, scoped hooks, and contribute APIs; plugins SHALL NOT supply privileged identity.
- R2.AC5: Repeated failures SHALL quarantine; structured retry and manual retry SHALL be supported per policy.
- R2.AC6: Feature flag `pluginRuntimeV2Enabled=false` SHALL restore the pre-manager workspace loader.

### R3: Transactional PluginScope

**User Story:** As a runtime owner, I want each plugin generation to stage, commit, activate, and dispose atomically, so partial registration and overlapping generations cannot leak.

**Acceptance Criteria:**
- R3.AC1: A `PluginScope` SHALL own one generation and support `commit`, `activate`, `rollback`, and awaited `dispose`.
- R3.AC2: V2 activation SHALL be: create scope → setup against staged APIs → validate → atomic commit → activate callbacks → mark active.
- R3.AC3: IF any activation step fails THEN the scope SHALL abort, remove committed contributions by exact owner, run reverse-order cleanup, and keep the previous active generation when two-phase prepare is available.
- R3.AC4: Cleanup SHALL be LIFO, awaited, optionally timed out; one cleanup failure SHALL NOT skip remaining cleanups.
- R3.AC5: Legacy `register(api)` plugins SHALL run through a compatibility adapter that creates a scope; direct legacy global register calls MAY be classified `legacy-global` without full transactional guarantee.
- R3.AC6: V1 replacement SHALL await old disposal before loading the new generation (conservative path).

### R4: Unified ContributionRegistry

**User Story:** As a maintainer, I want one contribution kernel with surface adapters, so ownership and batching are consistent without silent ordering changes.

**Acceptance Criteria:**
- R4.AC1: `ContributionRegistry` SHALL provide exact ownership, sequence, conflict policy, batch commit, snapshots, inspect, and subscribe.
- R4.AC2: Surface adapters SHALL preserve each surface’s current ordering/tie-break profile via an explicit compatibility profile.
- R4.AC3: Public register/unregister import paths and signatures SHALL remain; return types MAY add handles without breaking ignored returns.
- R4.AC4: Migration SHALL proceed simple→complex (message/header/footer/composer/history/project/editor toolbar → sidebar → panes → sidebar pages → dashboard → editor extensions → admin → tools adapter).
- R4.AC5: Stale owner dispose SHALL NOT remove a newer generation’s contributions.

### R5: Hook Engine V2 behind facade

**User Story:** As a core maintainer, I want a faster, owner-aware hook runtime behind existing APIs, without changing default semantics.

**Acceptance Criteria:**
- R5.AC1: Public `useHooks()` / `HookEngine` methods SHALL remain; internals MAY switch via `hookEngineV2Enabled`.
- R5.AC2: Dispatch plans SHALL be cached and invalidated on registration changes; wildcards SHALL use generation counters; cache SHALL be LRU-bounded.
- R5.AC3: Diagnostics SHALL be bounded ring buffers with immutable `snapshot()` / `reset()`; no raw mutable timing arrays in the public path.
- R5.AC4: New definitions MAY opt into parallel actions or non-continue error policies; unknown V1 hooks SHALL get legacy definitions automatically.
- R5.AC5: Production SHALL NOT dual-execute callbacks on V1 and V2 engines.
- R5.AC6: Auth SHALL remain on the specialized fail-closed constraint engine (not general filter continue).

### R6: Manifest V2, SDK, grants vs access

**User Story:** As a plugin author, I want a stable SDK and additive manifest, so packages declare compatibility and requested grants without importing app internals.

**Acceptance Criteria:**
- R6.AC1: `manifestVersion: 2` SHALL be additive; V1 manifests remain valid.
- R6.AC2: V2 manifests MAY declare engines, integrity digest, requestedGrants, dependencies, settings schema, and isolation mode.
- R6.AC3: Existing `access` policy SHALL continue to gate who may load/use the plugin; `requestedGrants` SHALL gate which host APIs the plugin may call; these MUST NOT be merged into one field.
- R6.AC4: `@or3/plugin-sdk` (or equivalent) SHALL expose define helpers, context, contribution/hook types, grants, and test harness without requiring `~/` or `#imports`.
- R6.AC5: Incompatible host/API ranges SHALL be rejected before activation with clear reasons.

### R7: Loaders + content-addressed packages

**User Story:** As an operator, I want post-build install of precompiled packages and correct module reload, so updates do not require Nuxt rebuild or stale ESM cache.

**Acceptance Criteria:**
- R7.AC1: `BundledV1Loader` SHALL preserve rebuild-required source plugins.
- R7.AC2: `ModuleV2Loader` SHALL load same-origin content-addressed client ESM without Nuxt rebuild when flagged on.
- R7.AC3: Trusted server V2 modules SHALL import from digest-keyed store paths so updates get new module identity.
- R7.AC4: Package store SHALL keep immutable digests under `extensions/.store/` with `active.json` pointers, per-plugin locks, and rollback.
- R7.AC5: Install/update/rollback/uninstall for the same ID SHALL be serialized by lock.

### R8: Isolation (later milestone)

**User Story:** As a security reviewer, I want explicit trust classes and a real isolation option for untrusted plugins.

**Acceptance Criteria:**
- R8.AC1: Trust classes SHALL be `trusted-host`, `isolated-client`, and `isolated-server`.
- R8.AC2: Isolated client plugins SHALL only reach host services via grant-checked RPC (iframe/Worker).
- R8.AC3: Isolated server plugins SHALL run outside the host Node process with resource limits and deny-by-default network/fs.
- R8.AC4: UI/docs SHALL NOT describe in-process grants as a sandbox.
- R8.AC5: `pluginIsolationEnabled=false` SHALL leave trusted-host plugins available.

### R9: Operability, flags, tests, performance

**User Story:** As an operator, I want real status, safe flags, and CI gates so V2 can ship incrementally.

**Acceptance Criteria:**
- R9.AC1: Admin runtime view SHALL show descriptor fields, desired vs actual status, errors, retry, contribution/hook counts, digests, and rollback/safe-mode controls.
- R9.AC2: Flags SHALL include at least `pluginRuntimeV2Enabled`, optional workspace canaries, `pluginModuleLoaderV2Enabled`, `hookEngineV2Enabled`, `pluginIsolationEnabled`, and safe-mode disable-non-core.
- R9.AC3: CI SHALL cover compatibility, lifecycle, ownership, hooks, packages/routes, and (when built) isolation cases from the design test matrix.
- R9.AC4: Performance suites SHALL baseline exact/wildcard dispatch, registry batching, reconcile of ~100 plugins, and bounded diagnostics memory; V1 public paths SHALL not regress materially.
- R9.AC5: First implementation slice SHALL be lifecycle ownership (descriptors, shadow manager, PluginScope, awaited cleanup, descriptor reconcile with BundledV1Loader, real status)—not Hook Engine V2 first.
