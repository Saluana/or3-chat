---
artifact_id: 80c3b360-112d-4054-ae11-47ce252db242
title: tasks.md
status: draft
owner: or3-chat
date: 2026-07-19
---

# Tasks

## 0. Prerequisites (v1 P0 — landed)

- [x] 0.1 Preserve manifest `runtime` in extension inventory
      Requirements: R7.AC3
      Done when: `listInstalledExtensions()` returns `runtime` from disk manifests; covered by install→inventory test.

- [x] 0.2 Fix duplicate install detection + HTTP 409
      Requirements: R7.AC1
      Done when: `force:false` throws `ExtensionAlreadyInstalledError` and install API returns 409.

- [x] 0.3 Atomic backup/swap install + rollback
      Requirements: R7.AC2
      Done when: replacement uses backup rename sequence; failure restores prior tree.

- [x] 0.4 Secure uninstall IDs/paths
      Requirements: R7.AC4
      Done when: `ExtensionIdSchema` exported and used; containment/realpath checks before `rm`.

- [x] 0.5 Exact-owner handles for core registries + workspace API tool dispose
      Requirements: R2.AC1, R2.AC5
      Done when: `createRegistry` / dashboard / pane apps return handles; workspace runtime disposes tools via owner token.

- [x] 0.6 Workspace loader generation checks + revision commit on success only
      Requirements: R1.AC3
      Done when: token rechecked after awaits; failed sync does not suppress retry via revision.

- [x] 0.7 Fail-closed authorization constraints
      Requirements: R3.AC5
      Done when: throws/thenables/invalid returns deny; grant attempts rejected.

- [x] 0.8 Mutating plugin route permissions + server loadAllowed
      Requirements: R6.AC1, R6.AC3, R1.AC1
      Done when: POST/PUT/PATCH/DELETE require `workspace.write`; runtime-manifest filters by access.

- [x] 0.9 Sync thenable rejection + onceAction await semantics
      Requirements: R3.AC1, R3.AC2
      Done when: shared hook engine unit tests pass.

## 1. PluginManager core

- [ ] 1.1 Define lifecycle types and `PluginContext` in `shared/plugins/`
      Requirements: R1.AC1, R1.AC2, R4.AC1
      Done when: exported types compile and unit-tested for grant set immutability.

- [ ] 1.2 Implement `PluginManager` state machine with generation token + AbortController
      Requirements: R1.AC3, R1.AC5
      Done when: overlapping activate/deactivate tests prove superseded loads do not commit.

- [ ] 1.3 Add failure counters and quarantine transitions
      Requirements: R1.AC4, R8.AC1
      Done when: N consecutive failures move plugin to `quarantined` and status API reports it.

- [ ] 1.4 Wire workspace client loader to manager commit path (staging bag → atomic replace)
      Requirements: R1.AC3, R1.AC5
      Done when: workspace switch race test passes without stale registrations.

## 2. ExtensionRegistry kernel

- [ ] 2.1 Expand shared `ExtensionRegistry<T>` with conflict policy, batching, snapshots
      Requirements: R2.AC1, R2.AC2, R2.AC3
      Done when: kernel unit tests cover replace/reject/coexist and batch projection updates.

- [ ] 2.2 Migrate message/header/composer/footer/history/project/editor registries to adapters
      Requirements: R2.AC4
      Done when: existing chrome registry tests pass and each register returns `RegistrationHandle`.

- [ ] 2.3 Migrate dashboard plugins/pages and pane apps fully onto kernel (remove dual maps)
      Requirements: R2.AC4, R2.AC5
      Done when: ownership tests pass; HMR dispose uses handles.

- [ ] 2.4 Bind access-policy predicates at registry projection time without executing denied plugin code
      Requirements: R4.AC4, R2.AC4
      Done when: denied plugins never receive manager `loading` for UI contributions.

## 3. Hook Engine v2

- [ ] 3.1 Add dispatch-plan cache invalidated on register/unregister
      Requirements: R3.AC4
      Done when: microbench/unit proves hot `doAction` does not re-sort every call.

- [ ] 3.2 Add per-hook mode + errorPolicy + timeout/AbortSignal
      Requirements: R3.AC4
      Done when: series/parallel and failClosed/stop/aggregate behaviors covered by unit tests.

- [ ] 3.3 Exact-owner hook registration handles + callback ownership in diagnostics
      Requirements: R3.AC3, R8.AC4
      Done when: stale dispose cannot remove newer callback; diagnostics include plugin id when available.

- [ ] 3.4 Bounded timings + public diagnostics snapshot/reset API
      Requirements: R3.AC6
      Done when: timing buffers cap; `_diagnostics` direct mutation no longer required by inspector UI.

- [ ] 3.5 Tighten custom hook name grammar / unsafe escape hatch
      Requirements: R3.AC7
      Done when: typed maps remain; illegal custom names rejected unless `unsafeOn()`.

