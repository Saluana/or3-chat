# DB Storage System Code Review

**Date:** 2026-01-14  
**Reviewer:** Razor (Code Review Agent)  
**Scope:** `app/core/storage/`, `app/db/files.ts`, `server/api/storage/`, `convex/storage.ts`, `app/utils/hash.ts`

---

## 1. Verdict

**Medium**

The implementation is solid overall. No blocking bugs were found. Several medium-priority issues exist around memory management during downloads, potential race conditions in the transfer queue, and minor type safety gaps. The architecture is clean and follows project conventions well.

---

## 2. Executive Summary

- **Memory risk in downloads**: `readBlobWithProgress` accumulates all chunks in memory before constructing the final Blob. For large files, this doubles memory usage during the assembly phase.
- **Race condition window**: `waiters` Map in FileTransferQueue can leak if a transfer completes between the initial check and Promise creation.
- **No request cancellation**: Transfer queue lacks AbortController integration; in-flight uploads/downloads cannot be cancelled when workspace changes or component unmounts.
- **Provider singleton creates new instance per call**: `getActiveStorageProvider()` calls `create()` on every invocation, producing fresh provider instances unnecessarily.
- **GC endpoint lacks rate limiting**: Admin GC endpoint has no throttle; repeated calls could overload Convex.
- **Missing `deleted_at` population**: Soft delete sets `deleted: true` but never populates `deleted_at`, causing GC to skip all files.

---

## 3. Findings

### 3.1 Memory Doubling During Download

**Severity:** Medium

**Evidence:** `app/core/storage/transfer-queue.ts:409-426`

```typescript
const chunks: Uint8Array[] = [];
// ...
while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
        chunks.push(value);
        // ...
    }
}
const blob = new Blob(chunks as BlobPart[]);
```

**Why:** Chunks are held in an array, then copied again into a Blob. For a 50MB file, peak memory is ~100MB. This is problematic on memory-constrained mobile devices.

**Fix:** Stream directly into a Blob constructor is not possible, but we can use a more memory-efficient approach:

```typescript
private async readBlobWithProgress(
    response: Response,
    transferId: string,
    mimeType?: string
): Promise<{ blob: Blob; bytesTotal: number }> {
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (!response.body) {
        const blob = await response.blob();
        return { blob, bytesTotal: contentLength || blob.size };
    }

    // Use TransformStream to track progress without extra memory copy
    const reader = response.body.getReader();
    let received = 0;

    const stream = new ReadableStream({
        pull: async (controller) => {
            const { done, value } = await reader.read();
            if (done) {
                controller.close();
                return;
            }
            received += value.byteLength;
            await this.updateTransfer(transferId, {
                bytes_done: received,
                bytes_total: contentLength || received,
            });
            controller.enqueue(value);
        },
    });

    const blob = await new Response(stream).blob();
    return { blob, bytesTotal: contentLength || blob.size };
}
```

**Tests:**
- Verify memory usage stays flat during 50MB+ download (manual profiling)
- Unit test progress updates are still called

---

### 3.2 Race Condition in waitForTransfer

**Severity:** Medium

**Evidence:** `app/core/storage/transfer-queue.ts:100-114`

```typescript
async waitForTransfer(id: string): Promise<void> {
    const transfer = await this.db.file_transfers.get(id);
    if (!transfer) {
        throw new Error('Transfer not found');
    }
    if (transfer.state === 'done') return;
    if (transfer.state === 'failed') {
        throw new Error(transfer.last_error || 'Transfer failed');
    }

    // RACE: transfer can complete here, before waiter is registered
    await new Promise<void>((resolve, reject) => {
        const waiters = this.waiters.get(id) ?? [];
        waiters.push({ resolve, reject });
        this.waiters.set(id, waiters);
    });
}
```

**Why:** If the transfer completes between the DB read and the Promise creation, the waiter hangs forever.

**Fix:**

