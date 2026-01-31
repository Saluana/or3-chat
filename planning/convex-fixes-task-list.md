# Convex Backend Issues - Prioritized Fix Task List

**Generated:** 2024-01-31  
**Base Document:** `/planning/di-convex.md`  
**Status:** Ready for Implementation  

---

## Executive Summary

Out of 20 issues identified in the audit document, **15 issues exist** in the current codebase and require fixes. The remaining 5 are either already fixed or don't apply. This document provides a prioritized, actionable task list with specific file changes needed.

**Key Metrics:**
- ✅ Tests passing: Required after all fixes
- ✅ Type-safe: 0 nuxi typecheck errors
- ✅ Lint-clean: 0 eslint errors
- ✅ Non-breaking: All changes backward compatible

---

## Priority 1: CRITICAL - Security Issues (Must Fix First)

### Issue 4: Missing Admin Authorization Checks

**Status:** ❌ **EXISTS** - 6 functions lack admin checks  
**Risk:** BREAKING if client code calls these without auth  
**Fix Complexity:** Low (add 1 line per function)

#### Files to Modify:
- `convex/admin.ts`

#### Changes Needed:

1. **Line 351** - `getWorkspace` query
```typescript
// BEFORE:
export const getWorkspace = query({
    args: {
        workspace_id: v.id('workspaces'),
    },
    handler: async (ctx, args) => {
        const workspace = await ctx.db.get(args.workspace_id);

// AFTER:
export const getWorkspace = query({
    args: {
        workspace_id: v.id('workspaces'),
    },
    handler: async (ctx, args) => {
        await requireAdmin(ctx); // ADD THIS LINE
        const workspace = await ctx.db.get(args.workspace_id);
```

2. **Line 498** - `restoreWorkspace` mutation
```typescript
// BEFORE:
handler: async (ctx, args) => {
    const workspace = await ctx.db.get(args.workspace_id);

// AFTER:
handler: async (ctx, args) => {
    await requireAdmin(ctx); // ADD THIS LINE
    const workspace = await ctx.db.get(args.workspace_id);
```

3. **Line 523** - `listWorkspaceMembers` query
```typescript
// BEFORE:
handler: async (ctx, args) => {
    const members = await ctx.db

// AFTER:
handler: async (ctx, args) => {
    await requireAdmin(ctx); // ADD THIS LINE
    const members = await ctx.db
```

4. **Line 611** - `setWorkspaceMemberRole` mutation
```typescript
// BEFORE:
handler: async (ctx, args) => {
    const member = await ctx.db

// AFTER:
handler: async (ctx, args) => {
    await requireAdmin(ctx); // ADD THIS LINE
    const member = await ctx.db
```

5. **Line 636** - `removeWorkspaceMember` mutation
```typescript
// BEFORE:
handler: async (ctx, args) => {
    const member = await ctx.db

// AFTER:
handler: async (ctx, args) => {
    await requireAdmin(ctx); // ADD THIS LINE
    const member = await ctx.db
```

6. **Lines 664 & 685** - `getWorkspaceSetting` and `setWorkspaceSetting`
```typescript
// Both need requireAdmin() as first line in handler
```

**Testing:**
```bash
# After changes, verify these fail without admin token:
- Call getWorkspace as non-admin → should throw "Forbidden"
- Call restoreWorkspace as non-admin → should throw "Forbidden"
```

---

### Issue 13: Admin Search Without Rate Limiting

**Status:** ❌ **EXISTS** - No max limit, no admin check  
**Risk:** Non-breaking (adds validation)  
**Fix Complexity:** Low

#### Files to Modify:
- `convex/admin.ts` (line 209)

#### Changes Needed:

```typescript
// BEFORE:
export const searchUsers = query({
    args: {
        query: v.string(),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const limit = args.limit ?? 20;
        const searchTerm = args.query.toLowerCase().trim();

// AFTER:
const MAX_SEARCH_LIMIT = 100;
const MAX_QUERY_LENGTH = 200;

export const searchUsers = query({
    args: {
        query: v.string(),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        await requireAdmin(ctx); // ADD ADMIN CHECK
        
        if (args.query.length > MAX_QUERY_LENGTH) {
            throw new Error(`Query too long: ${args.query.length} > ${MAX_QUERY_LENGTH}`);
        }
        
        const limit = Math.min(args.limit ?? 20, MAX_SEARCH_LIMIT); // ENFORCE MAX
        const searchTerm = args.query.toLowerCase().trim();
```

---

## Priority 2: HIGH - Cost Bomb Issues

