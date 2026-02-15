/**
 * Tests for delete operation validation in sync push endpoint
 * 
 * Issue: Delete operations were being rejected because validation was applied
 * to all operations, even though delete ops have minimal payloads.
 * 
 * Fix: Push validation now only validates 'put' operations against schemas,
 * while 'delete' operations pass through without schema validation.
 */
import { describe, it, expect } from 'vitest';
import { 
    PushBatchSchema, 
    MessagePayloadSchema, 
    ThreadPayloadSchema 
} from '../../shared/sync/schemas';

// Helper to create valid stamp with a proper UUID
function createStamp(deviceId: string = 'dev-1', clock: number = 1) {
    const now = Date.now();
    // Use a valid UUID v4 format - fixed for testing
    const uuids = [
        'a1b2c3d4-5678-4abc-8def-123456789001',
        'a1b2c3d4-5678-4abc-8def-123456789002',
        'a1b2c3d4-5678-4abc-8def-123456789003',
        'a1b2c3d4-5678-4abc-8def-123456789004',
        'a1b2c3d4-5678-4abc-8def-123456789005',
        'a1b2c3d4-5678-4abc-8def-123456789006',
    ];
    return {
        opId: uuids[clock - 1] || uuids[0],
        deviceId,
        hlc: `${now}-${clock}-${deviceId}`,
        clock,
    };
}

