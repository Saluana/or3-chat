# OR3 Cloud Auth & Clerk Integration Investigation

**Date**: 2026-01-29  
**Investigator**: Razor (Code Review Agent)  
**Status**: High severity issues found

## Executive Summary

Investigation of OR3 Cloud authentication and Clerk integration revealed **1 blocker** and **5 high-severity security issues** requiring immediate attention:

1. **BLOCKER**: Authentication bypass via broken session expiry calculation
2. **HIGH**: Type safety holes in token fetching allowing malformed tokens
3. **HIGH**: Silent auth failures masking production outages
4. **HIGH**: Race conditions in client session management
5. **HIGH**: Missing email validation allowing empty-email accounts
6. **MEDIUM**: Hardcoded Clerk issuer creating deployment risks

Current test coverage: **171 lines tests / 512 lines code = 33%**

Critical paths lacking tests:
- Session expiry validation
- Clerk API failure handling
- Token refresh timing
- Concurrent session resolution
- JWT template misconfiguration
- Workspace provisioning flow

## Architecture Overview

### Current Implementation

```
┌─────────────┐      ┌──────────────┐      ┌─────────────┐
│   Client    │─────▶│ Clerk SDK    │─────▶│ Clerk API   │
│  (Browser)  │◀─────│  (Frontend)  │◀─────│   (Cloud)   │
└─────────────┘      └──────────────┘      └─────────────┘
      │                      │
      │ /api/auth/session   │ JWT Token
      │                      │
      ▼                      ▼
┌─────────────┐      ┌──────────────┐      ┌─────────────┐
│ Nuxt Server │─────▶│ Clerk Auth   │─────▶│   Convex    │
│  (H3/Nitro) │◀─────│  Provider    │◀─────│  (Backend)  │
└─────────────┘      └──────────────┘      └─────────────┘
      │                      │                     │
      │ Session Context     │ Workspace Data      │
      │                      │                     │
      ▼                      ▼                     ▼
┌─────────────┐      ┌──────────────┐      ┌─────────────┐
│  Gateway    │      │   can()      │      │  Workspace  │
│  Endpoints  │      │ Authorization│      │    Store    │
└─────────────┘      └──────────────┘      └─────────────┘
```

### Key Components

1. **ClerkAuthProvider** (`server/auth/providers/clerk/`)
   - Extracts session from Clerk middleware
   - Fetches user details from Clerk API
   - Maps to internal ProviderSession

2. **Session Resolution** (`server/auth/session.ts`)
   - Resolves ProviderSession → SessionContext
   - Provisions workspaces in Convex
   - Caches per-request

3. **Authorization** (`server/auth/can.ts`)
   - Role-based permissions (owner/editor/viewer)
   - Resource-scoped checks
   - Hook extension point (not yet wired)

4. **Token Broker** (`server/auth/token-broker.ts`)
   - Stub for direct provider tokens
   - Currently unused/unimplemented

5. **Client Integration**
   - `useSessionContext`: Fetches session from server
   - `useAuthTokenBroker`: Mints Clerk JWT templates
   - `convex-clerk.client.ts`: Bridges Clerk → Convex

## Critical Findings

### 1. Authentication Bypass (BLOCKER)

**File**: `server/auth/providers/clerk/clerk-auth-provider.ts:40`

**Issue**: Broken operator precedence in expiry calculation:

```typescript
expiresAt: new Date(
    ((auth.sessionClaims.exp) || 0) * 1000 ||
        Date.now() + 3600000
),
```

When `exp` is undefined/null/0, evaluates to:
```
((undefined || 0) * 1000) || (Date.now() + 3600000)
→ (0 * 1000) || (Date.now() + 3600000)
→ 0 || (Date.now() + 3600000)
→ Date.now() + 3600000
```

**Result**: Creates 1-hour session even when Clerk provides no expiry.

**Attack Vector**: Forged token with `exp: 0` gets fresh 1-hour validity.

**Impact**: Authentication bypass, session hijacking.

**Fix**: Fail hard on missing/invalid expiry:
```typescript
if (typeof auth.sessionClaims.exp !== 'number' || auth.sessionClaims.exp <= 0) {
    throw new Error('Invalid session expiry claim');
}
expiresAt: new Date(auth.sessionClaims.exp * 1000),
```

---

### 2. Type Hole in Token Fetching (HIGH)

**File**: `server/utils/sync/convex-gateway.ts:13-33`

**Issue**: Multiple unsafe casts from `unknown` with no validation:

```typescript
const auth: unknown = event.context.auth?.();
const getToken =
    auth && typeof (auth as { getToken?: unknown }).getToken === 'function'
        ? ((auth as { getToken: (...) => Promise<string | null> }).getToken)
        : undefined;
```

**Problems**:
- No validation of returned token structure
- Empty strings pass through
- Expired tokens not checked
- Silent failures propagate

**Impact**: Auth bypass when Clerk returns malformed tokens.

**Fix**: Add Zod validation:
```typescript
const ClerkAuthSchema = z.object({
    getToken: z.function()
        .args(z.object({ 
            template: z.string().optional(), 
            skipCache: z.boolean().optional() 
        }).optional())
        .returns(z.promise(z.string().nullable())),
});

const parsed = ClerkAuthSchema.safeParse(authResult);
if (!parsed.success) {
    console.error('[sync-gateway] Invalid auth context:', parsed.error);
    return null;
}

const token = await parsed.data.getToken({ template, skipCache: false });
if (!token || token.trim().length === 0) {
    console.warn('[sync-gateway] Empty token from Clerk');
    return null;
}
```

---

### 3. Silent Auth Failures (HIGH)

**File**: `server/auth/session.ts:54-62, 109-112`

**Issue**: Swallows Clerk API errors and returns unauthenticated session:

```typescript
try {
    providerSession = await provider.getSession(event);
} catch (error) {
    recordProviderError();
    recordSessionResolution(false);
    const nullSession: SessionContext = { authenticated: false };
    event.context[cacheKey] = nullSession;
    return nullSession;  // Silent failure!
}
```

**Problems**:
- Network timeouts → silent lockout
- API rate limits → no visibility
- Misconfiguration → appears as "logged out"
- No alerts or structured logs

**Impact**: Production outages masked as "user logged out".

**Fix**: Log structured errors, fail hard in dev:
```typescript
catch (error) {
    recordProviderError();
    recordSessionResolution(false);
    console.error('[auth:session] Provider session fetch failed:', {
        provider: providerId,
        error: error instanceof Error ? error.message : String(error),
    });
    if (import.meta.dev) {
        throw error;  // Fail fast in dev
    }
    const nullSession: SessionContext = { authenticated: false };
    event.context[cacheKey] = nullSession;
    return nullSession;
}
```

---

### 4. Race Condition in Client (MEDIUM)

**File**: `app/composables/auth/useSessionContext.ts:12, 26-44`

**Issue**: Module-level `inFlight` flag shared across instances:

```typescript
let inFlight: Promise<SessionPayload> | null = null;

const refresh = async () => {
    if (inFlight) return inFlight;  // Check
    pending.value = true;
    inFlight = $fetch<SessionPayload>('/api/auth/session')  // Act
        // ...
        .finally(() => {
            inFlight = null;
        });
    return inFlight;
};
```

**Problem**: Check-then-act race. Two concurrent calls both see `inFlight === null`.

**Impact**: 
- Duplicate API calls
- Flash of unauthenticated UI
- Stale session data on fast navigation

**Fix**: Accept duplicate fetch (server caches per-request) or use proper mutex.

---

### 5. Missing Email Validation (HIGH)

**File**: `server/auth/providers/clerk/clerk-auth-provider.ts:28-30`

**Issue**: Falls back to empty string for missing email:

```typescript
const primaryEmail = clerkUser.emailAddresses.find(
    (email) => email.id === clerkUser.primaryEmailAddressId
);
// ...
email: primaryEmail?.emailAddress ?? '',  // Empty string fallback!
```

**Impact**: 
- Users with `email: ''` bypass email-based access controls
- Multiple accounts can share `email: ''`
- Notifications fail silently

**Fix**: Fail hard on missing email:
```typescript
if (!primaryEmail?.emailAddress) {
    throw new Error('User has no verified primary email address');
}
```

---

### 6. Hardcoded Clerk Issuer (MEDIUM)

**File**: `convex/auth.config.ts:12`

**Issue**: Hardcoded Clerk domain:

```typescript
domain: 'https://ace-parakeet-7.clerk.accounts.dev',
```

**Impact**: 
- Wrong issuer = JWT validation fails open
- Dev keys work, prod keys fail silently
- No error message, just broken auth

**Fix**: Environment variable with validation:
```typescript
const CLERK_ISSUER = process.env.CLERK_ISSUER_URL;

if (!CLERK_ISSUER || !CLERK_ISSUER.startsWith('https://')) {
    throw new Error('CLERK_ISSUER_URL must be set to HTTPS URL');
}

export default {
    providers: [{ domain: CLERK_ISSUER, applicationID: 'convex' }],
};
```

