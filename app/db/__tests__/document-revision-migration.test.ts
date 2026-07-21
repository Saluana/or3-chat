import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { Or3DB } from '../client';

const names: string[] = [];

afterEach(async () => {
    await Promise.all(names.splice(0).map((name) => Dexie.delete(name)));
});

describe('document revision index migration', () => {
    it('upgrades v13 to v14 without modifying existing posts', async () => {
        const name = `document-revision-migration-${crypto.randomUUID()}`;
        names.push(name);
        const existing = {
            id: 'existing-document',
            title: 'Untouched document',
            content: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] }),
            postType: 'document',
            created_at: 10,
            updated_at: 20,
            deleted: false,
            clock: 7,
            meta: '[]',
            file_hashes: JSON.stringify(['sha256-image']),
        };

        const legacy = new Dexie(name);
        legacy.version(13).stores({
            posts: 'id, title, postType, deleted, created_at, updated_at',
        });
        await legacy.open();
        await legacy.table('posts').put(existing);
        legacy.close();

        const upgraded = new Or3DB(name);
        await upgraded.open();

        expect(await upgraded.posts.get(existing.id)).toEqual(existing);
        expect(await upgraded.posts.where('[postType+title]')
            .equals(['document', existing.title]).primaryKeys()).toEqual([existing.id]);

        upgraded.close();
    });
});
