# OR3 Chat + OR3 Cloud Production Readiness Report

Date: 2026-02-23
Audited areas: Sync layer, Storage layer, Auth layer, Admin panel, Installation wizard

## Verdict

**Not ready for production yet.**

Core sync/storage/auth foundations are mostly in place, and many previously flagged issues are fixed. The remaining blockers are primarily in admin security/authorization and operational readiness.

## Executive Summary

- Sync and storage pipelines are largely production-shaped (rate limiting, no-store on sensitive endpoints, outbox deferral for 429/503, provider hardening in fs/s3/sqlite/basic-auth packages).
- Wizard critical issues from prior reviews are mostly resolved (token persistence, transient secret pruning, S3 TTL validation, Convex env apply path).
- **Admin hardening still has critical gaps**: broken generic rate limiting, spoofable IP trust, and mutation/super-admin policy inconsistencies.
- Ops hardening is partial: shutdown is not true connection draining, and deep health checks do not validate real provider connectivity.

## High-Priority Blockers (Fix Before Production)

### 1) Generic admin rate limiting is effectively non-functional

- File: `server/admin/auth/rate-limit.ts:197`
- Problem: `checkGenericRateLimit()` returns for first request without storing state, so repeated requests keep getting treated as first request.
- Evidence: repeated calls return unchanged `remaining: 19` (verified with `bun -e` smoke check).
- Impact: admin API rate limiting can be bypassed by default behavior.

### 2) Admin IP identity is spoofable in multiple paths

- File: `server/admin/auth/rate-limit.ts:161`
- Problem: `getClientIp()` uses `getRequestIP(..., { xForwardedFor: true })` unconditionally instead of trust-proxy-aware helpers.
- Impact: attackers can spoof `X-Forwarded-For` to evade rate limits in non-trusted deployments.

- File: `server/api/admin/extensions/install.post.ts:93`
- Problem: route directly trusts raw `x-forwarded-for` header.
- Impact: per-IP install limit can be trivially bypassed.

### 3) Mutation guard/CSRF intent checks are skipped on several POST admin endpoints

- File: `server/admin/api.ts:123`
- Guard behavior: CSRF/intent checks (`requireAdminMutation`) only run when `mutation: true` is passed.
- Affected POST routes not passing mutation options:
  - `server/api/admin/workspaces.post.ts:72`
  - `server/api/admin/workspaces/restore.post.ts:32`
  - `server/api/admin/workspaces/soft-delete.post.ts:48`
  - `server/api/admin/admin-users/grant.post.ts:51`
  - `server/api/admin/admin-users/revoke.post.ts:39`
- Impact: hardening contract for admin mutations is inconsistent.

### 4) Super-admin policy is inconsistent for global workspace admin operations

- File: `server/api/admin/workspaces/[id].get.ts:21`
- Comment claims super-admin semantics, but enforcement is `requireAdminApiContext(event)` without `superAdminOnly`.
- Similar pattern in create/restore/soft-delete workspace routes.
- Impact: role boundaries are unclear; privileged actions may be broader than intended.

## Important Gaps (P1/P2 but not immediate exploit blockers)

### 5) Graceful shutdown is not true draining

- File: `server/plugins/graceful-shutdown.ts:40`
- Current behavior: logs, waits fixed timeout, then exits.
- Missing: stop accepting new connections and explicit in-flight connection/request drain semantics.

### 6) Deep health check is mostly config-shape, not real connectivity

- File: `server/api/health.get.ts:50`
- `?deep=true` reports provider flags from runtime config, not live dependency checks.
- Risk: false healthy signals during provider outages.

### 7) Basic-auth refresh exists, but global 401 retry flow remains limited

- Refresh endpoint exists: `../or3-provider-basic-auth/src/runtime/server/api/basic-auth/refresh.post.ts`
- Silent refresh paths exist in UI/status components:
  - `../or3-provider-basic-auth/src/runtime/components/SidebarAuthButtonBasic.client.vue:83`
  - `../or3-provider-basic-auth/src/runtime/plugins/auth-status.client.ts:20`
