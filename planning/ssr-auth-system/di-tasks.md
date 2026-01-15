# SSR Auth System: Dumb Issues - Task List

**Priority Guide**: Implementation order based on dependencies and impact, not just severity.

---

## Phase 1: Critical Bugs (Breaking Changes Possible)

Fix auth failures and race conditions that affect reliability.

### ✅ Task 1.1: Fix Clerk race condition (Issue #20)
**Priority**: Critical  
**Severity**: High  
**Breaking Changes**: None (defensive fix)

**Why First**: Prevents auth failures on fast page loads. Critical reliability bug.

**Files**:
- Update: `app/composables/auth/useAuthTokenBroker.client.ts:34`

**Implementation**:
```typescript
function waitForClerk(timeoutMs = 5000): Promise<ClerkClient | null> {
    return new Promise((resolve) => {
        const startTime = Date.now();
        
        const check = () => {
            const clerk = (window as unknown as { Clerk?: ClerkClient }).Clerk;
            if (clerk) {
                resolve(clerk);
                return;
            }
            
            // Check if timed out
            if (Date.now() - startTime > timeoutMs) {
                console.warn('[auth-token-broker] Clerk load timeout');
                resolve(null);
                return;
            }
            
            // Check again in 50ms
            setTimeout(check, 50);
        };
        
        check();
    });
}

export function useAuthTokenBroker(): AuthTokenBroker {
    const runtimeConfig = useRuntimeConfig();

    return {
        async getProviderToken(input) {
            if (!runtimeConfig.public.ssrAuthEnabled) {
                return null;
            }

            try {
                // Wait for Clerk to load with timeout
                const clerk = await waitForClerk();
                if (!clerk?.session) {
                    return null;
                }

                return await clerk.session.getToken({ template: input.template });
            } catch (error) {
                console.error('[auth-token-broker] Failed to get provider token:', error);
                return null;
            }
        },
    };
}
```

**Tests**: 
- Mock slow Clerk load (<5s), verify token retrieved
- Mock very slow Clerk load (>5s), verify timeout returns null
- Mock Clerk never loads, verify timeout returns null

---

## Phase 2: Server-Side Improvements (No Breaking Changes)

Improve session handling and rate limiting.

### ✅ Task 2.1: Fix session cache key (Issue #12)
**Priority**: Medium  
**Severity**: Medium  
**Breaking Changes**: None (defensive improvement)

**Why Next**: Prevents edge-case bugs if multiple providers are used. Low risk, easy fix.

**Files**:
- Update: `server/auth/session.ts:12,25-27`

**Implementation**:
```typescript
const SESSION_CONTEXT_KEY_PREFIX = '__or3_session_context_';

/**
 * Resolve the session context for an H3 event.
 * Results are cached per-request to avoid multiple provider calls.
 *
 * @param event - H3 event
 * @returns SessionContext with authenticated state
 */
export async function resolveSessionContext(
    event: H3Event
): Promise<SessionContext> {
    // Get provider from config for cache key
    const config = useRuntimeConfig();
    const providerId = config.auth?.provider || 'clerk';
    const cacheKey = `${SESSION_CONTEXT_KEY_PREFIX}${providerId}`;
    
    // Check cache first
    if (event.context[cacheKey]) {
        return event.context[cacheKey] as SessionContext;
    }

    // If SSR auth disabled, return unauthenticated
    if (!isSsrAuthEnabled(event)) {
        const nullSession: SessionContext = { authenticated: false };
        event.context[cacheKey] = nullSession;
        return nullSession;
    }

    // Get provider from config
    const provider = getAuthProvider(providerId);

    if (!provider) {
        const nullSession: SessionContext = { authenticated: false };
        event.context[cacheKey] = nullSession;
        return nullSession;
    }

    // Resolve provider session
    let providerSession: ProviderSession | null = null;
    try {
        providerSession = await provider.getSession(event);
    } catch (error) {
        const nullSession: SessionContext = { authenticated: false };
        event.context[cacheKey] = nullSession;
        return nullSession;
    }

    if (!providerSession) {
        const nullSession: SessionContext = { authenticated: false };
        event.context[cacheKey] = nullSession;
        return nullSession;
    }

    // Map provider session to internal user/workspace via Convex
    const convex = getConvexClient();
    const workspaceInfo = await convex.mutation(api.workspaces.ensure, {
        provider: providerSession.provider,
        provider_user_id: providerSession.user.id,
        email: providerSession.user.email,
        name: providerSession.user.displayName,
    });

    const sessionContext: SessionContext = {
        authenticated: true,
        provider: providerSession.provider,
        providerUserId: providerSession.user.id,
        user: {
            id: providerSession.user.id,
            email: providerSession.user.email,
            displayName: providerSession.user.displayName,
        },
        workspace: {
            id: workspaceInfo.id,
            name: workspaceInfo.name,
        },
        role: workspaceInfo.role,
        expiresAt: providerSession.expiresAt.toISOString(),
    };

    // Cache result with provider-specific key
    event.context[cacheKey] = sessionContext;
    return sessionContext;
}
```

