# Tasks

Tasks are ordered by dependency. Each unchecked item is intended to fit in roughly one to four hours; a milestone may not be promoted until all of its gate tasks pass. Runtime flags are startup-only, and production callback dual-execution is prohibited.

## 0. Preserve landed V1 foundations

- [x] 0.1 Preserve runtime metadata, staged install/restore, 409 conflict behavior, uninstall ID/path/realpath checks, and inventory cache invalidation
      Requirements: R1.AC6, R7.AC1, R7.AC6
      Done when: existing extension-manager, install, limits, URL, and uninstall security suites remain green.

- [x] 0.2 Preserve exact-owner handles on the existing shared registry, dashboard, panes, tools, and server tools
      Requirements: R3.AC8, R4.AC5, R4.AC6, R4.AC8
      Done when: current ownership and stale-disposer tests remain green without loosening assertions.

- [x] 0.3 Preserve workspace generation checks, server-authoritative `loadAllowed`, deny-only auth constraints, sync-thenable rejection, async `onceAction`, and route read/write permission defaults
      Requirements: R1.AC3, R1.AC4, R2.AC7, R5.AC8, R6.AC7
      Done when: current workspace runtime, hook core, auth, runtime-manifest, and dispatcher tests remain green.

## 1. Milestone 0 — Freeze and qualify V1

- [x] 1.1 Create a machine-readable Compatibility Ledger listing every public plugin/hook module path, Nuxt auto-import, export, signature, overload, and declared return type
      Requirements: R1.AC1, R1.AC2, R5.AC1
      Done when: the ledger covers documented APIs plus exports found under plugin-facing composables/core/utils, and a reviewer can map every entry to its source file.

- [x] 1.2 Snapshot generated public declaration output and Nuxt auto-import declarations in CI
      Requirements: R1.AC1, R1.AC2, R9.AC6
      Done when: a fixture that removes an import or changes a `void`/disposer/handle/tool return causes the snapshot job to fail.

- [x] 1.3 Add unchanged compile fixtures for every plugin under `app/plugins/examples`
      Requirements: R1.AC1, R1.AC10, R9.AC6
      Done when: fixtures compile through the Nuxt project context with the same explicit/auto imports as the source examples.

- [x] 1.4 Add immutable compile fixtures derived from every maintained external V1 plugin available to the team
      Requirements: R1.AC10, R9.AC6
      Done when: the corpus has a version/source record, contains no credentials, and compiles without compatibility edits.

- [x] 1.5 Add golden hook tests for exact/wildcard merge order, equal priority, filter-error prior value, sync thenables, `acceptedArgs`, `has*`, exact/wildcard removal, nested priority, `off`, and async `onceAction`
      Requirements: R1.AC3, R1.AC4, R5.AC9
      Done when: each listed behavior has a V1 expected-value test independent of V2 code.

- [x] 1.6 Add a `_diagnostics` compatibility fixture covering reads, array bounds expectation, `{}` assignment reset, error counts, and `callbacks()`
      Requirements: R1.AC7, R5.AC6
      Done when: the current Hook Inspector usage and a plugin-style direct consumer both pass.

- [x] 1.7 Record shared `createRegistry` family profiles for duplicate replacement, freeze, default order, tie by ID, snapshots, reactive notifications, global persistence, and return shape
      Requirements: R1.AC5, R4.AC4, R4.AC7
      Done when: message/header/composer/footer/history/project/editor-toolbar profiles have golden tests and ledger entries.

- [x] 1.8 Record sidebar page and pane profiles for validation text, server no-op, defaulting, `markRaw`, async wrapping, retry/timeout, order-only ties, access filtering, and disposer/handle behavior
      Requirements: R1.AC5, R4.AC4
      Done when: profile tests distinguish these surfaces from the shared registry profile.

- [x] 1.9 Record dashboard plugin/page profile for inline replacement, shallow freeze, access merge, stable order ties, navigation state, component resolution, and cache invalidation
      Requirements: R1.AC5, R4.AC4
      Done when: existing dashboard tests are mapped into the ledger and missing cache/navigation cases are added.

- [ ] 1.10 Record editor extension and admin page/widget profiles for value identity, ordering, load failures, replace-in-place position, loaded-once behavior, and component cache bounds
      Requirements: R1.AC5, R4.AC4
      Done when: both profile families have explicit golden tests and return-type entries.

- [ ] 1.11 Record client/server tool profiles including duplicates, override, returned object/disposer, refs/watchers, runtime hints, schema parity, timeouts/limits, and `or3.tools.enabled`
      Requirements: R1.AC5, R4.AC8
      Done when: preference round-trip and replacement watcher cleanup are tested in addition to current tool suites.

- [ ] 1.12 Add production SSR-build and static-generate fixtures that load current built-ins and one bundled V1 workspace plugin
      Requirements: R1.AC8, R1.AC10, R7.AC1, R7.AC9
      Done when: `bun run build` and `bun run generate:static` verify plugin presence/absence at the intended boundaries.

