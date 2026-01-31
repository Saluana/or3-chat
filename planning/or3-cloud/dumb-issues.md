## ARCHITECTURAL ISSUES THAT WILL HAUNT YOU

While static builds work, there are **serious problems** in this codebase that need fixing:

---

## Issue 1: Admin Middleware Returns 404 on Error Instead of Redirecting

**File**: `app/middleware/admin-auth.ts:37-39`

```typescript
if (status === 404) {
    return;  // WHAT?!
}
```

**Why this is bad**: When the admin session endpoint returns 404 (which happens when admin is disabled), the middleware just... returns. It doesn't redirect. It doesn't stop navigation. The user gets a broken admin page that can't fetch any data.

**Real-world impact**: Users accessing `/admin` when admin is disabled see a skeleton screen that never loads instead of a clean 404 or redirect.

**Fix**: 
```typescript
if (status === 404) {
    return navigateTo('/');  // Or show a proper error page
}
```

---

## Issue 2: Workspace DB Cache is a Memory Leak Waiting to Happen

**File**: `app/db/client.ts:144,170-176`

```typescript
const workspaceDbCache = new Map<string, Or3DB>();

export function getWorkspaceDb(workspaceId: string): Or3DB {
    const existing = workspaceDbCache.get(workspaceId);
    if (existing) return existing;
    const created = new Or3DB(`or3-db-${workspaceId}`);
    workspaceDbCache.set(workspaceId, created);
    return created;
}
```

**Why this is bad**: Every workspace switch creates a new Dexie instance that **never gets closed or evicted**. A user switching between 50 workspaces holds 50 open IndexedDB connections. Browser limits will eventually break this.

**Real-world impact**: Long-running sessions (PWA installed on mobile) will hit IndexedDB connection limits. Switch workspaces enough times and the app crashes.

**Fix**: Add LRU eviction with proper cleanup:
```typescript
const workspaceDbCache = new LRUCache<string, Or3DB>({
    max: 10,
    dispose: (db) => db.close()
});
```

---

## Issue 3: File Transfer Queue Sorts in Memory

**File**: `app/core/storage/transfer-queue.ts:154-165`

```typescript
const candidates = await this.db.file_transfers
    .where('[state+workspace_id]')
    .equals(['queued', this.workspaceId])
    .sortBy('created_at');  // O(n log n) in JavaScript
```

**Why this is bad**: `sortBy` pulls ALL queued transfers into memory and sorts them. With 10,000 queued files, you're doing a 10k-element sort in JS on every queue tick.

**Real-world impact**: Upload queue performance degrades quadratically as the queue grows. Users with slow internet and large backlogs will see UI freezes.

**Fix**: Add a compound index and use cursor-based retrieval:
```typescript
// In schema: '[state+workspace_id+created_at]'
const candidates = await this.db.file_transfers
    .where('[state+workspace_id+created_at]')
    .between(['queued', workspaceId, Dexie.minKey], ['queued', workspaceId, Dexie.maxKey])
    .limit(available)
    .toArray();  // O(k) where k = limit
```

---

## Issue 4: Circuit Breaker is Global (One Workspace Breaks All)

**File**: `shared/sync/circuit-breaker.ts:109-116`

```typescript
let globalCircuitBreaker: SyncCircuitBreaker | null = null;

export function getSyncCircuitBreaker(): SyncCircuitBreaker {
    if (!globalCircuitBreaker) {
        globalCircuitBreaker = new SyncCircuitBreaker();
    }
    return globalCircuitBreaker;
}
```

**Why this is bad**: A single failing workspace trips the circuit breaker for **every workspace**. One bad tenant pauses sync for everyone on the device.

**Real-world impact**: Multi-workspace users (common in B2B SaaS) will have all their workspaces stop syncing because one workspace had a hiccup.

**Fix**: Scope circuit breakers by workspace:
```typescript
const breakers = new Map<string, SyncCircuitBreaker>();

export function getSyncCircuitBreaker(key: string): SyncCircuitBreaker {
    if (!breakers.has(key)) {
        breakers.set(key, new SyncCircuitBreaker());
    }
    return breakers.get(key)!;
}
```

---

## Issue 5: Rate Limiter Map Grows Without Bounds

**File**: `server/utils/sync/rate-limiter.ts:46-47,161`

```typescript
const rateLimitStore = new Map<string, RateLimitEntry>();
// ... later ...
cleanupStaleEntries();  // Only called if 5 minutes passed
```

**Why this is bad**: If cleanup doesn't run (low traffic, long-running process), the map grows forever. Each entry is ~200 bytes. 100k users = 20MB and growing.

**Real-world impact**: Server memory usage grows over time. Eventually OOM kills in production.

**Fix**: Use LRU cache or Redis:
```typescript
import { LRUCache } from 'lru-cache';

const rateLimitStore = new LRUCache<string, RateLimitEntry>({
    max: 10_000,
    ttl: 1000 * 60 * 60,  // 1 hour
});
```

---

## Issue 6: Convex Push Does Not Batch Writes

**File**: `convex/sync.ts:304-374` (implied from dumb-issues.md)

The push mutation loops over ops and does 3+ DB operations per op:
1. Get next server version
2. Apply operation to table
3. Insert change log entry