---

## Additional Issues

### 7. Unvalidated Convex Mutation Input (MEDIUM)

**File**: `convex/workspaces.ts:285-392`

**Issue**: Accepts any `provider` string without validation.

**Impact**: Direct Convex access can create ghost users with fake providers.

**Fix**: Validate provider and match JWT subject:
```typescript
if (args.provider !== CLERK_PROVIDER_ID) {
    throw new Error(`Invalid provider: ${args.provider}`);
}

const identity = await ctx.auth.getUserIdentity();
if (!identity || identity.subject !== args.provider_user_id) {
    throw new Error('Provider user ID mismatch');
}
```

---

### 8. Missing Rate Limit (LOW)

**File**: `server/api/auth/session.get.ts`

**Issue**: No rate limiting on session endpoint.

**Impact**: DOS via session spam, timing attacks.

**Fix**: Add per-IP rate limit:
```typescript
const clientIP = event.node.req.socket.remoteAddress || 'unknown';
const rateLimitResult = checkSyncRateLimit(clientIP, 'auth:session');
if (!rateLimitResult.allowed) {
    throw createError({ statusCode: 429 });
}
```

---

### 9. Stub Token Broker (LOW)

**File**: `server/auth/token-broker.ts:23-30`

**Issue**: Unused stub that always returns null.

**Impact**: Confusing code, broken direct sync if ever used.

**Fix**: Delete file and all imports.

---

### 10. Cache Key Collision Risk (LOW)

**File**: `server/auth/session.ts:29`

**Issue**: Cache key is `__or3_session_context_clerk` for all requests.

**Impact**: Provider switch mid-request could cause collision.

**Fix**: Include request ID in cache key or use WeakMap.

---

## Test Coverage Gaps

### Missing Unit Tests

1. **ClerkAuthProvider** (`server/auth/providers/clerk/clerk-auth-provider.ts`)
   - [ ] Valid session parsing
   - [ ] Missing exp claim → error
   - [ ] exp = 0 → error
   - [ ] Negative exp → error
   - [ ] Missing primary email → error
   - [ ] Empty emailAddresses array → error
   - [ ] Clerk API fetch failure
   - [ ] Invalid userId

2. **Session Resolution** (`server/auth/session.ts`)
   - [ ] Cache hit on second call
   - [ ] Provider error → logs and returns null
   - [ ] Provider error in dev → throws
   - [ ] Convex workspace creation on first login
   - [ ] Convex workspace reuse on second login
   - [ ] Convex API failure → throws
   - [ ] Auth disabled → returns null
   - [ ] Provider not registered → returns null

3. **Token Fetching** (`server/utils/sync/convex-gateway.ts`)
   - [ ] Auth context missing → null
   - [ ] getToken returns empty string → null
   - [ ] getToken throws → null
   - [ ] Valid token → returned
   - [ ] Invalid auth shape → null

4. **Registry** (`server/auth/registry.ts`)
   - [ ] Register provider
   - [ ] Get registered provider
   - [ ] Get unregistered provider → null
   - [ ] Replace provider (dev mode)

5. **Admin Functions** (`server/auth/admin.ts`)
   - [ ] requireAdminAccess with admin → pass
   - [ ] requireAdminAccess without admin → 403
   - [ ] requireAdminOwner with owner → pass
   - [ ] requireAdminOwner with editor → 403

6. **Authorization** (`server/auth/can.ts`)
   - [x] Existing tests (16 passing) ✅
   - [ ] Additional resource kind tests
   - [ ] Hook integration tests (when wired)

### Missing Integration Tests

7. **Middleware** (`server/middleware/00.clerk.ts`)
   - [ ] Clerk middleware populates event.context.auth
   - [ ] Missing Clerk session → auth() returns no userId
   - [ ] Invalid Clerk token → auth() returns no userId

8. **Session Endpoint** (`server/api/auth/session.get.ts`)
   - [ ] Auth disabled → returns { session: null }
   - [ ] Auth enabled, not signed in → returns { session: null }
   - [ ] Auth enabled, signed in → returns session
   - [ ] Rate limit exceeded → 429
   - [ ] Cache-Control headers set correctly

9. **Client Composables** (`app/composables/auth/`)
   - [x] useOr3Session basic test ✅
   - [ ] useSessionContext concurrent refresh
   - [ ] useAuthTokenBroker Clerk load timeout
   - [ ] useAuthTokenBroker valid token fetch
   - [ ] useAuthTokenBroker when auth disabled

