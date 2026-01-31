# OR3 Cloud — Production Readiness Review (SSR Auth + Sync + Storage)

Date: 2026-01-31

Scope of this review:
- SSR auth (Clerk default), session resolution, authorization (`can()`), and SSR/static boundaries.
- Sync gateway endpoints + client sync engine (outbox/subscription/GC) at a “production hardening” level.
- Storage gateway endpoints + client transfer queue.
- Admin gating + extension install surface (as part of OR3 Cloud operational readiness).

Explicitly not repeated here:
- Items already documented in `planning/di-configs.md` and `planning/di-convex.md`.

---

## Executive Summary

The overall architecture is directionally solid (local-first Dexie + optional sync + SSR-gated auth, and SSR-only endpoints protected by `can()`). A lot of the previously-known sync pitfalls appear already addressed in code (cursor scoping, bootstrap progress guard, table list alignment, bounded pending-op fetch).

However, there are a few **production blockers** unrelated to those existing DI reports:

1) **CORS middleware is unsafe/invalid when “allow all”** (sets `Access-Control-Allow-Origin: *` while also setting `Access-Control-Allow-Credentials: true`).
2) **Authorization hook enforcement is currently a no-op** (`can()` does not apply `auth.access:filter:decision`). This undermines the “single gate” story for extensibility.
3) **Rate limiting and client IP detection are not proxy-safe** (likely wrong in real SSR deployments behind ingress/load balancers).

If you ship SSR Cloud with those as-is, you’re signing up for cross-origin confusion at best, and a security incident / operational instability at worst.

---

## Go / No-Go Checklist

### No-Go (blockers)
- Fix CORS “allow all” behavior: never combine `Access-Control-Allow-Credentials: true` with `Access-Control-Allow-Origin: *`.
- Decide and implement how `auth.access:filter:decision` is enforced server-side (or explicitly remove/disable the hook from the contract for v1).
- Make rate-limits / IP-based controls robust behind proxies (`X-Forwarded-For`, trusted proxies, or switch to user-id-only).

### Go (acceptable for first production)
- Sync is optional; local-first behavior remains intact when sync is disabled.
- Sync and storage endpoints are 404-gated when disabled.
- Admin surface has host allowlisting, basePath rewrite, and mutation intent/origin checks.

---

## Findings

### 1) CORS: invalid + risky default behavior (No-Go)

**Where**: `server/middleware/cors.ts`

**What’s happening**
- When `allowedOrigins.length === 0`, code treats this as “allow all” and sets:
  - `Access-Control-Allow-Origin: *`
  - `Access-Control-Allow-Credentials: true`

**Why this is bad**
- Browsers reject credentialed CORS responses with `*` (spec violation), causing confusing production failures.
- Security-wise, “allow all origins + credentials” is not a meaningful or safe state.

**Impact**
- Cross-origin requests will intermittently fail or behave inconsistently.
- If you later rely on cookies for SSR auth, this becomes a serious security footgun.

**Fix**
- If `allowedOrigins` is empty, either:
  - Set `Access-Control-Allow-Credentials: false` and keep `*`, OR
  - Do not emit CORS headers at all, OR
  - Prefer a safe default (deny by default; require explicit origins).
- If you intend to support credentialed CORS, you must echo a specific allowed origin.

Suggested policy:
- Default = deny cross-origin.
- If you want local dev convenience, gate “allow all” behind `import.meta.dev`.

---

### 2) `can()` does not enforce server-side access filter hooks (High)

**Where**: `server/auth/can.ts` (`applyDecisionFilters`)

**What’s happening**
- `applyDecisionFilters` is currently a stub:
  - It returns the base decision unchanged.
  - Planning docs state `auth.access:filter:decision` should be enforceable.

**Why this matters**
- Your locked design decision says `can()` is the sole authorization gate.
- If hook-based restriction is part of your extensibility model, then the SSR server must actually run those filters.

**Impact**
- Operators cannot harden/override access policy via hooks (even if the UI suggests they can).
- Future provider modes (“gateway”) will be harder to reason about because enforcement is incomplete.

**Fix options**
1) Implement a server-side hook runner that can run a restricted subset of hooks from Nitro (no Nuxt composables).
2) Explicitly remove the hook requirement from the Cloud contract for v1 and delete the dead stub.

---

### 3) Proxy-unaware client identification breaks rate limiting (High)

**Where**
- `server/api/auth/session.get.ts` uses `event.node.req.socket.remoteAddress`.
- Sync/storage endpoints use per-user rate limits (good), but session endpoint uses per-IP.

**Why this is bad in real deployments**
- Behind a reverse proxy/load balancer, `remoteAddress` is typically the proxy, so:
  - All users share one IP bucket (massive false positives).
  - Or you effectively have no meaningful per-client limiting.

**Impact**
- Login/session endpoints become easy to DoS.
- “Rate limit exceeded” appears randomly for legitimate users.

**Fix**
- Use `X-Forwarded-For` or `X-Real-IP` with a “trusted proxy” configuration.
- Or avoid IP-based limiting for session and use a safer primitive:
  - A small global limiter plus user-id limiter when authenticated.

---

### 4) Clerk provider assumes `event.context.auth()` always exists (Medium)

**Where**: `server/auth/providers/clerk/clerk-auth-provider.ts`

**What’s happening**
- The provider calls `event.context.auth()` without checking it exists.