- [ ] 1.13 Commit benchmark harnesses and initial budgets for hooks, registries, reconciliation, enable/disable cycles, and diagnostics memory
      Requirements: R5.AC4, R5.AC6, R9.AC7
      Done when: results are reproducible on the selected runner and budgets are stored outside implementation code.

- [ ] 1.14 Add a Milestone 0 qualification command and record the first green baseline artifact
      Requirements: R1.AC10, R9.AC4, R9.AC6, R9.AC7
      Done when: one Bun command runs declaration, corpus, behavior, build, and benchmark gates and publishes a versioned result.

## 2. Milestone 1 — Descriptor contracts and shadow ownership

- [ ] 2.1 Implement discriminated `bundled-v1` and `package-v2` artifact identity types
      Requirements: R2.AC1, R2.AC3
      Done when: TypeScript prevents a bundled descriptor from claiming a package digest or post-build reload.

- [ ] 2.2 Implement canonical JSON and SHA-256 descriptor-key generation with collision/ordering vectors
      Requirements: R2.AC2
      Done when: reordered object keys hash identically, changed identity inputs hash differently, and delimiter-like values cannot collide.

- [ ] 2.3 Generate a bundled-plugin catalog containing host build ID, plugin ID, and exact module key for shared server/client use
      Requirements: R2.AC1, R2.AC3, R7.AC1
      Done when: a production build exposes only modules captured by its `import.meta.glob`, and a post-build disk plugin is absent/rebuild-required.

- [ ] 2.4 Add the generated artifact identity, policy/grant revisions, lifecycle coverage, and descriptor key additively to the runtime-manifest contract
      Requirements: R2.AC1-R2.AC5
      Done when: V1 response fields remain present and old response fixtures still parse.

- [ ] 2.5 Implement the pure runtime state machine and transition table
      Requirements: R2.AC4, R2.AC8
      Done when: every legal transition and every rejected transition has a table-driven unit test.

- [ ] 2.6 Implement `DescriptorResolver` validation and client recomputation of descriptor keys
      Requirements: R2.AC2, R2.AC4
      Done when: malformed/mismatched descriptors become `blocked` before a loader is called.

- [ ] 2.7 Add a shadow `PluginManager` that observes the current loader without controlling imports, registrations, or cleanup
      Requirements: R2.AC4, R9.AC5
      Done when: shadow records match V1 managed IDs and generations while callback/contribution counts stay unchanged.

- [ ] 2.8 Add bounded shadow divergence records for desired ID, observed ID, source, workspace, and rebuild-required mismatch
      Requirements: R2.AC3, R9.AC3, R9.AC5
      Done when: divergences are inspectable, capped, and contain no plugin payload/secrets.

- [ ] 2.9 Add a read-only runtime inspector panel for shadow status and selected startup flags
      Requirements: R9.AC1, R9.AC3
      Done when: the panel labels client/process/persisted scope, reports actual shadow data, and does not infer active state from workspace enablement.

- [ ] 2.10 Implement pre-discovery `disableNonCorePlugins` safe-mode configuration
      Requirements: R9.AC1, R9.AC2
      Done when: a boot test proves no non-core loader/import function is called in safe mode.

- [ ] 2.11 Run and document the shadow rollback drill
      Requirements: R9.AC4, R9.AC8
      Done when: removing/disabling only the observer restores the exact V1 path and the Milestone 0 qualification remains green.

## 3. Milestones 2–3 — V1-safe lifecycle and manager cutover

- [ ] 3.1 Implement idempotent scope-owned abort and cleanup record primitives
      Requirements: R3.AC1, R3.AC8
      Done when: duplicate abort/dispose calls are no-ops and stale owners cannot affect current records.

- [ ] 3.2 Implement the V1 cleanup runner with FIFO invocation, concurrently collected thenables, per-error reporting, and one overall timeout
      Requirements: R3.AC6, R3.AC9
      Done when: tests prove invocation order, non-serialized promise starts, all-settled behavior, thrown cleanup continuation, and timeout completion.

- [ ] 3.3 Adapt `createWorkspacePluginApi` to `LegacyPluginScope` without changing immediate registration visibility or public returns
      Requirements: R1.AC2, R3.AC5, R3.AC7
      Done when: registration-time visibility fixtures and existing workspace-runtime tests pass unchanged.

- [ ] 3.4 Add lifecycle-coverage reporting for passed-API ownership versus `legacy-global-possible`
      Requirements: R2.AC4, R3.AC7, R9.AC3
      Done when: all V1 packages default conservatively and the UI never labels arbitrary V1 code fully managed.

- [ ] 3.5 Add generation checks after every awaited fetch/import/register/stop boundary in manager-owned flow
      Requirements: R2.AC7, R3.AC8
      Done when: fault-injection tests at each boundary prove a superseded generation cannot publish state or registrations.