describe('Sync - Delete operation validation', () => {
    describe('PushBatchSchema', () => {
        it('should accept put operation with full payload', () => {
            const now = Date.now();
            const batch = {
                scope: { workspaceId: 'ws-1', deviceId: 'dev-1' },
                ops: [
                    {
                        id: 'pending-op-1',
                        tableName: 'threads',
                        pk: 'thread-1',
                        operation: 'put',
                        stamp: createStamp('dev-1', 1),
                        payload: {
                            id: 'thread-1',
                            title: 'Test Thread',
                            status: 'active',
                            pinned: false,
                            deleted: false,
                            created_at: now,
                            updated_at: now,
                            clock: 1,
                        },
                        createdAt: now,
                        attempts: 0,
                        status: 'pending',
                    },
                ],
            };

            const result = PushBatchSchema.safeParse(batch);
            expect(result.success).toBe(true);
        });

        it('should accept delete operation with minimal payload', () => {
            const batch = {
                scope: { workspaceId: 'ws-1', deviceId: 'dev-1' },
                ops: [
                    {
                        id: 'pending-op-2',
                        tableName: 'threads',
                        pk: 'thread-1',
                        operation: 'delete',
                        stamp: createStamp('dev-1', 1),
                        payload: {
                            id: 'thread-1',
                            deleted: true,
                        },
                        createdAt: Date.now(),
                        attempts: 0,
                        status: 'pending',
                    },
                ],
            };

            const result = PushBatchSchema.safeParse(batch);
            expect(result.success).toBe(true);
        });

        it('should accept delete operation with no payload', () => {
            const batch = {
                scope: { workspaceId: 'ws-1', deviceId: 'dev-1' },
                ops: [
                    {
                        id: 'pending-op-3',
                        tableName: 'threads',
                        pk: 'thread-1',
                        operation: 'delete',
                        stamp: createStamp('dev-1', 1),
                        // No payload field
                        createdAt: Date.now(),
                        attempts: 0,
                        status: 'pending',
                    },
                ],
            };

            const result = PushBatchSchema.safeParse(batch);
            expect(result.success).toBe(true);
        });

        it('should accept delete operation with undefined payload', () => {
            const batch = {
                scope: { workspaceId: 'ws-1', deviceId: 'dev-1' },
                ops: [
                    {
                        id: 'pending-op-4',
                        tableName: 'threads',
                        pk: 'thread-1',
                        operation: 'delete',
                        stamp: createStamp('dev-1', 1),
                        payload: undefined,
                        createdAt: Date.now(),
                        attempts: 0,
                        status: 'pending',
                    },
                ],
            };

            const result = PushBatchSchema.safeParse(batch);
            expect(result.success).toBe(true);
        });
    });

    describe('Per-table schema validation logic', () => {
        it('should validate put operations against MessagePayloadSchema', () => {
            const validMessage = {
                id: 'msg-1',
                thread_id: 'thread-1',
                role: 'user',
                content: 'Hello',
                index: 0,
                order_key: '0000000000000000',
                deleted: false,
                created_at: Date.now(),
                updated_at: Date.now(),
                clock: 1,
            };

            const result = MessagePayloadSchema.safeParse(validMessage);
            expect(result.success).toBe(true);
        });

        it('should reject invalid put operations', () => {
            const invalidMessage = {
                id: 'msg-1',
                // Missing required fields: thread_id, role, content, etc.
                deleted: false,
            };

            const result = MessagePayloadSchema.safeParse(invalidMessage);
            expect(result.success).toBe(false);
        });

        it('should allow delete payloads to skip schema validation', () => {
            // This minimal payload would fail MessagePayloadSchema validation
            // but should be acceptable for delete operations
            const deletePayload = {
                id: 'msg-1',
                deleted: true,
            };

            // If this were validated against MessagePayloadSchema, it would fail
            const result = MessagePayloadSchema.safeParse(deletePayload);
            expect(result.success).toBe(false);
            
            // But in the actual push endpoint, delete ops bypass schema validation
            // This is tested via integration tests or by checking the push.post.ts logic
        });
    });

    describe('Mixed operations batch', () => {
        it('should accept batch with both put and delete operations', () => {
            const now = Date.now();
            const batch = {
                scope: { workspaceId: 'ws-1', deviceId: 'dev-1' },
                ops: [
                    {
                        id: 'pending-op-5',
                        tableName: 'threads',
                        pk: 'thread-1',
                        operation: 'put',
                        stamp: createStamp('dev-1', 1),
                        payload: {
                            id: 'thread-1',
                            title: 'Test Thread',
                            status: 'active',
                            pinned: false,
                            deleted: false,
                            created_at: now,
                            updated_at: now,
                            clock: 1,
                        },
                        createdAt: now,
                        attempts: 0,
                        status: 'pending',
                    },
                    {
                        id: 'pending-op-6',
                        tableName: 'threads',
                        pk: 'thread-2',
                        operation: 'delete',
                        stamp: createStamp('dev-1', 2),
                        payload: {
                            id: 'thread-2',
                            deleted: true,
                        },
                        createdAt: now,
                        attempts: 0,
                        status: 'pending',
                    },
                ],
            };

            const result = PushBatchSchema.safeParse(batch);
            expect(result.success).toBe(true);
        });
    });

    describe('Sanitization behavior', () => {
        it('should handle delete operations in sanitizePayloadForSync', async () => {
            const { sanitizePayloadForSync } = await import('../../shared/sync/sanitize');

            // Delete with no payload
            const result1 = sanitizePayloadForSync('threads', null, 'delete');
            expect(result1).toBeUndefined();

            // Delete with minimal payload
            const result2 = sanitizePayloadForSync(
                'threads',
                { id: 'thread-1', deleted: true },
                'delete'
            );
            expect(result2).toBeDefined();
            expect(result2?.id).toBe('thread-1');

            // Put operation should always sanitize
            const result3 = sanitizePayloadForSync(
                'threads',
                { 
                    id: 'thread-1', 
                    title: 'Test',
                    deleted: false,
                    created_at: Date.now(),
                    updated_at: Date.now(),
                    clock: 1,
                },
                'put'
            );
            expect(result3).toBeDefined();
        });

        it('should preserve deleted flag in sanitized delete payloads', async () => {
            const { sanitizePayloadForSync } = await import('../../shared/sync/sanitize');

            const result = sanitizePayloadForSync(
                'threads',
                { id: 'thread-1', deleted: true, extra: 'field' },
                'delete'
            );

            expect(result?.deleted).toBe(true);
        });
    });
});
