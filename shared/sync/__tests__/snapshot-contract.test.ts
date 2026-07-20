import { describe, expect, it } from 'vitest';
import { SnapshotRequestSchema, SnapshotResponseSchema } from '../schemas';

describe('snapshot bootstrap contract', () => {
    it('accepts a bounded page tied to a snapshot and high-watermark', () => {
        const parsed = SnapshotResponseSchema.parse({
            workspaceId: 'workspace-1',
            snapshotId: 'snapshot-1',
            highWatermark: 42,
            items: [
                {
                    kind: 'row',
                    tableName: 'messages',
                    pk: 'message-1',
                    payload: { id: 'message-1', content: 'hello' },
                    revision: { clock: 3, hlc: '1000-0-device', opId: 'op-1' },
                },
                {
                    kind: 'tombstone',
                    tableName: 'threads',
                    pk: 'thread-deleted',
                    revision: { clock: 4, hlc: '1001-0-device', opId: 'op-2' },
                    serverDeletedAt: 1001,
                },
            ],
            nextPageToken: 'opaque-provider-token',
        });

        expect(parsed.highWatermark).toBe(42);
        expect(parsed.nextPageToken).toBe('opaque-provider-token');
    });

    it('rejects unbounded page sizes and invalid replay watermarks', () => {
        expect(() => SnapshotRequestSchema.parse({
            scope: { workspaceId: 'workspace-1' },
            pageSize: 1001,
        })).toThrow();
        expect(() => SnapshotResponseSchema.parse({
            workspaceId: 'workspace-1',
            snapshotId: 'snapshot-1',
            highWatermark: -1,
            items: [],
            nextPageToken: null,
        })).toThrow();
    });

    it('requires deterministic revision data for rows and tombstones', () => {
        expect(() => SnapshotResponseSchema.parse({
            workspaceId: 'workspace-1',
            snapshotId: 'snapshot-1',
            highWatermark: 1,
            items: [{
                kind: 'row',
                tableName: 'messages',
                pk: 'message-1',
                payload: {},
                revision: { clock: 1 },
            }],
            nextPageToken: null,
        })).toThrow();
    });
});
