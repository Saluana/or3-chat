# requirements.md

artifact_id: 3374299D-8258-4658-8B45-4EC092E5884A

## Introduction

This plan hardens OR3 Cloud SSR Auth + Sync + Storage based on the findings in planning/di-cloud-complete.md.

Constraints:
- No breaking changes to public APIs or wire formats.
- Static builds remain unchanged; SSR-only code stays in server/** and is gated by existing feature flags.
- Changes must be typesafe, testable, and minimal.

## Requirements

### 1. CORS must be spec-correct and predictable

1.1 As a deployment operator, I want CORS behavior that is standards-compliant, so that browser clients behave consistently.
- WHEN `security.allowedOrigins` is empty THEN the server SHALL NOT emit the invalid combination `Access-Control-Allow-Origin: *` with `Access-Control-Allow-Credentials: true`.
- WHEN credentials are enabled for CORS THEN the server SHALL echo back an explicit allowed `Origin` and SHALL set `Vary: Origin` without clobbering existing `Vary` values.
- WHEN an `Origin` header is not present THEN the CORS middleware SHALL do nothing.
- WHEN an `Origin` is not in the allowlist THEN the server SHALL NOT emit CORS headers.
- WHEN handling preflight (`OPTIONS`) THEN the server SHALL respond `204` and SHALL include `Access-Control-Allow-Methods` and `Access-Control-Allow-Headers`.

1.2 As a developer, I want an ergonomic local-dev experience, so that local tooling works without insecure production defaults.
- IF running in dev mode THEN the server MAY allow permissive CORS defaults.
- IF running in production mode THEN permissive “allow all origins” SHALL NOT enable credentials.

### 2. `can()` must enforce access decision filters (server-side)

2.1 As a platform engineer, I want `can()` to be the single enforcement point, so that SSR endpoints are consistently secured.
- WHEN `can()` produces an `AccessDecision` THEN it SHALL apply the `auth.access:filter:decision` filter hook.
- WHEN no filters are registered THEN the final decision SHALL equal the base decision.

2.2 As an extension author/operator, I want the filter hook to be able to restrict but not grant access, so that policies are safe.
- WHEN a filter changes `allowed` from `false` to `true` THEN the server SHALL treat this as invalid and SHALL ignore the grant (or override back to `false`) and SHALL record a diagnostic.
- WHEN a filter changes `allowed` from `true` to `false` THEN the server SHALL deny access.

2.3 As an operator, I want enforcement to be safe in failure cases.
- IF a filter throws THEN the server SHALL not crash the request and SHALL treat the filter as “no-op” while recording diagnostics.

### 3. Rate limiting and client identification must be proxy-safe

3.1 As an operator, I want correct client identity behind proxies, so that IP-based limits work as intended.
- WHEN a trusted proxy mode is enabled THEN the server SHALL use `X-Forwarded-For` / `X-Real-IP` (per configured precedence) to resolve the client IP.
- WHEN trusted proxy mode is disabled THEN the server SHALL fall back to the socket address.

3.2 As a security engineer, I want the session endpoint protected against abuse, so that it can’t be trivially DoS’d.
- WHEN calling `/api/auth/session` THEN the server SHALL apply a rate limit policy.
- WHEN the rate limit is exceeded THEN the server SHALL respond `429` and SHALL set `Retry-After`.

3.3 As a developer, I want limits to remain soft and non-breaking in v1.
- WHEN running multiple SSR instances THEN the system SHALL document that in-memory limits are best-effort.

### 4. Clerk provider session resolution must be resilient to middleware misconfiguration

4.1 As an operator, I want SSR to fail gracefully if Clerk middleware is not installed or ordered correctly, so that I don’t get blanket 500s.
- IF `event.context.auth` is missing or not callable THEN the Clerk provider SHALL return unauthenticated (or a clear structured error in dev) without throwing unhandled exceptions in production.

### 5. Session-to-workspace provisioning must not brick the server in production

5.1 As an operator, I want predictable failure behavior when the workspace store is unavailable, so that outages are handled intentionally.
- WHEN provisioning fails THEN behavior SHALL be configurable (non-breaking default), and SHALL avoid uncontrolled crashes.
- IF configured for “graceful” mode THEN the server SHALL return an unauthenticated session (or a structured 503 from `/api/auth/session`) instead of throwing.

### 6. Storage presign expiry must be truthful (or explicitly best-effort)

6.1 As a client developer, I want `expiresAt` to be accurate, so that the UI and retry logic behave correctly.
- WHEN the server returns `expiresAt` THEN it SHALL be derived from provider output when possible.
- IF provider output cannot supply expiry THEN the server SHALL return a server-defined best-effort expiry and SHALL not pretend client-chosen expiry is enforced.
- WHEN `expires_in_ms` is supplied THEN the server SHALL clamp it to a server maximum.

### 7. Storage commit must be rate-limited

7.1 As an operator, I want storage commit protected, so that commit mutations can’t be spammed.
- WHEN calling `/api/storage/commit` THEN the server SHALL enforce a per-user rate limit.

### 8. Admin host allowlisting must work behind proxies without weakening security

8.1 As an operator, I want admin host allowlisting to work behind reverse proxies, so that deployments don’t randomly 404.
- WHEN trusted proxy mode is enabled THEN admin host checks SHALL use forwarded host headers per config.
- WHEN trusted proxy mode is disabled THEN host checks SHALL use the `Host` header.
- WHEN forwarded headers are invalid THEN the server SHALL deny access (fail closed).

### 9. Wire schema drift must be contained without breaking existing clients

9.1 As a maintainer, I want consistent wire casing, so that schema evolution is predictable.
- WHEN validating inbound payloads THEN the schema SHALL accept legacy camelCase fields where they already exist.
- WHEN emitting payloads THEN the server/client SHALL emit the canonical snake_case form.
- The above SHALL be implemented without breaking existing stored data or clients.

### 10. Regression test coverage for hardening fixes

10.1 As a maintainer, I want tests that lock in the corrected behaviors.
- WHEN CORS headers are emitted THEN tests SHALL cover the credentialed + allow-all invalid combination.
- WHEN `can()` filters are present THEN tests SHALL cover “cannot grant” invariant and error handling.
- WHEN trusted proxy mode is enabled THEN tests SHALL cover IP/host resolution logic.
- WHEN storage commit is called THEN tests SHALL cover rate limit enforcement.
