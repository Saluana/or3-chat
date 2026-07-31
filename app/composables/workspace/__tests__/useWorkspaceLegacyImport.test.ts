import { afterEach, describe, expect, it, vi } from 'vitest';
import { Or3DB } from '~/db/client';
import { _resetHookBridge } from '~/core/sync/hook-bridge';
import { copyLegacyWorkspaceData } from '../useWorkspaceLegacyImport';

vi.mock('~/core/hooks/useHooks', () => ({
    useHooks: () => ({
        _engine: {
            applyFiltersSync: (_key: string, value: unknown) => value,
        },
        doAction: async () => undefined,
    }),
}));

const databases: Or3DB[] = [];

function createDb(prefix: string): Or3DB {
    const db = new Or3DB(`${prefix}-${crypto.randomUUID()}`);
    databases.push(db);
    return db;
}

afterEach(async () => {
    _resetHookBridge();
    await Promise.all(
        databases.splice(0).map(async (db) => {
            db.close();
            await db.delete();
        })
    );
});

describe('copyLegacyWorkspaceData', () => {
    it('copies legacy rows and atomically queues synced entities for upload', async () => {
        const source = createDb('legacy-source');
        const target = createDb('legacy-target');
        await Promise.all([source.open(), target.open()]);

        await source.projects.put({
            id: 'project-1',
            name: 'Legacy project',
            data: {},
            created_at: 1,
            updated_at: 1,
            deleted: false,
            clock: 1,
        });
        await source.threads.put({
            id: 'thread-1',
            title: 'Legacy chat',
            created_at: 1,
            updated_at: 1,
            status: 'ready',
            deleted: false,
            pinned: false,
            forked: false,
            clock: 1,
        });
        await source.messages.put({
            id: 'message-1',
            thread_id: 'thread-1',
            role: 'user',
            index: 0,
            data: { content: 'legacy message' },
            pending: false,
            created_at: 1,
            updated_at: 1,
            deleted: false,
            clock: 1,
        });
        await source.posts.put({
            id: 'document-1',
            title: 'Legacy document',
            content: '',
            postType: 'doc',
            meta: '[]',
            created_at: 1,
            updated_at: 1,
            deleted: false,
            clock: 1,
        });

        await expect(copyLegacyWorkspaceData(source, target)).resolves.toEqual({
            threads: 1,
            messages: 1,
            projects: 1,
        });

        expect(await target.projects.get('project-1')).toBeDefined();
        expect(await target.threads.get('thread-1')).toBeDefined();
        expect(await target.messages.get('message-1')).toBeDefined();
        expect(await target.posts.get('document-1')).toMatchObject({
            postType: 'doc',
        });

        const pending = await target.pending_ops.toArray();
        expect(pending.map((op) => op.tableName).sort()).toEqual([
            'messages',
            'posts',
            'projects',
            'threads',
        ]);
        expect(
            pending.every(
                (op) =>
                    op.status === 'pending' &&
                    Boolean(op.stamp.hlc) &&
                    Boolean(op.stamp.opId)
            )
        ).toBe(true);
    });
});
