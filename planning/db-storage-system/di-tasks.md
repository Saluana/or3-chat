# DB Storage System: Dumb Issues - Task List

**Priority Guide**: Implementation order based on dependencies and impact, not just severity.

---

## Phase 1: Critical Fixes (Breaking Changes Possible)

These fix user-facing bugs that can cause stalled uploads and poor UX.

### ✅ Task 1.1: Add timeout to waitForTransfer (Issue #25)
**Priority**: Critical  
**Severity**: High  
**Breaking Changes**: Yes (API signature change)

**Why First**: Prevents indefinite hangs on stalled uploads. Critical UX bug.

**Files**:
- Update: `app/core/storage/transfer-queue.ts:123-149`

**Implementation**:
```typescript
async waitForTransfer(id: string, timeoutMs = 60_000): Promise<void> {
    const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Transfer timeout')), timeoutMs);
    });
    
    const waiterPromise = new Promise<void>((resolve, reject) => {
        const waiters = this.waiters.get(id) ?? [];
        waiters.push({ resolve, reject });
        this.waiters.set(id, waiters);
    });
    
    // Check current state - if already done/failed, resolve immediately
    const transfer = await this.db.file_transfers.get(id);
    if (!transfer) {
        this.resolveWaiters(id);
        throw new Error('Transfer not found');
    }
    if (transfer.state === 'done') {
        this.resolveWaiters(id);
        return;
    }
    if (transfer.state === 'failed') {
        const errorMsg = transfer.last_error || 'Transfer failed';
        this.rejectWaiters(id, errorMsg);
        throw new Error(errorMsg);
    }
    
    return Promise.race([waiterPromise, timeoutPromise]);
}
```

**Tests**: Mock slow transfer, verify timeout fires at 60s.

---

## Phase 2: Performance Optimizations (No Breaking Changes)

Improve upload/download performance without changing APIs.

### ✅ Task 2.1: Throttle progress updates (Issue #22)
**Priority**: High  
**Severity**: Low  
**Breaking Changes**: None (internal optimization)

**Why Next**: Reduces Dexie writes from 10,000 to ~50 per file. Big performance win.

**Files**:
- Update: `app/core/storage/transfer-queue.ts:446-479`

**Implementation**:
```typescript
private async readBlobWithProgress(
    response: Response,
    transferId: string
): Promise<{ blob: Blob; bytesTotal: number }> {
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (!response.body) {
        const blob = await response.blob();
        return { blob, bytesTotal: contentLength || blob.size };
    }

    const reader = response.body.getReader();
    let received = 0;
    let lastUpdate = 0;
    const UPDATE_INTERVAL_MS = 200; // Update every 200ms max

    const stream = new ReadableStream<Uint8Array>({
        pull: async (controller) => {
            const { done, value } = await reader.read();
            if (done) {
                // Final update on completion
                await this.updateTransfer(transferId, {
                    bytes_done: received,
                    bytes_total: contentLength || received,
                });
                controller.close();
                return;
            }
            
            received += value.byteLength;
            
            const now = Date.now();
            if (now - lastUpdate > UPDATE_INTERVAL_MS) {
                await this.updateTransfer(transferId, {
                    bytes_done: received,
                    bytes_total: contentLength || received,
                });
                lastUpdate = now;
            }
            
            controller.enqueue(value);
        },
    });

    const blob = await new Response(stream).blob();
    return { blob, bytesTotal: contentLength || blob.size };
}
```

**Tests**: 
- Verify updates throttled to ~5 per second
- Verify final update always fires on completion

---

### ✅ Task 2.2: Make concurrency adaptive (Issue #13)
**Priority**: Medium  
**Severity**: Medium  
**Breaking Changes**: None (improves default behavior)

**Why Next**: Better defaults for different network conditions. Easy win.

**Files**:
- Update: `app/core/storage/transfer-queue.ts:18-55`

