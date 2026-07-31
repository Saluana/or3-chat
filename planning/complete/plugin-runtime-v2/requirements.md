# Requirements

## Introduction

Plugin Runtime V2 replaces OR3's internal plugin and hook machinery without requiring existing plugins to change. The migration is additive and compatibility-led: V1 Nuxt plugins, workspace packages, manifests, hook APIs, auto-imports, registries, tools, and static builds remain supported while new V2 packages gain explicit lifecycle ownership, atomic publication, stable SDK contracts, digest-based loading, and optional isolation.

The first implementation slice remains lifecycle ownership around the existing bundled loader. Full transactional activation applies only where the host controls all registrations; the plan does not claim atomicity for arbitrary V1 code that imports host globals or performs unmanaged side effects.

## Context

OR3 Chat is a Nuxt 4 application run with Bun. The client hook singleton is created in `app/plugins/00-hooks.client.ts`, SSR hooks are request-local, and both use `shared/hooks/hook-engine-core.ts`. Workspace plugins load through `app/plugins/workspace-plugins.client.ts` and currently reconcile by ID from a server-authoritative runtime manifest. Registries are heterogeneous: the shared `createRegistry` path shallow-freezes values and sorts by `order` then ID, while sidebar pages, panes, dashboard pages, editor extensions, admin pages, and tools each have distinct validation, ordering, caching, HMR, persistence, and return-value behavior. Existing P0 protections—exact-owner handles on several registries, stale workspace generation checks, fail-closed auth constraints, route permission defaults, install staging, and uninstall path checks—are foundations for this work.

## Assumptions

- Bun and Vitest remain the supported development and CI entrypoints.
- V1 support lasts for the full V2 release line; removal requires a V3 proposal.
- Existing third-party plugin source may use documented auto-imports or app-private `~/` imports, even when no copy of that plugin is present in this repository.
- Trusted in-process plugins remain supported. A grant attached to trusted code is an audit and mediation mechanism, not a sandbox.
- Static output remains functional and does not require an SSR plugin asset service.
- The authoritative sync/storage wire schema and core Dexie data model are unchanged by the lifecycle-first release.
- Feature-flag selection occurs before plugin activation and requires reload/restart to change kernels safely.

## Out of Scope

- Removing or silently rewriting any V1 public API, import path, Nuxt auto-import, manifest field, hook name, or hook payload.
- Making arbitrary V1 global side effects transactional or perfectly unloadable.
- Changing registry ordering, duplicate-ID policy, normalization, validation, persistence, or UI cache behavior while moving a surface.
- Loading source-only Vite plugins after a production build without rebuilding the host.
- Treating trusted in-process grants as a security boundary.
- A public marketplace, publisher CA, billing, or automated trust decisions before package identity and rollback are proven.
- Migrating core Dexie/sync schemas or deleting plugin-owned data during disable/uninstall.
- Executing the same production hook callback through V1 and V2 for comparison.

## Requirements

### R1: Frozen V1 compatibility contract

**User Story:** As an existing plugin author, I want the V2 rollout to preserve both documented and observable V1 behavior, so my plugin keeps compiling and running without changes.

**Acceptance Criteria:**
- R1.AC1: WHEN a V1 plugin uses any currently documented plugin, hook, registry, tool, or `Or3WorkspacePlugin.register(api)` import THEN the host SHALL preserve its module path, Nuxt auto-import name, TypeScript parameters, overloads, return type, and runtime availability.
- R1.AC2: WHEN an existing public registration function currently returns `void`, a disposer, a `RegistrationHandle`, or a `RegisteredTool` THEN its V1 facade SHALL retain that exact declared return shape; new scoped handles SHALL be exposed through additive internal/SDK APIs.
- R1.AC3: WHEN a V1 hook executes THEN exact and wildcard callbacks SHALL remain serial, lower priority SHALL run first, equal priority SHALL retain registration order, callback errors SHALL be recorded and continued, and a failing filter SHALL preserve the prior value.
- R1.AC4: WHEN a sync V1 callback returns a thenable THEN a filter SHALL preserve its prior value, an action SHALL continue, and the host SHALL record the error without awaiting the thenable.
- R1.AC5: WHEN a registry surface is migrated THEN duplicate-ID behavior, default order, tie-breaking, validation errors, shallow freezing/`markRaw`, component wrapping, cache invalidation, reactive publication, access filtering, SSR behavior, HMR persistence, and stored preferences SHALL match that surface's frozen compatibility profile.
- R1.AC6: WHEN a V1 manifest omits `manifestVersion` THEN it SHALL parse as V1 with the same defaults, normalization, unknown-key handling, and rebuild-required loader behavior used before V2.
- R1.AC7: WHEN V1 code reads or resets `hooks._diagnostics.timings`, `hooks._diagnostics.errors`, or `callbacks()` THEN a bounded compatibility facade SHALL preserve the existing shape and reset behavior for the full V2 line.
- R1.AC8: WHEN a static build is generated THEN built-in Nuxt plugins and bundled V1 extension points SHALL behave as before, and no server-only V2 loader or SDK module SHALL enter the static client graph.
- R1.AC9: WHEN an extension and built-in workspace plugin share an ID THEN extension-over-builtin precedence SHALL remain the V1 default.
- R1.AC10: V2-controlled behavior SHALL NOT become the default for V1 plugins until the repository examples and the maintained external compatibility corpus pass compile, runtime, SSR, static-build, production-build, HMR, and rollback gates unchanged.

