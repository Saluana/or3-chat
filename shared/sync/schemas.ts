/**
 * Zod Schemas for Sync Types
 *
 * Validation schemas for runtime type checking of sync operations.
 * These can be used on both client and server for validation.
 */
import { z } from 'zod';

// ============================================================
// CORE SCHEMAS
// ============================================================

export const SyncScopeSchema = z.object({
    workspaceId: z.string(),
    projectId: z.string().optional(),
});

export const ChangeStampSchema = z.object({
    deviceId: z.string(),
    opId: z.string().uuid(),
    hlc: z.string(),
    clock: z.number().int().nonnegative(),
});

export const PendingOpSchema = z.object({
    id: z.string(),
    tableName: z.string(),
    operation: z.enum(['put', 'delete']),
    pk: z.string(),
    payload: z.unknown().optional(),
    stamp: ChangeStampSchema,
    createdAt: z.number(),
    attempts: z.number().int().nonnegative(),
    nextAttemptAt: z.number().int().nonnegative().optional(),
    status: z.enum(['pending', 'syncing', 'failed']),
});

export const SyncChangeSchema = z.object({
    serverVersion: z.number().int().positive(),
    tableName: z.string(),
    pk: z.string(),
    op: z.enum(['put', 'delete']),
    payload: z.unknown().optional(),
    stamp: ChangeStampSchema,
});

// ============================================================
// TABLE PAYLOAD SCHEMAS
// ============================================================

/**
 * Validation schemas for incoming server payloads
 * These use passthrough() to allow additional fields while validating required ones
 */

export const ThreadPayloadSchema = z
    .object({
        id: z.string(),
        title: z.string().nullable().optional(),
        status: z.string(),
        deleted: z.boolean(),
        pinned: z.boolean(),
        created_at: z.number(),
        updated_at: z.number(),
        clock: z.number(),
    })
    .passthrough();

export const MessagePayloadSchema = z
    .object({
        id: z.string(),
        thread_id: z.string(),
        role: z.string(),
        index: z.number(),
        order_key: z.string(),
        deleted: z.boolean(),
        created_at: z.number(),
        updated_at: z.number(),
        clock: z.number(),
    })
    .passthrough();

export const ProjectPayloadSchema = z
    .object({
        id: z.string(),
        name: z.string(),
        deleted: z.boolean(),
        created_at: z.number(),
        updated_at: z.number(),
        clock: z.number(),
    })
    .passthrough();

export const PostPayloadSchema = z
    .object({
        id: z.string(),
        title: z.string(),
        content: z.string(),
        postType: z.string(), // Client-side uses camelCase
        deleted: z.boolean(),
        created_at: z.number(),
        updated_at: z.number(),
        clock: z.number(),
    })
    .passthrough();

export const FileMetaPayloadSchema = z
    .object({
        hash: z.string(),
        kind: z.string().optional(),
        mime_type: z.string().optional(),
        size: z.number().optional(),
        deleted: z.boolean(),
        created_at: z.number(),
        updated_at: z.number(),
        clock: z.number(),
    })
    .passthrough();

export const KvPayloadSchema = z
    .object({
        id: z.string(),
        name: z.string(),
        value: z.unknown(),
        created_at: z.number(),
        updated_at: z.number(),
        clock: z.number(),
    })
    .passthrough();

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
};

// ============================================================
// REQUEST/RESPONSE SCHEMAS
// ============================================================

export const PullRequestSchema = z.object({
    scope: SyncScopeSchema,
    cursor: z.number().int().nonnegative(),
    limit: z.number().int().positive().max(1000),
    tables: z.array(z.string()).optional(),
});

export const PullResponseSchema = z.object({
    changes: z.array(SyncChangeSchema),
    nextCursor: z.number().int().nonnegative(),
    hasMore: z.boolean(),
});

export const PushBatchSchema = z.object({
    scope: SyncScopeSchema,
    ops: z.array(PendingOpSchema),
});

export const PushResultItemSchema = z.object({
    opId: z.string(),
    success: z.boolean(),
    serverVersion: z.number().int().positive().optional(),
    error: z.string().optional(),
});

export const PushResultSchema = z.object({
    results: z.array(PushResultItemSchema),
    serverVersion: z.number().int().nonnegative(),
});

// ============================================================
// LOCAL STATE SCHEMAS
// ============================================================

export const TombstoneSchema = z.object({
    id: z.string(),
    tableName: z.string(),
    pk: z.string(),
    deletedAt: z.number(),
    clock: z.number().int().nonnegative(),
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
export type PushBatchZ = z.infer<typeof PushBatchSchema>;
export type PushResultZ = z.infer<typeof PushResultSchema>;
export type TombstoneZ = z.infer<typeof TombstoneSchema>;
export type SyncStateZ = z.infer<typeof SyncStateSchema>;
export type SyncRunZ = z.infer<typeof SyncRunSchema>;