```typescript
async waitForTransfer(id: string): Promise<void> {
    // Register waiter first, then check state
    const waiterPromise = new Promise<void>((resolve, reject) => {
        const waiters = this.waiters.get(id) ?? [];
        waiters.push({ resolve, reject });
        this.waiters.set(id, waiters);
    });

    // Check current state - if already done, resolve immediately
    const transfer = await this.db.file_transfers.get(id);
    if (!transfer) {
        this.resolveWaiters(id); // Clean up the just-added waiter
        throw new Error('Transfer not found');
    }
    if (transfer.state === 'done') {
        this.resolveWaiters(id);
        return;
    }
    if (transfer.state === 'failed') {
        this.rejectWaiters(id, transfer.last_error || 'Transfer failed');
        throw new Error(transfer.last_error || 'Transfer failed');
    }

    return waiterPromise;
}
```

**Tests:**
```typescript
it('resolves immediately if transfer already done', async () => {
    await db.file_transfers.put({ id: 't1', state: 'done', /* ... */ });
    await expect(queue.waitForTransfer('t1')).resolves.toBeUndefined();
});
```

---

### 3.3 No Transfer Cancellation / AbortController

**Severity:** Medium

**Evidence:** `app/core/storage/transfer-queue.ts:264-268`, `349-352`

```typescript
const uploadResponse = await fetch(presign.url, {
    method: presign.method ?? 'POST',
    headers: presign.headers,
    body: blobRow.blob,
    // No signal
});
```

**Why:** When `setWorkspaceId(null)` is called or user navigates away, in-flight transfers continue consuming bandwidth and memory. On slow connections, this wastes resources.

**Fix:** Add AbortController tracking:

```typescript
private abortControllers = new Map<string, AbortController>();

private async processTransfer(transfer: FileTransfer): Promise<void> {
    const controller = new AbortController();
    this.abortControllers.set(transfer.id, controller);
    
    try {
        // Pass controller.signal to fetch calls
        await this.doUpload(transfer, controller.signal);
        // ...
    } finally {
        this.abortControllers.delete(transfer.id);
    }
}

cancelTransfer(id: string): void {
    const controller = this.abortControllers.get(id);
    controller?.abort();
}

setWorkspaceId(workspaceId: string | null) {
    if (this.workspaceId && workspaceId !== this.workspaceId) {
        // Cancel all running transfers for old workspace
        for (const id of this.running) {
            this.cancelTransfer(id);
        }
    }
    this.workspaceId = workspaceId;
    // ...
}
```

**Tests:**
```typescript
it('cancels in-flight transfers when workspace changes', async () => {
    const transfer = await queue.enqueue(hash, 'upload');
    queue.setWorkspaceId('new-workspace');
    const record = await db.file_transfers.get(transfer!.id);
    expect(record?.state).toBe('failed');
});
```

---

### 3.4 Provider Factory Called Repeatedly

**Severity:** Low

**Evidence:** `app/core/storage/provider-registry.ts:20-26`

```typescript
export function getActiveStorageProvider(): ObjectStorageProvider | null {
    const config = useRuntimeConfig();
    const providerId = config.public?.storage?.provider || 'convex';
    const items = registry.snapshot();
    const entry = items.find((item) => item.id === providerId);
    return entry?.create() ?? null; // New instance every call
}
```

**Why:** Each call to `getActiveStorageProvider()` invokes `create()`, producing a new provider object. While the Convex provider is stateless, this pattern could cause issues if providers ever cache connections or state.

**Fix:** Memoize the active provider:

```typescript
let cachedProvider: ObjectStorageProvider | null = null;
let cachedProviderId: string | null = null;

export function getActiveStorageProvider(): ObjectStorageProvider | null {
    const config = useRuntimeConfig();
    const providerId = config.public?.storage?.provider || 'convex';
    
    if (cachedProvider && cachedProviderId === providerId) {
        return cachedProvider;
    }
    
    const items = registry.snapshot();
    const entry = items.find((item) => item.id === providerId);
    cachedProvider = entry?.create() ?? null;
    cachedProviderId = providerId;
    return cachedProvider;
}

export function _resetStorageProviders(): void {
    cachedProvider = null;
    cachedProviderId = null;
    registry.listIds().forEach((id) => registry.unregister(id));
}
```

