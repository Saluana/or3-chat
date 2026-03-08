---
artifact_id: 87f046a4-f1e1-4ee5-a348-26320620c7d4
title: Tasks - OR3 Cloud lock page
status: draft
owner: platform
date: 2026-03-08
---

# Purpose

Implementation checklist for an optional OR3 Cloud lock page that replaces the main app shell for unauthorised visitors until they are allowed through.

Tasks map back to `planning/or3-cloud-lock-page/requirements.md`.

## 1. Extend typed config and env parsing

Requirements: 1, 5, 8

- [ ] 1.1 Add `auth.lockPage` to OR3 Cloud config types and defaults
- [ ] 1.2 Extend `defineOr3CloudConfig(...)` validation for:
  - `lockPage.enabled`
  - `lockPage.adapter`
- [ ] 1.3 Extend env-to-config parsing in `server/admin/config/resolve-config.ts`
  - map `OR3_AUTH_LOCK_PAGE_ENABLED`
  - map `OR3_AUTH_LOCK_PAGE_ADAPTER`
- [ ] 1.4 Expose safe public runtime config for lock-page rendering
- [ ] 1.5 Add unit tests for config defaults and validation

## 2. Add the lock page registry and default renderer

Requirements: 3, 4, 7

- [ ] 2.1 Create `app/core/lock-page/registry.ts`
- [ ] 2.2 Define `LockPageAdapter` and register/resolve/unregister helpers
- [ ] 2.3 Add built-in default component, for example `app/components/lock-page/DefaultLockPage.vue`
- [ ] 2.4 Reuse the existing auth UI adapter registry inside the default lock page instead of importing provider UI directly
- [ ] 2.5 Add fallback behavior when a configured adapter is missing
- [ ] 2.6 Add unit tests for adapter resolution and fallback

## 3. Implement app-entry access resolution

Requirements: 2, 6, 7, 9

- [ ] 3.1 Add `useLockPageGate()` (or equivalent) composable for shell-route gating
- [ ] 3.2 Reuse `useSessionContext()` and public runtime config rather than adding a second session endpoint
- [ ] 3.3 Implement decision matrix for:
  - SSR auth disabled
  - lock page disabled
  - authenticated allowed
  - guest allowed
  - unauthenticated denied
  - session error fail-closed
- [ ] 3.4 Add unit tests covering the full decision matrix

## 4. Gate the shared app shell

Requirements: 1, 2, 6, 7

- [ ] 4.1 Integrate the gate into `app/components/PageShell.vue`
- [ ] 4.2 Ensure the gate runs before heavy shell initialization/rendering
- [ ] 4.3 Render the configured lock page adapter when locked
- [ ] 4.4 Render the normal shell when access is allowed
- [ ] 4.5 Add a lightweight loading/fail-closed state for pending/error transitions when the feature is enabled
- [ ] 4.6 Verify coverage for `/`, `/chat`, and `/docs` routes that already use `PageShell`

## 5. Developer override flow

Requirements: 4, 8

- [ ] 5.1 Add an example registration path for custom lock pages in app/plugin code
- [ ] 5.2 Document how deployments select a lock page adapter id in OR3 Cloud config
- [ ] 5.3 Ensure the override surface is SSR-safe and does not require provider-specific imports in core
- [ ] 5.4 Add an integration test proving a custom adapter replaces the default renderer

## 6. Documentation and wizard/config preservation

Requirements: 5, 8

- [ ] 6.1 Update public OR3 Cloud config docs with lock-page settings and defaults
- [ ] 6.2 Update wizard/config preservation logic so lock-page env keys are not lost on apply
- [ ] 6.3 If wizard prompts are added, keep them optional and off by default
- [ ] 6.4 Add developer-facing documentation or notes showing how to register a custom lock page

## 7. Verification and regression coverage

Requirements: 1 through 9

- [ ] 7.1 Component/integration tests:
  - lock page disabled -> existing shell behavior unchanged
  - lock page enabled + denied -> lock page renders
  - lock page enabled + allowed -> shell renders
  - unknown adapter -> default lock page fallback
- [ ] 7.2 SSR/auth integration tests:
  - signed-out visitor on `/` sees lock page
  - signed-in visitor reaches shell
  - guest-access-enabled deployment behaves per policy
- [ ] 7.3 Manual checks:
  - enable default lock page
  - sign in/out transitions
  - custom adapter switch
  - static build remains unchanged when SSR auth is off

## Recommended implementation order

1. Ship config parsing first so the feature is inert but typed.
2. Add the registry and built-in default lock page.
3. Add the gate composable and cover the decision matrix with tests.
4. Wire `PageShell`.
5. Add custom-adapter integration coverage.
6. Update docs and wizard/config preservation.
