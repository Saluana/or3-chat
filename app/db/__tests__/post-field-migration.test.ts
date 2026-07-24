import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { Or3DB } from '../client';

const databaseNames: string[] = [];

afterEach(async () => {
    await Promise.all(
        databaseNames.splice(0).map((name) => Dexie.delete(name))
    );
});

describe('posts wire-field migration', () => {
    it('repairs snapshot rows that used post_type before the client mapping fix', async () => {
        const name = `post-field-migration-${crypto.randomUUID()}`;
        databaseNames.push(name);

        const legacy = new Dexie(name);
        legacy.version(14).stores({
            posts: 'id, title, postType, [postType+title], deleted, created_at, updated_at',
        });
        await legacy.open();
        await legacy.table('posts').put({
            id: 'document-1',
            title: 'Recovered document',
            content: '',
            post_type: 'doc',
            deleted: false,
            created_at: 1,
            updated_at: 1,
            clock: 1,
            hlc: '1:0:remote',
            op_id: 'op-1',
        });
        legacy.close();

        const upgraded = new Or3DB(name);
        await upgraded.open();

        expect(await upgraded.posts.get('document-1')).toMatchObject({
            postType: 'doc',
        });
        expect(await upgraded.posts.get('document-1')).not.toHaveProperty(
            'post_type'
        );
        expect(
            await upgraded.posts.where('postType').equals('doc').count()
        ).toBe(1);

        upgraded.close();
    });
});
