import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { evictWorkspaceDb, getDb, setActiveWorkspaceDb } from '../client';
import { listImagePage, updateFileName } from '../files-select';

let workspace: string;
beforeEach(async () => {
    workspace = `file-query-${crypto.randomUUID()}`;
    await setActiveWorkspaceDb(workspace).open();
    await getDb().file_meta.put({ hash: 'image', name: 'original.png', kind: 'image', mime_type: 'image/png',
        size_bytes: 3, deleted: false, ref_count: 1, clock: 1, created_at: 1, updated_at: 1 });
});
afterEach(async () => {
    vi.restoreAllMocks(); setActiveWorkspaceDb(null); evictWorkspaceDb(workspace);
    await Dexie.delete(`or3-db-${workspace}`);
});

describe('file query ownership', () => {
    // Index selection yields before metadata hydration. Both must use one DB.
    it('hydrates an indexed page from its originating workspace', async () => {
        const db = getDb();
        const eachKey = db.Collection.prototype.eachKey;
        vi.spyOn(db.Collection.prototype, 'eachKey').mockImplementationOnce(function (this: typeof db.Collection.prototype, ...args) {
            return eachKey.apply(this, args).then(() => { setActiveWorkspaceDb(null); });
        });
        expect((await listImagePage({ state: 'active', sort: 'newest', limit: 10 })).items)
            .toMatchObject([{ hash: 'image', name: 'original.png' }]);
        expect(await db.file_meta.count()).toBe(1);
    });

    it('renames without overwriting a concurrent reference or deletion update', async () => {
        const db = getDb();
        const transaction = db.transaction.bind(db);
        vi.spyOn(db, 'transaction').mockImplementationOnce((...args) => {
            return db.file_meta.update('image', { deleted: true, ref_count: 4, clock: 5 }).then(() => transaction(...args));
        });
        // A stale pre-transaction read must not replace the newer whole row.
        await updateFileName('image', 'renamed.png');
        expect(await db.file_meta.get('image')).toMatchObject({ name: 'renamed.png', deleted: true, ref_count: 4, clock: 6 });
    });
});
