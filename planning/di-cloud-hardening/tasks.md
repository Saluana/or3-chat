# tasks.md

artifact_id: E3624F2E-F8A0-407F-9B83-64EDE6F88C0C

## 1. CORS hardening (Requirements: 1.1, 1.2)

- [ ] Update server/middleware/cors.ts to never emit `*` with `Allow-Credentials: true`.
- [ ] Append `Vary: Origin` instead of overwriting existing `Vary`.
- [ ] Add unit tests for CORS header matrix.

## 2. Auth decision filter enforcement in `can()` (Requirements: 2.1, 2.2, 2.3)

- [ ] Add server/auth/hooks.ts implementing a minimal, typed auth hook engine backed by server/hooks/hook-engine.ts.
- [ ] Add server/plugins/auth-hooks.ts to initialize the auth hook engine.
- [ ] Update server/auth/can.ts to apply `auth.access:filter:decision` and enforce “cannot grant” invariant.
- [ ] Add unit tests covering:
  - [ ] no filters => decision unchanged
  - [ ] filter can restrict allowed=true -> false
  - [ ] filter cannot grant allowed=false -> true (must be ignored/overridden)
  - [ ] filter throws => decision unchanged + diagnostic increment

## 3. Proxy-safe request identity utilities (Requirements: 3.1, 8.1)

- [ ] Add server/utils/net/request-identity.ts with `getClientIp()` and `getRequestHost()`.
- [ ] Extend runtime config to include `security.proxy` (optional) and plumb from config.or3cloud.ts + nuxt.config.ts.
- [ ] Add unit tests for:
  - [ ] trustProxy=false => socket address
  - [ ] trustProxy=true => parses X-Forwarded-For first entry
  - [ ] invalid forwarded values => null

## 4. Rate limiter: add missing operations (Requirements: 3.2, 7.1)

- [ ] Extend server/utils/sync/rate-limiter.ts:
  - [ ] Add `AUTH_RATE_LIMITS` containing `auth:session`
  - [ ] Add `storage:commit`
  - [ ] Update docs/comments to treat the identifier as a generic subject key
- [ ] Add unit test verifying unknown operations are allowed and known ops are enforced.

## 5. Session endpoint hardening (Requirements: 3.2, 3.3)

- [ ] Update server/api/auth/session.get.ts:
  - [ ] Use `getClientIp()`
  - [ ] Rate limit using `auth:session`
  - [ ] Keep response shape stable
- [ ] Add integration test ensuring 429 after threshold.

## 6. Clerk provider misconfiguration resilience (Requirements: 4.1)

- [ ] Update server/auth/providers/clerk/clerk-auth-provider.ts:
  - [ ] Guard `event.context.auth` existence
  - [ ] Make missing/invalid claims non-fatal in production
  - [ ] Keep fail-fast behavior in dev
- [ ] Add unit test stubbing event.context.auth missing.

## 7. Session provisioning failure mode (Requirements: 5.1)

- [ ] Add optional config `auth.sessionProvisioningFailure` with default `'throw'`.
- [ ] Update server/auth/session.ts provisioning catch:
  - [ ] `'throw'`: preserve behavior
  - [ ] `'unauthenticated'`: return unauthenticated session with structured logging
  - [ ] `'service-unavailable'`: throw 503 (and ensure session endpoint maps correctly)
- [ ] Add tests for each mode (unit-level with mocked Convex client).

## 8. Storage presign expiry truthfulness (Requirements: 6.1)

- [ ] Update server/api/storage/presign-upload.post.ts and presign-download.post.ts:
  - [ ] Clamp `expires_in_ms`
  - [ ] Derive `expiresAt` from provider when available, else use a server-defined default
  - [ ] Ensure response shape stays the same
- [ ] Add unit tests for expiry clamping and “provider has no expiry” behavior.

## 9. Storage commit rate limiting (Requirements: 7.1)

- [ ] Update server/api/storage/commit.post.ts to enforce rate limit `storage:commit`.
- [ ] Add integration test for commit rate limiting.

## 10. Admin host allowlisting behind proxies (Requirements: 8.1)

- [ ] Update server/middleware/admin-gate.ts to use `getRequestHost()` when `trustProxy` enabled.
- [ ] Update server/admin/guard.ts similarly for both request gating and mutation origin/host checks.
- [ ] Add tests for forwarded host behavior when trustProxy enabled/disabled.

## 11. Wire schema casing drift containment (Requirements: 9.1)

- [ ] Update shared/sync/schemas.ts to accept both legacy camelCase and canonical snake_case where drift already exists.
- [ ] Add unit tests verifying both shapes parse and normalize.

## 12. Documentation + rollout notes (Requirements: 3.3, 10.1)

- [ ] Update planning/or3-cloud/findings.md to mark these DI items as resolved once implemented.
- [ ] Add a short operator note documenting:
  - [ ] CORS semantics with empty allowlist
  - [ ] trusted proxy configuration
  - [ ] rate limit defaults and multi-instance limitations