- [ ] 3.6 Implement a per-plugin lifecycle mutex and a serialized reconcile coordinator
      Requirements: R2.AC7, R3.AC8, R7.AC6
      Done when: same-ID start/stop/replace operations serialize while unrelated plugin operations can progress.

- [ ] 3.7 Extract the current module lookup/fallback logic into `BundledV1Loader`
      Requirements: R1.AC6, R7.AC1
      Done when: explicit entry and all three legacy filenames resolve exactly as the existing loader tests specify.

- [ ] 3.8 Implement descriptor-keyed desired/active diff for bundled artifacts
      Requirements: R2.AC1-R2.AC4
      Done when: workspace/policy/grant/build/module/source changes are classified, and disk-only byte changes report rebuild-required.

- [ ] 3.9 Implement stop, replace, and start execution with V1 conservative old-stop-first behavior
      Requirements: R3.AC5, R3.AC6, R3.AC9
      Done when: replacement waits for bounded cleanup, does not overlap old/new mediated registrations, and refuses unsafe hot replacement after timeout when lifecycle coverage is `legacy-global-possible`.

- [ ] 3.10 Add reconcile triggers for workspace/session changes, local admin enable/disable, focus refresh, and authoritative manifest revision changes
      Requirements: R2.AC7
      Done when: concurrent triggers coalesce and the latest authoritative state wins.

- [ ] 3.11 Implement structured retry/backoff and descriptor-keyed in-session quarantine
      Requirements: R2.AC8, R9.AC3
      Done when: one failing plugin does not block ten healthy plugins, retry is bounded, and a new descriptor key is independently eligible.

- [ ] 3.12 Wire `pluginRuntimeV2Enabled` and workspace canaries as startup-only manager selection
      Requirements: R9.AC1, R9.AC8
      Done when: non-canary workspaces use the untouched V1 loader and a live flag mutation cannot switch an active kernel.

- [ ] 3.13 Add adversarial manager integration tests for register throw, cleanup throw/reject/hang, disable during import/register, workspace switch, built-in precedence, and transient manifest failure
      Requirements: R1.AC9, R2.AC7-R2.AC8, R3.AC5-R3.AC9
      Done when: healthy current generations remain on unknown manifest failure and all stale-generation assertions pass.

- [ ] 3.14 Run the manager-canary rollback drill and qualification gate
      Requirements: R1.AC10, R9.AC4, R9.AC8
      Done when: flag-off after reload restores the old loader with no duplicated callbacks/contributions and Milestone 0 remains green.

## 4. Milestone 4 — Atomic V2 publication and registry adapters

- [ ] 4.1 Implement `ActivationTable` with synchronous expected-owner compare-and-swap and revision counter
      Requirements: R4.AC2, R4.AC3, R4.AC6
      Done when: winner/loser/stale-owner tests pass without an awaited gap in publication.

- [ ] 4.2 Implement `ContributionRegistry` record storage, hidden staging, legacy-visible records, owner removal, inspection, and subscription
      Requirements: R4.AC1, R4.AC2, R4.AC5
      Done when: unit tests cover conflicts, hidden/current visibility, exact-owner cleanup, and immutable inspection snapshots.

- [ ] 4.3 Implement batched per-surface projection keyed by activation revision
      Requirements: R4.AC2, R4.AC7
      Done when: a 100-record commit emits one observable reactive publication for that surface.

- [ ] 4.4 Implement `TransactionalPluginScope` validation, pre-activation, hidden insert, publication CAS, rollback, and sequential LIFO disposal
      Requirements: R3.AC2-R3.AC4, R4.AC2-R4.AC3
      Done when: failures before publish leave the old owner visible and rollback after a forced synchronous publish fault restores it first.

- [ ] 4.5 Build a reusable differential surface-adapter test harness against Compatibility Ledger fixtures
      Requirements: R1.AC5, R9.AC6
      Done when: it compares values, returns, exceptions, object identity, order, and reactive notification count between V1 and adapter paths.

- [ ] 4.6 Add startup `pluginContributionV2Surfaces` allowlist and runtime inspection
      Requirements: R9.AC1, R9.AC3
      Done when: one surface can select/revert independently before plugin discovery.

- [ ] 4.7 Migrate message, header, and composer actions behind their compatibility adapters
      Requirements: R1.AC2, R1.AC5, R4.AC4-R4.AC7
      Done when: each surface's differential suite passes and existing public returns are unchanged.

- [ ] 4.8 Migrate footer, document-history, and thread-history actions behind their compatibility adapters
      Requirements: R1.AC2, R1.AC5, R4.AC4-R4.AC7
      Done when: visibility/disabled/order/access tests and differential fixtures pass.

- [ ] 4.9 Migrate project-tree actions and editor-toolbar buttons behind their compatibility adapters
      Requirements: R1.AC2, R1.AC5, R4.AC4-R4.AC7
      Done when: thrown visibility behavior and order/ID ties match the ledger.

