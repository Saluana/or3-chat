---
artifact_id: 80c3b360-112d-4054-ae11-47ce252db242
title: requirements.md
status: draft
owner: or3-chat
date: 2026-07-19
---

# Requirements

## Introduction

This plan defines Hook System v2 for OR3 Chat: a production-grade successor to the current trusted in-process hook and plugin framework. v1 P0 correctness defects (inventory `runtime` preservation, installer conflict/atomic swap, uninstall path safety, exact-owner registry handles, workspace generation checks, fail-closed auth constraints, mutating route permissions, sync thenable rejection, and server-authoritative load decisions) are assumed already fixed. v2 focuses on turning that foundation into an exceptional, operable plugin ecosystem with a Plugin Manager, unified registry kernel, Hook Engine v2 semantics, and a clear trusted vs isolated plugin boundary.

## Context

OR3 Chat is a Nuxt 4 / Bun / Dexie / Convex-capable local-first chat app. Hooks live in `shared/hooks/hook-engine-core.ts` and power client + server extension surfaces. Plugins install under `extensions/`, declare `or3.manifest.json`, load via `import.meta.glob` on the client, and dispatch server routes through Nitro. Workspace enablement and access gating already exist. The system is strong as a trusted operator-reviewed extension framework, but is not yet a secure third-party marketplace runtime because plugin code still executes inside the host process/bundle boundary.

## Assumptions

- Bun remains the only package manager and test runner entrypoint (`bun run test` / vitest).
- Static builds must continue to work; SSR plugin runtime stays gated behind SSR auth / admin flags.
- First-party and operator-reviewed plugins may remain in-process (trusted class).
- Untrusted marketplace plugins are a later phase and require isolation (iframe/Worker client, restricted server execution).
- Existing typed hook names in `app/core/hooks/hook-types.ts` remain the public contract; v2 extends them without silent rename breaks.
- Wire schema for sync/storage stays snake_case and out of scope for this plan.

## Out of Scope

- Full marketplace storefront, billing, or signing CA infrastructure beyond a design-ready signing hook.
- Rewriting every existing UI registry consumer in one PR (migration is incremental via adapters).
- Changing Dexie schema, sync outbox, or Convex provider contracts.
- Guaranteeing post-build source-plugin installs without rebuild while still using Vite `import.meta.glob` for trusted source plugins (v2 introduces precompiled package loading as the real post-build path).

## Requirements

### R1: Plugin Manager lifecycle

**User Story:** As a platform engineer, I want every plugin to move through an explicit lifecycle with host-owned context, so activation, failure, and cleanup are deterministic across workspace switches.

**Acceptance Criteria:**
- R1.AC1: WHEN a plugin is discovered THEN the Plugin Manager SHALL place it in `discovered` and SHALL NOT execute plugin code until verification and load decision succeed.
- R1.AC2: WHEN a plugin becomes active THEN it SHALL receive a host-created `PluginContext` containing `id`, `version`, `source`, `workspaceId`, `grants`, `signal`, `logger`, and `storage`.
- R1.AC3: IF workspace generation changes during load THEN the manager SHALL abort that load via `AbortSignal` and SHALL NOT commit registrations from the superseded generation.
- R1.AC4: WHEN a plugin fails repeatedly beyond a configured threshold THEN the manager SHALL transition it to `quarantined` and SHALL expose that status to admin/diagnostics surfaces.
- R1.AC5: WHEN a plugin stops THEN all exact-owner registration handles created under its context SHALL be disposed and timers/listeners started through the context SHALL be aborted.

### R2: Unified ExtensionRegistry kernel

**User Story:** As a plugin author, I want one registry kernel for UI and tool contributions, so ownership, conflict policy, and cleanup behave the same everywhere.

**Acceptance Criteria:**
- R2.AC1: WHEN any contribution registers THEN the kernel SHALL return an exact-owner `RegistrationHandle` whose `dispose()` only removes that owner’s registration.
- R2.AC2: WHEN two contributions share an id THEN the kernel SHALL apply a configurable conflict policy (`replace`, `reject`, `coexist-by-owner`) declared by the surface.
- R2.AC3: WHEN contributions change in a batch THEN the kernel SHALL support batched mutation so Vue projections update once per batch.
- R2.AC4: Dashboard plugins, pane apps, sidebar pages, message/header/composer/footer/history/project actions, editor toolbar buttons, and admin extensions SHALL migrate to thin adapters over the shared kernel.
- R2.AC5: IF a stale plugin dispose runs after replacement THEN the newer contribution SHALL remain registered.

### R3: Hook Engine v2 semantics

**User Story:** As a core maintainer, I want predictable sync/async hook semantics with ownership and policies, so extensions cannot silently corrupt security or UI pipelines.

