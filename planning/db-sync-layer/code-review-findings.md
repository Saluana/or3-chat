# DB Sync Layer Code Review Findings

**Date:** 2026-01-12  
**Reviewer:** Code Review Agent  
**Status:** ⚠️ Needs Clarification & Technical Fixes

## Important Context

**OR3-Cloud features (SSR auth, sync, storage) are OPTIONAL.** The app must function as:
- **Static build** (default): Local-first, no sync, OpenRouter PKCE auth only
- **SSR build** (optional): Enables Clerk auth, workspace sync, multi-user features

The db-sync-layer design is for **optional SSR mode only**. These features should be toggleable and not break static builds.

## Executive Summary

The db-sync-layer documentation has several **technical issues** that need fixing before implementation:

1. ✅ **SSR/Auth are optional** - Design correctly assumes SSR mode, but needs runtime guards
2. ❌ **Workspace isolation strategy conflict** - Requirement 2.3 contradicts Convex schema design
3. ❌ **Race conditions in clock increment** - Clock field must increment atomically but design doesn't enforce this
4. ❌ **Message ordering is fragile** - `order_key` generation is unspecified, leading to potential index collisions
5. ❌ **Missing dependencies** - `convex` and `convex-vue` are not in `package.json` (needed for SSR mode)
6. ❌ **Missing runtime toggles** - No clear guards to prevent SSR code from running in static builds

## Critical Issues (Must Fix Before Implementation)

### 1. SSR/Auth Dependencies - Add Runtime Guards

**Severity:** High (Architecture)  
**Location:** Throughout design.md  
**Problem:** The design assumes SSR auth exists but doesn't show how to gracefully handle static builds where these features are disabled.

**Context:** OR3-Cloud is optional. Auth via Clerk exists in SSR mode (`bun run dev:ssr`). Static builds use only OpenRouter PKCE.

**Fix:** Add runtime feature detection and graceful degradation:

```typescript
// app/plugins/convex-sync.client.ts
export default defineNuxtPlugin(async () => {
    // Only run if SSR auth is enabled
    if (!useRuntimeConfig().public.or3CloudEnabled) {
        console.log('[sync] OR3-Cloud disabled, skipping sync initialization');
        return;
    }

    // Only run on client, only when SSR auth enabled
    if (import.meta.server) return;

    const { session } = useSessionContext();
    // ... rest of sync logic
});
```

**Requirements for design.md:**
- Add "Feature Detection" section showing how to check if OR3-Cloud is enabled
- Document `runtimeConfig.public.or3CloudEnabled` flag
- Show graceful no-ops for all sync composables when feature is disabled

---

### 2. Workspace Isolation Strategy Conflict

**Severity:** High (Architecture)  
**Location:** `requirements.md` lines 192-196, `design.md` line 93, Convex schema  
**Problem:** Requirement 2.3 (late addition) proposes separate Dexie DBs per workspace (`or3-db-${workspaceId}`), but:
- All Convex tables still have `workspace_id` fields and indexes
- Current codebase uses single hardcoded DB: `or3-db`
- No migration strategy specified

**Impact:** Fundamental architecture confusion. Cannot implement both strategies simultaneously.

**Recommendation:** Choose one strategy and document it clearly:

**Option A: Single DB, workspace_id per row** (recommended for OR3-Cloud)
- Simpler migration for SSR mode
- Add `workspace_id` column to all Dexie tables (only populated in SSR mode)
- Convex schema already correct
- Bump Dexie version to 7
- Static builds ignore `workspace_id` field (always null)

**Option B: DB per workspace** (complex)
- Remove `workspace_id` from all Convex tables
- Requires complex Convex deployment strategy
- No clear benefit over Option A
- Harder to migrate between static and SSR modes

---

### 3. Clock Increment Not Atomic

**Severity:** High (Data Integrity)  
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

### 4. Message order_key Generation Unspecified

**Severity:** High (Data Integrity)  
**Location:** `requirements.md` lines 122-124, `design.md` line 388, 776  
**Problem:** Two devices insert messages at same `(thread_id, index)`. Both generate `order_key` from local HLC. Which message wins? Design doesn't specify collision resolution.

**Impact:** Messages can reorder or disappear during sync.

**Fix:** Treat index collisions as conflicts:
1. Compare `clock` values (LWW)
2. If clocks equal, compare `order_key` lexicographically
3. Delete losing message and emit conflict hook

---

### 5. Missing Convex Dependencies (SSR Mode Only)

**Severity:** Medium  
**Location:** `package.json`, `tasks.md` line 10  
**Problem:** `convex` and `convex-vue` are referenced but not installed. These are only needed for SSR mode with sync enabled.

**Fix:** Document that these are optional dependencies for SSR mode:
```bash
# Only needed if deploying with OR3-Cloud sync enabled
npm install --legacy-peer-deps convex convex-vue
```

**Recommendation:** Make these peer dependencies or document as optional in tasks.md.

---

### 6. Missing Runtime Feature Toggles

**Severity:** Medium (Architecture)  
**Location:** Throughout design  
**Problem:** No clear mechanism shown for detecting if OR3-Cloud features are enabled at runtime.

**Fix:** Add to design.md:

```typescript
// app/config/or3-cloud.ts
export const useOr3CloudConfig = () => {
    const config = useRuntimeConfig();
    return {
        enabled: config.public.or3CloudEnabled ?? false,
        syncEnabled: config.public.syncEnabled ?? false,
        authProvider: config.public.authProvider ?? 'openrouter', // 'clerk' in SSR
    };
};

// Usage in sync plugin
export default defineNuxtPlugin(() => {
    const { enabled, syncEnabled } = useOr3CloudConfig();
    
    if (!enabled || !syncEnabled) {
        console.log('[sync] OR3-Cloud sync disabled');
        return;
    }
    
    // Initialize sync engine...
});
```