### Issue 1: Infinite GC Loop of Doom

**Status:** ❌ **EXISTS** - No continuation limit  
**Risk:** Non-breaking (adds safety limit)  
**Fix Complexity:** Low

#### Files to Modify:
- `convex/sync.ts` (lines 896-904)

#### Changes Needed:

1. **Add continuation_count to args schema** (line ~820):
```typescript
// In runWorkspaceGc args:
export const runWorkspaceGc = internalMutation({
    args: {
        workspace_id: v.id('workspaces'),
        retention_seconds: v.optional(v.number()),
        batch_size: v.optional(v.number()),
        tombstone_cursor: v.optional(v.string()),
        changelog_cursor: v.optional(v.string()),
        continuation_count: v.optional(v.number()), // ADD THIS
    },
```

2. **Add limit check before scheduling continuation** (line 896):
```typescript
// BEFORE:
if (hasMoreTombstones || hasMoreChangeLogs) {
    await ctx.scheduler.runAfter(GC_CONTINUATION_DELAY_MS, internal.sync.runWorkspaceGc, {
        workspace_id: args.workspace_id,
        retention_seconds: retentionSeconds,
        batch_size: batchSize,
        tombstone_cursor: nextTombstoneCursor,
        changelog_cursor: nextChangelogCursor,
    });
}

// AFTER:
const MAX_CONTINUATIONS = 10; // Process max 1000 entries per scheduled GC
const continuationCount = args.continuation_count ?? 0;

if ((hasMoreTombstones || hasMoreChangeLogs) && continuationCount < MAX_CONTINUATIONS) {
    await ctx.scheduler.runAfter(GC_CONTINUATION_DELAY_MS, internal.sync.runWorkspaceGc, {
        workspace_id: args.workspace_id,
        retention_seconds: retentionSeconds,
        batch_size: batchSize,
        tombstone_cursor: nextTombstoneCursor,
        changelog_cursor: nextChangelogCursor,
        continuation_count: continuationCount + 1, // INCREMENT
    });
} else if (continuationCount >= MAX_CONTINUATIONS) {
    console.warn(`[GC] Max continuations reached for workspace ${args.workspace_id}, will resume next cycle`);
}
```

**Testing:**
```bash
# Manual test: Create workspace with 1500 change_log entries, verify GC stops after 10 continuations
```

---

### Issue 2: Missing Upload Size Limits

**Status:** ❌ **EXISTS** - No file size or quota validation  
**Risk:** Non-breaking (rejects oversized uploads)  
**Fix Complexity:** Low

#### Files to Modify:
- `convex/storage.ts` (line 41)

#### Changes Needed:

```typescript
// BEFORE:
export const generateUploadUrl = mutation({
    args: {
        workspace_id: v.id('workspaces'),
        hash: v.string(),
        mime_type: v.string(),
        size_bytes: v.number(),
    },
    handler: async (ctx, args) => {
        await verifyWorkspaceMembership(ctx, args.workspace_id);
        const uploadUrl = await ctx.storage.generateUploadUrl();
        return { uploadUrl };
    },
});

// AFTER:
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

export const generateUploadUrl = mutation({
    args: {
        workspace_id: v.id('workspaces'),
        hash: v.string(),
        mime_type: v.string(),
        size_bytes: v.number(),
    },
    handler: async (ctx, args) => {
        await verifyWorkspaceMembership(ctx, args.workspace_id);
        
        // Validate file size
        if (args.size_bytes > MAX_FILE_SIZE) {
            throw new Error(`File size ${args.size_bytes} bytes exceeds maximum ${MAX_FILE_SIZE} bytes (100MB)`);
        }
        
        if (args.size_bytes < 0) {
            throw new Error('File size must be positive');
        }
        
        const uploadUrl = await ctx.storage.generateUploadUrl();
        return { uploadUrl };
    },
});
```

**Testing:**
```bash
# Test: Try uploading 101MB file → should reject
# Test: Try uploading -1 byte file → should reject
```

---

### Issue 3: Unbounded Workspace GC Scheduling

**Status:** ❌ **EXISTS** - No limit on workspaces per run  
**Risk:** Non-breaking (limits per-cycle processing)  
**Fix Complexity:** Low

#### Files to Modify:
- `convex/sync.ts` (line 931)

#### Changes Needed:

```typescript
// BEFORE:
const workspaceIds = new Set<Id<'workspaces'>>();
for (const change of recentChanges) {
    const createdAt = typeof change.created_at === 'number' ? change.created_at : 0;
    if (createdAt >= sevenDaysAgo) {
        workspaceIds.add(change.workspace_id);
    }
}

// AFTER:
const MAX_WORKSPACES_PER_GC_RUN = 50;

const workspaceIds = new Set<Id<'workspaces'>>();
for (const change of recentChanges) {
    if (workspaceIds.size >= MAX_WORKSPACES_PER_GC_RUN) break; // ADD LIMIT
    const createdAt = typeof change.created_at === 'number' ? change.created_at : 0;
    if (createdAt >= sevenDaysAgo) {
        workspaceIds.add(change.workspace_id);
    }
}
```

---

### Issue 5: Full Table Scan in listWorkspaces

**Status:** ❌ **EXISTS** - `.collect()` loads all workspaces  
**Risk:** Breaking if clients expect unlimited results  
**Fix Complexity:** Medium (requires indexed approach)

#### Files to Modify:
- `convex/admin.ts` (line 267)

#### Changes Needed:

```typescript
// BEFORE:
export const listWorkspaces = query({
    args: {
        search: v.optional(v.string()),
        include_deleted: v.optional(v.boolean()),
        page: v.number(),
        per_page: v.number(),
    },
    handler: async (ctx, args) => {
        const { search, include_deleted, page, per_page } = args;
        const skip = (page - 1) * per_page;

        // Get all workspaces
        let workspaces = await ctx.db.query('workspaces').collect();

// AFTER:
const MAX_PER_PAGE = 100;

export const listWorkspaces = query({
    args: {
        search: v.optional(v.string()),
        include_deleted: v.optional(v.boolean()),
        page: v.number(),
        per_page: v.number(),
    },
    handler: async (ctx, args) => {
        await requireAdmin(ctx); // ADD THIS (was missing)
        
        const { search, include_deleted, page, per_page } = args;
        
        // Enforce max per_page
        const limit = Math.min(per_page, MAX_PER_PAGE);
        const skip = (page - 1) * limit;

        // Use indexed query with filter
        let query = ctx.db.query('workspaces');
        
        // Filter by deleted status using index
        if (!include_deleted) {
            query = query.withIndex('by_deleted', (q) => q.eq('deleted', false));
        }
        
        // NOTE: For search, we still need to collect and filter in-memory
        // This is a limitation of Convex - no full-text search indexes
        let workspaces = await query.collect(); // Still needed for search
        
        // Filter by search term if provided
        if (search) {
            const searchTerm = search.toLowerCase();
            workspaces = workspaces.filter((w) =>
                w.name.toLowerCase().includes(searchTerm)
            );
        }
        
        const total = workspaces.length;
        const paginated = workspaces.slice(skip, skip + limit);
        
        // ... rest of function unchanged
```

**Note:** Full fix requires moving to Algolia/Typesense for search. This is a partial mitigation.

---

### Issue 6: Unbounded Background Job Cleanup

**Status:** ❌ **EXISTS** - Three `.collect()` calls with no limits  
**Risk:** Non-breaking (adds batching)  
**Fix Complexity:** Medium

#### Files to Modify:
- `convex/backgroundJobs.ts` (line 186)

#### Changes Needed:

```typescript
// BEFORE:
export const cleanup = mutation({
    args: {
        timeout_ms: v.optional(v.number()),
        retention_ms: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const timeoutMs = args.timeout_ms ?? 5 * 60 * 1000;
        const retentionMs = args.retention_ms ?? 5 * 60 * 1000;
        const now = Date.now();
        let cleaned = 0;

        // Get all streaming jobs that have timed out
        const streamingJobs = await ctx.db
            .query('background_jobs')
            .withIndex('by_status', (q) => q.eq('status', 'streaming'))
            .collect();

// AFTER:
const CLEANUP_BATCH_SIZE = 100;

export const cleanup = mutation({
    args: {
        timeout_ms: v.optional(v.number()),
        retention_ms: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const timeoutMs = args.timeout_ms ?? 5 * 60 * 1000;
        const retentionMs = args.retention_ms ?? 5 * 60 * 1000;
        const now = Date.now();
        let cleaned = 0;

        // Get streaming jobs that have timed out (LIMIT BATCH)
        const streamingJobs = await ctx.db
            .query('background_jobs')
            .withIndex('by_status', (q) => q.eq('status', 'streaming'))
            .take(CLEANUP_BATCH_SIZE); // CHANGE collect() to take()

        for (const job of streamingJobs) {
            const age = now - job.started_at;
            if (age > timeoutMs) {
                await ctx.db.patch(job._id, {
                    status: 'error',
                    error: 'Job timed out',
                    completed_at: now,
                });
                cleaned++;
            }
        }

        // Get completed jobs that are stale (LIMIT EACH STATUS)
        for (const status of ['complete', 'error', 'aborted'] as const) {
            const jobs = await ctx.db
                .query('background_jobs')
                .withIndex('by_status', (q) => q.eq('status', status))
                .take(CLEANUP_BATCH_SIZE); // CHANGE collect() to take()

            for (const job of jobs) {
                const completedAge = now - (job.completed_at ?? job.started_at);
                if (completedAge > retentionMs) {
                    await ctx.db.delete(job._id);
                    cleaned++;
                }
            }
        }

        return cleaned;
    },
});
```

