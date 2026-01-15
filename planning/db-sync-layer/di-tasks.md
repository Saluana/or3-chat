# DB Sync Layer: Dumb Issues - Task List

**Priority Guide**: Implementation order based on dependencies and impact, not just severity.

---

## Phase 1: Foundation (No Breaking Changes)

These establish shared infrastructure that other fixes depend on. Implement first.

### ✅ Task 1.1: Consolidate PK_FIELDS constants (Issue #7)
**Priority**: Foundation  
**Severity**: Medium  
**Breaking Changes**: None (additive only)

**Why First**: Every other sync task needs PK field lookups. This creates the single source of truth.

**Files**:
- Create: `shared/sync/table-metadata.ts`
- Update: `app/core/sync/hook-bridge.ts`
- Update: `app/core/sync/subscription-manager.ts`
- Update: `app/core/sync/sync-payload-normalizer.ts`
- Update: `convex/sync.ts`

**Implementation**:
```typescript
// shared/sync/table-metadata.ts
export const TABLE_METADATA = {
    threads: { pk: 'id' },
    messages: { pk: 'id' },
    projects: { pk: 'id' },
    posts: { pk: 'id' },
    kv: { pk: 'id' },
    file_meta: { pk: 'hash' },
} as const;

export function getPkField(tableName: string): string {
    return TABLE_METADATA[tableName as keyof typeof TABLE_METADATA]?.pk ?? 'id';
}
```

**Tests**: None needed, pure refactor.

---

### ✅ Task 1.2: Consolidate field mappings (Issue #2)
**Priority**: Foundation  
**Severity**: High  
**Breaking Changes**: None (internal refactor)

**Why First**: Eliminates duplicate snake_case/camelCase logic before other refactors touch it.

**Files**:
- Create: `shared/sync/field-mappings.ts`
- Update: `app/core/sync/sync-payload-normalizer.ts`
- Update: `shared/sync/sanitize.ts`

**Implementation**:
```typescript
// shared/sync/field-mappings.ts
export const FIELD_MAPPINGS: Record<string, Record<string, string>> = {
    posts: {
        post_type: 'postType',
    },
};

export function toClientFormat(tableName: string, payload: Record<string, unknown>): Record<string, unknown> {
    const mappings = FIELD_MAPPINGS[tableName];
    if (!mappings) return payload;
    
    const result = { ...payload };
    for (const [snake, camel] of Object.entries(mappings)) {
        if (snake in result && !(camel in result)) {
            result[camel] = result[snake];
            delete result[snake];
        }
    }
    return result;
}

export function toServerFormat(tableName: string, payload: Record<string, unknown>): Record<string, unknown> {
    const mappings = FIELD_MAPPINGS[tableName];
    if (!mappings) return payload;
    
    const result = { ...payload };
    for (const [snake, camel] of Object.entries(mappings)) {
        if (camel in result && !(snake in result)) {
            result[snake] = result[camel];
            delete result[camel];
        }
    }
    return result;
}
```

**Tests**: Test round-trip client → server → client, verify identity.

---

### ✅ Task 1.3: Fix global HLC state (Issue #1)
**Priority**: Foundation  
**Severity**: Blocker  
**Breaking Changes**: Yes (API change)

**Why First**: Required for reliable testing of all sync code. Current globals break test isolation.

**Files**:
- Update: `app/core/sync/hlc.ts`
- Update all callers: `hook-bridge.ts`, `cursor-manager.ts`, etc.