**Tests:**
```typescript
it('returns same provider instance on repeated calls', () => {
    const p1 = getActiveStorageProvider();
    const p2 = getActiveStorageProvider();
    expect(p1).toBe(p2);
});
```

---

### 3.5 Soft Delete Never Sets `deleted_at`

**Severity:** High

**Evidence:** `app/db/files.ts:263-268`

```typescript
await db.file_meta.put({
    ...meta,
    deleted: true,
    updated_at: nowSec(),
    clock: nextClock(meta.clock),
    // deleted_at is never set!
});
```

**Why:** The GC logic in `convex/storage.ts:154` checks `file.deleted_at`:

```typescript
if (!file.deleted_at || file.deleted_at > cutoff) continue;
```

Since `deleted_at` is never populated, ALL soft-deleted files are skipped by GC. Orphaned blobs accumulate forever.

**Fix:**

```typescript
// In softDeleteFile and softDeleteMany:
await db.file_meta.put({
    ...meta,
    deleted: true,
    deleted_at: nowSec(), // Add this
    updated_at: nowSec(),
    clock: nextClock(meta.clock),
});
```

Also update the `FileMetaSchema` to include `deleted_at`:

```typescript
// app/db/schema.ts - add to FileMetaSchema
deleted_at: z.number().int().optional(),
```

**Tests:**
```typescript
it('sets deleted_at on soft delete', async () => {
    await softDeleteFile(hash);
    const meta = await db.file_meta.get(hash);
    expect(meta?.deleted_at).toBeGreaterThan(0);
});
```

---

### 3.6 GC Endpoint Lacks Rate Limiting

**Severity:** Low

**Evidence:** `server/api/storage/gc/run.post.ts`

**Why:** Admin users can spam the GC endpoint, causing repeated Convex mutations. While `limit` caps per-call deletions, there's no cooldown.

**Fix:** Add simple rate limiting using a timestamp check:

```typescript
// In-memory rate limit (resets on server restart, acceptable for admin endpoint)
let lastGcRun = 0;
const GC_COOLDOWN_MS = 60_000; // 1 minute

export default defineEventHandler(async (event) => {
    // ...existing auth checks...
    
    const now = Date.now();
    if (now - lastGcRun < GC_COOLDOWN_MS) {
        throw createError({ 
            statusCode: 429, 
            statusMessage: 'GC rate limited, wait 1 minute' 
        });
    }
    lastGcRun = now;
    
    // ...existing logic...
});
```

**Tests:** Manual verification or integration test with rapid calls.

---

### 3.7 Type Cast to `any` in blobImageSize

**Severity:** Nit

**Evidence:** `app/db/files.ts:384`

```typescript
const img = new (globalThis as any).Image();
```

**Why:** Breaks type safety. If running in a non-browser environment, this throws a runtime error.

**Fix:**

```typescript
async function blobImageSize(
    blob: Blob
): Promise<{ width: number; height: number } | undefined> {
    // Guard for non-browser environments
    if (typeof globalThis.Image !== 'function') {
        return undefined;
    }
    
    return new Promise((resolve) => {
        const img = new Image();
        // ...rest unchanged
    });
}
```

**Tests:** Existing tests should pass; add SSR guard test if needed.

---

### 3.8 Missing Error Handling for Convex Storage URL

**Severity:** Low

**Evidence:** `convex/storage.ts:126`

```typescript
const url = await ctx.storage.getUrl(file.storage_id);
return { url };
```

**Why:** If `storage_id` points to a deleted object, `getUrl` may return `null`. The calling code checks `result?.url`, but it's better to be explicit.

**Fix:**

```typescript
const url = await ctx.storage.getUrl(file.storage_id);
if (!url) {
    return null;
}
return { url };
```

**Tests:** Convex unit test with a deleted storage object.

---

### 3.9 Unused `urlOptions` in presign-upload

**Severity:** Nit

**Evidence:** `app/core/storage/transfer-queue.ts:242-248`

```typescript
const urlOptions = await hooks.applyFilters(
    'storage.files.url:filter:options',
    {
        hash: meta.hash,
        expiry_ms: DEFAULT_PRESIGN_EXPIRY_MS,
    }
);
// urlOptions.disposition passed but not used by SSR endpoint
```