- [ ] 3.6 Keep auth constraints on dedicated fail-closed path (no general filter reuse)
      Requirements: R3.AC5
      Done when: auth tests remain green; no `applyFiltersSync` in `can()` path.

## 4. Trusted vs isolated runtime

- [ ] 4.1 Add `pluginClass` to manifest schema with default `trusted-in-process`
      Requirements: R4.AC1, R5.AC1
      Done when: schema validation accepts/rejects correctly.

- [ ] 4.2 Implement host RPC proxy skeleton for isolated client plugins (iframe or Worker)
      Requirements: R4.AC2, R4.AC4
      Done when: isolated plugin can register a message action only through granted RPC methods.

- [ ] 4.3 Design restricted server execution adapter interface (worker/subprocess/remote)
      Requirements: R4.AC3
      Done when: interface + noop/trusted fallback exist; isolated server routes refuse in-process import.

- [ ] 4.4 Grant checks on ScopedHookApi / ScopedRegistryApi
      Requirements: R4.AC4, R4.AC5
      Done when: missing grant denies with structured error and does not mutate host registries.

## 5. Precompiled packages and post-build install

- [ ] 5.1 Define package layout (`runtime.client.entry` ESM, assets, server JS, integrity hashes)
      Requirements: R5.AC1, R5.AC3
      Done when: fixture package installs and verifies in unit tests.

- [ ] 5.2 Host module URL / import-map loader for verified packages
      Requirements: R5.AC2
      Done when: installed package loads without Vite rebuild in SSR-enabled integration test.

- [ ] 5.3 Admin UX labels for rebuild-required source plugins vs runtime packages
      Requirements: R5.AC4, R9.AC1
      Done when: UI copy and docs distinguish the two install modes.

## 6. Server routes and operability

- [ ] 6.1 Allow manifest-declared stronger permissions; reject weaker-than-default
      Requirements: R6.AC2
      Done when: validation + dispatcher tests cover allow/reject matrix.

- [ ] 6.2 Replace guessed runtime status with PluginManager status in admin APIs
      Requirements: R8.AC1
      Done when: admin list shows lifecycle + last error code.

- [ ] 6.3 Sensitive payload redaction helpers for hook diagnostics
      Requirements: R8.AC4
      Done when: marked hooks redact keys in snapshots/logs.

## 7. Testing matrix

- [ ] 7.1 End-to-end install → inventory → runtime-manifest → client entry → dispatch
      Requirements: R8.AC2
      Done when: one integration test file covers the full path with real temp extensions dir.

- [ ] 7.2 Adversarial suite for traversal, stale owners, generation races, auth fail-closed, route perms
      Requirements: R8.AC3
      Done when: all adversarial cases assert deny/no-op rather than crash/fail-open.

- [ ] 7.3 Performance smoke for dispatch-plan cache and registry batching
      Requirements: R3.AC4, R2.AC3
      Done when: documented thresholds in test comments; suite stays under CI budget.

## 8. Docs and DX

- [ ] 8.1 Update public docs + `public/_documentation/docmap.json`
      Requirements: R9.AC1
      Done when: PluginContext, handles, modes/policies, trusted vs isolated are linked from docmap.

- [ ] 8.2 Add trusted plugin scaffold template + example tests
      Requirements: R9.AC2
      Done when: `bun` scaffold script generates a loadable sample plugin.

- [ ] 8.3 HMR dispose-via-handle convention documented and applied to example plugins
      Requirements: R9.AC3
      Done when: example plugins cleanly remount under Vite HMR without duplicate IDs.

## Traceability Matrix

| Requirement | Design component | Tasks |
|---|---|---|
| R1 | PluginManager, PluginContext | 0.6, 1.1–1.4 |
| R2 | ExtensionRegistry + adapters | 0.5, 2.1–2.4 |
| R3 | HookEngine v2, auth constraints | 0.7, 0.9, 3.1–3.6 |
| R4 | Trusted/isolated classes + RPC | 1.1, 4.1–4.4 |
| R5 | Runtime package loader | 4.1, 5.1–5.3 |
| R6 | Route dispatcher permissions | 0.8, 6.1 |
| R7 | Install/inventory/uninstall | 0.1–0.4 |
| R8 | Status + tests + redaction | 1.3, 6.2–6.3, 7.1–7.3 |
| R9 | Docs/scaffold/HMR | 5.3, 8.1–8.3 |

## Definition of Done

- All acceptance criteria in `requirements.md` are covered by tasks above with no matrix gaps.
- `bun run test` passes for hook/plugin suites including new integration and adversarial tests.
- Admin/runtime status reflects PluginManager lifecycle for enabled plugins.
- Docs/docmap updated for author-facing v2 contracts.
- Trusted plugins remain functional; isolated class is at least scaffolded with grant-enforced RPC boundaries.