**Why this is a problem**
- Any mismatch in middleware/module order, configuration, or partial enablement can crash session resolution.

**Context7 / Clerk docs check**
- Clerk’s Nuxt documentation currently uses `event.context.auth()` as the standard way to access auth context inside Nitro event handlers and `clerkMiddleware()`.
- I did not find an official deprecation/removal notice for `event.context.auth()` in the current Clerk docs.

**Impact**
- A configuration mistake can turn into a 500 loop across all protected endpoints.

**Fix**
- Guard `event.context.auth`:
  - If missing, return `null` (unauthenticated) or throw a clear “provider misconfigured” error.
- To make any future Clerk API change low-risk, consider wrapping access behind a tiny helper (e.g. `getClerkAuth(event)`) so you only have one call site to migrate if Clerk replaces this surface.

---

### 5) Session resolution is hard-wired to Convex workspace provisioning (Medium)

**Where**: `server/auth/session.ts`

**What’s happening**
- `resolveSessionContext()` dynamically imports Convex client and calls `api.workspaces.resolveSession` / `api.workspaces.ensure`.
- Errors in the “workspace provisioning” step are thrown (even in production).

**Why this matters**
- It’s acceptable if Convex is the only supported backend today, but it contradicts the “provider-agnostic” narrative.
- More importantly: throwing inside session resolution makes *auth dependent on backend availability*.

**Impact**
- If Convex has an outage, your SSR app becomes unusable (all auth-gated endpoints fail).
- Depending on your route guards, you may also “brick” the UI (no session, no workspace, no access).

**Fix**
- Decide the failure mode:
  - Conservative: return unauthenticated + log structured error (deny access but keep server stable).
  - Explicit: respond 503 from session endpoint when workspace store is down.
- Either way, don’t crash the whole request path with an unhandled throw.

---

### 6) Storage: presign expiry is client-influenced but not actually enforced (Medium)

**Where**
- `server/api/storage/presign-upload.post.ts`
- `server/api/storage/presign-download.post.ts`

**What’s happening**
- Client can pass `expires_in_ms`.
- Server clamps to 1h for the response’s `expiresAt`, but Convex call doesn’t receive/use the expiry.

**Why this matters**
- The returned `expiresAt` becomes “UI fiction” unless the provider actually binds the URL expiry.

**Impact**
- Client UX can become inconsistent (thinking URL is valid/invalid when it isn’t).

**Fix**
- Either:
  - Remove `expires_in_ms` from the API surface and always use server defaults, or
  - Plumb expiry into provider and return provider-derived expiry.

---

### 7) Storage: commit endpoint is not rate-limited (Medium)

**Where**: `server/api/storage/commit.post.ts`

**What’s happening**
- Upload/download presign endpoints are rate-limited.
- Commit is not.

**Impact**
- Spam/abuse can hammer your commit mutation.

**Fix**
- Apply the same per-user limiter class for `storage:commit`.

---

### 8) Admin host allowlisting may be brittle behind proxies (Medium)

**Where**
- `server/middleware/admin-gate.ts`
- `server/admin/guard.ts`

**What’s happening**
- Host allowlist checks use the `Host` header.

**Why this matters**
- Behind certain ingress setups, you may need to consider `X-Forwarded-Host`.

**Impact**
- Admin UI/API may 404 in production due to header mismatch.

**Fix**
- Decide your “trusted proxy” policy and normalize host using forwarded headers when appropriate.

---

### 9) Operational limits and multi-instance deployments (Medium)

**Where**
- Rate limiting is in-memory (`server/utils/sync/rate-limiter.ts`).
- Convex gateway client cache is per-process (`server/utils/sync/convex-gateway.ts`).

**Impact**
- In a horizontally scaled SSR deployment:
  - Limits won’t be consistent across instances.
  - Gateway client caching is less effective.

**Fix**
- For v1: document “single instance recommended” or accept soft limits.
- For scaled deployments: move rate limiting to Redis (or provider-backed), and treat gateway caching as a perf-only optimization.

---

### 10) Wire-schema consistency risk: mixed snake_case + camelCase in payload schemas (Low)

**Where**: `shared/sync/schemas.ts`

**Observation**
- Most payload schemas are snake_case, but `posts.postType` is explicitly camelCase.

**Why this matters**
- This is survivable, but it’s a schema drift trap: new tables will copy patterns inconsistently.

**Fix**
- Either commit fully to snake_case on the wire and map in UI, or clearly document which fields are exceptions and why.

---

## Notes on “already covered elsewhere”

I’ve intentionally not re-listing issues from `di-configs.md` and `di-convex.md`.

Separately: several of the sync issues in `di-convex.md` appear already addressed in code (cursor scoping, notification table alignment, bootstrap progress guard, bounded pending-op fetch). That’s good — but it’s still worth re-running the relevant unit/integration tests after you finish the remaining DI fixes.

---

## Suggested Next Steps (ordered)

1) Fix CORS policy (No-Go).
2) Decide how server-side hook enforcement works for auth (`can()` hook filters) and implement/remove accordingly.
3) Make request identity / rate limiting proxy-aware.
4) Add rate limiting for storage commit.
5) Add “misconfigured Clerk middleware” hardening (graceful failure).

If you want, I can turn the No-Go items into a concrete patch set (with tests), but I didn’t change code in this pass since you asked for analysis + a new report file.