**Implementation**:
```typescript
export class HLCGenerator {
    private lastTimestamp = 0;
    private counter = 0;
    private nodeId: string | null = null;

    getNodeId(): string {
        if (this.nodeId) return this.nodeId;
        if (typeof localStorage !== 'undefined') {
            const stored = localStorage.getItem('or3-device-id');
            if (stored) {
                this.nodeId = stored;
                return this.nodeId;
            }
        }
        this.nodeId = crypto.randomUUID().slice(0, 8);
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem('or3-device-id', this.nodeId);
        }
        return this.nodeId;
    }

    generate(): string {
        const now = Date.now();
        if (now > this.lastTimestamp) {
            this.lastTimestamp = now;
            this.counter = 0;
        } else {
            this.counter++;
        }
        const ts = this.lastTimestamp.toString().padStart(13, '0');
        const cnt = this.counter.toString().padStart(4, '0');
        const node = this.getNodeId();
        return `${ts}:${cnt}:${node}`;
    }
}

let _instance: HLCGenerator | null = null;

export function getHLCGenerator(): HLCGenerator {
    if (!_instance) _instance = new HLCGenerator();
    return _instance;
}

export function generateHLC(): string {
    return getHLCGenerator().generate();
}

export function getDeviceId(): string {
    return getHLCGenerator().getNodeId();
}

export function _resetHLC(): void {
    _instance = null;
}
```

**Tests**: Generate HLC, reset, generate again, verify counter resets to 0.

---

## Phase 2: Critical Bugs (Breaking Changes Possible)

Fix data loss and memory leak issues.

### ✅ Task 2.1: Throw on hook bridge failures (Issue #3)
**Priority**: Critical  
**Severity**: High  
**Breaking Changes**: Yes (behavior change - transactions will fail)

**Why Next**: Prevents silent data loss. Must fix before shipping to production.

**Files**:
- Update: `app/core/sync/hook-bridge.ts:180-188`

**Implementation**:
```typescript
.catch((error) => {
    console.error('[HookBridge] Failed to enqueue pending op', error);
    void useHooks().doAction('sync.capture:action:failed', {
        tableName,
        pk,
        error: String(error),
    });
    // Rethrow to fail the transaction and prevent silent data loss
    throw error;
});
```

**Tests**: Mock `pending_ops.add` to throw, verify transaction rolls back.

---

### ✅ Task 2.2: Add cleanup to singleton maps (Issue #23)
**Priority**: Critical  
**Severity**: High  
**Breaking Changes**: None (additive API)

**Why Next**: Memory leak affects all long-running sessions. Easy fix with big impact.

**Files**:
- Update: `app/core/sync/cursor-manager.ts`
- Update: `app/core/sync/subscription-manager.ts`
- Update: `app/core/sync/hook-bridge.ts`
- Update: `app/plugins/00-workspace-db.client.ts` (call cleanup on workspace switch)

**Implementation**:
```typescript
// In each manager file
export function cleanupCursorManager(dbName: string): void {
    cursorManagerInstances.delete(dbName);
}

export function cleanupSubscriptionManager(scopeKey: string): void {
    const manager = subscriptionManagerInstances.get(scopeKey);
    if (manager) {
        void manager.stop();
    }
    subscriptionManagerInstances.delete(scopeKey);
}

export function cleanupHookBridge(dbName: string): void {
    const bridge = hookBridgeInstances.get(dbName);
    if (bridge) {
        bridge.stop();
    }
    hookBridgeInstances.delete(dbName);
}
```

**Tests**: Switch workspaces 100 times, verify map size < 10.

---

## Phase 3: Performance Optimizations (No Breaking Changes)

Improve performance without changing APIs.

### ✅ Task 3.1: Batch fetch in ConflictResolver (Issue #5)
**Priority**: High  
**Severity**: High  
**Breaking Changes**: None (internal optimization)

**Why Next**: N+1 query fix. Big performance win for sync apply. Depends on Task 1.1 (PK fields).

**Files**:
- Update: `app/core/sync/conflict-resolver.ts`

