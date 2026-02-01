# design.md

artifact_id: D963994C-0F5F-44B1-AE07-35ADBD0BFC81

## Overview

This design implements the hardening fixes from planning/di-cloud-complete.md with a focus on:
- spec-correct CORS
- server-side enforcement of `auth.access:filter:decision` inside `can()`
- proxy-safe request identity for rate limiting and admin host gating
- resilient session resolution
- storage gateway correctness (expiry truthfulness + commit rate limit)

No breaking changes:
- existing API routes and response shapes remain stable
- any new config is optional with defaults preserving current behavior where feasible
- any schema changes accept legacy fields

## “Review of the review” (tightening the DI)

The DI report is directionally correct, but a proper remediation plan needs to correct/clarify these points:

1) `/api/auth/session` is effectively not rate-limited today.
- server/api/auth/session.get.ts calls `checkSyncRateLimit(clientIP, 'auth:session')`.
- server/utils/sync/rate-limiter.ts has no `auth:session` config, so unknown operations are allowed.
- Fix plan must add an explicit `AUTH_RATE_LIMITS` entry (or equivalent) and test it.

2) “Per-IP rate limiting is not proxy-safe” is correct, but the concrete implementation should be shared and typed.
- Multiple places need “request identity”: auth session, admin host allowlisting, potentially future endpoints.
- Fix plan should introduce a single, typesafe resolver utility rather than duplicating parsing rules.

3) The CORS issue is real and immediate.
- server/middleware/cors.ts currently emits `*` + `Allow-Credentials: true` when allowlist is empty.
- Fix plan must also avoid clobbering an existing `Vary` header.

4) The hook enforcement issue is real, and the codebase already has the right primitive.
- There is an existing server-side HookEngine (server/hooks/hook-engine.ts) used for admin hooks.
- Fix plan should reuse this primitive and add a server-side hook registry for auth decision filters.

## Architecture

### Key components