**Why this is bad**: 50 ops = 150+ database round-trips. Convex mutations are fast, but this is wasteful.

**Real-world impact**: Large batches (initial sync, bulk imports) take unnecessarily long. Users see "Syncing..." spinners for seconds instead of milliseconds.

**Fix**: Batch operations where possible:
```typescript
// Collect all changes first
const changes = args.ops.map(op => ({
    serverVersion: await getNextServerVersion(ctx, args.workspace_id),
    op
}));

// Apply in parallel
await Promise.all(changes.map(({op, serverVersion}) => 
    applyOpAndLog(ctx, args.workspace_id, op, serverVersion)
));
```

---

## Issue 7: Session Context Cache Key is Too Broad

**File**: `server/auth/session.ts:12,25-27`

```typescript
const SESSION_CONTEXT_KEY = '__or3_session_context';

if (event.context[SESSION_CONTEXT_KEY]) {
    return event.context[SESSION_CONTEXT_KEY] as SessionContext;
}
```

**Why this is bad**: The cache key is a constant. If you ever support multiple auth providers per request (edge case, but possible), you get stale data.

**Real-world impact**: Hard to debug session issues. "Why is this user seeing another user's data?" type bugs.

**Fix**: Include provider in cache key:
```typescript
const SESSION_CONTEXT_KEY_PREFIX = '__or3_session_context_';
const cacheKey = `${SESSION_CONTEXT_KEY_PREFIX}${config.auth.provider}`;
```

---

## Issue 8: Outbox Ops Can Get Stuck in `syncing` Forever

**File**: `app/core/sync/outbox-manager.ts:158-170`

```typescript
// Mark as syncing
await this.db.pending_ops.bulkPut(
    batch.map((op) => ({ ...op, status: 'syncing' as const }))
);
```

**Why this is bad**: If the app crashes after marking ops as `syncing`, they never get retried. The flush query only looks for `status === 'pending'`.

**Real-world impact**: User makes changes, app crashes (or phone dies), changes are lost forever. Data loss bug.

**Fix**: Reset stale syncing ops on startup:
```typescript
// In outbox manager initialization
await this.db.pending_ops
    .where('status')
    .equals('syncing')
    .modify({ status: 'pending', nextAttemptAt: Date.now() });
```

---

## Issue 9: Duplicate PK_FIELDS Constants

**Files**: 
- `app/core/sync/hook-bridge.ts:36-43`
- `app/core/sync/subscription-manager.ts:24-32`
- `app/core/sync/sync-payload-normalizer.ts:23-32`
- `convex/sync.ts:68-75`

The same `PK_FIELDS` constant is defined in 4 different files.

**Why this is bad**: Change one, forget the others, bugs happen. The `file_meta` table uses `hash` as PK - if you forget to update one file, sync breaks for files.

**Real-world impact**: Subtle bugs where some parts of the app think `file_meta` uses `id` and others use `hash`. Data corruption.

**Fix**: Single source of truth in `shared/sync/table-metadata.ts`.

---

## Issue 10: HLC Uses Global Mutable State

**File**: `app/core/sync/hlc.ts:12-16`

```typescript
let lastTimestamp = 0;
let counter = 0;
let nodeId: string | null = null;
```

**Why this is bad**: Module-level globals pollute across tests and hot-reloads. Tests can't run in parallel. HLC clocks can go backwards after HMR.

**Real-world impact**: In development, hot reload causes HLC clock resets. This causes sync conflicts where newer changes appear older. Hard to debug.

**Fix**: Wrap in a class with proper lifecycle:
```typescript
export class HLCGenerator {
    private lastTimestamp = 0;
    private counter = 0;
    private nodeId: string | null = null;
    // ... methods
}
```

---

## RECOMMENDATIONS

### Immediate (Before Production)

1. **Fix the outbox syncing state recovery** (Issue 8) - This is data loss
2. **Add LRU eviction to workspace DB cache** (Issue 2) - This will crash long-running sessions
3. **Scope circuit breaker by workspace** (Issue 4) - Multi-workspace users will hate you
4. **Fix admin middleware 404 handling** (Issue 1) - Broken UX

### Short-term (Next Sprint)

5. **Consolidate PK_FIELDS** (Issue 9) - Technical debt
6. **Fix HLC global state** (Issue 10) - Developer experience
7. **Add rate limiter LRU** (Issue 5) - Operational safety
8. **Fix file transfer queue sorting** (Issue 3) - Performance

### Long-term (Post-v1)

9. **Batch Convex writes** (Issue 6) - Performance at scale
10. **Fix session cache key** (Issue 7) - Correctness edge case

---

## STATIC BUILD CHECKLIST

✅ SSR modules conditionally loaded in nuxt.config.ts  
✅ Client plugins use .client.ts suffix  
✅ Server middleware gates Clerk loading  
✅ Runtime gating in all composables  
✅ Admin pages don't break static generation  

**Conclusion**: The static build is safe. The runtime has issues. Fix the outbox recovery and DB cache leaks before shipping to production.

---

*Review completed: 2026-01-30*  
*Files reviewed: 150+ across auth, sync, storage, and admin systems*