**Implementation**:
```typescript
function getDefaultConcurrency(): number {
    if (typeof navigator === 'undefined' || !navigator.connection) {
        return 2; // Default fallback
    }
    
    const connection = navigator.connection;
    const effectiveType = connection.effectiveType;
    
    if (effectiveType === '4g' || effectiveType === 'wifi') {
        return 4;
    } else if (effectiveType === '3g') {
        return 2;
    } else {
        return 1; // 2g or slow-2g
    }
}

export class FileTransferQueue {
    private concurrency: number;
    // ... rest of properties

    constructor(
        private db: Or3DB,
        private provider: ObjectStorageProvider,
        config: FileTransferQueueConfig = {}
    ) {
        this.concurrency = config.concurrency ?? getDefaultConcurrency();
        this.maxAttempts = config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
        this.backoffBaseMs = config.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
        this.backoffMaxMs = config.backoffMaxMs ?? DEFAULT_BACKOFF_MAX_MS;
    }
    
    // ... rest of methods
}
```

**Tests**: 
- Mock `navigator.connection.effectiveType` as '4g', verify concurrency = 4
- Mock as '3g', verify concurrency = 2
- Mock as '2g', verify concurrency = 1
- Mock as undefined, verify concurrency = 2

---

## Phase 3: Server-Side Validation (Breaking Changes)

Add proper validation to storage endpoints.

### ✅ Task 3.1: Validate upload policies (Enhancement)
**Priority**: Medium  
**Severity**: Medium  
**Breaking Changes**: Yes (will reject invalid uploads)

**Why Next**: Security and data integrity. Should happen before production scale.

**Files**:
- Update: `server/api/storage/presign-upload.post.ts`
- Update: `server/api/storage/commit.post.ts`

**Implementation**:
```typescript
// In presign-upload.post.ts
export default defineEventHandler(async (event) => {
    if (!isSsrAuthEnabled(event)) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }

    const body = await readBody(event);
    
    // Validate request schema
    const schema = z.object({
        workspaceId: z.string(),
        hash: z.string(),
        mimeType: z.string(),
        sizeBytes: z.number().positive(),
        expiresInMs: z.number().optional(),
    });
    
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
        throw createError({ 
            statusCode: 400, 
            statusMessage: 'Invalid upload request',
            data: parsed.error.issues 
        });
    }
    
    const session = await resolveSessionContext(event);
    requireCan(session, 'workspace.write', {
        kind: 'workspace',
        id: parsed.data.workspaceId,
    });
    
    // Size limit check (e.g., 100MB)
    const MAX_FILE_SIZE = 100 * 1024 * 1024;
    if (parsed.data.sizeBytes > MAX_FILE_SIZE) {
        throw createError({ 
            statusCode: 413, 
            statusMessage: `File size exceeds maximum of ${MAX_FILE_SIZE} bytes` 
        });
    }
    
    // MIME type allowlist check
    const ALLOWED_MIME_TYPES = [
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'application/pdf',
        'text/plain',
        'text/markdown',
        // ... add more as needed
    ];
    
    if (!ALLOWED_MIME_TYPES.includes(parsed.data.mimeType)) {
        throw createError({ 
            statusCode: 415, 
            statusMessage: `MIME type ${parsed.data.mimeType} not allowed` 
        });
    }
    
    // ... rest of presign logic
});
```

**Tests**: 
- Send request with file > 100MB, expect 413
- Send request with disallowed MIME type, expect 415
- Send valid request, expect 200 with presigned URL

---

### ✅ Task 3.2: Add rate limiting to storage endpoints (Enhancement)
**Priority**: Low  
**Severity**: Medium  
**Breaking Changes**: Yes (will rate limit)

**Why Next**: Prevents storage abuse. Can be added after basic validation.

**Files**:
- Update: `server/api/storage/presign-upload.post.ts`
- Update: `server/api/storage/presign-download.post.ts`
- Update: `server/utils/sync/rate-limiter.ts` (add storage operations)