**Implementation**:
```typescript
async applyChanges(changes: SyncChange[]): Promise<ApplyResult> {
    const result: ApplyResult = {
        applied: 0,
        skipped: 0,
        conflicts: 0,
    };

    if (changes.length === 0) return result;

    const tableNames = Array.from(new Set(changes.map((c) => c.tableName)));
    const tables = [...tableNames, 'tombstones'];
    
    // Batch-fetch existing records by table
    const existingByTable = new Map<string, Map<string, LocalRecord>>();
    await this.db.transaction('r', tables, async () => {
        for (const tableName of tableNames) {
            const table = this.db.table(tableName);
            const pks = changes.filter(c => c.tableName === tableName).map(c => c.pk);
            const records = await table.bulkGet(pks);
            const map = new Map<string, LocalRecord>();
            records.forEach((rec, idx) => {
                if (rec) map.set(pks[idx]!, rec as LocalRecord);
            });
            existingByTable.set(tableName, map);
        }
    });
    
    // Now apply with cached lookups
    await this.db.transaction('rw', tables, async (tx) => {
        getHookBridge(this.db).markSyncTransaction(tx);
        
        for (const change of changes) {
            const local = existingByTable.get(change.tableName)?.get(change.pk);
            const changeResult = change.op === 'delete'
                ? await this.applyDeleteWithLocal(change, local)
                : await this.applyPutWithLocal(change, local);
            
            result.applied += changeResult.applied ? 1 : 0;
            result.skipped += changeResult.skipped ? 1 : 0;
            result.conflicts += changeResult.isConflict ? 1 : 0;
        }
    });

    return result;
}

private async applyDeleteWithLocal(change: SyncChange, local: LocalRecord | undefined): Promise<ChangeResult> {
    // ... existing applyDelete logic but using 'local' parameter
}

private async applyPutWithLocal(change: SyncChange, local: LocalRecord | undefined): Promise<ChangeResult> {
    // ... existing applyPut logic but using 'local' parameter
}
```

**Tests**: Mock Dexie, count `get` calls, verify O(tableCount) not O(changeCount).

---

### ✅ Task 3.2: Remove staging dataset (Issue #6)
**Priority**: High  
**Severity**: Medium  
**Breaking Changes**: None (internal refactor)

**Why Next**: Simplifies rescan logic and saves memory. Depends on Task 3.1 (batch fetch).

**Files**:
- Update: `app/core/sync/subscription-manager.ts:284-467`

**Implementation**:
```typescript
private async rescan(): Promise<void> {
    this.isBootstrapping = true;

    try {
        await useHooks().doAction('sync.rescan:action:starting', {
            scope: this.scope,
        });
        
        await this.cursorManager.reset();
        
        let cursor = 0;
        let hasMore = true;
        
        while (hasMore) {
            if (this.status === 'disconnected') break;
            
            const response = await this.provider.pull({
                scope: this.scope,
                cursor,
                limit: this.config.bootstrapPageSize,
                tables: this.config.tables,
            });
            
            if (response.changes.length) {
                await this.conflictResolver.applyChanges(response.changes);
            }
            
            cursor = response.nextCursor;
            hasMore = response.hasMore;
        }
        
        await this.cursorManager.setCursor(cursor);
        await this.cursorManager.markSyncComplete();
        await this.provider.updateCursor(
            this.scope,
            this.cursorManager.getDeviceId(),
            cursor
        );
        
        await this.reapplyPendingOps();
        
        await useHooks().doAction('sync.rescan:action:completed', {
            scope: this.scope,
        });
    } finally {
        this.isBootstrapping = false;
    }
}

// DELETE: buildStagedDataset, applyStagedDataset, applyChangeToStage methods
```

**Tests**: Verify rescan applies changes incrementally without clearing tables.

---

### ✅ Task 3.3: Simplify coalescing in OutboxManager (Issue #9)
**Priority**: Medium  
**Severity**: Medium  
**Breaking Changes**: None (internal optimization)

**Why Next**: Minor optimization. Easy win after bigger refactors.

**Files**:
- Update: `app/core/sync/outbox-manager.ts:115-120`

**Implementation**:
```typescript
// Coalesce and batch
const coalesced = this.coalesceOps(pendingOps);
const now = Date.now();
const dueOps = coalesced.filter(
    (op) => op.nextAttemptAt === undefined || op.nextAttemptAt <= now
);

// Mark dropped ops for deletion
const coalescedIds = new Set(coalesced.map((op) => op.id));
const dropped = pendingOps.filter((op) => !coalescedIds.has(op.id));
if (dropped.length) {
    await Promise.all(dropped.map((op) => this.db.pending_ops.delete(op.id)));
}
```