### R2: Descriptor identity and runtime ownership

**User Story:** As a platform engineer, I want the runtime to reconcile the actual artifact and policy inputs, so updates, revocations, and workspace changes cannot be mistaken for an already-loaded ID.

**Acceptance Criteria:**
- R2.AC1: The descriptor model SHALL use a discriminated artifact identity: bundled V1 artifacts SHALL identify their host build and module key, while V2 package artifacts SHALL identify a host-computed SHA-256 digest and validated entrypoints.
- R2.AC2: WHEN the host constructs an instance key THEN it SHALL hash a canonical descriptor identity containing artifact identity, workspace, access-policy revision, grants revision, API version, trust mode, entrypoints, and resolved dependency keys; it SHALL NOT concatenate ambiguous delimiter-separated strings.
- R2.AC3: WHEN version metadata changes without a new bundled host build THEN `BundledV1Loader` SHALL continue to report rebuild-required behavior and SHALL NOT claim that runtime disk bytes were hot reloaded.
- R2.AC4: Runtime state SHALL expose desired state, actual state, descriptor key, generation, lifecycle coverage, timestamps, loader, contribution/hook counts, and structured failure/retry data without inferring activity from enabled IDs.
- R2.AC5: Host-created plugin context SHALL bind plugin identity, workspace, generation, grants, logger, storage, settings, HTTP, hooks, contributions, and `AbortSignal`; plugin-supplied IDs SHALL NOT authorize privileged operations.
- R2.AC6: Client workspace activation SHALL be managed separately from server route module caching; server handlers MAY be cached by package digest but SHALL receive request-scoped identity, workspace, authorization, and grants.
- R2.AC7: WHEN workspace, session, access decision, enablement, package pointer, policy revision, or grants revision changes THEN the manager SHALL schedule one serialized reconcile and supersede any older generation.
- R2.AC8: WHEN repeated activation failures reach the configured in-session threshold THEN the manager SHALL quarantine that descriptor key, SHALL leave unrelated plugins eligible to activate, and SHALL support explicit retry.

### R3: Compatibility-aware lifecycle and cleanup

**User Story:** As a runtime owner, I want deterministic stopping and generation safety without changing V1 registration-time behavior.

