import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    evictWorkspaceDb,
    setActiveWorkspaceDb,
    type Or3DB,
} from '~/db/client';
import type { Post } from '../schema';
import { listDocumentFileHashes } from '../documents';

function doc(
    id: string,
    overrides: Partial<Post> = {}
): Post {
    return {
        id,
        title: id,
        content: JSON.stringify({ type: 'doc', content: [] }),
        postType: 'doc',
        created_at: 1,
        updated_at: 1,
        deleted: false,
        clock: 1,
        meta: '',
        file_hashes: JSON.stringify(['sha256:a']),
        ...overrides,
    } as Post;
}

describe('reference-only document reads', () => {
    let db: Or3DB;
    let workspaceId: string;
    let postReads = 0;

    beforeEach(async () => {
        workspaceId = `doc-refs-${crypto.randomUUID()}`;
        db = setActiveWorkspaceDb(workspaceId);
        await db.open();
        db.posts.hook('reading', (value) => {
            postReads += 1;
            return value;
        });
    });

    afterEach(async () => {
        setActiveWorkspaceDb(null);
        evictWorkspaceDb(workspaceId);
        await Dexie.delete(db.name);
    });

    it('deduplicates active document references with zero post value reads', async () => {
        await db.posts.bulkPut([
            doc('doc-1', {
                file_hashes: JSON.stringify(['sha256:a', 'sha256:b']),
            }),
            doc('doc-2', {
                file_hashes: JSON.stringify(['sha256:b', 'sha256:c']),
            }),
            doc('deleted-doc', {
                deleted: true,
                file_hashes: JSON.stringify(['sha256:deleted']),
            }),
            doc('prompt-1', {
                postType: 'prompt',
                file_hashes: JSON.stringify(['sha256:prompt']),
            }),
            doc('revision-1', {
                postType: 'or3-tactics:revision',
                file_hashes: JSON.stringify(['sha256:revision']),
            }),
            doc('empty-1', { file_hashes: '' }),
            doc('missing-1', { file_hashes: null }),
            doc('malformed-1', { file_hashes: '{not-json' }),
        ]);

        postReads = 0;
        const hashes = (await listDocumentFileHashes()).sort();
        expect(hashes).toEqual(['sha256:a', 'sha256:b', 'sha256:c']);
        expect(postReads).toBe(0);
    });

    it('never touches multi-megabyte document bodies', async () => {
        const huge = JSON.stringify({
            type: 'doc',
            content: [
                {
                    type: 'paragraph',
                    content: [
                        { type: 'text', text: 'x'.repeat(4_000_000) },
                    ],
                },
            ],
        });
        await db.posts.put(doc('huge-doc', { content: huge }));

        postReads = 0;
        const started = Date.now();
        const hashes = await listDocumentFileHashes();
        const elapsed = Date.now() - started;

        expect(hashes).toEqual(['sha256:a']);
        expect(postReads).toBe(0);
        // Reference reads must not scale with body size.
        expect(elapsed).toBeLessThan(500);
    });

    it('returns an empty list when no active document references exist', async () => {
        await db.posts.put(
            doc('deleted-only', { deleted: true, file_hashes: '["sha256:x"]' })
        );
        postReads = 0;
        expect(await listDocumentFileHashes()).toEqual([]);
        expect(postReads).toBe(0);
    });
});