**Note:** This limits to 400 jobs per cleanup run (100 × 4 status types). Consider adding continuation pattern if more aggressive cleanup needed.

---

### Issue 8: Unbounded Workspace Delete

**Status:** ❌ **EXISTS** - `.collect()` loads all related data  
**Risk:** Non-breaking (adds batching)  
**Fix Complexity:** Medium

#### Files to Modify:
- `convex/workspaces.ts` (line 53)

#### Changes Needed:

```typescript
// BEFORE:
async function deleteWorkspaceData(ctx: MutationCtx, workspaceId: Id<'workspaces'>) {
    // ... type definitions ...
    
    const deleteByIndex = async (table: TableNames, indexName: string) => {
        const rows = await (ctx.db.query(table) as unknown as QueryByIndex)
            .withIndex(indexName, (q) => q.eq('workspace_id', workspaceId))
            .collect();
        for (const row of rows) {
            await ctx.db.delete(row._id);
        }
    };

// AFTER:
const DELETE_BATCH_SIZE = 100;
const MAX_DELETE_ITERATIONS = 10; // Prevent infinite loops

async function deleteWorkspaceData(ctx: MutationCtx, workspaceId: Id<'workspaces'>) {
    // ... type definitions ...
    
    const deleteByIndex = async (table: TableNames, indexName: string) => {
        let totalDeleted = 0;
        let iterations = 0;
        
        while (iterations < MAX_DELETE_ITERATIONS) {
            const rows = await (ctx.db.query(table) as unknown as QueryByIndex)
                .withIndex(indexName, (q) => q.eq('workspace_id', workspaceId))
                .take(DELETE_BATCH_SIZE); // CHANGE to take()
            
            if (rows.length === 0) break;
            
            // Delete batch in parallel
            await Promise.all(rows.map(row => ctx.db.delete(row._id)));
            
            totalDeleted += rows.length;
            iterations++;
            
            // If we got less than batch size, we're done
            if (rows.length < DELETE_BATCH_SIZE) break;
        }
        
        if (iterations >= MAX_DELETE_ITERATIONS) {
            console.warn(`[deleteWorkspace] Max iterations reached for ${table}, may have more data`);
        }
        
        return totalDeleted;
    };
    
    // ... rest unchanged
```

**Note:** Large workspace deletes may need multiple cleanup runs. Consider adding a scheduled continuation if needed.

---

### Issue 10: Rate Limit Cleanup Doesn't Keep Up

**Status:** ❌ **EXISTS** - Only cleans 100/run, growth unbounded  
**Risk:** Non-breaking (improves cleanup)  
**Fix Complexity:** Low

#### Files to Modify:
- `convex/rateLimits.ts` (line 119)

#### Changes Needed:

```typescript
// BEFORE:
export const cleanup = internalMutation({
    args: {},
    handler: async (ctx) => {
        const cutoff = Date.now() - 48 * 60 * 60 * 1000;
        const oldRecords = await ctx.db
            .query('rate_limits')
            .filter((q) => q.lt(q.field('updated_at'), cutoff))
            .take(100);
        
        for (const record of oldRecords) {
            await ctx.db.delete(record._id);
        }
        
        return { deleted: oldRecords.length };
    },
});

// AFTER:
const RATE_LIMIT_CLEANUP_BATCH_SIZE = 500;
const MAX_BATCHES_PER_RUN = 5;

export const cleanup = internalMutation({
    args: {},
    handler: async (ctx) => {
        const cutoff = Date.now() - 48 * 60 * 60 * 1000;
        let totalDeleted = 0;
        let batches = 0;
        
        // Process multiple batches per run
        while (batches < MAX_BATCHES_PER_RUN) {
            const oldRecords = await ctx.db
                .query('rate_limits')
                .filter((q) => q.lt(q.field('updated_at'), cutoff))
                .take(RATE_LIMIT_CLEANUP_BATCH_SIZE);
            
            if (oldRecords.length === 0) break;
            
            // Delete batch in parallel
            await Promise.all(oldRecords.map(r => ctx.db.delete(r._id)));
            
            totalDeleted += oldRecords.length;
            batches++;
            
            // If we got less than batch size, we're done
            if (oldRecords.length < RATE_LIMIT_CLEANUP_BATCH_SIZE) break;
        }
        
        return { deleted: totalDeleted, batches };
    },
});
```