**Implementation**:
```typescript
// In rate-limiter.ts, add:
export const STORAGE_RATE_LIMITS: Record<string, RateLimitConfig> = {
    'storage:upload': { windowMs: 60_000, maxRequests: 50 },
    'storage:download': { windowMs: 60_000, maxRequests: 100 },
};

// Merge with existing SYNC_RATE_LIMITS
export const ALL_RATE_LIMITS = {
    ...SYNC_RATE_LIMITS,
    ...STORAGE_RATE_LIMITS,
};

// In presign-upload.post.ts
const rateLimitResult = checkRateLimit(session.user.id, 'storage:upload');
if (!rateLimitResult.allowed) {
    const retryAfterSec = Math.ceil((rateLimitResult.retryAfterMs ?? 1000) / 1000);
    setResponseHeader(event, 'Retry-After', String(retryAfterSec));
    throw createError({
        statusCode: 429,
        statusMessage: `Rate limit exceeded. Retry after ${retryAfterSec}s`,
    });
}

// ... rest of endpoint logic

recordRequest(session.user.id, 'storage:upload');
```

**Tests**: 
- Send 51 upload requests in 60s, expect 429 on 51st
- Send 101 download requests in 60s, expect 429 on 101st

---

## Phase 4: Nice-to-Have Improvements (Low Priority)

### ✅ Task 4.1: Add upload resume capability (Enhancement)
**Priority**: Low  
**Severity**: Low  
**Breaking Changes**: None (additive feature)

**Why Last**: Nice-to-have for large files. Complex to implement correctly.

**Files**:
- Update: `app/core/storage/transfer-queue.ts` (add resume logic)
- Update: `server/api/storage/presign-upload.post.ts` (support range uploads)

**Implementation**: Complex. Requires:
1. Chunked upload support
2. Server-side tracking of partial uploads
3. Client-side retry from last successful chunk

**Tests**: 
- Start upload, cancel midway, resume, verify completes
- Verify no duplicate chunks uploaded

---

### ✅ Task 4.2: Add storage metrics and monitoring (Enhancement)
**Priority**: Low  
**Severity**: Low  
**Breaking Changes**: None (additive feature)

**Why Last**: Observability is good but not critical for v1.

**Files**:
- Create: `server/utils/storage/metrics.ts`
- Update: `app/core/storage/transfer-queue.ts` (emit events)

**Implementation**:
```typescript
// In metrics.ts
export interface StorageMetrics {
    uploadsStarted: number;
    uploadsCompleted: number;
    uploadsFailed: number;
    downloadsStarted: number;
    downloadsCompleted: number;
    downloadsFailed: number;
    bytesUploaded: number;
    bytesDownloaded: number;
}

const metrics: StorageMetrics = {
    uploadsStarted: 0,
    uploadsCompleted: 0,
    uploadsFailed: 0,
    downloadsStarted: 0,
    downloadsCompleted: 0,
    downloadsFailed: 0,
    bytesUploaded: 0,
    bytesDownloaded: 0,
};

export function recordUploadStart(): void {
    metrics.uploadsStarted++;
}

export function recordUploadComplete(bytes: number): void {
    metrics.uploadsCompleted++;
    metrics.bytesUploaded += bytes;
}

export function recordUploadFailed(): void {
    metrics.uploadsFailed++;
}

export function getMetrics(): Readonly<StorageMetrics> {
    return { ...metrics };
}

export function resetMetrics(): void {
    Object.keys(metrics).forEach(k => {
        metrics[k as keyof StorageMetrics] = 0;
    });
}
```

**Tests**: 
- Record events, verify counters increment
- Get metrics, verify snapshot
- Reset, verify counters zero

---

## Summary

**Total Tasks**: 7  
**Critical**: 1  
**High/Medium**: 5  
**Low**: 1  

**Recommended Order**: Phase 1 → Phase 2 → Phase 3 → Phase 4

**Breaking Changes Summary**:
- Task 1.1: waitForTransfer signature change (required for UX)
- Task 3.1: Upload validation (security requirement)
- Task 3.2: Rate limiting (abuse prevention)

**Dependencies**:
- None. Storage layer is relatively independent.
- Task 2.1 (throttle) should be done before Task 4.2 (metrics) to avoid metric spam.