**Tests**: None needed, defensive coding.

---

### ✅ Task 2.2: Use LRU cache for rate limiter (Issue #4)
**Priority**: High  
**Severity**: High  
**Breaking Changes**: None (internal implementation change)

**Why Next**: Prevents memory leak in rate limiter. Shared with sync layer.

**Files**:
- Update: `server/utils/sync/rate-limiter.ts:46-47`
- Update: `package.json` (add lru-cache dependency)

**Implementation**:
```typescript
import { LRUCache } from 'lru-cache';

export interface RateLimitEntry {
    /** Timestamps of requests in the current window */
    timestamps: number[];
}

/**
 * Rate limit store using LRU cache to prevent unbounded growth.
 * Max 10k users tracked, entries expire after 10 minutes of inactivity.
 */
const rateLimitStore = new LRUCache<string, RateLimitEntry>({
    max: 10_000,
    ttl: MAX_ENTRY_AGE_MS,
    updateAgeOnGet: false,
    updateAgeOnHas: false,
});

// Remove cleanupStaleEntries function - LRU cache handles it

export function recordSyncRequest(userId: string, operation: string): void {
    const config = SYNC_RATE_LIMITS[operation] ?? STORAGE_RATE_LIMITS[operation];
    if (!config) {
        return;
    }

    const key = getRateLimitKey(userId, operation);
    const now = Date.now();
    const windowStart = now - config.windowMs;

    let entry = rateLimitStore.get(key);
    if (!entry) {
        entry = { timestamps: [] };
    }

    // Add current request timestamp
    entry.timestamps.push(now);

    // Prune old timestamps outside the window
    entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart);
    
    rateLimitStore.set(key, entry);
}

export function checkSyncRateLimit(userId: string, operation: string): RateLimitResult {
    const config = SYNC_RATE_LIMITS[operation] ?? STORAGE_RATE_LIMITS[operation];
    if (!config) {
        return { allowed: true, remaining: Infinity };
    }

    const key = getRateLimitKey(userId, operation);
    const entry = rateLimitStore.get(key);
    const now = Date.now();
    const windowStart = now - config.windowMs;

    if (!entry) {
        return { allowed: true, remaining: config.maxRequests };
    }

    const recentRequests = entry.timestamps.filter((ts) => ts > windowStart);
    const requestCount = recentRequests.length;
    const remaining = Math.max(0, config.maxRequests - requestCount);

    if (requestCount >= config.maxRequests) {
        const oldestInWindow = recentRequests[0]!;
        const retryAfterMs = oldestInWindow + config.windowMs - now;

        return {
            allowed: false,
            remaining: 0,
            retryAfterMs: Math.max(0, retryAfterMs),
        };
    }

    return { allowed: true, remaining };
}
```

**Tests**: 
- Add 100k entries, verify memory bounded
- Verify old entries expire after ttl
- Verify rate limiting still works correctly

---

## Phase 3: Documentation and Refinements (Low Priority)

### ✅ Task 3.1: Document rate limiter memory bounds (Enhancement)
**Priority**: Low  
**Severity**: Low  
**Breaking Changes**: None (documentation only)

**Why Next**: After implementing LRU cache, document the behavior.

**Files**:
- Update: `server/utils/sync/rate-limiter.ts` (add JSDoc)