- [ ] 4.10 Migrate sidebar sections behind its compatibility adapter
      Requirements: R1.AC5, R4.AC4-R4.AC7
      Done when: placement grouping, default placement, access, component identity, and current return shapes match.

- [ ] 4.11 Migrate pane apps behind its compatibility adapter
      Requirements: R1.AC5, R4.AC4-R4.AC7
      Done when: Zod errors, `markRaw`, order-only ties, getters, and exact-owner replacement match.

- [ ] 4.12 Migrate sidebar pages behind its compatibility adapter
      Requirements: R1.AC5, R4.AC4-R4.AC7
      Done when: SSR no-op, validation, async component policy, access, defaults, context callbacks, and disposer semantics match.

- [ ] 4.13 Migrate dashboard plugin records and inline page replacement behind adapters
      Requirements: R1.AC5, R4.AC4-R4.AC7
      Done when: plugin/page replacement and reactive projections pass the differential suite.

- [ ] 4.14 Migrate dashboard navigation/component caches behind the adapter
      Requirements: R1.AC5, R4.AC4
      Done when: resolve, retry, removal, replacement, active navigation, and cache invalidation tests match the V1 profile.

- [ ] 4.15 Migrate editor node, mark, and generic extension registries behind adapters
      Requirements: R1.AC5, R4.AC4-R4.AC7
      Done when: ordering, stored identity, lazy factory failure, and list APIs match.

- [ ] 4.16 Migrate admin pages/widgets and component cache behind adapters
      Requirements: R1.AC2, R1.AC5, R4.AC4-R4.AC7
      Done when: replace-in-place positions, default order 0, loaded-once behavior, and cache bound match.

- [ ] 4.17 Adapt client tools to the kernel without replacing the execution/persistence implementation
      Requirements: R1.AC2, R4.AC5, R4.AC8
      Done when: `RegisteredTool` identity, watchers, storage key, override, enabled refs, execution, and exact disposal remain unchanged.

- [ ] 4.18 Adapt server tools to owner inspection without changing its public disposer or execution contract
      Requirements: R1.AC2, R4.AC5, R4.AC8
      Done when: server tool contract/schema/timeout suites pass unchanged and owners appear only in internal inspection.

- [ ] 4.19 Run 1,000-cycle leak tests and one-surface-at-a-time rollback drills
      Requirements: R4.AC6-R4.AC8, R9.AC4, R9.AC7
      Done when: disabled surfaces/plugins leave zero managed records/watchers and every surface flag has a tested revert result.

## 5. Milestone 5 — Hook Runtime V2

- [ ] 5.1 Implement owner-aware exact and wildcard hook record storage with sorted registration-time arrays
      Requirements: R5.AC3-R5.AC5
      Done when: legacy records and hidden managed records reproduce the golden match order.

- [ ] 5.2 Implement exact/wildcard/activation generations and the bounded 1,024-entry dispatch-plan LRU
      Requirements: R5.AC4
      Done when: focused invalidation and capacity eviction tests pass at high cardinality.

- [ ] 5.3 Implement legacy serial action/filter executors over cached plans
      Requirements: R1.AC3, R1.AC4, R5.AC3, R5.AC9
      Done when: the full hook conformance suite passes without expected-value changes.

- [ ] 5.4 Implement explicit new-hook policies for parallel actions, timeout, stop, aggregate, rethrow, and fail-closed
      Requirements: R5.AC3, R5.AC8
      Done when: each policy has isolated result/error/timeout tests and unknown hooks never select it implicitly.

- [ ] 5.5 Add scoped hook registration to `TransactionalPluginScope` and `ActivationTable`
      Requirements: R3.AC2-R3.AC4, R5.AC5
      Done when: hook callbacks and registry records from one V2 owner become visible on the same activation revision.

- [ ] 5.6 Implement bounded metric counters/rings, a 2,048-series cap with overflow aggregation, and immutable diagnostics snapshots/reset
      Requirements: R5.AC6, R9.AC7
      Done when: recent samples cap at 128, series cap at 2,048, overflow remains observable, snapshots cannot mutate runtime state, and high-cardinality tests stay within the committed bound.

- [ ] 5.7 Implement the V1 `_diagnostics` compatibility facade
      Requirements: R1.AC7, R5.AC6
      Done when: direct reads, reset assignments, `callbacks()`, HMR reset, and current Hook Inspector fixtures pass.

- [ ] 5.8 Wire V2 through client singleton, SSR request-local, and server/admin wrappers without changing public types
      Requirements: R5.AC1, R5.AC2
      Done when: lifetime isolation tests and declaration snapshots pass in client and SSR contexts.

- [ ] 5.9 Migrate Hook Inspector to immutable snapshots while retaining the compatibility facade
      Requirements: R1.AC7, R5.AC6, R9.AC3
      Done when: inspector refresh/reset works and no app code needs mutable internals.

- [ ] 5.10 Add metadata/plan-only shadow comparison and assert no callback dual execution
      Requirements: R5.AC7, R9.AC5
      Done when: a side-effect counter increments once while shadow plan differences remain inspectable.

