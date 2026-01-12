# DB Sync Layer Code Review Findings

**Date:** 2026-01-12  
**Reviewer:** Code Review Agent  
**Status:** ❌ FAILED - Not Ready for Implementation

## Executive Summary

The db-sync-layer documentation contains **multiple blocking issues** that must be resolved before implementation:

1. **SSR mode is not enabled** - The entire design assumes SSR but `nuxt.config.ts` has no `ssr: true`
2. **Auth system does not exist** - Referenced auth APIs (`AuthTokenBroker`, `useSessionContext()`, workspace membership) are not implemented
3. **Workspace isolation strategy conflict** - Requirement 2.3 pivots to separate DBs per workspace, contradicting the Convex schema that uses `workspace_id` fields
4. **Race conditions in clock increment** - Clock field must increment atomically but design doesn't enforce this
5. **Message ordering is fragile** - `order_key` generation is unspecified, leading to potential index collisions
6. **Missing dependencies** - `convex` and `convex-vue` are not in `package.json`

## Critical Issues (Must Fix Before Implementation)

### 1. No SSR Mode Configured

**Severity:** Blocker  
**Location:** `nuxt.config.ts`  
**Problem:** The entire sync design assumes SSR is enabled, but the app is currently client-only. All server routes, Convex mutations, and auth assumptions are dead code.

**Fix:**
```typescript
// nuxt.config.ts
export default defineNuxtConfig({
    ssr: true, // REQUIRED for SSR features
    // ... rest
});
```

---

### 2. Auth System Does Not Exist

**Severity:** Blocker  
**Location:** `design.md` lines 86-88, 1054  
**Problem:** The design references `useSessionContext()`, `AuthTokenBroker`, and workspace membership, but the codebase only has OpenRouter PKCE (client-only, no workspace concept).

**Impact:** Sync cannot start without workspace context and authorization.

**Solution Options:**
1. **Implement full SSR auth first** (recommended in planning/ssr-auth docs)
2. **Simplify for v1**: Drop workspace isolation, sync everything to single Convex workspace per user

---

### 3. Workspace Isolation Strategy Broken

**Severity:** Blocker  
**Location:** `requirements.md` lines 192-196, `design.md` line 93, Convex schema  
**Problem:** Requirement 2.3 (late addition) proposes separate Dexie DBs per workspace (`or3-db-${workspaceId}`), but:
- All Convex tables still have `workspace_id` fields and indexes
- Current codebase uses single hardcoded DB: `or3-db`
- No migration strategy specified

**Impact:** Fundamental architecture confusion. Cannot implement both strategies simultaneously.

**Recommendation:** Choose one strategy:

**Option A: Single DB, workspace_id per row** (recommended)
- Simpler migration
- Add `workspace_id` column to all Dexie tables
- Convex schema already correct
- Bump Dexie version to 7

**Option B: DB per workspace**
- Remove `workspace_id` from all Convex tables
- Requires complex Convex deployment strategy
- No clear benefit over Option A

---

### 4. Clock Increment Not Atomic

**Severity:** High  
**Location:** `design.md` line 827, 707-714  
**Problem:** LWW conflict resolution depends on `clock` being a monotonic per-record version counter, but design uses incoming clock as-is: `clock: (payload as any)?.clock ?? 0`

**Impact:** Two devices can write the same clock value, breaking LWW. Tie-break is undefined.

**Fix:**
```typescript
// Add to every Dexie write
const nextClock = (existing?.clock ?? 0) + 1;
await db.threads.put({ ...thread, clock: nextClock });

// Enforce server-side in Convex
const serverClock = Math.max(existing.clock ?? 0, op.clock) + 1;
await ctx.db.patch(existing._id, { ...op.payload, clock: serverClock });
```

---

### 5. Message order_key Generation Unspecified

**Severity:** High  
**Location:** `requirements.md` lines 122-124, `design.md` line 388, 776  
**Problem:** Two devices insert messages at same `(thread_id, index)`. Both generate `order_key` from local HLC. Which message wins? Design doesn't specify collision resolution.