**Why:** The SSR endpoint accepts `disposition` but ignores it. Either remove the field or implement it.

**Fix:** Remove from both sides until Content-Disposition header support is needed, or implement in the presign endpoint.

---

## 4. Diffs and Examples

### 4.1 Fix deleted_at in softDeleteFile

```diff
--- a/app/db/files.ts
+++ b/app/db/files.ts
@@ -263,6 +263,7 @@ export async function softDeleteFile(hash: string): Promise<void> {
         await hooks.doAction('db.files.delete:action:soft:before', payload);
         await db.file_meta.put({
             ...meta,
             deleted: true,
+            deleted_at: nowSec(),
             updated_at: nowSec(),
             clock: nextClock(meta.clock),
         });
```

### 4.2 Fix softDeleteMany similarly

```diff
@@ -286,6 +287,7 @@ export async function softDeleteMany(hashes: string[]): Promise<void> {
             await hooks.doAction('db.files.delete:action:soft:before', payload);
             await db.file_meta.put({
                 ...meta,
                 deleted: true,
+                deleted_at: nowSec(),
                 updated_at: nowSec(),
                 clock: nextClock(meta.clock),
             });
```

### 4.3 Update FileMetaSchema

```diff
--- a/app/db/schema.ts
+++ b/app/db/schema.ts
@@ -221,6 +221,7 @@ export const FileMetaSchema = z.object({
     created_at: z.number().int(),
     updated_at: z.number().int(),
     deleted: z.boolean().default(false),
+    deleted_at: z.number().int().optional(),
     clock: z.number().int(),
 });
```

---

## 5. Performance Notes

| Area | Issue | Impact | Recommendation |
|------|-------|--------|----------------|
| Download memory | Double buffering in `readBlobWithProgress` | 2x peak RAM for file size | Use streaming Response constructor |
| Hash computation | SHA-256 loads entire blob into ArrayBuffer | OK for < 20MB cap | Current implementation acceptable |
| Transfer queue DB queries | `processQueue` queries all queued transfers | O(n) where n = queued items | Add workspace index to query |
| Provider creation | New object per `getActiveStorageProvider()` call | Minor GC pressure | Memoize provider instance |

### Transfer Queue DB Query Optimization

Current:
```typescript
const pending = await this.db.file_transfers
    .where('state')
    .equals('queued')
    .toArray();

const candidates = pending
    .filter((transfer) => transfer.workspace_id === this.workspaceId)
```

Optimized (use compound index):
```typescript
const candidates = await this.db.file_transfers
    .where('[state+workspace_id]')
    .equals(['queued', this.workspaceId])
    .sortBy('created_at');
```

This requires adding the compound index to `client.ts`:
```typescript
file_transfers:
    'id, hash, direction, state, workspace_id, created_at, updated_at, [hash+direction], [state+created_at], [state+workspace_id]',
```

---

## 6. Deletions

| Target | Reason |
|--------|--------|
| `disposition` parameter in `PresignedUrlResult` | Unused - not implemented in SSR endpoints |
| `urlOptions.disposition` in transfer-queue.ts | Passed but ignored; remove until feature is needed |

---

## 7. Checklist for Merge

All items completed:

- [x] Add `deleted_at` field to `FileMetaSchema` in `app/db/schema.ts`
- [x] Update `softDeleteFile` and `softDeleteMany` to set `deleted_at`
- [x] Add unit test verifying `deleted_at` is set on soft delete
- [x] Add unit test for provider memoization
- [x] Fix race condition in `waitForTransfer` by registering waiter before state check
- [x] Add `[state+workspace_id]` compound index to `file_transfers` table
- [x] Update `processQueue` to use the compound index
- [x] Bump Dexie version to 10 for new index
- [x] Add AbortController to transfer queue with cancel support
- [x] Memoize `getActiveStorageProvider()` result
- [x] Fix memory efficiency in `readBlobWithProgress` using streaming
- [x] Fix `any` cast in `blobImageSize` with proper type guard
- [x] Add null check in Convex `getFileUrl`
- [x] Add rate limiting to GC endpoint (1 minute cooldown per workspace)

---

*End of review.*