- [ ] 5.11 Wire startup-only `hookEngineV2Enabled` and run rollback/performance gates
      Requirements: R9.AC1, R9.AC4, R9.AC7-R9.AC8
      Done when: reload with flag off restores V1 core, all conformance tests pass, and exact/wildcard budgets pass.

## 6. Milestone 6 — Manifest V2, SDK, and state contracts

- [ ] 6.1 Split manifest parsing into compatible V1 and strict V2 schemas with `manifestVersion ?? 1` dispatch
      Requirements: R1.AC6, R6.AC1
      Done when: all stored V1 manifest fixtures normalize identically and invalid V2 fields fail before import.

- [ ] 6.2 Add V2 engine ranges, entrypoints, requested grants, dependencies, trust, settings version, and state-compatibility fields
      Requirements: R6.AC2, R10.AC3
      Done when: schema tests cover valid/minimal and every incompatible/invalid state.

- [ ] 6.3 Implement compatibility and feature-negotiation verification with machine-readable blocked reasons
      Requirements: R6.AC5
      Done when: host/API/dependency/feature/trust mismatches each block before loader invocation.

- [ ] 6.4 Implement required/optional dependency resolution, semver checks, cycle paths, topological start, and reverse stop ordering
      Requirements: R2.AC2, R6.AC5, R6.AC8
      Done when: missing/incompatible required dependencies and cycles block before import, optional absence negotiates cleanly, and start/stop order is deterministic.

- [ ] 6.5 Implement reviewed-grant persistence/revision separately from access policy revision
      Requirements: R2.AC5, R6.AC3
      Done when: access changes and grant changes generate distinct descriptor-key inputs and mediated denials are tested.

- [ ] 6.6 Scaffold `@or3/plugin-sdk` with define helper, host-created context, contribution/hook contracts, and feature negotiation
      Requirements: R6.AC4
      Done when: a minimal V2 plugin compiles using only SDK exports.

- [ ] 6.7 Add SDK settings/storage/HTTP clients and stable error result types
      Requirements: R2.AC5, R6.AC4, R10.AC3-R10.AC4
      Done when: identity is closed over by the host and cannot be replaced by plugin input in tests.

- [ ] 6.8 Add SDK test harness and fake host with activation, grants, failures, and cleanup controls
      Requirements: R6.AC4, R9.AC6
      Done when: plugin packages can test success, denied grant, stale generation, activation failure, and cleanup locally.

- [ ] 6.9 Add V2 conformance checks for private aliases, Nuxt auto-imports, unresolved bare imports, and SDK range
      Requirements: R6.AC5, R6.AC6, R7.AC4
      Done when: V1 private-import fixture remains valid while the equivalent V2 fixture fails with a clear code.

- [ ] 6.10 Implement state-compatibility preflight and admin update explanation model
      Requirements: R10.AC3-R10.AC5
      Done when: upgrade/rollback eligibility is computed without mutating state and incompatible rollback is clearly represented.

- [ ] 6.11 Build one first-party sample V2 package and run the full SDK/transactional lifecycle suite
      Requirements: R3.AC2-R3.AC4, R6.AC4-R6.AC6
      Done when: sample setup, atomic visibility, grant denial, rollback, and cleanup pass without app-private imports.

- [ ] 6.12 Prototype the build-generated host ESM facade/import map for Vue and SDK externals in a production Nuxt build
      Requirements: R7.AC3, R7.AC4, R7.AC11
      Done when: identity/reactivity/component/CSP tests prove the plugin and host share compatible Vue/SDK modules, or ModuleV2Loader trusted UI is formally blocked in favor of rebuild-required/isolated UI.

## 7. Milestone 7 — Immutable packages and post-build loaders

- [ ] 7.1 Implement safe canonical package-tree hashing and validation
      Requirements: R7.AC2, R7.AC4
      Done when: traversal, symlink, device file, duplicate normalized path, case-fold collision, mode, length, and manifest-integrity vectors pass.

- [ ] 7.2 Implement per-plugin immutable store layout and in-process operation mutex
      Requirements: R7.AC5, R7.AC6
      Done when: verified trees are never mutated and unrelated plugin IDs do not share a mutex.

- [ ] 7.3 Implement advisory multi-process lock with stale-lock ownership/recovery rules
      Requirements: R7.AC6
      Done when: two-process install/update/uninstall tests serialize one ID without deleting a live lock.

- [ ] 7.4 Implement atomic per-plugin current/candidate/previous pointer writes and startup validation
      Requirements: R7.AC5, R7.AC8
      Done when: fault injection around temp write/flush/rename/restart always selects a complete verified tree.

- [ ] 7.5 Adapt install/update to store an immutable candidate without changing the current pointer
      Requirements: R7.AC2, R7.AC8, R10.AC4
      Done when: bad digest, compatibility, grants, dependency, loader, or state preflight leaves the prior pointer unchanged.

