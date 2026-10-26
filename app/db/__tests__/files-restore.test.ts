import 'fake-indexeddb/auto';
import { Blob as NodeBlob } from 'node:buffer';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { restoreMany, softDeleteFile, softDeleteMany, hardDeleteMany } from '../files';
import { commitDraftVersion, listDraftVersions, removeDraftVersion } from '../workspace-draft-recovery';
import { getDb } from '../client';
import type { FileMeta } from '../schema';

const mocks = vi.hoisted(() => ({
    doAction: vi.fn(async () => {}),
    applyFilters: vi.fn(async (_: string, val: any) => val),
    nowSec: 1234567890,
}));

vi.mock('../../core/hooks/useHooks', () => ({
    useHooks: () => ({
        doAction: mocks.doAction,
        applyFilters: mocks.applyFilters,
    }),
}));

vi.mock('../util', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../util')>();
    return {
        ...actual,
        nowSec: () => mocks.nowSec,
    };
});

describe('restoreMany', () => {
    beforeEach(async () => {
        const db = getDb();
        await db.open();
        await db.file_meta.clear();
        await db.file_blobs.clear();
        await db.tombstones.clear();
        await db.workspace_tab_drafts.clear();
        await db.workspace_draft_versions.clear();
        mocks.doAction.mockClear();
    });

    it('protects recovery-only attachment bytes through every deletion API until the exact version is discarded', async () => {
        const db = getDb();
        await db.file_meta.put({ hash: 'recovery-only', name: 'synthetic.png', kind: 'image', mime_type: 'image/png', size_bytes: 3, deleted: false, ref_count: 0, clock: 1, created_at: 1, updated_at: 1 });
        await db.file_blobs.put({ hash: 'recovery-only', blob: new NodeBlob(['png']) as unknown as Blob });
        await commitDraftVersion(db, { account: 'local', tab: 'orphan-attachment', writer: 'synthetic-file-owner', sequence: 1, archiveOnly: true,
            draft: { version: 1, text: 'recoverable file', attachments: [{ hash: 'recovery-only', name: 'synthetic.png', mime: 'image/png', kind: 'image' }], largeTextBlocks: [], updatedAt: 1 } });
        expect(await db.workspace_tab_drafts.count()).toBe(0);
        await expect(softDeleteFile('recovery-only')).rejects.toThrow('saved draft version');
        await expect(softDeleteMany(['recovery-only'])).rejects.toThrow('saved draft version');
        await expect(hardDeleteMany(['recovery-only'])).rejects.toThrow('saved draft version');
        expect((await db.file_blobs.get('recovery-only'))?.blob.size).toBe(3);
        await removeDraftVersion(db, 'local', (await listDraftVersions(db, 'local'))[0]!);
        expect(await hardDeleteMany(['recovery-only'])).toEqual(['recovery-only']);
        expect(await db.file_blobs.get('recovery-only')).toBeUndefined();
    });

    it('restores deleted files', async () => {
        const db = getDb();
        const metas: FileMeta[] = [
            {
                hash: 'h1',
                name: 'f1',
                kind: 'image',
                mime_type: 'image/png',
                size_bytes: 10,
                deleted: true,
                deleted_at: 1000,
                clock: 1,
                created_at: 1000,
                updated_at: 1000,
                ref_count: 1
            },
            {
                hash: 'h2',
                name: 'f2',
                kind: 'image',
                mime_type: 'image/png',
                size_bytes: 20,
                deleted: true,
                deleted_at: 1000,
                clock: 2,
                created_at: 1000,
                updated_at: 1000,
                ref_count: 1
            }
        ];
        await db.file_meta.bulkPut(metas);

        await restoreMany(['h1', 'h2']);

        const restored = await db.file_meta.bulkGet(['h1', 'h2']);
        expect(restored[0]!.deleted).toBe(false);
        expect(restored[0]!.updated_at).toBe(mocks.nowSec);
        expect(restored[0]!.clock).toBeGreaterThan(1);

        expect(restored[1]!.deleted).toBe(false);
        expect(restored[1]!.updated_at).toBe(mocks.nowSec);

        expect(mocks.doAction).toHaveBeenCalledTimes(4); // 2 before, 2 after
    });

    it('restores above a retained remote delete watermark even when the materialized row is older', async () => {
        const db = getDb();
        await db.file_meta.put({ hash: 'late-delete', name: 'restorable.txt', kind: 'file',
            mime_type: 'text/plain', size_bytes: 3, deleted: true, clock: 2,
            created_at: 1, updated_at: 1, ref_count: 1 });
        await db.tombstones.put({ id: 'file_meta:late-delete', tableName: 'file_meta',
            pk: 'late-delete', clock: 9, deletedAt: 100 });

        await restoreMany(['late-delete']);

        expect(await db.file_meta.get('late-delete')).toMatchObject({ deleted: false, clock: 10 });
    });

    it('ignores non-deleted files', async () => {
        const db = getDb();
        const metas: FileMeta[] = [
            {
                hash: 'h3',
                name: 'f3',
                kind: 'image',
                mime_type: 'image/png',
                size_bytes: 10,
                deleted: false, // Already active
                clock: 1,
                created_at: 1000,
                updated_at: 1000,
                ref_count: 1
            }
        ];
        await db.file_meta.put(metas[0]!);

        await restoreMany(['h3']);

        const meta = await db.file_meta.get('h3');
        expect(meta!.updated_at).toBe(1000); // Not changed
        expect(mocks.doAction).not.toHaveBeenCalled();
    });

    it('handles missing files gracefully', async () => {
        await restoreMany(['missing-hash']);
        expect(mocks.doAction).not.toHaveBeenCalled();
    });
});
