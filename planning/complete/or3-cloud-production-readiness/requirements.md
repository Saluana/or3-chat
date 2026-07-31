# OR3 Cloud — Production Readiness Requirements

## Introduction

OR3 Cloud has been developed across 15+ feature areas: SSR auth, sync, storage, background jobs, notifications, admin dashboard, install wizard, five provider packages, and more. All major features are implemented, but a comprehensive audit reveals critical bugs in default-stack providers, missing production infrastructure (health checks, graceful shutdown, structured error handling), incomplete security hardening, and ~158 leftover tasks across completed plans.

This document defines the requirements for making OR3 Cloud **production-ready**: safe for real users, real data, and real deployments.

### Scope

This plan focuses exclusively on items that **block or risk production deployment**. It does not cover:
- Theme improvements (cosmetic, deferred)
- Sidebar homepage polish (cosmetic, deferred)
- n8n integration (ideation only)
- Optional admin adapters (non-MVP)
- Deferred unit tests for stable, low-risk code paths

### Priority Tiers

- **P0 — Blocking**: Data loss, security vulnerability, or broken functionality that prevents deployment.
- **P1 — Critical**: Production infrastructure that's standard for any serious deployment.
- **P2 — Important**: Security hardening and robustness items that should ship soon after launch.
- **P3 — Follow-up**: Polish, docs, and nice-to-haves for post-launch.

---

## P0 — Blocking Requirements

### 1. Default-Stack Provider Bugs

> As a deployer using the default stack (basic-auth + sqlite + fs), I need all three providers to function correctly, so that data is stored safely and users can authenticate reliably.

**1.1 — FS Storage Hash Format**
- WHEN a client uploads a file with hash format `sha256:<hex>` THEN the FS provider SHALL accept and resolve the path correctly.
- WHEN a file is uploaded THEN the server SHALL verify the uploaded bytes match the claimed hash before committing.

**1.2 — FS Storage GC**
- WHEN storage GC is triggered THEN the FS provider SHALL delete orphaned blobs from disk and return an accurate `deleted_count`.

**1.3 — SQLite Workspace Isolation**
- WHEN two workspaces contain entities with the same ID THEN the materialized sync tables SHALL store them independently without `UNIQUE constraint` collisions.
- WHEN an entity is pushed for workspace A THEN it SHALL NOT be visible in workspace B's pull response.

**1.4 — SQLite Tombstone Upsert**
- WHEN a delete operation is pushed for an entity that already has a tombstone THEN the tombstone SHALL be updated in-place, not duplicated.

**1.5 — SQLite Concurrent User Creation**
- WHEN two concurrent requests attempt `getOrCreateUser` for the same identity THEN exactly one user SHALL be created and both requests SHALL succeed.

**1.6 — Basic-Auth Refresh Flow**
- WHEN a user's access token expires THEN the auth plugin SHALL automatically use the refresh token to obtain a new access token without logging the user out.
- WHEN the refresh token itself is expired THEN the user SHALL be redirected to login.

**1.7 — Basic-Auth JWT Algorithm Constraint**
- WHEN verifying a JWT THEN `jwt.verify()` SHALL specify `algorithms: ['HS256']` explicitly.

**1.8 — Basic-Auth Rate Limiter Memory**
- WHEN the rate limiter tracks login attempts THEN it SHALL use an LRU or TTL-bounded store, not an unbounded `Map`.

### 2. Auth UI Provider Agnosticism

> As a deployer using basic-auth (not Clerk), I need the sidebar auth button to work with my auth provider, so that users can sign in without Clerk being installed.

**2.1 — AuthUiAdapter Registry**
- WHEN OR3 starts THEN it SHALL resolve the auth UI adapter from the registered provider, not hardcode `SidebarAuthButtonClerk`.
- WHEN no auth UI adapter is registered THEN a fallback (username/login link) SHALL be rendered.

---

## P1 — Critical Production Infrastructure

### 3. Health Check Endpoint

> As a deployer running OR3 behind a load balancer or in a container, I need a health check endpoint, so that orchestrators can determine if the instance is alive and ready.

**3.1**
- WHEN `GET /api/health` is called THEN the server SHALL return `200 { status: 'ok', timestamp }` if the process is healthy.
- WHEN optional deep checks are requested (`?deep=true`) THEN the response SHALL include provider connectivity status.

### 4. Graceful Shutdown

> As a deployer, I need the server to drain connections and clean up on shutdown, so that in-flight requests complete and no data is lost.

**4.1**
- WHEN the process receives `SIGTERM` or `SIGINT` THEN the server SHALL stop accepting new connections, wait for in-flight requests to complete (up to a configurable timeout), flush any pending state, and then exit cleanly.
- WHEN background jobs are in-flight during shutdown THEN their state SHALL be logged and, where possible, marked for recovery.

### 5. Structured Error Handling

> As a deployer, I need unhandled errors to be logged in a structured format and not leak internal details, so that I can debug issues and protect users.

