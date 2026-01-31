# Convex Fixes - Developer Checklist

Quick reference for implementing the 15 critical fixes identified in the audit.

---

## 🚨 Priority 1: Security (45 min)

### Issue #4: Add requireAdmin() to 6 Functions

**File:** `convex/admin.ts`

```bash
# Search for these functions and add: await requireAdmin(ctx);
# as the first line in the handler:

Line 351  | getWorkspace
Line 498  | restoreWorkspace
Line 523  | listWorkspaceMembers
Line 611  | setWorkspaceMemberRole
Line 636  | removeWorkspaceMember
Line 664  | getWorkspaceSetting
Line 685  | setWorkspaceSetting
```

**Pattern:**
```typescript
handler: async (ctx, args) => {
    await requireAdmin(ctx); // ← ADD THIS LINE
    // ... rest of handler
```

**Test:** Try calling as non-admin → should throw "Forbidden: Admin access required"

---

### Issue #13: Search Limits

**File:** `convex/admin.ts` (line 209)

**Add at top of file:**
```typescript
const MAX_SEARCH_LIMIT = 100;
const MAX_QUERY_LENGTH = 200;
```

**In searchUsers handler:**
```typescript
handler: async (ctx, args) => {
    await requireAdmin(ctx); // ADD
    
    if (args.query.length > MAX_QUERY_LENGTH) { // ADD
        throw new Error(`Query too long: ${args.query.length} > ${MAX_QUERY_LENGTH}`);
    }
    
    const limit = Math.min(args.limit ?? 20, MAX_SEARCH_LIMIT); // CHANGE
```

---

## 💰 Priority 2: Cost Bombs (3.25 hours)

### Issue #1: GC Continuation Limit

**File:** `convex/sync.ts`

**Line ~820 - Add to args:**
```typescript
args: {
    // ... existing args
    continuation_count: v.optional(v.number()), // ADD
```

**Line 896 - Add limit check:**
```typescript
const MAX_CONTINUATIONS = 10;
const continuationCount = args.continuation_count ?? 0;

if ((hasMoreTombstones || hasMoreChangeLogs) && continuationCount < MAX_CONTINUATIONS) {
    await ctx.scheduler.runAfter(GC_CONTINUATION_DELAY_MS, internal.sync.runWorkspaceGc, {
        // ... existing params
        continuation_count: continuationCount + 1, // ADD
    });
} else if (continuationCount >= MAX_CONTINUATIONS) {
    console.warn(`[GC] Max continuations reached for workspace ${args.workspace_id}`);
}
```

---

### Issue #2: File Size Limit

**File:** `convex/storage.ts` (line 41)

**Add at top:**
```typescript
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
```

**In generateUploadUrl handler:**
```typescript
handler: async (ctx, args) => {
    await verifyWorkspaceMembership(ctx, args.workspace_id);
    
    if (args.size_bytes > MAX_FILE_SIZE) { // ADD
        throw new Error(`File size ${args.size_bytes} bytes exceeds maximum ${MAX_FILE_SIZE} bytes (100MB)`);
    }
    if (args.size_bytes < 0) { // ADD
        throw new Error('File size must be positive');
    }
    
    const uploadUrl = await ctx.storage.generateUploadUrl();
```

**Test:** Upload 101MB file → should reject

---

### Issue #3: GC Workspace Limit

**File:** `convex/sync.ts` (line 931)

**Add at top:**
```typescript
const MAX_WORKSPACES_PER_GC_RUN = 50;
```

**In runScheduledGc:**
```typescript
const workspaceIds = new Set<Id<'workspaces'>>();
for (const change of recentChanges) {
    if (workspaceIds.size >= MAX_WORKSPACES_PER_GC_RUN) break; // ADD
    const createdAt = typeof change.created_at === 'number' ? change.created_at : 0;
    if (createdAt >= sevenDaysAgo) {
        workspaceIds.add(change.workspace_id);
    }
}
```

---

### Issue #5: listWorkspaces Limit

**File:** `convex/admin.ts` (line 267)

**Add at top:**
```typescript
const MAX_PER_PAGE = 100;
```

**In handler:**
```typescript
handler: async (ctx, args) => {
    await requireAdmin(ctx); // ADD
    
    const { search, include_deleted, page, per_page } = args;
    const limit = Math.min(per_page, MAX_PER_PAGE); // CHANGE
    const skip = (page - 1) * limit; // USE limit not per_page
    
    // Use indexed query
    let query = ctx.db.query('workspaces');
    if (!include_deleted) {
        query = query.withIndex('by_deleted', (q) => q.eq('deleted', false));
    }
    let workspaces = await query.collect();
    
    // ... rest unchanged
    const paginated = workspaces.slice(skip, skip + limit); // USE limit
```

---

### Issue #6: Job Cleanup Batching

**File:** `convex/backgroundJobs.ts` (line 186)

**Add at top:**
```typescript
const CLEANUP_BATCH_SIZE = 100;
```