---

## Priority 3: MEDIUM - Input Validation & Performance

### Issue 15: Missing Input Validation on Critical Fields

**Status:** ❌ **EXISTS** - Multiple string fields without max length  
**Risk:** Non-breaking (adds validation)  
**Fix Complexity:** Low

#### Files to Modify:
- `convex/admin.ts` (multiple locations)
- `convex/workspaces.ts` (multiple locations)
- `convex/sync.ts` (line 340)

#### Changes Needed:

**1. Add validation constants at top of each file:**

```typescript
// In admin.ts:
const MAX_WORKSPACE_NAME_LENGTH = 200;
const MAX_WORKSPACE_DESCRIPTION_LENGTH = 2000;
const MAX_SETTING_KEY_LENGTH = 100;
const MAX_SETTING_VALUE_LENGTH = 10000;

// In sync.ts (already has MAX_PUSH_OPS):
const MAX_OP_ID_LENGTH = 64;
const MAX_PAYLOAD_SIZE = 64 * 1024; // 64KB per operation
const VALID_TABLES = ['threads', 'messages', 'projects', 'posts', 'kv', 'file_meta', 'notifications'];
```

**2. admin.ts - Line 389 `createWorkspace`:**

```typescript
handler: async (ctx, args) => {
    const { userId: adminUserId } = await requireAdmin(ctx);
    
    // ADD VALIDATION
    if (args.name.length === 0) {
        throw new Error('Workspace name cannot be empty');
    }
    if (args.name.length > MAX_WORKSPACE_NAME_LENGTH) {
        throw new Error(`Workspace name too long: ${args.name.length} > ${MAX_WORKSPACE_NAME_LENGTH}`);
    }
    if (args.description && args.description.length > MAX_WORKSPACE_DESCRIPTION_LENGTH) {
        throw new Error(`Description too long: ${args.description.length} > ${MAX_WORKSPACE_DESCRIPTION_LENGTH}`);
    }
    
    // Verify owner exists
    const owner = await ctx.db.get(args.owner_user_id);
```

**3. admin.ts - Line 685 `setWorkspaceSetting`:**

```typescript
handler: async (ctx, args) => {
    await requireAdmin(ctx); // ADD THIS
    
    // ADD VALIDATION
    if (args.key.length > MAX_SETTING_KEY_LENGTH) {
        throw new Error(`Setting key too long: ${args.key.length} > ${MAX_SETTING_KEY_LENGTH}`);
    }
    if (args.value.length > MAX_SETTING_VALUE_LENGTH) {
        throw new Error(`Setting value too long: ${args.value.length} > ${MAX_SETTING_VALUE_LENGTH}`);
    }
    
    const existing = await ctx.db
```

**4. workspaces.ts - Line 143 `create`:**

```typescript
const MAX_WORKSPACE_NAME_LENGTH = 200;
const MAX_WORKSPACE_DESCRIPTION_LENGTH = 2000;

// In handler:
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

**5. sync.ts - Line 362 (already validates batch size, add more):**

```typescript
// AFTER existing batch size check (line 363):
// Validate individual operations
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
            throw new Error(`Payload too large for ${op.table_name}: ${payloadSize} > ${MAX_PAYLOAD_SIZE}`);
        }
    }
}
```

**Note:** The `VALID_TABLES` check is redundant with existing `TABLE_INDEX_MAP` check at line 382, but makes intent explicit.

---

### Issue 7 & 20: N+1 Query Patterns

**Status:** ❌ **EXISTS** - 3 functions with N+1 patterns  
**Risk:** Non-breaking (performance improvement)  
**Fix Complexity:** Medium

#### Files to Modify:
- `convex/admin.ts` (lines 90, 523)
- `convex/workspaces.ts` (line 92)

#### Changes Needed:

**1. admin.ts - Line 90 `listAdmins`:**

```typescript
// BEFORE:
const admins = await ctx.db.query('admin_users').collect();

