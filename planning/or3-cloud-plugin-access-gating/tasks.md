---
artifact_id: 5a0f4ca4-43ef-4835-a8d4-2c7347d9cd4f
title: Tasks - OR3 Cloud plugin access gating
status: draft
owner: platform
date: 2026-02-19
---

# 1. Define shared gate policy model

- [ ] Add shared TypeScript + Zod schema for plugin access policy and denial reasons. Requirements: 1.1, 5.1
- [ ] Add shared evaluator utility returning structured decisions. Requirements: 3.1, 5.1
- [ ] Add merge utility for code defaults + admin overrides with deterministic precedence. Requirements: 1.1, 2.1, 6.1

## Tests
- [ ] Add evaluator matrix unit tests (auth/tier/role/mode combinations). Requirements: 7.1
- [ ] Add invalid policy normalization tests and reason-code assertions. Requirements: 5.1, 7.1

# 2. Extend plugin registration contracts

- [ ] Add optional `access` policy field to plugin registration/manifest-facing types. Requirements: 1.1, 6.1
- [ ] Keep default behavior unchanged when `access` is missing. Requirements: 1.1, 6.1
- [ ] Document plugin-author examples for common policies (`authRequired`, `paid`). Requirements: 1.1

## Tests
- [ ] Add backward-compat tests showing legacy plugins register and function unchanged. Requirements: 6.1, 7.1

# 3. Add admin policy persistence and validation

- [ ] Extend admin plugin settings endpoints to validate/persist `settings.access` policy block. Requirements: 2.1
- [ ] Return normalized effective policy in read APIs (or add dedicated policy endpoint). Requirements: 2.1, 5.1
- [ ] Preserve unknown plugin settings fields while updating `access`. Requirements: 6.1

## Tests
- [ ] Add API tests for valid `access` writes and reads. Requirements: 2.1, 7.1
- [ ] Add API tests for invalid `access` payload rejection (400). Requirements: 2.1, 7.1

# 4. Introduce entitlement resolver extension point

- [ ] Add server registry interface for entitlement resolution (`resolveEntitlements(session, workspace)`). Requirements: 1.1, 4.1
- [ ] Provide default no-entitlement implementation for compatibility. Requirements: 6.1
- [ ] Add provider integration guidance for mapping billing tiers to entitlement IDs. Requirements: 2.1

## Tests
- [ ] Add unit tests for default resolver behavior and registry replacement. Requirements: 4.1, 7.1

# 5. Apply gating to UI registries/composables

- [ ] Integrate gate evaluator into dashboard plugin visibility/disabled states. Requirements: 3.1
- [ ] Integrate gating into sidebar pages/actions and message actions via shared guard helper. Requirements: 3.1, 4.1
- [ ] Ensure deny reasons can be surfaced in optional UX messaging (non-sensitive). Requirements: 5.1

## Tests
- [ ] Add composable tests for hidden vs disabled outcomes by policy decision. Requirements: 3.1, 7.1

# 6. Add server-side enforcement helper

- [ ] Implement `requirePluginAccess` helper for SSR endpoints with plugin ID context. Requirements: 3.1, 4.1
- [ ] Ensure helper composes with `requireCan()` (plugin gate first, resource auth second). Requirements: 3.1
- [ ] Apply helper to at least one representative plugin-owned SSR route as reference implementation. Requirements: 3.1, 4.1

## Tests
- [ ] Add route tests for unauthenticated deny, missing entitlement deny, allowed paid-user path. Requirements: 3.1, 7.1

# 7. Admin dashboard UX for policy editing

- [ ] Add policy controls on `admin/plugins` page (auth toggle, tier selector, role selector). Requirements: 2.1
- [ ] Load/save controls through existing workspace plugin settings APIs. Requirements: 2.1, 6.1
- [ ] Add guardrails/help text explaining server-side enforcement and policy precedence. Requirements: 5.1

## Tests
- [ ] Add component tests for policy form serialization/deserialization. Requirements: 2.1, 7.1

# 8. Documentation and rollout

- [ ] Update plugin docs with new access policy contract and examples. Requirements: 1.1, 6.1
- [ ] Update cloud docs with entitlement resolver extension pattern. Requirements: 4.1
- [ ] Add migration notes (non-breaking default behavior). Requirements: 6.1

# 9. Validation

- [ ] Run `bun run test` for affected suites. Requirements: 7.1
- [ ] Run `bun run lint` and fix only introduced issues. Requirements: 7.1
