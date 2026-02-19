---
artifact_id: 57f4502a-b04d-4563-b6d4-987341f7e04a
title: Design - OR3 Cloud plugin access gating
status: draft
owner: platform
date: 2026-02-19
---

# Overview

This design introduces a unified plugin access-gating layer for OR3 Cloud. It adds declarative policy primitives that can be defined in plugin code and overridden by admins per workspace.

The design is intentionally provider-agnostic and aligned with OR3 constraints:
- canonical workspace/user data stays in the selected `AuthWorkspaceStore`,
- SSR endpoint authorization remains enforced through `can()`,
- extension points (hooks/registries/composables) are preferred over hard-coded logic,
- static builds must remain functional and avoid server-only imports.

# Current-state findings (gap summary)

1. Plugin manifests currently expose general `capabilities` metadata but no built-in auth/entitlement gating contract.
2. Admin plugin controls currently support workspace-level enable/disable and free-form settings storage, but no first-class gate schema.
3. UI registries expose ad-hoc visibility callbacks, so plugin authors can custom-gate in code, but there is no shared policy evaluator, no consistent deny reasons, and no central admin override model.

# Architecture

```mermaid
flowchart LR
    A[Plugin registration\n(code defaults)] --> B[Gate Policy Resolver]
    C[Admin plugin settings\nworkspace overrides] --> B
    D[Session Context\nauth/workspace/role] --> B
    E[Entitlement Resolver\n(provider-agnostic)] --> B

    B --> F[Client composables\nvisibility/disabled state]
    B --> G[Server guards\nrequireCan + policy check]

    G --> H[SSR API response\nallow/deny + reason code]
```

## Core components

1. **PluginGatePolicy schema (shared)**
   - Defines typed policy fields (`authRequired`, `requiredEntitlements`, `requiredWorkspaceRoles`, `mode`).
   - Lives in shared code so client and server can evaluate the same structure.

2. **Gate Policy Resolver (shared/composable + server helper)**
   - Merges code defaults with admin overrides using deterministic precedence:
     1) secure system defaults,
     2) plugin-declared defaults,
     3) workspace admin overrides.
   - Produces normalized effective policy and validation errors.

3. **Entitlement Resolver registry (server-first, client-safe snapshot)**
   - New provider extension point:
     - server resolver computes user entitlements for workspace (`free`, `paid`, `enterprise`, feature flags).
     - optional client snapshot endpoint for non-sensitive UI gating hints.
   - Default resolver returns empty entitlements (maintains backward compatibility).

4. **Plugin Gate Evaluator**
   - Pure function evaluating `(policy, session, entitlements, pluginEnabled)`.
   - Returns structured decision:
     - `allowed: boolean`
     - `reasons: PluginGateDenyReason[]`
     - `effectivePolicy`

5. **Admin API + UI integration**
   - Extend admin workspace plugin settings contract with validated `access` block.
   - Add admin dashboard editor controls for common gate patterns:
     - auth required toggle,
     - minimum tier selector,
     - role requirement multi-select.

6. **Server action guard integration**
   - For SSR routes owned by plugin features, evaluate plugin policy before business logic.
   - Final authz remains `can()` for resource operations; plugin gate acts as precondition layer.

# Data contracts

## Shared policy types (TypeScript sketch)

```ts
export type EntitlementId = string;
export type WorkspaceRole = 'owner' | 'editor' | 'viewer';

export interface PluginGatePolicy {
  authRequired?: boolean;
  requiredEntitlements?: EntitlementId[];
  requiredWorkspaceRoles?: WorkspaceRole[];
  mode?: 'all' | 'any';
}

export type PluginGateDenyReason =
  | 'plugin-disabled'
  | 'unauthenticated'
  | 'missing-entitlement'
  | 'insufficient-role'
  | 'invalid-policy';

export interface PluginGateDecision {
  allowed: boolean;
  reasons: PluginGateDenyReason[];
  effectivePolicy: Required<PluginGatePolicy>;
}
```

## Workspace settings shape (additive)

Stored under existing plugin settings namespace, per plugin:

```json
{
  "access": {
    "authRequired": true,
    "requiredEntitlements": ["paid"],
    "requiredWorkspaceRoles": ["owner", "editor"],
    "mode": "all"
  }
}
```

Notes:
- additive under existing `plugins.settings.{pluginId}`;
- unknown keys remain preserved by existing settings store behavior;
- policy block validated by Zod before persistence.

# Integration points

## Client surfaces

- `useDashboardPlugins` / dashboard page resolution:
  - filter or disable entries based on gate decision.
- sidebar registries (`useSidebarSections`, `useSidebarPages`, header/composer actions):
  - apply shared evaluator output for consistent visibility behavior.
- message action registry:
  - optional guard wrapper so gated actions do not render or execute.

## Server surfaces

- New helper in server plugin infra:
  - `requirePluginAccess(event, { pluginId, action })`.
- helper pipeline:
  1) resolve session,
  2) resolve workspace plugin enabled state,
  3) load plugin settings policy,
  4) resolve entitlements,
  5) evaluate policy,
  6) enforce denial before action,
  7) continue to `requireCan()` for resource authorization.

# Error handling

- Invalid admin policy payload → `400 Invalid request` with field-level issues (safe details).
- Gate denial on SSR action → `403 Forbidden` with reason code.
- Missing entitlement resolver/provider outage:
  - fail closed for policies that require entitlements,
  - emit server log warning with workspace/plugin context.
- Static build / SSR auth disabled:
  - evaluator treats session as unauthenticated unless explicit local-safe override is configured.

# Security and performance considerations

- Security:
  - never rely on client-only visibility checks; server enforcement required for protected actions.
  - `can()` remains sole resource authorization gate.
- Performance:
  - memoize effective policy per `(workspaceId, pluginId, policyVersion)` in request-local cache.
  - batch entitlement resolution per request to avoid repeated provider calls.

# Testing strategy

1. **Unit**
   - policy schema normalization and merge precedence.
   - evaluator matrix (`authRequired`, tier, role, mode any/all).
   - deterministic deny reason ordering.

2. **Integration**
   - admin API save/load for `access` block.
   - plugin enable + access policy interactions.
   - client composables consume effective decision and hide/disable correctly.

3. **SSR/API integration**
   - protected route with plugin gate denies unauthenticated and non-paid users.
   - authorized paid user passes plugin gate, then `can()` governs resource-level authorization.

4. **E2E (follow-up)**
   - workspace admin sets policy in dashboard; another user sees feature availability update after session refresh.
