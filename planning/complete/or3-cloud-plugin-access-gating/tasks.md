---
artifact_id: 5a0f4ca4-43ef-4835-a8d4-2c7347d9cd4f
title: Tasks - OR3 Cloud plugin access gating
status: draft
owner: platform
date: 2026-02-19
---

# 1. Define shared gate policy model

- [x] Add shared TypeScript + Zod schema for plugin access policy and denial reasons. Requirements: 1.1, 5.1
- [x] Add shared evaluator utility returning structured decisions. Requirements: 3.1, 5.1
- [x] Add merge utility for code defaults + admin overrides with deterministic precedence. Requirements: 1.1, 2.1, 6.1

## Tests
- [x] Add evaluator matrix unit tests (auth/tier/role/mode combinations). Requirements: 7.1
- [x] Add invalid policy normalization tests and reason-code assertions. Requirements: 5.1, 7.1

# 2. Extend plugin registration contracts

- [x] Add optional `access` policy field to plugin registration/manifest-facing types. Requirements: 1.1, 6.1
- [x] Keep default behavior unchanged when `access` is missing. Requirements: 1.1, 6.1
- [x] Document plugin-author examples for common policies (`authRequired`, `paid`). Requirements: 1.1

## Tests
- [x] Add backward-compat tests showing legacy plugins register and function unchanged. Requirements: 6.1, 7.1

# 3. Add admin policy persistence and validation

- [x] Extend admin plugin settings endpoints to validate/persist `settings.access` policy block. Requirements: 2.1
- [x] Return normalized effective policy in read APIs (or add dedicated policy endpoint). Requirements: 2.1, 5.1
- [x] Preserve unknown plugin settings fields while updating `access`. Requirements: 6.1

## Tests
- [x] Add API tests for valid `access` writes and reads. Requirements: 2.1, 7.1
- [x] Add API tests for invalid `access` payload rejection (400). Requirements: 2.1, 7.1

# 4. Introduce entitlement resolver extension point

- [x] Add server registry interface for entitlement resolution (`resolveEntitlements(session, workspace)`). Requirements: 1.1, 4.1
- [x] Provide default no-entitlement implementation for compatibility. Requirements: 6.1
- [x] Add provider integration guidance for mapping billing tiers to entitlement IDs. Requirements: 2.1

## Tests
- [x] Add unit tests for default resolver behavior and registry replacement. Requirements: 4.1, 7.1

# 5. Apply gating to UI registries/composables

- [x] Integrate gate evaluator into dashboard plugin visibility/disabled states. Requirements: 3.1
- [x] Integrate gating into sidebar pages/actions and message actions via shared guard helper. Requirements: 3.1, 4.1
- [x] Ensure deny reasons can be surfaced in optional UX messaging (non-sensitive). Requirements: 5.1

## Tests
- [x] Add composable tests for hidden vs disabled outcomes by policy decision. Requirements: 3.1, 7.1

# 6. Add server-side enforcement helper

- [x] Implement `requirePluginAccess` helper for SSR endpoints with plugin ID context. Requirements: 3.1, 4.1
- [x] Ensure helper composes with `requireCan()` (plugin gate first, resource auth second). Requirements: 3.1
- [x] Apply helper to at least one representative plugin-owned SSR route as reference implementation. Requirements: 3.1, 4.1

## Tests
- [x] Add route tests for unauthenticated deny, missing entitlement deny, allowed paid-user path. Requirements: 3.1, 7.1

# 7. Admin dashboard UX for policy editing

- [x] Add policy controls on `admin/plugins` page (auth toggle, tier selector, role selector). Requirements: 2.1
- [x] Load/save controls through existing workspace plugin settings APIs. Requirements: 2.1, 6.1
- [x] Add guardrails/help text explaining server-side enforcement and policy precedence. Requirements: 5.1

## Tests
- [x] Add component tests for policy form serialization/deserialization. Requirements: 2.1, 7.1

# 8. Documentation and rollout

- [x] Update plugin docs with new access policy contract and examples. Requirements: 1.1, 6.1
- [x] Update cloud docs with entitlement resolver extension pattern. Requirements: 4.1
- [x] Add migration notes (non-breaking default behavior). Requirements: 6.1

# 9. Validation

- [x] Run `bun run test` for affected suites. Requirements: 7.1
- [x] Run `bun run lint` and fix only introduced issues. Requirements: 7.1