**Change all `.collect()` to `.take(CLEANUP_BATCH_SIZE)`:**
```typescript
// Line ~201
const streamingJobs = await ctx.db
    .query('background_jobs')
    .withIndex('by_status', (q) => q.eq('status', 'streaming'))
    .take(CLEANUP_BATCH_SIZE); // CHANGE from collect()

// Line ~219 (in loop, do for each status)
const jobs = await ctx.db
    .query('background_jobs')
    .withIndex('by_status', (q) => q.eq('status', status))
    .take(CLEANUP_BATCH_SIZE); // CHANGE from collect()
```

---

### Issue #8: Workspace Delete Batching

**File:** `convex/workspaces.ts` (line 53)

**Add at top:**
```typescript
const DELETE_BATCH_SIZE = 100;
const MAX_DELETE_ITERATIONS = 10;
```

**Replace deleteByIndex function:**
```typescript
const deleteByIndex = async (table: TableNames, indexName: string) => {
    let totalDeleted = 0;
    let iterations = 0;
    
    while (iterations < MAX_DELETE_ITERATIONS) {
        const rows = await (ctx.db.query(table) as unknown as QueryByIndex)
            .withIndex(indexName, (q) => q.eq('workspace_id', workspaceId))
            .take(DELETE_BATCH_SIZE); // CHANGE from collect()
        
        if (rows.length === 0) break;
        
        await Promise.all(rows.map(row => ctx.db.delete(row._id)));
        
        totalDeleted += rows.length;
        iterations++;
        
        if (rows.length < DELETE_BATCH_SIZE) break;
    }
    
    if (iterations >= MAX_DELETE_ITERATIONS) {
        console.warn(`[deleteWorkspace] Max iterations reached for ${table}`);
    }
    
    return totalDeleted;
};
```

---

### Issue #10: Rate Limit Cleanup

**File:** `convex/rateLimits.ts` (line 119)

**Add at top:**
```typescript
const RATE_LIMIT_CLEANUP_BATCH_SIZE = 500;
const MAX_BATCHES_PER_RUN = 5;
```

**Replace cleanup handler:**
```typescript
handler: async (ctx) => {
    const cutoff = Date.now() - 48 * 60 * 60 * 1000;
    let totalDeleted = 0;
    let batches = 0;
    
    while (batches < MAX_BATCHES_PER_RUN) {
        const oldRecords = await ctx.db
            .query('rate_limits')
            .filter((q) => q.lt(q.field('updated_at'), cutoff))
            .take(RATE_LIMIT_CLEANUP_BATCH_SIZE); // CHANGE from 100
        
        if (oldRecords.length === 0) break;
        
        await Promise.all(oldRecords.map(r => ctx.db.delete(r._id)));
        
        totalDeleted += oldRecords.length;
        batches++;
        
        if (oldRecords.length < RATE_LIMIT_CLEANUP_BATCH_SIZE) break;
    }
    
    return { deleted: totalDeleted, batches };
},
```

---

## 🎯 Priority 3: Performance (3 hours)

### Issue #15: Input Validation

**Files:** `admin.ts`, `workspaces.ts`, `sync.ts`

**Add constants at top of each file:**

**admin.ts:**
```typescript
const MAX_WORKSPACE_NAME_LENGTH = 200;
const MAX_WORKSPACE_DESCRIPTION_LENGTH = 2000;
const MAX_SETTING_KEY_LENGTH = 100;
const MAX_SETTING_VALUE_LENGTH = 10000;
```

**workspaces.ts:**
```typescript
const MAX_WORKSPACE_NAME_LENGTH = 200;
const MAX_WORKSPACE_DESCRIPTION_LENGTH = 2000;
```

**sync.ts:**
```typescript
const MAX_OP_ID_LENGTH = 64;
const MAX_PAYLOAD_SIZE = 64 * 1024;
const VALID_TABLES = ['threads', 'messages', 'projects', 'posts', 'kv', 'file_meta', 'notifications'];
```

**Add validation in handlers:**

**admin.ts - createWorkspace (line 389):**
```typescript
if (args.name.length === 0) {
    throw new Error('Workspace name cannot be empty');
}
if (args.name.length > MAX_WORKSPACE_NAME_LENGTH) {
    throw new Error(`Workspace name too long: ${args.name.length} > ${MAX_WORKSPACE_NAME_LENGTH}`);
}
if (args.description && args.description.length > MAX_WORKSPACE_DESCRIPTION_LENGTH) {
    throw new Error(`Description too long: ${args.description.length} > ${MAX_WORKSPACE_DESCRIPTION_LENGTH}`);
}
```

**admin.ts - setWorkspaceSetting (line 685):**
```typescript
if (args.key.length > MAX_SETTING_KEY_LENGTH) {
    throw new Error(`Setting key too long: ${args.key.length} > ${MAX_SETTING_KEY_LENGTH}`);
}
if (args.value.length > MAX_SETTING_VALUE_LENGTH) {
    throw new Error(`Setting value too long: ${args.value.length} > ${MAX_SETTING_VALUE_LENGTH}`);
}
```

