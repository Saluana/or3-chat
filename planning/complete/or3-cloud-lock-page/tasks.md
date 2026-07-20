---
artifact_id: 87f046a4-f1e1-4ee5-a348-26320620c7d4
title: Tasks - OR3 Cloud lock page
status: draft
owner: platform
date: 2026-03-08
---

# Purpose

Implementation checklist for an optional OR3 Cloud lock page that redirects unauthorised visitors away from protected shell routes to a dedicated `/welcome` route while leaving admin routes reachable.

Tasks map back to `planning/or3-cloud-lock-page/requirements.md`.

## 1. Extend typed config and env parsing

Requirements: 1, 2, 5, 8

- [x] 1.1 Add `auth.lockPage` to OR3 Cloud config types and defaults
- [x] 1.2 Extend `defineOr3CloudConfig(...)` validation for:
  - `lockPage.enabled`
  - `lockPage.adapter`
- [x] 1.3 Extend env-to-config parsing in `server/admin/config/resolve-config.ts`
  - map `OR3_AUTH_LOCK_PAGE_ENABLED`
  - map `OR3_AUTH_LOCK_PAGE_ADAPTER`
- [x] 1.4 Expose safe public runtime config for lock-page rendering, including `admin.basePath`
- [x] 1.5 Add unit tests for config defaults and validation

## 2. Add the lock page registry and default renderer

Requirements: 3, 4, 7

- [x] 2.1 Create `app/core/lock-page/registry.ts`
- [x] 2.2 Define `LockPageAdapter` and register/resolve/unregister helpers
- [x] 2.3 Add built-in default component, for example `app/components/lock-page/DefaultLockPage.vue`
- [x] 2.4 Reuse the existing auth UI adapter registry inside the default lock page instead of importing provider UI directly
- [x] 2.5 Add fallback behavior when a configured adapter is missing
- [x] 2.6 Add unit tests for adapter resolution and fallback

## 3. Add the dedicated lock route

Requirements: 1, 3, 4, 6

- [x] 3.1 Add `app/pages/welcome.vue` as the stable public lock-page route
- [x] 3.2 Resolve the configured lock-page adapter from `welcome.vue`
- [x] 3.3 Redirect authenticated users from `/welcome` back to `next` or `/`
- [x] 3.4 Keep the route simple enough that forks can replace it directly if desired
- [x] 3.5 Add tests for route-level fallback and post-auth redirect behavior

## 4. Add global route gating

Requirements: 1, 2, 6, 7

- [x] 4.1 Add `app/middleware/lock-page.global.ts`
- [x] 4.2 Implement protected-route classification for:
  - `/`
  - `/chat`
  - `/chat/**`
  - `/docs`
  - `/docs/**`
- [x] 4.3 Implement bypass rules for:
  - fixed `/welcome`
  - `admin.basePath`
  - `${admin.basePath}/login`
- [x] 4.4 Redirect denied visitors to `/welcome?next=<original-route>`
- [x] 4.5 Fail closed on access-resolution errors
- [x] 4.6 Verify admin routes remain reachable while the lock page is enabled

## 5. Implement shared access resolution

Requirements: 2, 6, 7, 9

- [x] 5.1 Add a small shared helper/composable for lock-page access checks
- [x] 5.2 Reuse existing session state/helpers rather than creating a second auth model
- [x] 5.3 Implement decision matrix for:
  - SSR auth disabled
  - lock page disabled
  - authenticated allowed
  - guest allowed
  - unauthenticated denied
  - session error fail-closed
- [x] 5.4 Add unit tests covering the full decision matrix

## 6. Developer override flow

Requirements: 4, 8

- [x] 6.1 Add an example registration path for custom lock pages in app/plugin code
- [x] 6.2 Document how deployments select a lock-page adapter id in OR3 Cloud config
- [x] 6.3 Keep the plugin override as the supported extension path
- [x] 6.4 Note that forks may replace `app/pages/welcome.vue` directly if they prefer
- [x] 6.5 Add an integration test proving a custom adapter replaces the default renderer

## 7. Documentation and wizard/config preservation

Requirements: 5, 8

- [x] 7.1 Update public OR3 Cloud config docs with lock-page settings and defaults
- [x] 7.2 Update wizard/config preservation logic so lock-page env keys are not lost on apply
- [x] 7.3 If wizard prompts are added, keep them optional and off by default
- [x] 7.4 Add developer-facing documentation or notes showing:
  - plugin-based override
  - route replacement option for forks

## 8. Verification and regression coverage

Requirements: 1 through 9

- [x] 8.1 Component/integration tests:
  - lock page disabled -> existing routing unchanged
  - lock page enabled + denied -> protected routes redirect to `/welcome`
  - lock page enabled + allowed -> protected routes render normally
  - unknown adapter -> default lock page fallback
  - `/welcome` redirects back after auth
- [x] 8.2 SSR/auth integration tests:
  - signed-out visitor on `/` is redirected to `/welcome`
  - signed-in visitor reaches shell
  - guest-access-enabled deployment behaves per policy
  - `/admin` and `/admin/login` remain reachable
- [ ] 8.3 Manual checks:
  - enable default lock page
  - sign in/out transitions
  - custom adapter switch
  - admin route bypass
  - static build remains unchanged when SSR auth is off

## Recommended implementation order

1. Ship config parsing first so the feature is inert but typed.
2. Add the registry and built-in default lock page.
3. Add `app/pages/welcome.vue`.
4. Add the global lock-page middleware and the shared access helper.
5. Add custom-adapter integration coverage.
6. Update docs and wizard/config preservation.