**Implementation**:
```typescript
/**
 * Sync Rate Limiter
 *
 * In-memory sliding window rate limiter for sync and storage operations.
 * Limits are per-user to prevent abuse while allowing normal usage.
 *
 * Memory bounds:
 * - Maximum 10,000 users tracked concurrently (LRU eviction)
 * - Entries expire after 10 minutes of inactivity
 * - Each entry stores ~100 bytes (timestamps array)
 * - Total memory: ~1MB worst case
 *
 * Note: This is in-memory and resets on server restart. This is acceptable
 * for soft limits - it prevents sustained abuse but won't persist across
 * deployments. For distributed deployments, consider Redis.
 */
```

**Tests**: None, documentation only.

---

### ✅ Task 3.2: Add session refresh logic (Enhancement)
**Priority**: Low  
**Severity**: Low  
**Breaking Changes**: None (additive feature)

**Why Last**: Nice-to-have for long sessions. Not critical for v1.

**Files**:
- Update: `app/composables/auth/useAuthTokenBroker.client.ts`
- Create: `app/composables/auth/useSessionRefresh.client.ts`

**Implementation**:
```typescript
// useSessionRefresh.client.ts
export function useSessionRefresh() {
    const tokenBroker = useAuthTokenBroker();
    const refreshInterval = ref<NodeJS.Timeout | null>(null);
    
    function startRefresh(intervalMs = 5 * 60 * 1000) {
        if (refreshInterval.value) return;
        
        refreshInterval.value = setInterval(async () => {
            try {
                // Refresh token from provider
                const token = await tokenBroker.getProviderToken({
                    providerId: 'convex',
                    template: 'convex',
                });
                
                if (!token) {
                    console.warn('[session-refresh] Failed to refresh token');
                }
            } catch (error) {
                console.error('[session-refresh] Refresh error:', error);
            }
        }, intervalMs);
    }
    
    function stopRefresh() {
        if (refreshInterval.value) {
            clearInterval(refreshInterval.value);
            refreshInterval.value = null;
        }
    }
    
    onUnmounted(() => {
        stopRefresh();
    });
    
    return {
        startRefresh,
        stopRefresh,
    };
}
```

**Tests**: 
- Start refresh, verify timer runs
- Stop refresh, verify timer cleared
- Verify cleanup on unmount

---

### ✅ Task 3.3: Add auth metrics and logging (Enhancement)
**Priority**: Low  
**Severity**: Low  
**Breaking Changes**: None (additive feature)

**Why Last**: Observability is good but not critical for v1.

**Files**:
- Create: `server/auth/metrics.ts`
- Update: `server/auth/session.ts` (emit events)

**Implementation**:
```typescript
// metrics.ts
export interface AuthMetrics {
    sessionResolutions: number;
    sessionResolutionFailures: number;
    authorizationChecks: number;
    authorizationDenials: number;
    providerErrors: number;
}

const metrics: AuthMetrics = {
    sessionResolutions: 0,
    sessionResolutionFailures: 0,
    authorizationChecks: 0,
    authorizationDenials: 0,
    providerErrors: 0,
};

export function recordSessionResolution(success: boolean): void {
    if (success) {
        metrics.sessionResolutions++;
    } else {
        metrics.sessionResolutionFailures++;
    }
}

export function recordAuthorizationCheck(allowed: boolean): void {
    metrics.authorizationChecks++;
    if (!allowed) {
        metrics.authorizationDenials++;
    }
}

export function recordProviderError(): void {
    metrics.providerErrors++;
}

export function getMetrics(): Readonly<AuthMetrics> {
    return { ...metrics };
}

export function resetMetrics(): void {
    Object.keys(metrics).forEach(k => {
        metrics[k as keyof AuthMetrics] = 0;
    });
}
```

**Tests**: 
- Record events, verify counters increment
- Get metrics, verify snapshot
- Reset, verify counters zero

---

## Summary

**Total Tasks**: 6  
**Critical**: 1  
**High/Medium**: 2  
**Low**: 3  

**Recommended Order**: Phase 1 → Phase 2 → Phase 3

**Breaking Changes Summary**:
- None. All changes are internal improvements or additive features.

**Dependencies**:
- Task 2.2 (LRU cache) is shared with sync layer rate limiter
- Should be implemented once and used by both auth and sync endpoints

**Shared with Other Layers**:
- Rate limiter (Issue #4) - Used by both auth session endpoints and sync/storage endpoints