- CORS middleware: server/middleware/cors.ts
- Authorization gate: server/auth/can.ts
- Session resolution: server/auth/session.ts and server/auth/providers/clerk/clerk-auth-provider.ts
- Rate limiting: server/utils/sync/rate-limiter.ts (extend to include auth + commit)
- Request identity utilities (new): server/utils/net/request-identity.ts
- Admin allowlisting: server/middleware/admin-gate.ts and server/admin/guard.ts
- Storage gateway: server/api/storage/*.ts

### High-level flow (session endpoint)

```mermaid
flowchart LR
  A[Client] --> B[/api/auth/session]
  B --> C[resolveRequestIdentity]
  C --> D[rateLimiter.check("auth:session", ip)]
  D -->|allowed| E[resolveSessionContext]
  D -->|denied| F[429 + Retry-After]
  E --> G[Cache-Control: no-store]
  E --> H[{session|null}]
```

## Detailed design

### 1) CORS: make allow-all non-credentialed

Current behavior (server/middleware/cors.ts):
- allowAll := allowedOrigins.length === 0
- emits `Access-Control-Allow-Origin: *`
- always emits `Access-Control-Allow-Credentials: true`

Correct behavior:
- If allowAll, do NOT emit `Access-Control-Allow-Credentials: true`.
- Only emit `Access-Control-Allow-Credentials: true` when echoing an explicit origin.
- Preserve existing `Vary` values by appending `Origin` (not overwriting).

Proposed CORS policy (non-breaking default):
- In dev (`import.meta.dev`): keep allowAll semantics for convenience, but still never combine `*` with credentials.
- In prod: allowAll continues to set `*` (non-credentialed). Operators who need credentialed cross-origin must set explicit `OR3_ALLOWED_ORIGINS`.

Typesafe runtime config:
- No schema changes required; uses existing `security.allowedOrigins`.

### 2) `can()` hook enforcement (server-side)

Goal: apply `auth.access:filter:decision` inside `can()`.

Constraints:
- `can()` currently does not receive an event.
- Nitro routes must not depend on Nuxt composables.

Approach:
- Add a server-side hook engine singleton for auth filters that is safe to import and does not depend on Nuxt.
- Provide a minimal typed wrapper for the single hook we need now.
- `can()` calls the hook engine synchronously (fast path) and applies the “cannot grant” invariant.

New module: server/auth/hooks.ts

```ts
import type { AccessDecision, SessionContext } from '~/core/hooks/hook-types'

export type AuthAccessDecisionFilter = (
  decision: AccessDecision,
  ctx: { session: SessionContext | null }
) => AccessDecision

export interface AuthHookEngine {
  applyAccessDecisionFilters(decision: AccessDecision, ctx: { session: SessionContext | null }): AccessDecision
  addAccessDecisionFilter(fn: AuthAccessDecisionFilter, priority?: number): () => void
}
```

Implementation notes:
- Backed by server/hooks/hook-engine.ts.
- `applyAccessDecisionFilters` runs `applyFiltersSync('auth.access:filter:decision', decision, ctx)`.
- Enforce invariant:
  - if base.allowed === false and filtered.allowed === true => force allowed back to false and record a diagnostic.

Wiring:
- Introduce server/plugins/auth-hooks.ts that initializes the auth hook engine.
- Future: extension loader can register filters into this engine (without requiring Nuxt app runtime).

Non-breaking:
- If no filters registered, results are unchanged.

### 3) Proxy-safe request identity

Add a single, reusable utility:
- server/utils/net/request-identity.ts

Functions:

```ts
export interface ProxyTrustConfig {
  trustProxy: boolean
  forwardedForHeader?: 'x-forwarded-for' | 'x-real-ip'
  forwardedHostHeader?: 'x-forwarded-host'
}

export function getClientIp(event: H3Event, cfg: ProxyTrustConfig): string | null
export function getRequestHost(event: H3Event, cfg: ProxyTrustConfig): string | null
```

Parsing rules:
- If trustProxy:
  - `X-Forwarded-For`: take the first IP in the list.
  - Validate basic shape; if invalid, return null.
- Else:
  - Use `event.node.req.socket.remoteAddress`.

Config:
- Add optional runtime config under `security.proxy`:
  - `trustProxy` default false
  - `forwardedForHeader` default 'x-forwarded-for'
  - `forwardedHostHeader` default 'x-forwarded-host'

This is non-breaking because default is current behavior.

### 4) Rate limiter: add auth + commit operations (no API changes)

Extend server/utils/sync/rate-limiter.ts:
- Add `AUTH_RATE_LIMITS` with `auth:session`.
- Add `storage:commit` under storage limits.

Implementation detail:
- The existing limiter is keyed by a string and does not require it to be a userId; update docs to call it “subjectKey”.
- Keep function names (`checkSyncRateLimit`, `recordSyncRequest`) to avoid refactors.

Suggested limits (tune later):
- `auth:session`: 60/min per IP
- `storage:commit`: 30/min per user

### 5) `/api/auth/session` hardening

Update server/api/auth/session.get.ts:
- Use `getClientIp()` with proxy config.
- Ensure the limiter operation exists.
- Keep headers (`Retry-After`, `X-RateLimit-*`) as today.

### 6) Clerk provider resilience

Update server/auth/providers/clerk/clerk-auth-provider.ts:
- Guard `event.context.auth`:
  - if missing/non-function: return null in production; throw a clear error in dev.
- Treat missing/invalid `exp` as unauthenticated rather than throwing in production (dev can still fail fast).

This preserves behavior for correct configs and avoids “blanket 500” on misconfiguration.

### 7) Session provisioning failure mode

Current: provisioning failure throws (server/auth/session.ts).

Non-breaking strategy:
- Add optional config `auth.sessionProvisioningFailure` with default `'throw'` (preserves today).
- Support `'unauthenticated'` and `'service-unavailable'`:
  - unauthenticated: return `{ authenticated: false }` + record structured error
  - service-unavailable: throw `createError({ statusCode: 503 })` for `/api/auth/session` only (endpoint catches and maps), while other endpoints can still fail fast if desired

Implementation:
- Keep `resolveSessionContext` returning SessionContext, but catch provisioning errors and branch on config.
- Ensure dev remains strict.

### 8) Storage presign expiry truthfulness

Current: endpoint returns `expiresAt = Date.now() + expiryMs` where `expiryMs` is client-influenced, but provider call does not use it.

Non-breaking and typesafe plan:
- Continue accepting `expires_in_ms` and clamping.
- Derive `expiresAt` as:
  - If provider returns expiry: use provider expiry.
  - Else: use server-defined default (e.g. 15m) regardless of client request.

In the Convex gateway implementation, if Convex cannot provide expiry, we treat `expiresAt` as best-effort and document it.

### 9) Storage commit rate limiting

Update server/api/storage/commit.post.ts:
- Apply the same rate limit pattern used in presign endpoints.
- Operation: `storage:commit`.

### 10) Admin host allowlisting behind proxies

Update server/middleware/admin-gate.ts and server/admin/guard.ts:
- Use `getRequestHost()` with proxy config.
- Fail closed if host cannot be resolved.

Important: do NOT start trusting forwarded host unless `trustProxy` is enabled.

### 11) Wire schema casing drift containment

Update shared schema validation (shared/sync/schemas.ts) for the known exception:
- Accept both `postType` and `post_type` on input.
- Normalize to one canonical internal shape.

No breaking changes because existing payloads remain accepted.

## Error handling

Use a consistent pattern:
- For enforcement gates (`requireCan`, rate limits): throw typed H3 errors with status.
- For optional hook failures: do not crash; record diagnostics.
- For provider misconfiguration in dev: throw early.

## Testing strategy

- Unit tests:
  - CORS header matrix (allowAll, allowed origin, blocked origin; credentials on/off)
  - `can()` filter enforcement + cannot-grant invariant + filter-throws behavior
  - request identity parsing (x-forwarded-for parsing and validation)
  - rate limiter op existence and headers
- Integration tests:
  - `/api/auth/session` returns 429 after threshold and uses forwarded IP when trustProxy enabled
  - storage commit rate limited

All tests should run via `bun run test` (Vitest).
