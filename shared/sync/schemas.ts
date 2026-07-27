/**
 * Zod Schemas for Sync Types
 *
 * Validation schemas for runtime type checking of sync operations.
 * These can be used on both client and server for validation.
 */
import { z } from 'zod';
import { toServerFormat } from './field-mappings';

export const MAX_SYNC_PUSH_BATCH_OPS = 100;
export const MAX_SYNC_PUSH_BATCH_BYTES = 2 * 1024 * 1024;
const MAX_SYNC_IDENTIFIER_LENGTH = 256;
const MAX_SYNC_TABLE_FILTERS = 50;

function jsonByteLength(value: unknown): number {
    try {
        return new TextEncoder().encode(JSON.stringify(value)).length;
    } catch {
        return Number.MAX_SAFE_INTEGER;
    }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toSnakeCaseKey(key: string): string {
    return key.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`);
}

function normalizeRecordToSnakeCase(
    input: Record<string, unknown>
): Record<string, unknown> {
    const normalized: Record<string, unknown> = { ...input };
    for (const [key, value] of Object.entries(input)) {
        const snakeKey = toSnakeCaseKey(key);
        if (snakeKey === key) continue;
        if (!(snakeKey in normalized)) {
            normalized[snakeKey] = value;
        }
        delete normalized[key];
    }
    return normalized;
}

export function normalizeWirePayloadForTable(
    tableName: string,
    payload: unknown
): unknown {
    if (!isPlainRecord(payload)) return payload;
    const normalized = normalizeRecordToSnakeCase(payload);
    return toServerFormat(tableName, normalized);
}

function createTablePayloadSchema<T extends z.ZodRawShape>(
    tableName: string,
    shape: T
): z.ZodType<z.infer<z.ZodObject<T>>> {
    return z.preprocess(
        (input) => normalizeWirePayloadForTable(tableName, input),
        z.object(shape).passthrough()
    ) as z.ZodType<z.infer<z.ZodObject<T>>>;
}

// ============================================================
// CORE SCHEMAS
// ============================================================

export const SyncScopeSchema = z.object({
    workspaceId: z.string().trim().min(1).max(MAX_SYNC_IDENTIFIER_LENGTH),
    projectId: z.string().trim().min(1).max(MAX_SYNC_IDENTIFIER_LENGTH).optional(),
});

export const ChangeStampSchema = z.object({
    deviceId: z.string().trim().min(1).max(MAX_SYNC_IDENTIFIER_LENGTH),
    opId: z.string().uuid(),
    hlc: z.string().min(1).max(512),
    clock: z.number().int().nonnegative(),
});

export const PendingOpSchema = z.object({
    id: z.string().min(1).max(MAX_SYNC_IDENTIFIER_LENGTH),
    tableName: z.string().min(1).max(128),
    operation: z.enum(['put', 'delete']),
    pk: z.string().min(1).max(1024),
    payload: z.unknown().optional(),
    stamp: ChangeStampSchema,
    createdAt: z.number(),
    attempts: z.number().int().nonnegative(),
    nextAttemptAt: z.number().int().nonnegative().optional(),
    status: z.enum([
        'pending',
        'in_flight',
        'retry_wait',
        'failed_retryable',
        'failed_permanent',
        'applied',
        'discarded',
        // Legacy persisted states, migrated lazily by the outbox manager.
        'syncing',
        'failed',
    ]),
    lastError: z.string().optional(),
    lastErrorCode: z.enum([
        'VALIDATION_ERROR',
        'UNAUTHORIZED',
        'CONFLICT',
        'NOT_FOUND',
        'RATE_LIMITED',
        'OVERSIZED',
        'NETWORK_ERROR',
        'SERVER_ERROR',
        'UNKNOWN',
    ]).optional(),
    failureKind: z.enum(['retry_exhausted', 'permanent']).optional(),
    failedAt: z.number().int().nonnegative().optional(),
    discardedAt: z.number().int().nonnegative().optional(),
    discardReason: z.string().optional(),
});

export const SyncChangeSchema = z.object({
    serverVersion: z.number().int().positive(),
    tableName: z.string(),
    pk: z.string(),
    op: z.enum(['put', 'delete']),
    payload: z.unknown().optional(),
    stamp: ChangeStampSchema,
});

/**
 * Reusable change-list schema for provider packages.
 *
 * Providers must import this pre-composed schema instead of wrapping
 * `SyncChangeSchema` with their own Zod instance. Composing schemas from two
 * installed Zod minors creates incompatible private `_zod` types.
 */
export const SyncChangesSchema = z.array(SyncChangeSchema);

// ============================================================
// TABLE PAYLOAD SCHEMAS
// ============================================================

/**
 * Validation schemas for incoming server payloads
 * These use passthrough() to allow additional fields while validating required ones
 */

export const ThreadPayloadSchema = createTablePayloadSchema('threads', {
        id: z.string(),
        title: z.string().nullable().optional(),
        status: z.string(),
        deleted: z.boolean(),
        pinned: z.boolean(),
        created_at: z.number(),
        updated_at: z.number(),
        clock: z.number(),
    });

export const MessagePayloadSchema = createTablePayloadSchema('messages', {
        id: z.string(),
        thread_id: z.string(),
        role: z.string(),
        index: z.number(),
        order_key: z.string(),
        deleted: z.boolean(),
        created_at: z.number(),
        updated_at: z.number(),
        clock: z.number(),
        hlc: z.string().optional(),
    });

export const ProjectPayloadSchema = createTablePayloadSchema('projects', {
        id: z.string(),
        name: z.string(),
        deleted: z.boolean(),
        created_at: z.number(),
        updated_at: z.number(),
        clock: z.number(),
    });

export const PostPayloadSchema = createTablePayloadSchema('posts', {
        id: z.string(),
        title: z.string(),
        content: z.string(),
        post_type: z.string(), // Wire schema uses snake_case
        deleted: z.boolean(),
        created_at: z.number(),
        updated_at: z.number(),
        clock: z.number(),
    });

export const FileMetaPayloadSchema = createTablePayloadSchema('file_meta', {
        hash: z.string(),
        kind: z.string().optional(),
        mime_type: z.string().optional(),
        size_bytes: z.number().optional(),
        deleted: z.boolean(),
        created_at: z.number(),
        updated_at: z.number(),
        clock: z.number(),
    });

export const KvPayloadSchema = createTablePayloadSchema('kv', {
        id: z.string(),
        name: z.string(),
        value: z.unknown().optional().nullable(),
        created_at: z.number(),
        updated_at: z.number(),
        clock: z.number(),
    });

export const NotificationPayloadSchema = createTablePayloadSchema(
    'notifications',
    {
        id: z.string(),
        user_id: z.string(),
        thread_id: z.string().optional(),
        document_id: z.string().optional(),
        type: z.string(),
        title: z.string(),
        body: z.string().optional(),
        actions: z.array(z.unknown()).optional(),
        read_at: z.number().optional(),
        deleted: z.boolean(),
        deleted_at: z.number().optional(),
        created_at: z.number(),
        updated_at: z.number(),
        clock: z.number(),
    }
);

/**
 * Map of table names to their payload schemas
 */
export const TABLE_PAYLOAD_SCHEMAS: Record<string, z.ZodSchema> = {
    threads: ThreadPayloadSchema,
    messages: MessagePayloadSchema,
    projects: ProjectPayloadSchema,
    posts: PostPayloadSchema,
    file_meta: FileMetaPayloadSchema,
    kv: KvPayloadSchema,
    notifications: NotificationPayloadSchema,
};

// ============================================================
// REQUEST/RESPONSE SCHEMAS
// ============================================================

export const PullRequestSchema = z.object({
    scope: SyncScopeSchema,
    cursor: z.number().int().nonnegative(),
    limit: z.number().int().positive().max(1000),
    tables: z
        .array(z.string().trim().min(1).max(128))
        .max(MAX_SYNC_TABLE_FILTERS)
        .optional(),
});

export const PullResponseSchema = z
    .object({
        changes: SyncChangesSchema.max(1000),
        nextCursor: z.number().int().nonnegative(),
        hasMore: z.boolean(),
    })
    .superRefine((response, ctx) => {
        let previousVersion = 0;
        const opIds = new Set<string>();
        for (const [index, change] of response.changes.entries()) {
            if (change.serverVersion <= previousVersion) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['changes', index, 'serverVersion'],
                    message: 'Pull changes must be strictly ordered by serverVersion',
                });
            }
            if (change.serverVersion > response.nextCursor) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['changes', index, 'serverVersion'],
                    message: 'Pull change exceeds nextCursor',
                });
            }
            if (opIds.has(change.stamp.opId)) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['changes', index, 'stamp', 'opId'],
                    message: 'Pull response contains a duplicate opId',
                });
            }
            previousVersion = change.serverVersion;
            opIds.add(change.stamp.opId);
        }
    });

export const SnapshotRequestSchema = z.object({
    scope: SyncScopeSchema,
    pageSize: z.number().int().positive().max(1000),
    pageToken: z.string().min(1).max(4096).optional(),
    tables: z
        .array(z.string().trim().min(1).max(128))
        .max(MAX_SYNC_TABLE_FILTERS)
        .optional(),
});

export const SnapshotRevisionSchema = z.object({
    clock: z.number().int().nonnegative(),
    hlc: z.string().min(1),
    opId: z.string().min(1),
});

export const SnapshotItemSchema = z.discriminatedUnion('kind', [
    z.object({
        kind: z.literal('row'),
        tableName: z.string().min(1),
        pk: z.string().min(1),
        payload: z.unknown(),
        revision: SnapshotRevisionSchema,
    }),
    z.object({
        kind: z.literal('tombstone'),
        tableName: z.string().min(1),
        pk: z.string().min(1),
        revision: SnapshotRevisionSchema,
        serverDeletedAt: z.number().int().nonnegative(),
    }),
]);

export const SnapshotResponseSchema = z
    .object({
        workspaceId: z.string().min(1),
        snapshotId: z.string().min(1),
        highWatermark: z.number().int().nonnegative(),
        items: z.array(SnapshotItemSchema).max(1000),
        nextPageToken: z.string().min(1).max(4096).nullable(),
    })
    .superRefine((response, ctx) => {
        let previousKey: string | null = null;
        const logicalKeys = new Set<string>();
        for (const [index, item] of response.items.entries()) {
            const logicalKey = `${item.tableName}\0${item.pk}`;
            const orderedKey = `${logicalKey}\0${item.kind}`;
            if (previousKey !== null && orderedKey <= previousKey) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['items', index],
                    message: 'Snapshot items must be strictly ordered',
                });
            }
            if (logicalKeys.has(logicalKey)) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['items', index],
                    message:
                        'Snapshot contains duplicate or contradictory entries for one record',
                });
            }
            previousKey = orderedKey;
            logicalKeys.add(logicalKey);
        }
    });

export const PushBatchSchema = z
    .object({
        scope: SyncScopeSchema,
        ops: z.array(PendingOpSchema).max(MAX_SYNC_PUSH_BATCH_OPS),
    })
    .superRefine((batch, ctx) => {
        if (jsonByteLength(batch) > MAX_SYNC_PUSH_BATCH_BYTES) {
            ctx.addIssue({
                code: 'custom',
                path: ['ops'],
                message: `Push batch exceeds ${MAX_SYNC_PUSH_BATCH_BYTES} bytes`,
            });
        }
        const opIds = new Set<string>();
        for (const [index, op] of batch.ops.entries()) {
            if (opIds.has(op.stamp.opId)) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['ops', index, 'stamp', 'opId'],
                    message: 'Push batch contains a duplicate opId',
                });
            }
            opIds.add(op.stamp.opId);
        }
    });

export const PushResultItemSchema = z.object({
    opId: z.string().min(1),
    success: z.boolean(),
    serverVersion: z.number().int().positive().optional(),
    error: z.string().optional(),
    tableName: z.string().optional(),
    operation: z.enum(['put', 'delete']).optional(),
    payload: z.unknown().optional(),
    wasExisting: z.boolean().optional(),
    applied: z.boolean().optional(),
    errorCode: z
        .enum([
            'VALIDATION_ERROR',
            'UNAUTHORIZED',
            'CONFLICT',
            'NOT_FOUND',
            'RATE_LIMITED',
            'OVERSIZED',
            'NETWORK_ERROR',
            'SERVER_ERROR',
            'UNKNOWN',
        ])
        .optional(),
});

export const PushResultSchema = z
    .object({
        results: z.array(PushResultItemSchema).max(MAX_SYNC_PUSH_BATCH_OPS),
        serverVersion: z.number().int().nonnegative(),
    })
    .superRefine((response, ctx) => {
        const opIds = new Set<string>();
        for (const [index, result] of response.results.entries()) {
            if (opIds.has(result.opId)) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['results', index, 'opId'],
                    message: 'Push response contains a duplicate opId',
                });
            }
            if (
                result.serverVersion !== undefined &&
                result.serverVersion > response.serverVersion
            ) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['results', index, 'serverVersion'],
                    message: 'Push result serverVersion exceeds response serverVersion',
                });
            }
            opIds.add(result.opId);
        }
    });

export function getPullResponseContractError(
    request: z.infer<typeof PullRequestSchema>,
    response: z.infer<typeof PullResponseSchema>
): string | null {
    if (response.nextCursor < request.cursor) {
        return 'Pull response cursor regressed';
    }
    if (response.hasMore && response.nextCursor <= request.cursor) {
        return 'Pull response hasMore did not advance the cursor';
    }
    if (
        response.changes.some(
            (change) => change.serverVersion <= request.cursor
        )
    ) {
        return 'Pull response contains a change at or before the requested cursor';
    }
    return null;
}

export function getSnapshotResponseContractError(
    request: z.infer<typeof SnapshotRequestSchema>,
    response: z.infer<typeof SnapshotResponseSchema>
): string | null {
    if (response.workspaceId !== request.scope.workspaceId) {
        return 'Snapshot response workspace does not match the request';
    }
    if (response.items.length > request.pageSize) {
        return 'Snapshot response exceeds the requested page size';
    }
    return null;
}

export function getPushResultContractError(
    batch: z.infer<typeof PushBatchSchema>,
    response: z.infer<typeof PushResultSchema>
): string | null {
    const expected = new Set(batch.ops.map((op) => op.stamp.opId));
    const actual = new Set(response.results.map((result) => result.opId));
    if (actual.size !== expected.size) {
        return 'Push response does not contain exactly one result per operation';
    }
    for (const opId of expected) {
        if (!actual.has(opId)) {
            return `Push response is missing result for operation ${opId}`;
        }
    }
    return null;
}

// ============================================================
// LOCAL STATE SCHEMAS
// ============================================================

export const TombstoneSchema = z.object({
    id: z.string(),
    tableName: z.string(),
    pk: z.string(),
    deletedAt: z.number(),
    clock: z.number().int().nonnegative(),
    hlc: z.string().min(1).optional(),
    opId: z.string().min(1).optional(),
    serverVersion: z.number().int().nonnegative().optional(),
    serverDeletedAt: z.number().nonnegative().optional(),
    syncedAt: z.number().optional(),
});

export const SyncStateSchema = z.object({
    id: z.string(),
    cursor: z.number().int().nonnegative(),
    lastSyncAt: z.number(),
    deviceId: z.string(),
});

export const SyncRunSchema = z.object({
    id: z.string(),
    startedAt: z.number(),
    completedAt: z.number().optional(),
    pushedCount: z.number().int().nonnegative(),
    pulledCount: z.number().int().nonnegative(),
    conflictCount: z.number().int().nonnegative(),
    errorCount: z.number().int().nonnegative(),
    status: z.enum(['running', 'completed', 'failed']),
    error: z.string().optional(),
});

// ============================================================
// TYPE EXPORTS (inferred from schemas)
// ============================================================

export type SyncScopeZ = z.infer<typeof SyncScopeSchema>;
export type ChangeStampZ = z.infer<typeof ChangeStampSchema>;
export type PendingOpZ = z.infer<typeof PendingOpSchema>;
export type SyncChangeZ = z.infer<typeof SyncChangeSchema>;
export type PullRequestZ = z.infer<typeof PullRequestSchema>;
export type PullResponseZ = z.infer<typeof PullResponseSchema>;
export type SnapshotRequestZ = z.infer<typeof SnapshotRequestSchema>;
export type SnapshotResponseZ = z.infer<typeof SnapshotResponseSchema>;
export type PushBatchZ = z.infer<typeof PushBatchSchema>;
export type PushResultZ = z.infer<typeof PushResultSchema>;
export type TombstoneZ = z.infer<typeof TombstoneSchema>;
export type SyncStateZ = z.infer<typeof SyncStateSchema>;
export type SyncRunZ = z.infer<typeof SyncRunSchema>;