**Tests**: Verify coalescing + due filtering works correctly.

---

### ✅ Task 3.4: Remove duplicate normalization (Issue #18)
**Priority**: Low  
**Severity**: Low  
**Breaking Changes**: None (internal optimization)

**Why Next**: Depends on Task 3.2 (staging removal). Minor optimization.

**Files**:
- Update: `app/core/sync/subscription-manager.ts` (if any staging code remains)

**Implementation**: If staging is removed, this is automatically fixed.

**Tests**: Mock `normalizeSyncPayload`, verify called once per change.

---

## Phase 4: Convex Backend Improvements (No Breaking Changes)

Server-side performance and validation fixes.

### ✅ Task 4.1: Validate payloads in push endpoint (Issue #10)
**Priority**: Critical  
**Severity**: High  
**Breaking Changes**: Yes (will reject invalid payloads)

**Why Next**: Security fix. Must happen before production. Depends on Task 1.2 (field mappings).

**Files**:
- Update: `server/api/sync/push.post.ts`

**Implementation**:
```typescript
const parsed = PushBatchSchema.safeParse(body);
if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid push request' });
}

// Validate each op payload
for (const op of parsed.data.ops) {
    if (op.payload) {
        const schema = TABLE_PAYLOAD_SCHEMAS[op.tableName];
        if (schema) {
            const result = schema.safeParse(op.payload);
            if (!result.success) {
                throw createError({ 
                    statusCode: 400, 
                    statusMessage: `Invalid payload for ${op.tableName}: ${result.error.message}` 
                });
            }
        }
    }
}
```

**Tests**: Send push with invalid payload, expect 400.

---

### ✅ Task 4.2: Batch Convex writes in push (Issue #24)
**Priority**: High  
**Severity**: High  
**Breaking Changes**: None (internal optimization)

**Why Next**: Big performance win for sync push. Can be done independently.

**Files**:
- Update: `convex/sync.ts:304-374`

**Implementation**:
```typescript
// Collect all ops with their server versions first
const opsToApply: Array<{ 
    op: typeof args.ops[0]; 
    serverVersion: number 
}> = [];

for (const op of args.ops) {
    if (!TABLE_INDEX_MAP[op.table_name]) {
        results.push({
            opId: op.op_id,
            success: false,
            error: `Unknown table: ${op.table_name}`,
        });
        continue;
    }

    const existing = await ctx.db
        .query('change_log')
        .withIndex('by_op_id', (q) => q.eq('op_id', op.op_id))
        .first();

    if (existing) {
        results.push({
            opId: op.op_id,
            success: true,
            serverVersion: existing.server_version,
        });
        continue;
    }

    const serverVersion = await getNextServerVersion(ctx, args.workspace_id);
    opsToApply.push({ op, serverVersion });
    latestVersion = serverVersion;
}

// Apply ops in parallel (Convex transactions are serializable)
const applyResults = await Promise.allSettled(
    opsToApply.map(async ({ op, serverVersion }) => {
        await applyOpToTable(ctx, args.workspace_id, op);
        
        await ctx.db.insert('change_log', {
            workspace_id: args.workspace_id,
            server_version: serverVersion,
            table_name: op.table_name,
            pk: op.pk,
            op: op.operation,
            payload: op.payload,
            clock: op.clock,
            hlc: op.hlc,
            device_id: op.device_id,
            op_id: op.op_id,
            created_at: nowSec(),
        });

        if (op.operation === 'delete') {
            const deletedAt =
                typeof (op.payload as { deleted_at?: number })?.deleted_at === 'number'
                    ? ((op.payload as { deleted_at?: number }).deleted_at as number)
                    : nowSec();
            await upsertTombstone(ctx, args.workspace_id, op, serverVersion, deletedAt);
        }
        
        return { opId: op.op_id, serverVersion };
    })
);

for (let i = 0; i < applyResults.length; i++) {
    const result = applyResults[i];
    if (result.status === 'fulfilled') {
        results.push({ ...result.value, success: true });
    } else {
        results.push({
            opId: opsToApply[i]!.op.op_id,
            success: false,
            error: String(result.reason),
        });
    }
}
```