**Acceptance Criteria:**
- R3.AC1: WHEN a sync filter/action returns a thenable THEN the engine SHALL reject that result, record a diagnostic, and SHALL NOT treat the Promise as a successful value.
- R3.AC2: WHEN `onceAction` is invoked via async `doAction` THEN the callback SHALL be awaited and removed exactly once, including on rejection.
- R3.AC3: Hook registration SHALL return exact-owner handles; remove-by-function-reference alone SHALL NOT be the preferred cleanup path for plugins.
- R3.AC4: The engine SHALL support per-hook action modes (`series` | `parallel`) and error policies (`continue` | `stop` | `aggregate` | `rethrow` | `failClosed`).
- R3.AC5: Authorization hooks SHALL use fail-closed deny-only constraints, not general filter transformation semantics.
- R3.AC6: Timing arrays SHALL be bounded/sampled; diagnostics SHALL expose snapshot/reset APIs without requiring mutation of private `_diagnostics` fields.
- R3.AC7: Custom action/filter names outside the typed map SHALL match a naming grammar, or go through an explicitly unsafe API.

### R4: Trusted vs isolated plugin classes

**User Story:** As a security reviewer, I want an explicit split between trusted in-process plugins and isolated third-party plugins, so capability grants are enforceable.

**Acceptance Criteria:**
- R4.AC1: The platform SHALL classify plugins as `trusted-in-process` or `isolated`.
- R4.AC2: WHEN a plugin is `isolated` THEN client code SHALL run in an iframe or Worker with RPC, and SHALL NOT receive unconstrained host object graphs.
- R4.AC3: WHEN a plugin is `isolated` on the server THEN handlers SHALL run in a restricted execution boundary (worker thread, subprocess, or remote function) with host-mediated grants.
- R4.AC4: IF a plugin lacks a required grant THEN host APIs SHALL deny the call even if the plugin code attempts direct registry access.
- R4.AC5: Trusted plugins MAY keep today’s in-process model, but SHALL still receive host-created context and exact-owner handles.

### R5: Precompiled runtime packages and true post-build install

**User Story:** As an operator, I want installed plugins to activate without rebuilding the host app, so marketplace and admin installs are real runtime features.

**Acceptance Criteria:**
- R5.AC1: Installable runtime packages SHALL ship precompiled browser ESM (and assets) plus server JS handlers declared in manifest `runtime`.
- R5.AC2: WHEN a verified package is installed and load-allowed THEN the client loader SHALL import it through a host-provided module URL / import map, not only Vite build-time globs.
- R5.AC3: IF a package fails signature/hash verification THEN the manager SHALL mark it `blocked` and SHALL NOT import it.
- R5.AC4: Source-only plugins that require Vite transform SHALL remain supported for first-party development, but admin UI SHALL label them as rebuild-required.

### R6: Server route authority and permissions

**User Story:** As a workspace member, I want plugin HTTP routes to enforce correct read/write permissions, so mutating plugin APIs cannot be called with read-only access.

**Acceptance Criteria:**
- R6.AC1: GET/HEAD plugin routes SHALL default to `workspace.read`; POST/PUT/PATCH/DELETE SHALL default to `workspace.write`.
- R6.AC2: Manifests MAY request a more specific host-defined permission, but SHALL NOT request a weaker permission than the method default.
- R6.AC3: Route dispatch SHALL continue to require plugin access gating before importing handler modules.

### R7: Installer and inventory integrity

**User Story:** As an admin, I want install/uninstall to be conflict-safe and rollback-safe, so a failed update never destroys the working plugin.

**Acceptance Criteria:**
- R7.AC1: WHEN `force` is false and the extension exists THEN install SHALL return HTTP 409 and SHALL NOT replace files.
- R7.AC2: Forced replacement SHALL backup the current target, swap staging into place, then delete backup; on failure it SHALL restore backup.
- R7.AC3: Inventory listing SHALL preserve full validated manifest fields including `runtime`.
- R7.AC4: Uninstall SHALL validate `ExtensionIdSchema` and verify resolved-path containment before recursive delete.

### R8: Operability, diagnostics, and testing

**User Story:** As an operator, I want real plugin status and adversarial tests, so runtime health is observable and regressions are caught.

**Acceptance Criteria:**
- R8.AC1: Admin/runtime status SHALL reflect Plugin Manager state (`active`, `failed`, `quarantined`, etc.), not guessed UI flags alone.
- R8.AC2: The suite SHALL include an integration path: install ZIP → list inventory → runtime-manifest → client entry selection → server route dispatch.
- R8.AC3: The suite SHALL include adversarial cases for path traversal uninstall, duplicate install, stale owner dispose, workspace generation races, auth constraint throw/thenable, and mutating route permission matrix.
- R8.AC4: Sensitive hook payloads SHALL support redaction in diagnostics logs.

### R9: Developer experience

**User Story:** As a plugin author, I want typed APIs, clear docs, and minimal boilerplate, so extending OR3 is predictable.

**Acceptance Criteria:**
- R9.AC1: Public docs and `docmap.json` SHALL describe PluginContext, registry handles, hook modes/policies, and trusted vs isolated classes.
- R9.AC2: A scaffold/template SHALL generate a minimal trusted plugin with manifest, client entry, optional server route, and tests.
- R9.AC3: HMR in development SHALL dispose exact-owner handles for the previous version before registering the next.