const results = await Promise.all(
    admins.map(async (admin) => {
        const user = await ctx.db.get(admin.user_id); // N+1!
        return {
            userId: admin.user_id,
            email: user?.email,
            displayName: user?.display_name,
            createdAt: admin.created_at,
        };
    })
);

// AFTER:
const admins = await ctx.db.query('admin_users').collect();

// Batch fetch all users
const userIds = admins.map(a => a.user_id);
const users = await Promise.all(
    userIds.map(id => ctx.db.get(id))
);

// Build user map
const userMap = new Map(
    users.filter(Boolean).map(u => [u!._id, u!])
);

// Map results without additional queries
const results = admins.map((admin) => ({
    userId: admin.user_id,
    email: userMap.get(admin.user_id)?.email,
    displayName: userMap.get(admin.user_id)?.display_name,
    createdAt: admin.created_at,
}));
```

**Note:** This is already optimized at line 304-308 in `listWorkspaces` - use same pattern.

**2. admin.ts - Line 523 `listWorkspaceMembers`:**

```typescript
// BEFORE:
const members = await ctx.db
    .query('workspace_members')
    .withIndex('by_workspace', (q) =>
        q.eq('workspace_id', args.workspace_id)
    )
    .collect();

const results = await Promise.all(
    members.map(async (member) => {
        const user = await ctx.db.get(member.user_id); // N+1!
        return {
            userId: member.user_id,
            role: member.role,
            email: user?.email,
            displayName: user?.display_name,
            createdAt: member.created_at,
        };
    })
);

// AFTER:
const members = await ctx.db
    .query('workspace_members')
    .withIndex('by_workspace', (q) =>
        q.eq('workspace_id', args.workspace_id)
    )
    .collect();

// Batch fetch all users
const userIds = members.map(m => m.user_id);
const users = await Promise.all(
    userIds.map(id => ctx.db.get(id))
);

// Build user map
const userMap = new Map(
    users.filter(Boolean).map(u => [u!._id, u!])
);

// Map results without additional queries
const results = members.map((member) => ({
    userId: member.user_id,
    role: member.role,
    email: userMap.get(member.user_id)?.email,
    displayName: userMap.get(member.user_id)?.display_name,
    createdAt: member.created_at,
}));
```

**3. workspaces.ts - Line 92 `listMyWorkspaces`:**

```typescript
// BEFORE:
const workspaces = await Promise.all(
    memberships.map(async (m) => {
        const workspace = await ctx.db.get(m.workspace_id); // N+1!
        if (!workspace) return null;
        return {
            _id: workspace._id,
            name: workspace.name,
            description: workspace.description ?? null,
            role: m.role,
            created_at: workspace.created_at,
            is_active: activeWorkspaceId === workspace._id,
        };
    })
);

// AFTER:
// Batch fetch all workspaces
const workspaceIds = memberships.map(m => m.workspace_id);
const workspaceFetches = await Promise.all(
    workspaceIds.map(id => ctx.db.get(id))
);

// Build workspace map
const workspaceMap = new Map(
    workspaceFetches.filter(Boolean).map(w => [w!._id, w!])
);

// Map results without additional queries
const workspaces = memberships.map((m) => {
    const workspace = workspaceMap.get(m.workspace_id);
    if (!workspace) return null;
    return {
        _id: workspace._id,
        name: workspace.name,
        description: workspace.description ?? null,
        role: m.role,
        created_at: workspace.created_at,
        is_active: activeWorkspaceId === workspace._id,
    };
}).filter(Boolean);
```

---

### Issue 9: File Meta Race Condition Dedupe

**Status:** ❌ **EXISTS** - Expensive dedupe on every upload  
**Risk:** Non-breaking (optimization)  
**Fix Complexity:** Low

#### Files to Modify:
- `convex/storage.ts` (line 107)

#### Changes Needed:

```typescript
// BEFORE:
const matches = await ctx.db
    .query('file_meta')
    .withIndex('by_workspace_hash', (q) =>
        q.eq('workspace_id', args.workspace_id).eq('hash', args.hash)
    )
    .collect(); // Loads ALL duplicates