**Acceptance Criteria:**
- R3.AC1: A managed generation SHALL own its host-mediated registrations, activation callbacks, abort controller, and cleanup callbacks through an idempotent scope.
- R3.AC2: WHEN a V2 SDK plugin prepares THEN contributions and hook callbacks SHALL remain hidden until validation and pre-activation complete.
- R3.AC3: WHEN V2 preparation or pre-activation fails THEN the previous generation SHALL remain visible, the failed generation SHALL publish zero callbacks/contributions, and its cleanup SHALL run.
- R3.AC4: WHEN a V2 generation stops THEN cleanup SHALL run sequentially in reverse registration order, SHALL be awaited, and one cleanup failure SHALL NOT skip later cleanup.
- R3.AC5: WHEN a V1 `register(api)` plugin activates THEN passed-API registrations SHALL retain immediate visibility; setup failure SHALL remove host-mediated registrations but SHALL NOT be described as atomic.
- R3.AC6: WHEN a V1 generation stops THEN cleanup callbacks SHALL be invoked in existing FIFO order, all returned thenables SHALL be collected without changing invocation concurrency, and replacement SHALL wait for settlement up to a bounded compatibility timeout.
- R3.AC7: IF a V1 plugin imports global registries/hooks directly or starts unmanaged timers/listeners THEN the runtime SHALL classify lifecycle coverage as `legacy-global-possible`, SHALL preserve the plugin's execution, and SHALL NOT claim complete cleanup or safe hot replacement.
- R3.AC8: WHEN generation changes during fetch, import, registration, validation, activation, or cleanup THEN every subsequent publish SHALL fail its generation check and stale exact-owner disposal SHALL NOT remove a newer generation.
- R3.AC9: IF cleanup exceeds its timeout THEN the runtime SHALL abort mediated resources, continue stopping remaining plugins, record a degraded stop, and require safe replacement/reload policy rather than waiting forever.

### R4: Atomic V2 publication and contribution registries

**User Story:** As a maintainer, I want one ownership kernel and an atomic V2 visibility boundary, so the UI never observes half of a V2 plugin generation.

**Acceptance Criteria:**
- R4.AC1: `ContributionRegistry` SHALL store exact owner, plugin ID, generation, registration sequence, lifecycle visibility, normalized value, and surface metadata for every managed record.
- R4.AC2: V2 records SHALL be staged as hidden and SHALL become visible across all migrated registries through one synchronous compare-and-swap of the plugin's active owner/generation.
- R4.AC3: IF V2 activation rolls back after publication THEN the visibility pointer SHALL return to the retained previous generation before failed records are removed.
- R4.AC4: Surface adapters SHALL preserve the frozen V1 profile and SHALL own surface-specific validation, normalization, cache behavior, access checks, and context evaluation.
- R4.AC5: Public V1 register/unregister functions SHALL remain ID-compatible, while manager and V2 SDK code SHALL clean up only by exact owner.
- R4.AC6: A stale handle, stale scope, or old generation SHALL NOT remove or shadow the current generation's record with the same contribution ID.
- R4.AC7: A multi-record V2 commit SHALL cause at most one observable reactive publication per affected surface and SHALL preserve existing consumer object/value shapes.
- R4.AC8: Tool migration SHALL preserve duplicate rejection/override behavior, JSON-schema validation, client/server runtime hints, execution limits, reactive refs, exact-owner replacement, and the `or3.tools.enabled` preference key.

### R5: Hook Engine V2 behind exact facades

**User Story:** As a core maintainer, I want cached, owner-aware hooks with bounded diagnostics while all V1 hook behavior remains intact.

**Acceptance Criteria:**
- R5.AC1: `useHooks()`, `createHookEngine()`, typed client hooks, typed admin hooks, `HookEngine`, global hook augmentation, sync variants, `has*`, `remove*`, `removeAllCallbacks`, `currentPriority`, `onceAction`, `on`, and `off` SHALL remain available with their V1 signatures.
- R5.AC2: Client hooks SHALL remain one HMR-persistent singleton, SSR hooks SHALL remain request-local, and specialized server/admin hook owners SHALL retain their current lifetime boundaries.
- R5.AC3: Unknown V1 hooks SHALL receive legacy serial/continue/no-timeout policy; only new explicit definitions MAY select parallel actions, timeout, aggregate, stop, rethrow, or fail-closed behavior.
- R5.AC4: Resolved dispatch plans SHALL be cached by exact and wildcard generations, invalidated on relevant registration changes, and bounded by a committed LRU limit.
- R5.AC5: New scoped hook registration SHALL attach owner and generation and SHALL participate in the same V2 activation visibility pointer as contributions.
- R5.AC6: New immutable diagnostics SHALL bound both samples per series and total metric-series cardinality, SHALL aggregate overflow without allocating unbounded keys, and SHALL provide `snapshot()` and `reset()` while the V1 `_diagnostics` facade remains compatible.
- R5.AC7: Production SHALL execute each callback through exactly one selected engine; shadow mode MAY compare registrations and plans but SHALL NOT call plugin callbacks.
- R5.AC8: Authorization SHALL remain on the deny-only fail-closed constraint engine and SHALL NOT inherit general legacy filter continuation.
- R5.AC9: `acceptedArgs`, exact/wildcard removal asymmetries, `has*` return values, nested `currentPriority`, and async `onceAction` behavior SHALL be captured in golden tests before the engine changes.

