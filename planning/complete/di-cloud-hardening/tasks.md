# tasks.md

artifact_id: E3624F2E-F8A0-407F-9B83-64EDE6F88C0C

## 1. CORS hardening (Requirements: 1.1, 1.2)

- [x] Update server/middleware/cors.ts to never emit `*` with `Allow-Credentials: true`.
- [x] Append `Vary: Origin` instead of overwriting existing `Vary`.
- [x] Add unit tests for CORS header matrix.

## 2. Auth decision filter enforcement in `can()` (Requirements: 2.1, 2.2, 2.3)

- [x] Add server/auth/hooks.ts implementing a minimal, typed auth hook engine backed by server/hooks/hook-engine.ts.
- [x] Add server/plugins/auth-hooks.ts to initialize the auth hook engine.
- [x] Update server/auth/can.ts to apply `auth.access:filter:decision` and enforce "cannot grant" invariant.
- [x] Add unit tests covering:
  - [x] no filters => decision unchanged
  - [x] filter can restrict allowed=true -> false
  - [x] filter cannot grant allowed=false -> true (must be ignored/overridden)
  - [x] filter throws => decision unchanged + diagnostic increment

## 3. Proxy-safe request identity utilities (Requirements: 3.1, 8.1)

- [x] Add server/utils/net/request-identity.ts with `getClientIp()` and `getRequestHost()`.
- [x] Extend runtime config to include `security.proxy` (optional) and plumb from config.or3cloud.ts + nuxt.config.ts.
- [x] Add unit tests for:
  - [x] trustProxy=false => socket address
  - [x] trustProxy=true => parses X-Forwarded-For first entry
  - [x] invalid forwarded values => null

## 4. Rate limiter: add missing operations (Requirements: 3.2, 7.1)

- [x] Extend server/utils/sync/rate-limiter.ts:
  - [x] Add `AUTH_RATE_LIMITS` containing `auth:session`
  - [x] Add `storage:commit`
  - [x] Update docs/comments to treat the identifier as a generic subject key
- [x] Add unit test verifying unknown operations are allowed and known ops are enforced.

## 5. Session endpoint hardening (Requirements: 3.2, 3.3)

- [x] Update server/api/auth/session.get.ts:
  - [x] Use `getClientIp()`
  - [x] Rate limit using `auth:session`
  - [x] Keep response shape stable
- [ ] Add integration test ensuring 429 after threshold.

## 6. Clerk provider misconfiguration resilience (Requirements: 4.1)

- [x] Update server/auth/providers/clerk/clerk-auth-provider.ts:
  - [x] Guard `event.context.auth` existence
  - [x] Make missing/invalid claims non-fatal in production
  - [x] Keep fail-fast behavior in dev
- [x] Add unit test stubbing event.context.auth missing.

## 7. Session provisioning failure mode (Requirements: 5.1)

- [x] Add optional config `auth.sessionProvisioningFailure` with default `'throw'`.
- [x] Update server/auth/session.ts provisioning catch:
  - [x] `'throw'`: preserve behavior
  - [x] `'unauthenticated'`: return unauthenticated session with structured logging
  - [x] `'service-unavailable'`: throw 503 (and ensure session endpoint maps correctly)
- [x] Add tests for each mode (unit-level with mocked Convex client).

## 8. Storage presign expiry truthfulness (Requirements: 6.1)

- [x] Update server/api/storage/presign-upload.post.ts and presign-download.post.ts:
  - [x] Clamp `expires_in_ms`
  - [x] Derive `expiresAt` from provider when available, else use a server-defined default
  - [x] Ensure response shape stays the same
- [x] Add unit tests for expiry clamping and “provider has no expiry” behavior.

## 9. Storage commit rate limiting (Requirements: 7.1)

- [x] Update server/api/storage/commit.post.ts to enforce rate limit `storage:commit`.
- [x] Add integration test for commit rate limiting.

## 10. Admin host allowlisting behind proxies (Requirements: 8.1)

- [x] Update server/middleware/admin-gate.ts to use `getRequestHost()` when `trustProxy` enabled.
- [x] Update server/admin/guard.ts similarly for both request gating and mutation origin/host checks.
- [x] Add tests for forwarded host behavior when trustProxy enabled/disabled.

## 11. Wire schema casing drift containment (Requirements: 9.1)

- [ ] Update shared/sync/schemas.ts to accept both legacy camelCase and canonical snake_case where drift already exists.
- [ ] Add unit tests verifying both shapes parse and normalize.

## 12. Documentation + rollout notes (Requirements: 3.3, 10.1)

- [ ] Update planning/or3-cloud/findings.md to mark these DI items as resolved once implemented.
- [ ] Add a short operator note documenting:
  - [ ] CORS semantics with empty allowlist
  - [ ] trusted proxy configuration
  - [ ] rate limit defaults and multi-instance limitations