**sync.ts - push (line 362, after batch size check):**
```typescript
for (const op of args.ops) {
    if (op.op_id.length > MAX_OP_ID_LENGTH) {
        throw new Error(`op_id too long: ${op.op_id.length} > ${MAX_OP_ID_LENGTH}`);
    }
    if (!VALID_TABLES.includes(op.table_name)) {
        throw new Error(`Invalid table: ${op.table_name}`);
    }
    if (op.payload) {
        const payloadSize = JSON.stringify(op.payload).length;
        if (payloadSize > MAX_PAYLOAD_SIZE) {
            throw new Error(`Payload too large: ${payloadSize} > ${MAX_PAYLOAD_SIZE}`);
        }
    }
}
```

---

### Issue #7 & #20: Fix N+1 Patterns

**Pattern to follow:**
```typescript
// BEFORE:
const items = await ctx.db.query('table1').collect();
const results = await Promise.all(
    items.map(async (item) => {
        const related = await ctx.db.get(item.foreign_key); // N+1!
        return { ...item, related };
    })
);

// AFTER:
const items = await ctx.db.query('table1').collect();
const foreignKeys = items.map(i => i.foreign_key);
const related = await Promise.all(foreignKeys.map(id => ctx.db.get(id)));
const relatedMap = new Map(related.filter(Boolean).map(r => [r!._id, r!]));
const results = items.map((item) => ({
    ...item,
    related: relatedMap.get(item.foreign_key)
}));
```

**Apply to:**
- `admin.ts` line 90 (listAdmins)
- `admin.ts` line 523 (listWorkspaceMembers)
- `workspaces.ts` line 92 (listMyWorkspaces)

---

### Issue #9: Optimize File Dedupe

**File:** `convex/storage.ts` (line 107)

**REPLACE:**
```typescript
// OLD:
const matches = await ctx.db
    .query('file_meta')
    .withIndex('by_workspace_hash', (q) =>
        q.eq('workspace_id', args.workspace_id).eq('hash', args.hash)
    )
    .collect();

if (matches.length > 1) {
    const sorted = [...matches].sort((a, b) => a._creationTime - b._creationTime);
    // ... dedupe logic
}

// NEW:
const existing = await ctx.db
    .query('file_meta')
    .withIndex('by_workspace_hash', (q) =>
        q.eq('workspace_id', args.workspace_id).eq('hash', args.hash)
    )
    .first();

if (existing && existing._id !== createdId) {
    await ctx.db.patch(existing._id, {
        storage_id: args.storage_id,
        storage_provider_id: args.storage_provider_id,
        updated_at: nowSec(),
    });
    await ctx.db.delete(createdId);
    return;
}
```

---

## ✅ Testing After Each Change

```bash
# Run tests
bun test

# Type check
bunx nuxi typecheck

# Lint
bun run lint

# Manual tests
# - Admin dashboard loads
# - Upload file < 100MB (should work)
# - Upload file > 100MB (should fail)
# - Non-admin calls admin endpoint (should fail)
```

---

## 📊 Progress Tracking

```
Priority 1 (45 min):
[ ] Issue #4: Add requireAdmin() (6 functions)
[ ] Issue #13: Search limits

Priority 2 (3.25 hours):
[ ] Issue #1: GC continuation limit
[ ] Issue #2: File size limit
[ ] Issue #3: GC workspace limit
[ ] Issue #5: listWorkspaces limit
[ ] Issue #6: Job cleanup batching
[ ] Issue #8: Workspace delete batching
[ ] Issue #10: Rate limit cleanup

Priority 3 (3 hours):
[ ] Issue #15: Input validation (3 files)
[ ] Issue #7 & #20: Fix N+1 (3 functions)
[ ] Issue #9: Optimize dedupe

Final:
[ ] All tests pass
[ ] 0 type errors
[ ] 0 lint errors
[ ] Manual smoke tests pass
```

---

## 🚀 Quick Start

1. **Start with security:** Issues #4 and #13 (45 min)
2. **Test admin dashboard** → verify requireAdmin() works
3. **Add cost limits:** Issues #1, #2, #3 (1 hour)
4. **Test uploads** → verify file size limit works
5. **Add batching:** Issues #5, #6, #8, #10 (2 hours)
6. **Add validation:** Issues #15, #7, #9 (3 hours)
7. **Final testing** → verify all tests pass

**Total Time:** 6-7 hours for all fixes

---

## 🆘 Need Help?

See detailed explanations in:
- `/planning/convex-fixes-task-list.md` (full task list with code examples)
- `/planning/convex-fixes-summary.md` (executive summary)
- `/planning/di-convex.md` (original audit)

---

**Tip:** Commit after each issue is fixed and tested! This makes it easy to rollback if needed.