- [ ] 7.6 Add candidate server dry-run, read-only/copied-state preflight, and designated client hidden-preparation canary
      Requirements: R7.AC8, R10.AC4-R10.AC5
      Done when: any failed candidate check leaves current code/state untouched and successful canary evidence is bound to the candidate digest.

- [ ] 7.7 Implement the digest-addressed client module/asset route with containment, MIME, `nosniff`, cache, and access behavior
      Requirements: R7.AC3, R7.AC4, R7.AC10
      Done when: a multi-module fixture loads and every invalid path/content-type/access case is rejected.

- [ ] 7.8 Implement `ModuleV2Loader` with SDK external resolution and generation cancellation
      Requirements: R2.AC7, R7.AC3
      Done when: a production build imports a newly installed V2 package without rebuilding and a stale import cannot publish.

- [ ] 7.9 Implement digest-keyed trusted `ServerModuleResolver`
      Requirements: R2.AC6, R7.AC7
      Done when: new digest loads new code, same digest reuses code, and no module captures a request workspace context.

- [ ] 7.10 Adapt plugin route dispatch to the resolver while preserving access-before-execution and non-weakenable permission defaults
      Requirements: R6.AC7, R7.AC7
      Done when: cross-workspace, GET/HEAD, mutating, override, missing route, and failed import tests pass.

- [ ] 7.11 Implement host-managed settings migration transaction/snapshot hooks
      Requirements: R10.AC3, R10.AC4
      Done when: forced migration failure restores the exact prior settings snapshot/version.

- [ ] 7.12 Implement candidate promotion, code rollback eligibility, pointer swap, and optional down-migration
      Requirements: R7.AC5, R7.AC8, R10.AC4-R10.AC5
      Done when: promotion protects/restores state before pointer failure, compatible rollback restores prior client/server code, and incompatible state disables the operation before mutation.

- [ ] 7.13 Separate disable, package uninstall, version garbage collection, and data deletion operations
      Requirements: R10.AC1, R10.AC2, R10.AC6
      Done when: disable retains all data/packages, uninstall reports retention, and data deletion needs a distinct confirmed call.

- [ ] 7.14 Add production install→candidate→canary→promote→disable→rollback E2E coverage
      Requirements: R7.AC3, R7.AC5, R7.AC8, R7.AC10
      Done when: both client and server code update by digest without process restart, a client-specific activation failure is labeled/local rather than fleet-atomic, and managed records disappear on disable.

- [ ] 7.15 Add static-build rejection/rebuild-required coverage for runtime V2 packages
      Requirements: R1.AC8, R7.AC9
      Done when: static generation stays green, server loader code is absent, and admin/runtime status explains the limitation.

- [ ] 7.16 Wire startup-only `pluginModuleLoaderV2Enabled` and run package-store rollback/crash drills
      Requirements: R9.AC1, R9.AC4, R7.AC5-R7.AC9
      Done when: flag-off leaves bundled V1 available and all injected crash points recover to the prior known-good package.

## 8. Milestone 8 — Optional isolation

- [ ] 8.1 Define versioned RPC envelopes and schemas for request, response, event, cancellation, and error messages
      Requirements: R8.AC2, R8.AC3
      Done when: schema fixtures reject unknown versions, malformed IDs, invalid payloads, and oversized messages.

- [ ] 8.2 Implement RPC correlation, cancellation, deadlines, replay protection, and bounded in-flight requests
      Requirements: R8.AC2, R8.AC3
      Done when: timeout, cancel, duplicate/replay, late response, and backpressure tests pass.

- [ ] 8.3 Implement the grant-checking host RPC broker with host-bound plugin identity
      Requirements: R8.AC2, R8.AC3
      Done when: plugin-supplied identity is ignored and every ungranted method fails before its handler runs.

- [ ] 8.4 Implement Worker bootstrap, CSP/module loading, termination, and crash reporting
      Requirements: R8.AC1, R8.AC2
      Done when: a fixture starts/stops repeatedly, reports crashes, and leaves no Worker or pending RPC after disposal.

- [ ] 8.5 Bridge the V2 SDK logic APIs over Worker RPC
      Requirements: R8.AC2
      Done when: granted hooks/storage/settings operations work without transferring host object graphs.

- [ ] 8.6 Add Worker adversarial tests for host globals, DOM, direct network, revoked grants, and resource deadlines
      Requirements: R8.AC2
      Done when: every prohibited attempt fails and the host remains responsive.

- [ ] 8.7 Implement sandboxed iframe bootstrap, origin policy, CSP, teardown, and crash reporting
      Requirements: R8.AC1, R8.AC2
      Done when: a minimal isolated UI mounts/unmounts through the protocol without same-origin parent authority.

- [ ] 8.8 Implement schema-limited iframe UI contributions and event delivery over RPC
      Requirements: R8.AC2
      Done when: unsupported component/function transfer is rejected and allowed declarative UI events round-trip.