**Impact:** Messages can reorder or disappear during sync.

**Fix:** Treat index collisions as conflicts:
1. Compare `clock` values (LWW)
2. If clocks equal, compare `order_key` lexicographically
3. Delete losing message and emit conflict hook

---

### 6. Missing Convex Dependencies

**Severity:** Medium  
**Location:** `package.json`, `tasks.md` line 10  
**Problem:** `convex` and `convex-vue` are referenced but not installed.

**Fix:**
```bash
npm install --legacy-peer-deps convex convex-vue
```

---

## High Priority Issues

### 7. Security: No Workspace Membership Check

**Severity:** High (Security)  
**Location:** `design.md` lines 512-513  
**Problem:** Convex `push` mutation verifies user identity but doesn't check workspace membership. Any authenticated user can push to any workspace.

**Fix:**
```typescript
// Verify workspace membership before accepting push
const membership = await ctx.db
    .query('workspaceMembers')
    .withIndex('by_user', (q) => q.eq('user_id', identity.subject))
    .filter((q) => q.eq(q.field('workspace_id'), args.workspace_id))
    .first();

if (!membership) {
    throw new Error('Access denied: not a workspace member');
}
```

---

### 8. Missing Schema Fields

**Severity:** High  
**Location:** `app/db/schema.ts`  
**Problem:** Dexie schemas missing `order_key` and `deleted_at` fields that Convex has.

**Fix:**
```typescript
export const MessageSchema = z.object({
    // ... existing fields ...
    order_key: z.string(),
    deleted_at: z.number().int().nullable().optional(),
});
```

Apply to all schemas: threads, messages, projects, posts, kv, file_meta.

---

### 9. HookBridge Transaction Safety

**Severity:** Medium  
**Location:** `design.md` lines 789-807  
**Problem:** Design uses Dexie table hooks to write to `pending_ops` inside the same transaction, but Dexie hooks cannot write to other tables.

**Impact:** Will throw `TransactionInactiveError`.

**Fix:** Buffer ops during hooks, flush after transaction commits:
```typescript
this.db.table('threads').hook('creating', (pk, obj, tx) => {
    this.buffer.push({ tableName: 'threads', op: 'put', pk, obj });
});

// After transaction commits:
await this.db.pending_ops.bulkAdd(this.buffer);
```

---

## Medium Priority Issues

### 10. Outbox Coalescing Unimplemented

**Location:** `design.md` line 877  
**Problem:** `coalesceOps` function referenced but not defined.

**Fix:**
```typescript
function coalesceOps(ops: PendingOp[]): PendingOp[] {
    const map = new Map<string, PendingOp>();
    for (const op of ops) {
        const key = `${op.tableName}:${op.pk}`;
        const existing = map.get(key);
        if (!existing || op.createdAt > existing.createdAt) {
            map.set(key, op);
        }
    }
    return Array.from(map.values());
}
```

---

### 11. No Subscription Cleanup on Workspace Switch

**Location:** `design.md` lines 99-105  
**Problem:** Watch callback starts new sync engine but never disposes old one.

**Impact:** Memory leak, stale subscriptions push wrong workspace data.

**Fix:**
```typescript
let currentEngine: SyncEngine | null = null;

watch(session, async (s) => {
    if (currentEngine) {
        await currentEngine.stop();
        currentEngine = null;
    }
    if (s?.authenticated && s.workspace) {
        currentEngine = await syncEngine.start({ ... });
    }
});
```

---

### 12. CursorManager Never Loads Persisted Cursor

**Location:** `tasks.md` line 109  
**Problem:** Design mentions persisting cursor but no load logic shown.

**Impact:** On cold start, pulls entire change log from cursor=0.

---

### 13. Direct vs Gateway Mode Incomplete

**Location:** `design.md` lines 177, 212-216  
**Problem:** Gateway mode described but no SSR endpoints shown. No fallback if token fetch fails.

