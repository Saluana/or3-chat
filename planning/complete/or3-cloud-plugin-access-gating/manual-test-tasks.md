---
artifact_id: 9d30654e-c612-4d56-b9fb-ec60b64dc94e
title: Manual Test Tasks - OR3 Cloud plugin access gating
status: draft
owner: platform
date: 2026-02-19
---

# Manual test checklist

## 0. Setup

- [ ] Start app in SSR mode (`SSR_AUTH_ENABLED=true`) and log in as workspace owner.
- [ ] Ensure at least one test plugin is installed and enabled in workspace plugin settings.
- [ ] Ensure test users exist for: `owner`, `editor`, `viewer`, and unauthenticated session.
- [ ] If behavior looks stale, clear local cache keys and reload (`or3:server-route-available`, `or3:background-streaming-available`).

## 1. Backward compatibility (no access policy)

- [ ] Remove `settings.access` for plugin and save.
- [ ] Verify plugin surfaces behave exactly like pre-gating behavior (only enable/disable controls access).
- [ ] Verify unknown plugin settings fields are still preserved after save.

## 2. Admin policy save/load validation

- [ ] In admin plugin page, set `authRequired=true`, set entitlement to `paid`, set roles to `owner` + `editor`, save.
- [ ] Reload admin page and verify effective policy is persisted and rendered correctly.
- [ ] Submit an invalid `settings.access` payload from API client and verify `400` with validation details.

## 3. Auth gating behavior

- [ ] With `authRequired=true`, verify unauthenticated user cannot access gated plugin surfaces.
- [ ] Verify authenticated user can see gated UI only when other policy requirements are satisfied.
- [ ] Verify deny state shows non-sensitive reason text.

## 4. Entitlement gating behavior

- [ ] Configure policy to require entitlement `paid`.
- [ ] Verify user without `paid` entitlement is denied in UI and SSR route responses.
- [ ] Verify entitled user is allowed through plugin gate.
- [ ] Verify server deny reason code is `missing-entitlement` when entitlement is absent.

## 5. Role gating behavior

- [ ] Configure policy to require workspace role `owner` only.
- [ ] Verify `editor`/`viewer` users are denied and `owner` is allowed.
- [ ] Verify deny reason code is `insufficient-role` for non-owner users.

## 6. Mode behavior (`all` vs `any`)

- [ ] Set policy with multiple constraints in `mode=all`; verify all must pass.
- [ ] Switch to `mode=any`; verify any single matching constraint allows access.
- [ ] Confirm behavior is identical across dashboard, sidebar, and message actions.

## 7. Server enforcement and auth composition

- [ ] Call a plugin-protected SSR endpoint directly (outside UI) while failing policy; verify `403`.
- [ ] Confirm route still applies resource-level `can()` authorization after plugin gate passes.
- [ ] Verify `plugin-disabled` deny reason when workspace plugin is disabled.

## 8. Failure and fallback behavior

- [ ] Simulate entitlement resolver returning empty entitlements; verify policies requiring entitlements fail closed.
- [ ] Simulate invalid policy data in settings store; verify decision fails safely with `invalid-policy`.
- [ ] With SSR auth disabled/static mode, verify deterministic unauthenticated behavior for gated features.

## 9. Regression sweep

- [ ] Verify non-gated plugins still render and execute as expected.
- [ ] Verify plugin install/uninstall/enable/disable flows still work in admin UI.
- [ ] Verify no plugin settings data loss after repeated edits to `settings.access`.
- [ ] Re-run targeted test suites after manual checks if behavior drift is observed.