---

## High Priority Issues (Technical Fixes)

### 7. Security: No Workspace Membership Check

**Severity:** High (Security) - **SSR Mode Only**  
**Location:** `design.md` lines 512-513  
**Problem:** Convex `push` mutation verifies user identity but doesn't check workspace membership. Any authenticated user can push to any workspace.

**Note:** This only applies when sync is enabled in SSR mode.

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

### 8. Missing Schema Fields (For Sync Support)

**Severity:** High  
**Location:** `app/db/schema.ts`  
**Problem:** Dexie schemas missing `order_key` and `deleted_at` fields that Convex has. These fields should be optional and only used when sync is enabled.

**Fix:**
```typescript
export const MessageSchema = z.object({
    // ... existing fields ...
    order_key: z.string().optional(), // Only used with sync
    deleted_at: z.number().int().nullable().optional(), // Only used with sync
    workspace_id: z.string().nullable().optional(), // Only used in SSR mode
});
```

Apply to all schemas: threads, messages, projects, posts, kv, file_meta.

**Important:** These fields should gracefully degrade:
- In static builds: always null/undefined
- In SSR builds without sync: always null/undefined  
- In SSR builds with sync: populated by sync engine

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

### Architecture & Design
- [ ] **Add runtime feature detection** (or3CloudEnabled, syncEnabled flags)
- [ ] **Resolve workspace isolation strategy** (Option A: single DB + workspace_id recommended)
- [ ] **Document SSR vs Static build differences** clearly in design.md
- [ ] **Add graceful degradation patterns** for when OR3-Cloud is disabled

### Schema & Types
- [ ] **Add optional schema fields** (order_key, deleted_at, workspace_id - all nullable)
- [ ] **Bump Dexie version** if adding new fields
- [ ] **Ensure backward compatibility** with existing local data

### Core Sync Features (SSR Mode Only)
- [ ] **Implement atomic clock increment** in all write paths
- [ ] **Add message collision resolution** with proper LWW + order_key handling
- [ ] **Implement coalesceOps function** for outbox optimization
- [ ] **Fix HookBridge transaction safety** (buffer then flush)
- [ ] **Add workspace membership authorization** in Convex mutations
- [ ] **Add subscription cleanup** on workspace/session changes
- [ ] **Add debounce to subscriptions** to prevent UI thrashing

### Optional Dependencies (SSR Mode Only)
- [ ] **Install Convex dependencies** only when deploying with sync
- [ ] **Document optional deps** in package.json or separate install script
- [ ] **Guard Convex imports** to not break static builds

### Testing
- [ ] **Write critical tests** (clock, conflicts, outbox, retry)
- [ ] **Test static build still works** without OR3-Cloud
- [ ] **Test SSR build** with sync enabled
- [ ] **Test SSR build** with sync disabled

---

## Recommendation

**Status: NEEDS ARCHITECTURE UPDATES & TECHNICAL FIXES**

The documentation has solid foundations and correctly designs for optional SSR features. However, it needs clarification and technical fixes:

### Immediate Actions Needed:

1. **Clarify OR3-Cloud as Optional** throughout all docs
   - Add "Feature Toggle" section to design.md
   - Show runtime detection patterns
   - Document graceful degradation when disabled

2. **Resolve Workspace Isolation Strategy**
   - Choose between Option A (single DB + workspace_id) or Option B (DB per workspace)
   - Document migration path from static to SSR builds
   - Show how workspace_id remains null in static builds

3. **Fix Technical Issues**
   - Atomic clock increment
   - Message order_key collision handling
   - HookBridge transaction safety
   - Workspace membership security checks

4. **Add Missing Implementations**
   - coalesceOps function
   - Cursor persistence loading
   - Subscription cleanup
   - Runtime feature detection helpers

5. **Test Coverage**
   - Sync engine unit tests
   - Static vs SSR integration tests
   - Migration tests (static → SSR mode)

**Estimated remediation time:** 1-2 days of documentation updates + proper technical fixes before implementation can begin.

---

## Summary for Static vs SSR Builds

| Feature | Static Build | SSR Build (No Sync) | SSR Build (With Sync) |
|---------|--------------|---------------------|----------------------|
| Local Dexie | ✅ Yes | ✅ Yes | ✅ Yes |
| OpenRouter Auth | ✅ PKCE | ✅ PKCE | ✅ PKCE + Clerk |
| Clerk Auth | ❌ No | ✅ Optional | ✅ Yes |
| Workspace Isolation | ❌ N/A | ✅ Yes (per user) | ✅ Yes (multi-user) |
| DB Sync | ❌ No | ❌ No | ✅ Yes (Convex) |
| `workspace_id` field | null | null | populated |
| `order_key` field | null | null | populated |
| Convex deps | ❌ Not needed | ❌ Not needed | ✅ Required |



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

## Revision History

**2026-01-12 (Updated):** Corrected understanding based on user feedback. OR3-Cloud features (SSR auth via Clerk, sync, storage) are **optional** and toggleable. The app supports both static and SSR builds. Auth via Clerk exists and can be enabled with `bun run dev:ssr`. Updated review to focus on:
1. Proper feature detection and runtime toggles
2. Technical fixes (clock increment, message ordering, transaction safety)
3. Clear documentation of static vs SSR build differences

Original review incorrectly treated SSR features as "missing" rather than "optional."

---

**Next Steps:** Address technical issues and architecture clarifications above, then proceed with implementation.
