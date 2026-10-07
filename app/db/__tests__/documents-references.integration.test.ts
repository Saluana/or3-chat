import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    evictWorkspaceDb,
    setActiveWorkspaceDb,
    type Or3DB,
} from '~/db/client';
import type { Post } from '../schema';
import { reportError } from '~/utils/errors';
import {
    DocumentConflictError,
    getDocumentInDb,
    listDocumentFileHashes,
    updateDocument,
    updateDocumentInDb,
} from '../documents';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { setHookEngine } from '~/core/hooks/useHooks';

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

describe('document storage integrity and reference reads', () => {
    let db: Or3DB;
    let workspaceId: string;
    let postReads = 0;
    let hooks: ReturnType<typeof createTypedHookEngine>;

    beforeEach(async () => {
        hooks = createTypedHookEngine(createHookEngine());
        setHookEngine(hooks);
        // tests/setup.ts replaces reportError with a spy; dbTry reports failures through it.
        vi.mocked(reportError).mockClear();
        workspaceId = `doc-refs-${crypto.randomUUID()}`;
        db = setActiveWorkspaceDb(workspaceId);
        await db.open();
        db.posts.hook('reading', (value) => {
            postReads += 1;
            return value;
        });
    });

    afterEach(async () => {
        hooks.removeAllCallbacks();
        setHookEngine(null);
        setActiveWorkspaceDb(null);
        evictWorkspaceDb(workspaceId);
        await Dexie.delete(db.name);
    });

    // A sidebar rename calls updateDocument without an expected editor snapshot;
    // the editor supplies one. Another writer can delete or edit the row while
    // the async hooks prepare the update.
    // Failure cases: the stale write overwrites or recreates the row; the
    // rejection is untyped so callers cannot tell a conflict from a failure; a
    // routine conflict is reported as a database failure; an uncontended update
    // is rejected by a false-positive compare; a genuine write failure goes
    // unreported. Exercise the real public helpers, hook barrier and Dexie.
    it.each([
        ['delete', false],
        ['edit', false],
        ['delete', true],
        ['edit', true],
    ] as const)('rejects a concurrent %s with a conflict and writes nothing (editor snapshot: %s)', async (change, withSnapshot) => {
        await db.posts.put(doc('racing-doc'));
        const current = await getDocumentInDb(db, 'racing-doc');
        let resume!: () => void;
        let entered!: () => void;
        const reached = new Promise<void>((resolve) => { entered = resolve; });
        const gate = new Promise<void>((resolve) => { resume = resolve; });
        hooks.addAction('db.documents.update:action:before', async () => {
            entered();
            await gate;
        });
        const patch = { title: 'Late rename' };
        const pending = withSnapshot
            ? updateDocumentInDb(db, 'racing-doc', patch, { title: current!.title, content: current!.content })
            : updateDocument('racing-doc', patch);
        const outcome = pending.then(value => ({ value, error: undefined as unknown }), error => ({ value: undefined, error }));
        await reached;
        if (change === 'delete') await db.posts.delete('racing-doc');
        else await db.posts.update('racing-doc', { content: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Newer work' }] }] }), clock: 2 });
        const beforeResume = await db.posts.get('racing-doc');
        resume();
        const result = await outcome;
        expect(result.error).toBeInstanceOf(DocumentConflictError);
        expect(await db.posts.get('racing-doc')).toEqual(beforeResume);
        // A routine conflict is not a database failure and must not be reported as one.
        expect(reportError).not.toHaveBeenCalled();
    });

    it('persists an uncontended update that supplies no editor snapshot', async () => {
        await db.posts.put(doc('plain-doc'));
        const updated = await updateDocument('plain-doc', { title: 'Renamed' });
        expect(updated?.title).toBe('Renamed');
        const stored = await db.posts.get('plain-doc');
        expect(stored).toMatchObject({ title: 'Renamed', content: doc('plain-doc').content });
        expect(stored!.clock).toBeGreaterThan(1);
        expect(reportError).not.toHaveBeenCalled();
    });

    it('still reports a genuine write failure as a database error', async () => {
        await db.posts.put(doc('failing-doc'));
        vi.spyOn(db.posts, 'put').mockRejectedValueOnce(new Error('disk exploded'));
        await expect(updateDocument('failing-doc', { title: 'Never saved' })).rejects.toThrow('disk exploded');
        expect(reportError).toHaveBeenCalledWith(
            expect.objectContaining({ code: 'ERR_DB_WRITE_FAILED' }),
            expect.anything()
        );
        expect((await db.posts.get('failing-doc'))?.title).toBe('failing-doc');
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