### R6: Additive manifest, SDK, access, and grants

**User Story:** As a plugin author, I want an explicit V2 package contract while my V1 manifest and private imports continue to work.

**Acceptance Criteria:**
- R6.AC1: Manifest parsing SHALL dispatch on `manifestVersion ?? 1`; the V1 parser SHALL remain compatible and the V2 parser SHALL validate V2-only fields before code import.
- R6.AC2: A V2 manifest SHALL declare host/API engine ranges, runtime entrypoints, requested grants, dependencies, trust/isolation mode, settings schema version, state-compatibility policy, and optional expected package integrity.
- R6.AC3: Existing `access` policy SHALL decide who may load/use a plugin; reviewed grants SHALL decide which mediated host APIs it may call; the host SHALL persist and revision these decisions separately.
- R6.AC4: `@or3/plugin-sdk` SHALL expose stable define helpers, context, contributions, hooks, grants, settings/storage clients, route contracts, feature negotiation, and a test harness without importing app-private aliases.
- R6.AC5: WHEN a V2 package requests an unsupported host/API range, dependency, feature, trust mode, or grant THEN verification SHALL block it before import with machine-readable reasons.
- R6.AC6: V1 bundled code SHALL remain allowed to use current `~/`, `~~/`, `#imports`, and Nuxt auto-import paths; V2 package conformance SHALL reject those private imports.
- R6.AC7: Route permissions SHALL continue to default GET/HEAD to `workspace.read` and mutating methods to `workspace.write`; a manifest override SHALL NOT weaken the method default.
- R6.AC8: WHEN V2 dependencies are resolved THEN required dependencies SHALL be present and compatible, cycles SHALL block all cycle members with a clear path, activation SHALL be topological, dependents SHALL stop before dependencies, and optional dependency absence SHALL be exposed through feature negotiation.

### R7: Correct loaders and crash-safe package storage

**User Story:** As an operator, I want post-build V2 installation and trustworthy rollback without changing V1 build-time loading.

**Acceptance Criteria:**
- R7.AC1: `BundledV1Loader` SHALL retain the existing `import.meta.glob` entry/fallback behavior and SHALL remain available for the full V2 line.
- R7.AC2: The host SHALL compute the canonical package-tree SHA-256 after safe extraction; it SHALL NOT trust a version string or a self-reported digest as artifact identity.
- R7.AC3: `ModuleV2Loader` SHALL import same-origin, digest-addressed ESM after build, and every relative import/asset SHALL resolve beneath the same immutable package root.
- R7.AC4: V2 client conformance SHALL reject unresolved bare imports other than explicit SDK externals, path traversal, symlinks, executable source requiring Vite transforms, and assets outside the package root.
- R7.AC5: The package store SHALL retain immutable versions, use a per-plugin atomic pointer with current/candidate/previous digest, and recover to a complete pointer after process crash.
- R7.AC6: Install, update, rollback, and uninstall for one plugin ID SHALL share an in-process mutex and multi-process advisory lock; operations for unrelated IDs MAY proceed independently.
- R7.AC7: Trusted server modules SHALL resolve by digest-keyed file URL, while each request SHALL still pass access gating and `can()` before handler execution.
- R7.AC8: WHEN a candidate package fails verification, state-compatibility preflight, server dry-run, or designated client canary preparation THEN the active pointer and prior running generation SHALL remain unchanged; after promotion, a client-specific activation failure SHALL retain its compatible previous local generation when possible and SHALL NOT be described as a fleet-wide atomic rollback.
- R7.AC9: WHEN static output has no runtime asset service THEN V2 runtime packages SHALL be reported as unsupported/rebuild-required and bundled/static behavior SHALL remain unchanged.
- R7.AC10: Disabling a plugin SHALL prevent future manager imports/dispatch and remove managed callbacks, but cached code bytes SHALL NOT be treated as an authorization boundary.
- R7.AC11: BEFORE arbitrary trusted-host V2 UI modules ship THEN a production-build ABI test SHALL prove that allowed host externals (including Vue and the SDK runtime) resolve to the host's compatible singleton module graph under CSP; the loader SHALL NOT silently bundle a second Vue runtime as fallback.