- [ ] 8.9 Add iframe adversarial tests for parent DOM/global access, navigation, direct network, malformed messages, and revoked grants
      Requirements: R8.AC2
      Done when: sandbox/CSP and host validation block every fixture escape attempt.

- [ ] 8.10 Write the isolated-server threat model and choose the process/isolate/container boundary with a measured prototype
      Requirements: R8.AC3
      Done when: the decision records which CPU, memory, fs, env, and network controls are enforceable on supported deployments.

- [ ] 8.11 Implement isolated-server spawn/handshake/health/termination lifecycle
      Requirements: R8.AC1, R8.AC3
      Done when: crash, failed handshake, host shutdown, and repeated start/stop leave no child runtime.

- [ ] 8.12 Enforce server CPU/wall/memory and request/response budgets
      Requirements: R8.AC3
      Done when: each budget terminates only the offending plugin request/runtime and reports a stable error.

- [ ] 8.13 Enforce deny-by-default filesystem, environment, and network policies for the selected server boundary
      Requirements: R8.AC3
      Done when: adversarial fixtures cannot read host secrets/files or open undeclared network targets.

- [ ] 8.14 Bridge approved server SDK services through the grant-checking RPC broker
      Requirements: R8.AC3
      Done when: request-scoped workspace identity is host-created and grant revocation stops subsequent calls.

- [ ] 8.15 Run the full isolated-server escape/resource adversarial suite
      Requirements: R8.AC3, R9.AC6
      Done when: all threat-model controls have passing evidence on each supported deployment target.

- [ ] 8.16 Add trust labeling and prohibit silent fallback from isolated to trusted-host
      Requirements: R8.AC1, R8.AC4, R8.AC5
      Done when: isolation-off blocks isolated descriptors before import and UI never labels trusted grants a sandbox.

- [ ] 8.17 Wire startup-only `pluginIsolationEnabled` and run isolation rollback/security gates
      Requirements: R8.AC5, R9.AC1, R9.AC4, R9.AC6
      Done when: flag-off retains trusted plugins, blocks isolated ones, and all shipped adversarial tests pass.

## 9. Milestone 9 — Rollout, tooling, and deprecation

- [ ] 9.1 Complete runtime/admin controls for retry, quarantine clear, disable, inspect, rollback, and safe-mode guidance
      Requirements: R2.AC8, R9.AC2-R9.AC3
      Done when: every control calls a real manager/package operation and unavailable actions explain why.

- [ ] 9.2 Add CLI `create` and `validate` commands using SDK templates and the shared conformance engine
      Requirements: R6.AC4-R6.AC6
      Done when: Bun creates a minimal package and validation reports schema/import/compatibility failures with stable codes.

- [ ] 9.3 Add CLI `test`, `build`, and `pack` commands with reproducible package output
      Requirements: R6.AC4-R6.AC6, R7.AC2-R7.AC4
      Done when: two builds of the unchanged sample produce the same canonical package digest.

- [ ] 9.4 Add CLI `inspect` for manifest, module graph, digest, grants, state compatibility, and trust class
      Requirements: R6.AC2-R6.AC5, R7.AC2-R7.AC4, R10.AC3
      Done when: inspection works without importing plugin code and matches server verification output.

- [ ] 9.5 Add warnings and a report-only codemod for V1 app-private imports
      Requirements: R6.AC6, R9.AC9
      Done when: V1 builds remain successful, warnings point to SDK replacements, and no source is changed without explicit command.

- [ ] 9.6 Write the V1 support policy, V2 migration guide, and lifecycle-coverage limitations
      Requirements: R3.AC7, R9.AC9
      Done when: docs state V1 support through V2, earliest V3 removal, and immediate/non-atomic legacy behavior plainly.

- [ ] 9.7 Write the trust model, state rollback rules, and safe-mode operator runbook
      Requirements: R3.AC7, R8.AC4, R9.AC2, R9.AC9, R10
      Done when: operators can recover without the plugin UI and docs state all non-sandbox/non-fleet-atomic/data limitations plainly.

- [ ] 9.8 Update public hook/plugin/manifest/SDK docs and `public/_documentation/docmap.json`
      Requirements: R1, R5, R6, R9.AC9
      Done when: docmap resolves every new page and no existing V1 guide instructs a removed/changed behavior.

- [ ] 9.9 Add a release qualification report that records flags, corpus versions, builds, benchmarks, fault tests, rollback drills, and known lifecycle limitations
      Requirements: R1.AC10, R9.AC4-R9.AC8
      Done when: the report is generated from CI artifacts and blocks promotion on any missing gate.

- [ ] 9.10 Promote the manager default in a standalone reviewed change only after qualification
      Requirements: R9.AC8
      Done when: the change enables neither Hook Runtime V2 nor ModuleV2Loader by default and includes a passing rollback drill.

