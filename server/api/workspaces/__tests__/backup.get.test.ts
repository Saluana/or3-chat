// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';
import type { Readable } from 'node:stream';
import { scanCloudBackup } from '~~/shared/storage/workspace-archive';

vi.mock('h3', async (importOriginal) => ({
    ...await importOriginal<typeof import('h3')>(),
    defineEventHandler: (handler: unknown) => handler,
    getQuery: () => ({ workspaceId: 'ws-audit' }),
    setResponseHeader: vi.fn(),
    sendStream: (_event: unknown, stream: Readable) => stream,
}));
const { backupSnapshot } = vi.hoisted(() => ({ backupSnapshot: vi.fn() }));
vi.mock('../_helpers', () => ({
    requireWorkspaceSession: async () => ({ user: { id: 'user-audit' }, workspace: { id: 'ws-audit', name: 'Audit' } }),
}));
vi.mock('../../../utils/storage/workspace-access', () => ({ requireStorageWorkspaceAccess: vi.fn() }));
vi.mock('../../../sync/gateway/registry', () => ({ getActiveSyncGatewayAdapter: () => ({ backupSnapshot }) }));
vi.mock('../../../storage/gateway/registry', () => ({ getActiveStorageGatewayAdapter: () => undefined }));
vi.mock('../../../utils/headers', () => ({ setNoCacheHeaders: vi.fn() }));
vi.mock('../../../utils/sync/is-sync-enabled', () => ({ isSyncEnabled: () => true }));
vi.mock('../../../utils/rate-limit/enforce', () => ({ enforceRateLimit: vi.fn() }));
vi.mock('../../../utils/sync/rate-limiter', () => ({ checkSyncRateLimit: vi.fn(), recordSyncRequest: vi.fn() }));

// Failure boundaries: background rows can omit ordering, explicit keys must stay
// unchanged, and malformed required fields must still reject the whole export.
describe('GET /api/workspaces/backup message ordering', () => {
    const hlc = '1730000000000:00000:server';
    let payload: Record<string, unknown>;
    beforeEach(() => {
        payload = {
            id: 'assistant-audit', thread_id: 'thread-audit', role: 'assistant',
            index: 1, deleted: false, created_at: 1, updated_at: 2, clock: 2,
            data: { content: 'Background reply' },
        };
        backupSnapshot.mockReset().mockImplementation(async () => ({
            workspaceId: 'ws-audit', snapshotId: 'snapshot-audit', highWatermark: 2,
            nextPageToken: null,
            items: [{ kind: 'row', tableName: 'messages', pk: payload.id, payload,
                revision: { clock: 2, hlc, opId: 'op-audit' } }],
        }));
    });

    async function exportRows() {
        const handler = (await import('../backup.get')).default;
        const stream = await handler({ context: {} } as H3Event) as unknown as Readable;
        const chunks: Uint8Array<ArrayBuffer>[] = [];
        for await (const chunk of stream) chunks.push(new Uint8Array(chunk));
        const rows: Record<string, unknown>[] = [];
        await scanCloudBackup(new Blob(chunks), async frame => {
            if (frame.row) rows.push(frame.row);
        });
        return rows;
    }

    it('exports background messages using their snapshot revision without mutating source rows', async () => {
        const rows = await exportRows();
        expect(rows).toMatchObject([{ id: 'assistant-audit', order_key: hlc, data: { content: 'Background reply' } }]);
        expect(payload).not.toHaveProperty('order_key');
    });

    it('preserves an explicit message order key', async () => {
        payload.order_key = 'original-order';
        expect(await exportRows()).toMatchObject([{ order_key: 'original-order' }]);
    });

    it('still rejects malformed message payloads', async () => {
        delete payload.thread_id;
        await expect(exportRows()).rejects.toThrow();
    });
});