### R8: Explicit trust classes and optional isolation

**User Story:** As a security reviewer, I want real process/context boundaries for untrusted plugins, so grants cannot be bypassed by direct host access.

**Acceptance Criteria:**
- R8.AC1: Trust classes SHALL distinguish `trusted-host`, `isolated-client`, and `isolated-server` in descriptors, status, UI, and audit records.
- R8.AC2: Isolated client code SHALL run in a sandboxed iframe or Worker and SHALL reach the host only through schema-validated, grant-checked RPC.
- R8.AC3: Isolated server code SHALL run outside the host process with bounded CPU, wall time, memory, request/response size, filesystem, environment, and network access.
- R8.AC4: Documentation and UI SHALL NOT call trusted in-process grants a sandbox or imply that cached client code can be revoked after execution.
- R8.AC5: IF isolation is disabled THEN trusted-host V1/V2 plugins SHALL remain available and isolated plugins SHALL be blocked before import rather than silently downgraded.

### R9: Controlled rollout, observability, and qualification

**User Story:** As an operator, I want every migration seam gated and reversible, so a compatibility regression cannot take down all plugins.

**Acceptance Criteria:**
- R9.AC1: Startup flags SHALL independently select the manager, workspace canary set, migrated contribution surfaces, hook engine, module loader, isolation, and pre-discovery safe mode.
- R9.AC2: Safe mode SHALL disable non-core plugin discovery before any non-core plugin code executes and SHALL be controllable without first loading the plugin admin UI.
- R9.AC3: Runtime inspection SHALL label whether status is for this client, this server process, or persisted package state and SHALL show descriptor/artifact identity, desired versus actual state, generation, lifecycle coverage, access/grant revisions, errors, retry/quarantine, counts, current/candidate/previous digest, and rollback availability without implying fleet-wide observation.
- R9.AC4: Each milestone SHALL define entry evidence, automated exit gates, an operator-visible rollback procedure, and a rollback drill before its flag can be enabled outside the maintained compatibility corpus.
- R9.AC5: Manager shadow mode SHALL compare desired/observed state without controlling the V1 loader, and hook shadow mode SHALL compare metadata/plans without executing callbacks.
- R9.AC6: CI SHALL include API declaration snapshots, Nuxt auto-import snapshots, external plugin compile fixtures, differential V1/V2 behavior tests, SSR and static production builds, lifecycle fault injection, package crash recovery, and shipped isolation tests.
- R9.AC7: Hook and registry benchmark medians SHALL remain within committed per-suite budgets relative to Milestone 0, plan-cache and diagnostics capacities SHALL be hard-bounded, and disabled plugins SHALL leave zero managed callbacks/contributions.
- R9.AC8: V2 manager SHALL remain off by default until contract gates pass; later default-on promotion SHALL be a separate reviewed change with evidence and SHALL NOT simultaneously enable the hook engine or module loader.
- R9.AC9: Documentation and `docmap.json` SHALL be updated in the same milestone that changes a public surface, and V1 deprecations SHALL name an additive replacement and earliest V3 removal window.

### R10: Plugin state and rollback safety

**User Story:** As a plugin user, I want runtime upgrades, plugin updates, rollback, disable, and uninstall to preserve my data unless I explicitly authorize deletion.

**Acceptance Criteria:**
- R10.AC1: Enabling Plugin Runtime V2 SHALL NOT rewrite, migrate, delete, or re-key existing V1 KV, Dexie, localStorage, file, or provider-backed plugin data.
- R10.AC2: Disable and runtime rollback SHALL remove code-owned managed registrations but SHALL retain plugin settings and data.
- R10.AC3: V2 settings/storage migrations SHALL declare source version, target version, forward/backward compatibility, and downgrade support before an updated package can activate.
- R10.AC4: WHEN a V2 migration is required THEN the host SHALL run preflight before the active pointer changes and SHALL use an atomic transaction or restorable snapshot for host-managed plugin state.
- R10.AC5: IF the prior package cannot read migrated state THEN one-click code rollback SHALL be disabled or paired with a tested down-migration; the admin UI SHALL state this before update confirmation.
- R10.AC6: Uninstall SHALL be a separate explicit operation from disable, SHALL report retained package versions and data, and SHALL require a distinct user decision before deleting plugin-owned state.