- [ ] 9.11 Evaluate hook, surface, module-loader, and isolation default promotions as separate releases
      Requirements: R9.AC4, R9.AC8
      Done when: each promotion has its own qualification evidence, canary result, and startup-flag rollback.

## Suggested PR sequence

1. `test(plugin-runtime): freeze public api and external compatibility corpus`
2. `test(plugin-runtime): freeze hook registry tool and build behavior`
3. `feat(plugin-runtime): add artifact identity and descriptor state machine`
4. `feat(plugin-runtime): add shadow manager status and preboot safe mode`
5. `feat(plugin-runtime): add v1-compatible scope and awaited cleanup settlement`
6. `refactor(plugin-runtime): reconcile bundled plugins through manager canaries`
7. `feat(plugin-runtime): add activation table and contribution kernel`
8. One `refactor(registry): migrate <surface> behind compatibility adapter` PR per task group
9. `feat(hooks): add owner-aware cached runtime and diagnostics facade`
10. `feat(plugin-manifest): add strict v2 schema and compatibility checks`
11. `feat(plugin-sdk): add scoped context conformance and test harness`
12. `feat(plugin-packages): add canonical store locks and candidate pointers`
13. `feat(plugin-loader): add digest-addressed client and server resolution`
14. `feat(plugin-state): add migration preflight and rollback eligibility`
15. Separate isolated client, isolated server, tooling, and default-promotion PRs

## Traceability Matrix

| Requirement | Design component(s) | Task numbers |
|---|---|---|
| R1 Frozen V1 contract | Compatibility Ledger, surface adapters, Hook Runtime facades, BundledV1Loader | 0.1-0.3, 1.1-1.14, 3.3, 3.7, 4.5-4.18, 5.3, 5.7-5.8, 6.1, 7.15, 9.5-9.9 |
| R2 Descriptor/runtime ownership | PluginCatalog, DescriptorResolver, PluginManager, ServerModuleResolver | 2.1-2.9, 3.5-3.11, 6.4-6.5, 7.8-7.10, 9.1 |
| R3 Lifecycle/cleanup | LegacyPluginScope, TransactionalPluginScope, ActivationTable | 3.1-3.6, 3.9, 3.13, 4.1, 4.4, 5.5, 6.11, 9.6-9.7 |
| R4 Atomic registries | ActivationTable, ContributionRegistry, surface adapters | 0.2, 1.7-1.11, 4.1-4.19, 5.5 |
| R5 Hook Runtime V2 | HookRuntime V2, legacy diagnostics facade, auth constraint engine | 0.3, 1.5-1.6, 1.13, 5.1-5.11, 9.8 |
| R6 Manifest/SDK/access/grants | PluginCatalog, V1/V2 parsers, `@or3/plugin-sdk`, ServerModuleResolver | 3.7, 6.1-6.12, 7.10, 9.2-9.8 |
| R7 Loaders/package store | BundledV1Loader, package store, ModuleV2Loader, ServerModuleResolver | 0.1, 1.12, 2.1-2.4, 3.6-3.8, 6.12, 7.1-7.16, 9.3-9.4 |
| R8 Isolation | isolated client/server runtimes, grant RPC | 8.1-8.17, 9.7, 9.9 |
| R9 Rollout/operability | flags, safe mode, runtime inspector, qualification report | 1.2-1.14, 2.7-2.11, 3.12-3.14, 4.6, 4.19, 5.10-5.11, 7.16, 8.17, 9.1-9.11 |
| R10 State/rollback safety | package pointer, state preflight/migrations, uninstall separation | 6.2, 6.7, 6.10, 7.5-7.6, 7.11-7.13, 9.4, 9.7, 9.9 |

## Definition of Done

- Every acceptance criterion has a passing automated test or a named, completed production/security drill; the traceability matrix has no gap.
- `bun run test`, `bun run type-check`, `bun run build`, and `bun run generate:static` pass in the supported configurations.
- Repository examples and the maintained external V1 compatibility corpus compile and run unchanged through the selected default flags.
- V1 API declarations, Nuxt auto-imports, runtime semantics, cleanup profile, registry profiles, tool persistence, hook topology, and `_diagnostics` compatibility remain frozen for the V2 line.
- Every managed generation has real descriptor/artifact identity, status, generation, lifecycle coverage, exact-owner counts, and an operator-visible rollback/safe-mode path.
- V2 SDK plugins publish hooks and contributions through one activation-generation swap; failed preparation exposes none of the failed generation.
- Bundled V1 remains rebuild-required and supported; V2 packages load post-build by verified digest, recover from injected crashes, and reload client/server code correctly.
- Code rollback never claims to restore incompatible migrated state; disable/uninstall/data deletion remain separate operations.
- Diagnostics and plan caches remain within committed hard bounds and performance budgets; disabled plugins leave zero managed callbacks/contributions.
- Trusted versus isolated execution is accurately labeled, and every shipped isolation boundary passes its adversarial tests.
- Each default-on promotion is a separate reviewed change backed by qualification evidence and a successful startup-flag rollback drill.