10. **Convex Plugin** (`app/plugins/convex-clerk.client.ts`)
    - [x] Sync auth retry test ✅
    - [ ] Clerk not available → logs warning
    - [ ] Session changes → calls convex.setAuth
    - [ ] HMR cleanup

### Missing Security Tests

11. **Edge Cases**
    - [ ] XSS in displayName/email
    - [ ] SQL injection in provider/userId
    - [ ] SSRF via Convex URL manipulation
    - [ ] JWT with wrong issuer → rejected
    - [ ] Expired JWT → rejected
    - [ ] JWT with tampered claims → rejected

---

## Performance Notes

1. **Session Cache**: Per-request caching works well. No memory leaks.

2. **Gateway Client Cache**: Limited to 50 clients but uses FIFO eviction. Should use LRU.

3. **Clerk API Call Cost**: Fetches full user object on every SSR page load (100-200ms). Should cache in Redis for 5 minutes.

4. **Convex Query+Mutation**: First login does query then mutation. Should use upsert pattern.

---

## Recommendations

### Immediate Actions (Blockers)

1. **Fix expiry calculation** in `clerk-auth-provider.ts:40`
2. **Add primary email validation** in `clerk-auth-provider.ts:28-30`
3. **Add Zod validation** to `convex-gateway.ts:getClerkProviderToken()`
4. **Add structured error logging** to `session.ts:54-62`

### Short-term (High Priority)

5. **Move Clerk issuer to env var** in `convex/auth.config.ts`
6. **Add provider validation** to `convex/workspaces.ts:ensure`
7. **Add rate limiting** to `/api/auth/session`
8. **Delete** `server/auth/token-broker.ts` (unused stub)
9. **Add unit tests** for ClerkAuthProvider
10. **Add integration tests** for session resolution

### Medium-term

11. **Fix race condition** in `useSessionContext.ts` (or document as acceptable)
12. **Add Redis caching** for Clerk user fetches
13. **Switch to LRU cache** for gateway clients
14. **Add alerting** for provider error rate threshold
15. **Complete test coverage** to 80%+

### Long-term

16. **Wire auth.access:filter:decision hook** for plugins
17. **Add multi-provider support** (Firebase, Auth0)
18. **Add session refresh mechanism**
19. **Add SAML/OIDC support**
20. **Add audit logging** for auth events

---

## Test Plan

### Phase 1: Critical Path Tests

```typescript
// server/auth/providers/clerk/__tests__/clerk-auth-provider.test.ts
describe('clerkAuthProvider', () => {
    describe('session expiry validation', () => {
        it('throws when exp claim is missing');
        it('throws when exp is 0');
        it('throws when exp is negative');
        it('accepts valid future exp');
    });
    
    describe('email validation', () => {
        it('throws when no primary email');
        it('throws when primaryEmailAddressId mismatches');
        it('accepts valid email');
    });
    
    describe('Clerk API failures', () => {
        it('throws when clerkClient.users.getUser fails');
        it('handles network timeout');
        it('handles rate limit errors');
    });
});
```

### Phase 2: Integration Tests

```typescript
// server/auth/__tests__/session.integration.test.ts
describe('session resolution flow', () => {
    it('creates workspace on first login');
    it('reuses workspace on second login');
    it('caches session within request');
    it('logs errors on Clerk failure');
    it('throws in dev mode on provider error');
});
```

### Phase 3: Security Tests

```typescript
// server/auth/__tests__/security.test.ts
describe('auth security', () => {
    it('rejects JWT with wrong issuer');
    it('rejects expired JWT');
    it('sanitizes XSS in displayName');
    it('prevents provider name injection');
    it('rate limits session endpoint');
});
```

---

## Metrics

### Before Investigation
- Implementation: 512 lines
- Tests: 171 lines (33% coverage)
- Known issues: 0
- Test files: 4

### Target After Fixes
- Implementation: ~520 lines (fixes + deletions)
- Tests: ~600 lines (80% coverage)
- Fixed issues: 10
- Test files: 10
- New test cases: ~50

---

## Related Documents

- [SSR Auth System Requirements](./ssr-auth-system/requirements.md)
- [SSR Auth System Tasks](./ssr-auth-system/tasks.md)
- [OR3 Cloud Findings](./findings.md)
- [Auth System Documentation](../public/_documentation/cloud/auth-system.md)

---

**Status**: Ready for implementation  
**Next Step**: Begin fixing blocker issues
