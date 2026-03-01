---
artifact_id: 8cf5a3c9-6e3a-44c1-8bc0-2f0b2a5f12c7
title: Admin auth hardening (Clerk + admin dashboard)
status: draft
owner: security
date: 2026-02-01
---

# Overview

This work hardens the OR3 admin dashboard authentication and authorization surfaces under `server/admin/**` and `server/api/admin/**`.

Primary goals:
- Prevent username enumeration via timing differences on login.
- Prevent privilege escalation through insufficient authorization on admin grant/revoke and other sensitive endpoints.
- Ensure rate limiting cannot be bypassed or weaponized via spoofed proxy headers.
- Make admin JWT secret handling safe-by-default while minimizing disruption to dev flows.

Non-breaking policy for this plan:
- No API routes removed or renamed.
- Response shapes remain stable.
- Authorization may be tightened for sensitive operations (expected security behavior). Where this changes who can call an endpoint, we will (a) keep the endpoint but (b) return 403 with a clear message.
- Config tightening is introduced via phased enforcement (warnings → strict), to avoid sudden dev breakage.

# Requirements

## 1. Prevent timing-based username enumeration on admin login

**User Story 1.1**
As a security engineer, I want `/api/admin/auth/login` to take approximately the same time for invalid usernames and invalid passwords, so that attackers cannot enumerate valid admin usernames.

**Acceptance Criteria**
- WHEN a login request is made with an incorrect username THEN the handler SHALL still execute a password verification step with equivalent cost to a correct-username request.
- WHEN a login request is made with a correct username but incorrect password THEN the handler SHALL return the same status code and message as for incorrect username.
- The handler SHALL preserve existing rate limiting behavior (same keys, same limits) and SHALL not leak via distinct error messages.

## 2. Require explicit authorization for admin privilege changes

**User Story 2.1**
As an operator, I want admin privilege changes (grant/revoke) to only be possible for super admins, so that workspace admins cannot create or remove other admins.

**Acceptance Criteria**
- WHEN calling `/api/admin/admin-users/grant` THEN the endpoint SHALL require super admin access.
- WHEN calling `/api/admin/admin-users/revoke` THEN the endpoint SHALL require super admin access.
- Unauthorized callers SHALL receive 403 (not 401), preserving consistent semantics for “authenticated but insufficient privilege”.

## 3. Eliminate rate limit bypass via spoofed proxy headers

**User Story 3.1**
As a security engineer, I want IP-based rate limiting to be based on a trusted client identity, so attackers cannot bypass limits by setting `X-Forwarded-For`.

**Acceptance Criteria**
- WHEN `trustProxy` is disabled THEN client IP SHALL be sourced from the socket remote address (or a safe fallback), not `X-Forwarded-For`.
- WHEN `trustProxy` is enabled THEN client IP SHALL be parsed via the existing proxy-safe identity utility and invalid forwarded headers SHALL fail closed (not grant a new spoofed identity).
- Rate limit keys SHALL continue to be deterministic per request and not throw on missing IP.

## 4. Make admin JWT secrets safe-by-default without surprising production behavior

**User Story 4.1**
As an operator, I want the admin JWT secret to be explicitly configured and validated, so that secrets are not silently generated or persisted in insecure ways.

**Acceptance Criteria**
- IF `OR3_ADMIN_JWT_SECRET` is missing in production THEN the server SHALL refuse to sign/verify admin JWTs and SHALL surface a clear, actionable error.
- The configured secret SHALL be validated for minimum strength (byte length) and SHALL reject obviously weak values.
- Development behavior SHALL avoid writing secrets to disk by default.

**User Story 4.2**
As a developer, I want a non-disruptive upgrade path from the legacy `.data/admin-jwt-secret` behavior, so local dev does not unexpectedly break.

**Acceptance Criteria**
- IF legacy `.data/admin-jwt-secret` exists THEN the system MAY continue to read it in development for a deprecation window, but SHALL emit a deprecation warning.
- IF no secret is configured in development THEN behavior SHALL be controlled by an explicit flag:
  - Default: generate an ephemeral in-memory secret and warn loudly (no disk writes).
  - Optional strict mode: require explicit `OR3_ADMIN_JWT_SECRET` and throw.

## 5. Reduce privilege escalation risks for workspace admin sessions

**User Story 5.1**
As a security engineer, I want “workspace admin” sessions to have limited access to non-destructive admin endpoints only, so that a compromised workspace admin cannot become equivalent to a super admin.

**Acceptance Criteria**
- Sensitive operations (admin grants/revokes, credential changes, system configuration writes, destructive workspace mutations) SHALL require `superAdminOnly: true` in `requireAdminApiContext()`.
- Non-sensitive “read-only” admin endpoints MAY remain accessible to workspace admins when appropriate.
- The authorization policy SHALL be explicit per endpoint (not implicit).

## 6. Test coverage

**User Story 6.1**
As a maintainer, I want regression tests for these security invariants, so future refactors do not reintroduce vulnerabilities.

**Acceptance Criteria**
- Unit tests SHALL cover:
  - Login timing equalization behavior (structural test: verify password verification is invoked for wrong username path).
  - Rate limiter IP extraction honoring proxy trust config.
  - Grant/revoke endpoints enforcing `superAdminOnly`.
  - JWT secret validation and dev-mode behavior (legacy file + ephemeral + strict).
- Tests SHALL not require external services (Clerk/Convex) and SHALL be runnable via `bun run test`.
