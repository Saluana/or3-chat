import { describe, expect, it } from 'vitest';
import {
    NotificationPayloadSchema,
    PullResponseSchema,
    PostPayloadSchema,
    PushBatchSchema,
    PushResultSchema,
    SnapshotResponseSchema,
    TABLE_PAYLOAD_SCHEMAS,
    TombstoneSchema,
    MAX_SYNC_PUSH_BATCH_OPS,
} from '../schemas';

describe('sync schemas', () => {
    it('reads legacy tombstones and preserves full deterministic revisions', () => {
        expect(TombstoneSchema.safeParse({
            id: 'messages:m1', tableName: 'messages', pk: 'm1', deletedAt: 1, clock: 1,
        }).success).toBe(true);
        const current = TombstoneSchema.parse({
            id: 'messages:m1', tableName: 'messages', pk: 'm1', deletedAt: 1, clock: 2,
            hlc: '2:0:d', opId: 'op-2', serverVersion: 9, serverDeletedAt: 10,
        });
        expect(current).toMatchObject({
            hlc: '2:0:d', opId: 'op-2', serverVersion: 9, serverDeletedAt: 10,
        });
    });

    it('includes notifications in TABLE_PAYLOAD_SCHEMAS', () => {
        expect(TABLE_PAYLOAD_SCHEMAS.notifications).toBe(NotificationPayloadSchema);
    });

    it('validates notification payloads', () => {
        const payload = {
            id: 'notif-1',
            user_id: 'user-1',
            type: 'sync-error',
            title: 'Sync failed',
            deleted: false,
            created_at: 1,
            updated_at: 1,
            clock: 1,
        };
        expect(NotificationPayloadSchema.safeParse(payload).success).toBe(true);
    });

    it('accepts post payloads in snake_case and keeps snake_case', () => {
        const parsed = PostPayloadSchema.safeParse({
            id: 'post-1',
            title: 'Post',
            content: 'Body',
            post_type: 'markdown',
            deleted: false,
            created_at: 1,
            updated_at: 2,
            clock: 3,
        });

        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect(parsed.data.post_type).toBe('markdown');
            expect(parsed.data).not.toHaveProperty('postType');
        }
    });

    it('accepts post payloads in camelCase and normalizes to snake_case', () => {
        const parsed = PostPayloadSchema.safeParse({
            id: 'post-2',
            title: 'Post',
            content: 'Body',
            postType: 'markdown',
            deleted: false,
            createdAt: 1,
            updatedAt: 2,
            clock: 3,
        });

        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect(parsed.data.post_type).toBe('markdown');
            expect(parsed.data.created_at).toBe(1);
            expect(parsed.data.updated_at).toBe(2);
            expect(parsed.data).not.toHaveProperty('postType');
            expect(parsed.data).not.toHaveProperty('createdAt');
            expect(parsed.data).not.toHaveProperty('updatedAt');
        }
    });

    it('normalizes notification camelCase keys to snake_case', () => {
        const parsed = NotificationPayloadSchema.safeParse({
            id: 'notif-2',
            userId: 'user-2',
            threadId: 'thread-1',
            documentId: 'doc-1',
            type: 'ai.message.received',
            title: 'Done',
            deleted: false,
            createdAt: 5,
            updatedAt: 6,
            clock: 7,
        });

        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect(parsed.data.user_id).toBe('user-2');
            expect(parsed.data.thread_id).toBe('thread-1');
            expect(parsed.data.document_id).toBe('doc-1');
            expect(parsed.data.created_at).toBe(5);
            expect(parsed.data.updated_at).toBe(6);
            expect(parsed.data).not.toHaveProperty('userId');
            expect(parsed.data).not.toHaveProperty('threadId');
            expect(parsed.data).not.toHaveProperty('documentId');
            expect(parsed.data).not.toHaveProperty('createdAt');
            expect(parsed.data).not.toHaveProperty('updatedAt');
        }
    });

    it('accepts PushResult errorCode values', () => {
        const parsed = PushResultSchema.safeParse({
            results: [
                {
                    opId: 'op-1',
                    success: false,
                    error: 'Validation failed',
                    errorCode: 'VALIDATION_ERROR',
                },
            ],
            serverVersion: 42,
        });

        expect(parsed.success).toBe(true);
    });

    it('accepts PushResult webhook emission metadata fields', () => {
        const parsed = PushResultSchema.safeParse({
            results: [
                {
                    opId: 'op-2',
                    success: true,
                    serverVersion: 43,
                    tableName: 'threads',
                    operation: 'put',
                    payload: { id: 'thread-1', title: 'Renamed' },
                    wasExisting: true,
                    applied: true,
                },
            ],
            serverVersion: 43,
        });

        expect(parsed.success).toBe(true);
    });

    it('rejects unordered pull versions and duplicate pull operation IDs', () => {
        const opId = 'a1b2c3d4-5678-4abc-8def-123456789001';
        const baseChange = {
            tableName: 'messages',
            pk: 'message-1',
            op: 'delete' as const,
            stamp: {
                deviceId: 'device-1',
                opId,
                hlc: '1:0:device-1',
                clock: 1,
            },
        };
        const parsed = PullResponseSchema.safeParse({
            changes: [
                { ...baseChange, serverVersion: 2 },
                {
                    ...baseChange,
                    pk: 'message-2',
                    serverVersion: 1,
                },
            ],
            nextCursor: 2,
            hasMore: false,
            oldestRetainedVersion: 0,
            requiresSnapshot: false,
        });

        expect(parsed.success).toBe(false);
    });

    it('rejects duplicate push request and response operation IDs', () => {
        const opId = 'a1b2c3d4-5678-4abc-8def-123456789001';
        const op = {
            id: 'pending-1',
            tableName: 'messages',
            operation: 'delete' as const,
            pk: 'message-1',
            stamp: {
                deviceId: 'device-1',
                opId,
                hlc: '1:0:device-1',
                clock: 1,
            },
            createdAt: 1,
            attempts: 0,
            status: 'pending' as const,
        };

        expect(
            PushBatchSchema.safeParse({
                scope: { workspaceId: 'workspace-1' },
                ops: [op, { ...op, id: 'pending-2', pk: 'message-2' }],
            }).success
        ).toBe(false);
        expect(
            PushResultSchema.safeParse({
                results: [
                    { opId, success: true, serverVersion: 1 },
                    { opId, success: true, serverVersion: 1 },
                ],
                serverVersion: 1,
            }).success
        ).toBe(false);
    });

    it('rejects oversized batches and hostile identifier/filter bounds', () => {
        const makeOp = (index: number) => ({
            id: `pending-${index}`,
            tableName: 'messages',
            operation: 'delete' as const,
            pk: `message-${index}`,
            stamp: {
                deviceId: 'device-1',
                opId: `00000000-0000-4000-8000-${index
                    .toString()
                    .padStart(12, '0')}`,
                hlc: `${index}:0:device-1`,
                clock: index,
            },
            createdAt: index,
            attempts: 0,
            status: 'pending' as const,
        });

        expect(
            PushBatchSchema.safeParse({
                scope: { workspaceId: 'workspace-1' },
                ops: Array.from(
                    { length: MAX_SYNC_PUSH_BATCH_OPS + 1 },
                    (_, index) => makeOp(index)
                ),
            }).success
        ).toBe(false);
        expect(
            PullResponseSchema.safeParse({
                changes: [],
                nextCursor: 0,
                hasMore: false,
            }).success
        ).toBe(false);
        expect(
            PullResponseSchema.safeParse({
                changes: [],
                nextCursor: 0,
                hasMore: false,
                oldestRetainedVersion: 0,
                requiresSnapshot: false,
            }).success
        ).toBe(true);
        expect(
            PushBatchSchema.safeParse({
                scope: { workspaceId: ' '.repeat(5) },
                ops: [],
            }).success
        ).toBe(false);
    });

    it('never throws while rejecting deterministic malformed JSON fuzz cases', () => {
        let seed = 0x5eed1234;
        const random = () => {
            seed = (seed * 1664525 + 1013904223) >>> 0;
            return seed / 0x1_0000_0000;
        };
        const scalar = (): unknown => {
            const values: unknown[] = [
                null,
                true,
                false,
                random() * Number.MAX_SAFE_INTEGER,
                'x'.repeat(Math.floor(random() * 400)),
            ];
            return values[Math.floor(random() * values.length)];
        };
        const jsonValue = (depth = 0): unknown => {
            if (depth >= 4 || random() < 0.45) return scalar();
            if (random() < 0.5) {
                return Array.from(
                    { length: Math.floor(random() * 8) },
                    () => jsonValue(depth + 1)
                );
            }
            return Object.fromEntries(
                Array.from(
                    { length: Math.floor(random() * 8) },
                    (_, index) => [`key_${depth}_${index}`, jsonValue(depth + 1)]
                )
            );
        };

        for (let index = 0; index < 500; index += 1) {
            const candidate = jsonValue();
            expect(() => PushBatchSchema.safeParse(candidate)).not.toThrow();
            expect(() => PullResponseSchema.safeParse(candidate)).not.toThrow();
            expect(() => SnapshotResponseSchema.safeParse(candidate)).not.toThrow();
        }
    });

    it('rejects unordered and contradictory snapshot items', () => {
        const response = {
            workspaceId: 'workspace-1',
            snapshotId: 'snapshot-1',
            highWatermark: 2,
            items: [
                {
                    kind: 'row' as const,
                    tableName: 'messages',
                    pk: 'message-1',
                    payload: { id: 'message-1' },
                    revision: { clock: 1, hlc: '1:0:d', opId: 'op-row' },
                },
                {
                    kind: 'tombstone' as const,
                    tableName: 'messages',
                    pk: 'message-1',
                    revision: {
                        clock: 2,
                        hlc: '2:0:d',
                        opId: 'op-delete',
                    },
                    serverDeletedAt: 2,
                },
            ],
            nextPageToken: null,
        };

        expect(SnapshotResponseSchema.safeParse(response).success).toBe(false);
        expect(
            SnapshotResponseSchema.safeParse({
                ...response,
                items: [
                    {
                        ...response.items[0],
                        tableName: 'threads',
                        pk: 'thread-1',
                    },
                    response.items[1],
                ],
            }).success
        ).toBe(false);
    });
});