- Gap: no general request-layer 401 interceptor/retry mechanism across all client API calls.
- Risk: token-expiry UX can still degrade under active workloads.

## Layer-by-Layer Readiness Snapshot

### Sync layer

Status: **Mostly ready**

- Outbox defers transport 429/503 without incrementing attempts (`app/core/sync/outbox-manager.ts:313` + tests).
- Gateway provider propagates `Retry-After` into structured error metadata (`app/core/sync/providers/gateway-sync-provider.ts:141`).
- GC endpoints require elevated permission and are rate limited (`server/api/sync/gc-*.post.ts`).
- Remaining: load/stress verification and a few checklist tests not completed in planning docs.

### Storage layer

Status: **Mostly ready**

- Core presign input validation in place (`server/api/storage/presign-upload.post.ts:31`, `server/api/storage/presign-download.post.ts:27`).
- S3 adapter hardening present (storage_id binding, commit HEAD field enforcement, GC scan bound):
  - `../or3-provider-s3/src/runtime/server/storage/s3-storage-gateway-adapter.ts:223`
  - `../or3-provider-s3/src/runtime/server/storage/s3-storage-gateway-adapter.ts:282`
  - `../or3-provider-s3/src/runtime/server/storage/s3-storage-gateway-adapter.ts:375`
- S3 invalid config fails fast when selected (`../or3-provider-s3/src/runtime/server/plugins/register.ts:18`).

### Auth layer

Status: **Near-ready with one UX/robustness gap**

- JWT algorithm pinning implemented (`../or3-provider-basic-auth/src/runtime/server/lib/jwt.ts:97`).
- Refresh route, rotation, replay detection, and tests exist.
- Auth UI adapter registry path is present and provider registration works:
  - `app/core/auth-ui/registry.ts:15`
  - `app/plugins/10.auth-ui-registry.client.ts:7`
  - `../or3-provider-basic-auth/src/runtime/plugins/basic-auth-ui.client.ts:46`
- Remaining: stronger global request retry/refresh strategy for expired access tokens.

### Admin panel

Status: **Not ready (security blockers)**

- Broken generic rate limiting, IP spoofing exposure, and inconsistent mutation/super-admin enforcement remain.

### Installation wizard

Status: **Mostly ready**

- Token/session continuity fixed (`app/wizard/composables/useWizardSession.ts:726`, `server/middleware/wizard-token-auth.ts:91`).
- Secret cache pruning fixed (`shared/cloud/wizard/api.ts:421`).
- Convex env apply wired into web deploy path (`server/wizard/index.ts:398`).
- S3 TTL validation now strict (`shared/cloud/wizard/validation.ts:242`).

## Quick Test Evidence

Command run:

`bunx vitest run server/admin/auth/__tests__/rate-limit.test.ts app/core/sync/__tests__/outbox-manager.test.ts server/api/storage/__tests__/presign-upload.post.test.ts server/api/storage/__tests__/presign-download.post.test.ts`

Result:

- 4 test files passed
- 37 tests passed

Note: existing tests do not currently catch the `checkGenericRateLimit()` state-persistence bug.

## Release Recommendation

**Recommendation: No-Go for production right now.**

Minimum fixes before go-live:

1. Fix admin generic rate limiter state tracking and add regression tests.
2. Replace admin IP resolution with trust-proxy-aware helpers everywhere.
3. Enforce `mutation: true` on all POST/PUT/PATCH/DELETE admin routes using `requireAdminApiContext`.
4. Complete super-admin policy classification and enforce it consistently for global workspace/admin-user operations.
5. Upgrade graceful shutdown to real connection draining behavior.

After these are done, re-run targeted security tests + a short staging soak, then reassess for launch.