**Tests**: Verify push latency scales linearly with batch size.

---

### ✅ Task 4.3: Optimize GC cursor queries (Issue #21)
**Priority**: Medium  
**Severity**: Medium  
**Breaking Changes**: None (internal optimization)

**Why Next**: Simple optimization. Can be done independently.

**Files**:
- Update: `convex/sync.ts:602-605` (and similar in other GC functions)

**Implementation**:
```typescript
const minCursorRow = await ctx.db
    .query('device_cursors')
    .withIndex('by_workspace_version', (q) => q.eq('workspace_id', args.workspace_id))
    .order('asc')
    .first();

const minCursor = minCursorRow?.last_seen_version ?? 0;
```

**Tests**: Verify GC uses min cursor correctly.

---

### ✅ Task 4.4: Document Convex type unsafety (Issue #8)
**Priority**: Low  
**Severity**: High  
**Breaking Changes**: None (documentation only)

**Why Last**: Complex to fix properly. Document the limitation for now.

**Files**:
- Update: `convex/sync.ts:170-177` (add comment)

**Implementation**:
```typescript
// Note: Type casts (as any) are necessary because Convex doesn't support
// fully type-safe dynamic table queries. Table name is validated via TABLE_INDEX_MAP
// and runtime validation of payloads happens client-side in ConflictResolver.applyPut()
// using Zod schemas (TABLE_PAYLOAD_SCHEMAS).
// Future: Consider a type-safe helper with switch statement for each table.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const existing = await (ctx.db.query(table as any) as any)
    .withIndex(indexName, (q: { eq: (field: string, value: unknown) => unknown }) =>
        pkField === 'hash'
            ? (q as any).eq('workspace_id', workspaceId).eq('hash', op.pk)
            : (q as any).eq('workspace_id', workspaceId).eq('id', op.pk)
    )
    .first();
```

**Tests**: Verify queries work for all tables.

---

## Phase 5: Nice-to-Have Improvements (Low Priority)

### ✅ Task 5.1: Make KV blocklist extensible (Issue #14)
**Priority**: Low  
**Severity**: Low  
**Breaking Changes**: None (additive API)

**Files**:
- Update: `app/core/sync/hook-bridge.ts:29-34`

**Tests**: Add hook, verify filter applies.

---

### ✅ Task 5.2: Optimize sanitize dotted keys (Issue #16)
**Priority**: Low  
**Severity**: Low  
**Breaking Changes**: None (internal optimization)

**Files**:
- Update: `shared/sync/sanitize.ts:27-31`

**Tests**: Benchmark, verify faster.

---

### ✅ Task 5.3: Remove cached cursor (Issue #19)
**Priority**: Low  
**Severity**: Low  
**Breaking Changes**: None (simplification)

**Files**:
- Update: `app/core/sync/cursor-manager.ts:20`

**Tests**: None, pure simplification.

---

### ✅ Task 5.4: Optimize HLC padding (Issue #15)
**Priority**: Low  
**Severity**: Low  
**Breaking Changes**: Yes (format change)

**Why Last**: Changes HLC format. Low impact but needs migration.

**Files**:
- Update: `app/core/sync/hlc.ts:64-68`

**Tests**: Verify compareHLC still works with new format.

---

## Summary

**Total Tasks**: 18  
**Blocker/High**: 8  
**Medium**: 6  
**Low**: 4  

**Recommended Order**: Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5

**Breaking Changes Summary**:
- Task 1.3: HLC API change (foundation requirement)
- Task 2.1: Hook failures now throw (data safety)
- Task 4.1: Invalid payloads rejected (security)
- Task 5.4: HLC format change (optional optimization)
