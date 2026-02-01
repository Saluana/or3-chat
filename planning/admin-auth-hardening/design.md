---
artifact_id: 4a1c2d20-2f4c-4cbb-a3a2-e0f1e7dfd5fa
title: Design - Admin auth hardening
status: draft
owner: security
date: 2026-02-01
---

# Overview

This design addresses the high-priority vulnerabilities identified in the admin dashboard auth system.

Affected areas:
- Admin login handler: `server/api/admin/auth/login.post.ts`
- Admin user mutation endpoints: `server/api/admin/admin-users/grant.post.ts`, `server/api/admin/admin-users/revoke.post.ts`
- IP identity used by rate limiting: `server/admin/auth/rate-limit.ts` (should integrate with `server/utils/net/request-identity.ts`)
- Admin JWT secret resolution: `server/admin/auth/jwt.ts`
- Hybrid admin context resolution and per-endpoint enforcement: `server/admin/context.ts` + `server/admin/api.ts` usage

# Goals

- Make login failures constant-cost with respect to username correctness.
- Enforce least privilege on admin mutation endpoints.
- Ensure rate limiting uses proxy-safe client identity.
- Eliminate unsafe secret persistence patterns while keeping dev workable.

# Non-goals

- Replacing the hybrid model (super admin JWT + workspace admin session).
- Introducing new external dependencies.
- Changing route names or response payload shapes.

# Threat model summary

- Remote attacker can send requests to admin endpoints.
- Attacker may control request headers including `X-Forwarded-For`.
- Timing side channels are measurable at internet latencies when delta is large (bcrypt vs string compare).
- Workspace admin accounts may be compromised; they must not be able to mint new admins.

# Design details

## 1) Login timing equalization

### Current behavior
`login.post.ts` compares username before running bcrypt verification, yielding fast failure for invalid usernames.

### Proposed change
Always execute a bcrypt verification step before returning 401, regardless of whether the username matches.

Implementation approach:
- Compute `passwordValid` first.
- Combine credential checks into a single conditional:

```ts
const passwordValid = await verifyPassword(password, credentials.password_hash_bcrypt);
const ok = credentials.username === username && passwordValid;
if (!ok) { /* record failed + 401 */ }
```

Why this is sufficient here:
- The credential source is a single stored admin credential (not a DB lookup by username), so we can always run bcrypt against the stored hash.
- This equalizes wrong-username vs wrong-password latency to approximately bcrypt cost.

Optional hardening (future):
- Replace `!==` string compare with a constant-time compare (for completeness). In practice bcrypt dominates, but constant-time compare is cheap and removes micro-deltas.

## 2) Require super admin for admin grants/revokes

### Current behavior
`grant.post.ts` and `revoke.post.ts` call `requireAdminApiContext(event)` with default options, allowing both super admin and workspace admin.

### Proposed change
Use the existing `superAdminOnly` option in `requireAdminApiContext()`:

```ts
await requireAdminApiContext(event, { superAdminOnly: true, mutation: true });
```

Notes:
- This is not an API breaking change (endpoint still exists) but does tighten authorization.
- Add `mutation: true` so the admin guard can apply stricter controls if present.

## 3) Proxy-safe client IP for rate limiting

### Current behavior
`server/admin/auth/rate-limit.ts:getClientIp()` trusts `x-forwarded-for` unconditionally.

### Proposed change
Integrate the existing proxy-safe utility:
- Use `normalizeProxyTrustConfig(...)` and `getClientIp(event, cfg)` from `server/utils/net/request-identity.ts`.
- Source the proxy trust configuration from runtime config or an existing admin guard config (preferred), and use a safe fallback when IP cannot be determined.

Policy:
- If `trustProxy` is false → use socket remote address.
- If `trustProxy` is true and forwarded header is missing/invalid → fail closed to a sentinel identity (e.g. `"unknown"`) rather than accepting spoofed identity.

This avoids:
- Bypass by sending arbitrary `X-Forwarded-For`.
- DoS via exhausting rate limits for random victim IPs.

## 4) Admin JWT secret handling

### Current behavior
- In production: secret is required.
- In development: secret is generated and persisted in `.data/admin-jwt-secret`.

### Proposed change (phased, non-disruptive)

Phase A (immediate hardening):
- Stop writing a new secret to disk by default.
- Continue to accept:
  - Explicit configured secret (`OR3_ADMIN_JWT_SECRET`) in all envs.
  - Legacy `.data/admin-jwt-secret` **read-only** in development with a deprecation warning.
- If no secret is configured in development:
  - Default to an ephemeral in-memory secret per process, with a loud warning.
  - Provide an opt-in strict mode env/config flag to require explicit secret (for teams that want it).

Phase B (later, possibly next major):
- Remove legacy file support and require explicit secret everywhere.

Secret validation:
- Validate that the secret meets minimum strength, expressed as bytes not hex chars.
  - Accept either raw string or hex; normalize to bytes length.
  - Enforce $\ge 32$ bytes equivalent for HS256.

Developer tooling:
- Add a small script (Bun) to generate a recommended secret and print export instructions.

## 5) Endpoint-level sensitivity classification

### Current behavior
Many endpoints call `requireAdminApiContext(event)` without `superAdminOnly`, including mutations like workspace restore.

### Proposed change
Define a security policy table mapping endpoints to required principal:
- Super-admin only:
  - grant/revoke admin
  - any future admin credential changes
  - system configuration writes
  - destructive workspace mutations (soft-delete/restore, creates) depending on intended operator model
- Workspace-admin allowed:
  - read-only endpoints (list workspaces, search users, view workspace details)

Implementation approach:
- Do not rely on “implicit” sensitivity.
- Update each endpoint to pass `superAdminOnly: true` where appropriate.

# Testing strategy

## Unit tests (Vitest)

- Login timing hardening:
  - Mock `verifyPassword` and assert it is invoked even when `credentials.username !== username`.
  - Assert 401 response unchanged.

- Rate limiting identity:
  - Add tests for `getClientIp` in admin rate limiter verifying:
    - forwarded headers ignored when trustProxy false.
    - forwarded headers validated when trustProxy true.
    - invalid forwarded header yields `unknown` / null path.

- Authorization tightening:
  - Add tests around `requireAdminApiContext({ superAdminOnly: true })` behavior using stubbed `event.context.admin` principals.
  - Add endpoint-level tests (minimal H3 event stubs) for grant/revoke to assert 403 for workspace_admin principal.

- JWT secret behavior:
  - Validate production missing secret throws.
  - Validate legacy secret file (dev) is read-only and emits warning.
  - Validate ephemeral dev secret works without touching filesystem.