**5.1**
- WHEN an unhandled error occurs in any API route THEN the server SHALL log the error with structured metadata (request path, method, status, timestamp) and return a sanitized error response.
- WHEN running in production THEN stack traces SHALL NOT be included in HTTP responses.

### 6. Cache-Control on Sensitive Endpoints

> As a security-conscious deployer, I need sync and storage API responses to not be cached by intermediaries, so that sensitive workspace data is not leaked.

**6.1**
- WHEN a sync push/pull or storage presign response is returned THEN it SHALL include `Cache-Control: no-store` headers.

---

## P2 — Security Hardening

### 7. Admin Auth Hardening

> As a deployer exposing the admin dashboard, I need the admin auth system to be hardened against common attacks, so that the admin panel is safe.

**7.1 — Login Timing**
- WHEN a login attempt fails (wrong username or wrong password) THEN the response time SHALL be constant (always run bcrypt) and the error message SHALL be identical.

**7.2 — Admin Grants Authorization**
- WHEN a workspace admin attempts to grant or revoke admin access THEN the endpoint SHALL reject with 403.
- WHEN a super admin attempts the same THEN it SHALL succeed.

**7.3 — Admin JWT Secret**
- WHEN running in production without `OR3_ADMIN_JWT_SECRET` set THEN the server SHALL fail to start with a clear error message (no auto-generation).

**7.4 — Endpoint Sensitivity Audit**
- WHEN an admin endpoint performs a mutation or reveals sensitive data THEN it SHALL require super admin authorization.

### 8. FS Storage Security

> As a deployer, I need file storage to be secure against replay and integrity attacks.

**8.1 — Presigned URL Binding**
- WHEN a presigned upload/download URL is generated THEN it SHALL be bound to the requesting user's session (not just a signature check).

**8.2 — Upload Size Validation**
- WHEN the FS provider receives an upload THEN it SHALL enforce a configurable maximum file size server-side.

**8.3 — Startup Config Validation**
- WHEN `OR3_STORAGE_FS_ROOT` or `OR3_STORAGE_FS_TOKEN_SECRET` is missing THEN the server SHALL log a clear error at startup rather than failing at request time.

### 9. Sync Security

> As a deployer, I need sync endpoints to be robust against abuse.

**9.1 — GC Authorization**
- WHEN a sync GC endpoint is called THEN it SHALL require `workspace.admin` permission, not just `workspace.write`.

**9.2 — GC Rate Limiting**
- WHEN sync GC endpoints are called THEN they SHALL be rate-limited to prevent abuse.

### 10. Auto-Provisioning Control

> As a deployer, I need to control whether new users are automatically provisioned, so that I can run a closed deployment.

**10.1**
- WHEN `OR3_AUTH_AUTO_PROVISION=false` is set THEN new auth tokens SHALL NOT automatically create users and workspaces.
- WHEN auto-provisioning is disabled and an unknown user authenticates THEN the response SHALL be a clear "registration disabled" error.

---

## P3 — Follow-up Items

### 11. DevTools Production Gate
- WHEN running in production THEN Nuxt DevTools SHALL be disabled.

### 12. CORS Max-Age
- WHEN CORS preflight responses are sent THEN they SHALL include a configurable `Access-Control-Max-Age` header.

### 13. Per-User Resource Limits
- Background jobs SHALL enforce per-user concurrency limits (not just global).
- Storage SHALL enforce per-workspace quota when configured.

### 14. Wire Schema Casing
- Sync schema validation SHALL accept both camelCase and snake_case and normalize to snake_case.

### 15. Configurable Hardcoded Values
- MIME type allowlist SHALL be configurable.
- Rate limit thresholds SHALL be overridable via runtime config.
- GC retention period SHALL be configurable.
- OpenRouter URL SHALL be configurable for proxy setups.

### 16. Documentation
- Provider docs (basic-auth, sqlite, fs) SHALL be published.
- Provider compatibility matrix SHALL be documented.
- Migration guide from Clerk+Convex to default stack SHALL be published.
- Deployment/operations guide covering env vars, scaling, monitoring SHALL be created.

### 17. Notification Center Verification
- All notification types (AI completion, sync conflict, system warning) SHALL be manually verified end-to-end.
- Notification hooks SHALL be documented in the hook catalog.

### 18. SQLite Additional Hardening
- `setActiveWorkspace` SHALL reject soft-deleted workspaces.
- `removeWorkspace` SHALL update active workspace for ALL affected members, not just the actor.
- Duplicate `op_id` in a push batch SHALL be deduplicated, not crash the transaction.
- Missing `OR3_SQLITE_DB_PATH` SHALL log a warning (not silently use `:memory:`).

### 19. Basic-Auth Additional Hardening
- Proxy handling SHALL use core's `normalizeProxyTrustConfig` + request identity helpers.
- Bootstrap bcrypt hash SHALL be skipped when account already exists.

### 20. Password Validation Consistency
- Wizard and admin SHALL enforce the same minimum password requirements (12 chars with complexity).