**Recommendation:** Drop gateway mode for v1, add later.

---

## Low Priority Issues

### 14. Retry Backoff Not Exponential

**Location:** `design.md` line 850  
**Problem:** Delays `[250, 1000, 3000, 5000]` are not exponential despite requirements saying "exponential backoff".

**Fix:** Either keep current (they're fine) and fix docs, or use true exponential: `[250, 500, 1000, 2000, 4000]`.

---

### 15. Hook Payloads Use `unknown` Types

**Location:** `design.md` line 1005  
**Problem:** Conflict hook payloads typed as `unknown` instead of per-table types.

**Impact:** Plugins lose type safety.

---

### 16. No Performance Budgets

**Problem:** 
- Outbox flushes every 1s (aggressive)
- Subscription callbacks not debounced
- No backpressure if 100 changes arrive at once

**Fix:** Add debounce to subscription handlers:
```typescript
const debouncedOnChanges = debounce(onChanges, 100);
```

---

### 17. Tombstone GC Unimplemented

**Location:** `requirements.md` lines 139-141, `tasks.md` lines 128-131  
**Problem:** No GC implementation shown.

**Impact:** Tombstones grow forever until quota exceeded (long-term issue).

---

## Positive Observations

✅ **Well-documented types and interfaces** - TypeScript types are comprehensive  
✅ **Hooks integration thoughtful** - Event system properly leveraged  
✅ **LWW conflict resolution is sound** - Once clock increment is fixed  
✅ **Provider abstraction is clean** - Good separation of concerns  
✅ **Comprehensive test checklist** - Tasks document covers unit, integration, E2E  

---

## Implementation Checklist

Before implementing this design:

- [ ] **Enable SSR mode** (`ssr: true` in `nuxt.config.ts`)
- [ ] **Implement or stub auth system** (session, workspace membership, token broker)
- [ ] **Resolve workspace isolation strategy** (Option A recommended)
- [ ] **Add missing schema fields** (order_key, deleted_at)
- [ ] **Install Convex dependencies**
- [ ] **Implement atomic clock increment**
- [ ] **Add message collision resolution**
- [ ] **Implement coalesceOps function**
- [ ] **Fix HookBridge transaction safety**
- [ ] **Add workspace membership authorization**
- [ ] **Add subscription cleanup**
- [ ] **Add debounce to subscriptions**
- [ ] **Write critical tests** (clock, conflicts, outbox, retry)

---

## Recommendation

**Status: NOT READY FOR IMPLEMENTATION**

The documentation has strong foundations but contains multiple blocking issues and architectural conflicts. Recommend:

1. **Rewrite design.md** to resolve workspace isolation strategy
2. **Create auth system stub** or defer auth-dependent features to v2
3. **Enable SSR mode** as prerequisite
4. **Add missing implementations** (coalesceOps, cursor loading, etc.)
5. **Fix transaction safety issues**
6. **Add comprehensive tests** before starting implementation

**Estimated remediation time:** 2-3 days of documentation cleanup and architecture decisions before implementation can begin.

---

## Test Coverage Needed

Priority tests to write:

```typescript
// 1. Clock increment
describe('Clock increment', () => {
    it('should increment clock atomically on every update');
    it('should handle concurrent writes with different clocks');
});

// 2. Message collision
describe('Message index collision', () => {
    it('should resolve collisions via clock then order_key');
    it('should emit conflict hook');
});

// 3. Outbox coalescing
describe('Outbox coalescing', () => {
    it('should keep latest op per record');
    it('should preserve ops for different records');
});

// 4. Workspace isolation
describe('Workspace isolation', () => {
    it('should isolate data by workspace_id');
    it('should prevent cross-workspace access');
});

// 5. Auth integration
describe('Sync authorization', () => {
    it('should reject push without workspace membership');
    it('should verify token before sync');
});
```

---

**Next Steps:** Address critical issues above, then proceed with implementation.