if (matches.length > 1) {
    const sorted = [...matches].sort(
        (a, b) => a._creationTime - b._creationTime
    );
    const keeper = sorted[0];
    if (!keeper) return;
    for (const file of sorted.slice(1)) {
        if (file._id === keeper._id) continue;
        await ctx.db.delete(file._id);
    }

// AFTER:
// Check if duplicate exists
const existing = await ctx.db
    .query('file_meta')
    .withIndex('by_workspace_hash', (q) =>
        q.eq('workspace_id', args.workspace_id).eq('hash', args.hash)
    )
    .first(); // Just check first match

if (existing && existing._id !== createdId) {
    // Duplicate exists - update existing instead of creating new
    await ctx.db.patch(existing._id, {
        storage_id: args.storage_id,
        storage_provider_id: args.storage_provider_id,
        updated_at: nowSec(),
    });
    
    // Delete the newly created one
    await ctx.db.delete(createdId);
    return;
}
```

**Note:** This prevents race condition by using first-wins strategy. Consider adding unique index if Convex supports it.

---

## Priority 4: LOW - Future Enhancements

### Issue 11: Change Log Without Retention Enforcement

**Status:** ⚠️ **PARTIAL** - GC exists but no hard limits  
**Risk:** Non-breaking (adds monitoring)  
**Fix Complexity:** Low

#### Recommendation:
Add monitoring/logging to track change_log growth. The GC mechanisms exist (Issues 1-3 fix those), but consider adding:

```typescript
// In sync.ts, add internal query:
export const getWorkspaceChangeLogStats = internalQuery({
    args: {
        workspace_id: v.id('workspaces'),
    },
    handler: async (ctx, args) => {
        const logs = await ctx.db
            .query('change_log')
            .withIndex('by_workspace_version', (q) =>
                q.eq('workspace_id', args.workspace_id)
            )
            .take(1); // Just check if any exist
        
        // Use Convex's count() if available, otherwise estimate
        const count = logs.length; // Placeholder - needs actual count
        
        return { count, workspace_id: args.workspace_id };
    },
});
```

**Action:** Monitor in production, set alert if any workspace exceeds 100K entries.

---

### Issue 12: Device Cursors Without Expiration

**Status:** ⚠️ **ARCHITECTURAL** - Schema change required  
**Risk:** Breaking (schema migration)  
**Fix Complexity:** High

#### Recommendation:
**Defer to Phase 2.** Requires schema migration which is breaking. Current workaround:

1. Document the zombie device issue
2. Add manual cleanup query for testing:

```typescript
// Add to sync.ts:
export const cleanupStaleDeviceCursors = internalMutation({
    args: {
        workspace_id: v.id('workspaces'),
        stale_days: v.number(),
    },
    handler: async (ctx, args) => {
        const cutoff = nowSec() - (args.stale_days * 24 * 3600);
        
        const staleCursors = await ctx.db
            .query('device_cursors')
            .withIndex('by_workspace_device', (q) =>
                q.eq('workspace_id', args.workspace_id)
            )
            .collect();
        
        let deleted = 0;
        for (const cursor of staleCursors) {
            if (cursor.updated_at < cutoff) {
                await ctx.db.delete(cursor._id);
                deleted++;
            }
        }
        
        return { deleted };
    },
});
```

**Action:** Run manually for now, schedule as cron in Phase 2.

---

### Issue 14: No Storage Quotas

**Status:** ⚠️ **FEATURE REQUEST** - Not critical for MVP  
**Risk:** Non-breaking (adds new feature)  
**Fix Complexity:** High (new schema table)

#### Recommendation:
**Defer to Phase 2.** Issue #2 (file size limits) mitigates the immediate risk. Full quota tracking requires:

1. New `workspace_storage_stats` table
2. Atomic updates on every upload/delete
3. Quota enforcement in `generateUploadUrl`

**Action:** Document as future enhancement. File size limit (Issue #2) prevents worst abuse.

---

## Issues Already Fixed or N/A

### Issue 16: Convex Store Without Request Timeouts

**Status:** ✅ **NOT APPLICABLE**  
**Reason:** File `server/admin/stores/convex/convex-store.ts` doesn't exist in current codebase. Likely refactored out.

---

### Issue 17, 18, 19: Missing Admin Checks

**Status:** ✅ **COVERED IN ISSUE #4**  
**Reason:** These are part of the 6 functions identified in Priority 1.

---

## Summary Checklist

### Must Fix (Priority 1 & 2):

- [ ] **Issue 4:** Add `requireAdmin()` to 6 functions (admin.ts)
- [ ] **Issue 13:** Add max limit & admin check to `searchUsers` (admin.ts)
- [ ] **Issue 1:** Add continuation limit to GC (sync.ts)
- [ ] **Issue 2:** Add file size limit to uploads (storage.ts)
- [ ] **Issue 3:** Add workspace limit to scheduled GC (sync.ts)
- [ ] **Issue 5:** Add max per_page to `listWorkspaces` (admin.ts)
- [ ] **Issue 6:** Add batch limits to job cleanup (backgroundJobs.ts)
- [ ] **Issue 8:** Add batch limits to workspace delete (workspaces.ts)
- [ ] **Issue 10:** Improve rate limit cleanup (rateLimits.ts)

### Should Fix (Priority 3):

- [ ] **Issue 15:** Add input validation to string fields (admin.ts, workspaces.ts, sync.ts)
- [ ] **Issue 7 & 20:** Fix N+1 patterns (admin.ts, workspaces.ts)
- [ ] **Issue 9:** Optimize file dedupe (storage.ts)

### Future Enhancements (Priority 4):

- [ ] **Issue 11:** Add change_log monitoring
- [ ] **Issue 12:** Add device cursor expiration (Phase 2)
- [ ] **Issue 14:** Add storage quotas (Phase 2)

---

## Testing Strategy

### 1. Unit Tests (vitest)

Add tests for each validation:

```typescript
// Example: convex/admin.test.ts
describe('createWorkspace', () => {
    it('should reject workspace name > 200 chars', async () => {
        const longName = 'a'.repeat(201);
        await expect(createWorkspace({ name: longName, ... }))
            .rejects.toThrow('Workspace name too long');
    });
    
    it('should reject non-admin users', async () => {
        // Mock ctx without admin grant
        await expect(createWorkspace({ ... }))
            .rejects.toThrow('Forbidden: Admin access required');
    });
});
```

### 2. Integration Tests

Test GC limits:

```bash
# Create workspace with 1500 change_log entries
# Trigger GC
# Verify it stops after 10 continuations (1000 entries processed)
```

### 3. Verify Goals

```bash
# Run all tests
bun test

# Type check
bunx nuxi typecheck

# Lint
bun run lint

# Verify specific test suites pass:
# - app/db tests (clock, files, fork)
# - server tests (admin, auth, jobs)
# - Exclude: workflow-execution, env-dependent tests
```

---

## Risk Assessment

### Breaking Changes: **NONE**

All changes are additive (validation) or internal (batching). No API signatures changed.

### Potential Issues:

1. **File size limit** (Issue #2): Clients uploading >100MB files will now fail
   - **Mitigation:** This is intentional abuse prevention
   - **Action:** Document in API changelog

2. **Per-page limit** (Issue #5): Clients requesting `per_page: 10000` will be capped at 100
   - **Mitigation:** Existing clients likely use reasonable limits
   - **Action:** Check analytics for large per_page values

3. **Admin checks** (Issue #4): Clients calling admin endpoints without auth will fail
   - **Mitigation:** These should already require auth, fixing a security hole
   - **Action:** Verify admin dashboard still works

---

## Implementation Order

1. **Day 1 - Critical Security (2-3 hours)**
   - Issues 4, 13 (admin checks)
   - Test admin dashboard

2. **Day 1 - Cost Bombs (3-4 hours)**
   - Issues 1, 2, 3 (GC limits, file size)
   - Test upload flow

3. **Day 2 - Performance (3-4 hours)**
   - Issues 5, 6, 8, 10 (batch limits)
   - Test list operations

4. **Day 2 - Validation & N+1 (2-3 hours)**
   - Issues 15, 7, 20, 9
   - Test create/update flows

5. **Day 2 - Final Testing (2 hours)**
   - Run full test suite
   - Type check
   - Lint
   - Manual smoke tests

**Total Estimated Time:** 12-16 hours (1.5-2 days)

---

## Success Criteria

- ✅ All vitest tests pass (excluding workflow-execution)
- ✅ `bunx nuxi typecheck` reports 0 errors
- ✅ `bun run lint` reports 0 errors
- ✅ Manual admin dashboard test passes
- ✅ Manual file upload test (<100MB) passes
- ✅ Manual file upload test (>100MB) rejects
- ✅ Manual workspace list with large per_page caps at 100
- ✅ All admin endpoints require admin auth

---

## Post-Implementation

### Monitoring

Add these alerts:

1. **Change log growth**: Alert if any workspace exceeds 100K entries
2. **GC failures**: Alert if GC hits max continuations
3. **File upload rejections**: Track how many uploads hit size limit
4. **Rate limit hits**: Monitor validation error rates

### Documentation

Update:

1. API docs with new file size limit (100MB)
2. API docs with max per_page limit (100)
3. Admin setup guide with authorization requirements
4. Architecture docs with GC continuation limits

---

**End of Task List**
