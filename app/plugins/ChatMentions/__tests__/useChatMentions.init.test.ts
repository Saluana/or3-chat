import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { evictWorkspaceDb, getDb, setActiveWorkspaceDb } from '~/db/client';

import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { setHookEngine, useHooks } from '~/core/hooks/useHooks';
vi.mock('#imports', async () => ({ useAppConfig: () => ({}), useHooks: (await import('~/core/hooks/useHooks')).useHooks }));
vi.mock('~/composables/useOr3Config', () => ({ useOr3Config: () => ({ features: { mentions: { enabled: true } } }), isMentionSourceEnabled: () => true }));
const mocks = vi.hoisted(() => ({
    createDb: vi.fn(),
    buildIndex: vi.fn(),
    searchWithIndex: vi.fn(),
    reportError: vi.fn(),
}));

vi.mock('~/core/search/orama', () => ({
    createDb: mocks.createDb,
    buildIndex: mocks.buildIndex,
    searchWithIndex: mocks.searchWithIndex,
}));

vi.mock('~/utils/errors', () => ({
    reportError: mocks.reportError,
    err: (code: string, message: string) => Object.assign(new Error(message), { code }),
}));

import {
    initMentionsIndex,
    resetIndex,
    searchMentions,
} from '../useChatMentions';

describe('mentions index initialization', () => {
    let workspaceId: string;
    let databaseName: string;
    beforeEach(async () => {
        resetIndex();
        vi.clearAllMocks();
        mocks.createDb.mockResolvedValue({ kind: 'mentions-db' });
        workspaceId = `mentions-owner-${crypto.randomUUID()}`;
        const db = setActiveWorkspaceDb(workspaceId);
        databaseName = db.name;
        await db.posts.put({ id: 'doc-1', postType: 'doc', title: 'Document one', content: '',
            clock: 1, created_at: 1, updated_at: 1, deleted: false });
        await db.threads.put({ id: 'thread-1', title: 'Thread one', clock: 1,
            created_at: 1, updated_at: 1, deleted: false, status: 'ready', pinned: false, forked: false });
        mocks.buildIndex.mockResolvedValue(undefined);
        mocks.searchWithIndex.mockResolvedValue([]);
    });
    afterEach(async () => {
        resetIndex(); setActiveWorkspaceDb(null); evictWorkspaceDb(workspaceId);
        await Dexie.delete(databaseName);
    });

    it('indexes only saved files with a live original metadata row', async () => {
        const db = getDb();
        const hash = `sha256:${'a'.repeat(64)}`;
        await db.file_meta.put({ hash, name: 'Saved file', mime_type: 'text/plain', kind: 'file', size_bytes: 4,
            ref_count: 1, clock: 1, created_at: 1, updated_at: 1, deleted: false });
        await db.posts.put({ id: 'saved-file', postType: 'or3:file', title: 'Saved file', content: 'text',
            file_hashes: JSON.stringify([hash]), clock: 1, created_at: 1, updated_at: 1, deleted: false });
        await initMentionsIndex();
        expect(mocks.buildIndex.mock.calls.at(-1)?.[1]).toContainEqual(expect.objectContaining({ id: 'saved-file', source: 'file' }));
        await db.file_meta.update(hash, { deleted: true });
        resetIndex(); await initMentionsIndex();
        expect(mocks.buildIndex.mock.calls.at(-1)?.[1]).not.toContainEqual(expect.objectContaining({ id: 'saved-file' }));
    });

    it.each(['sync.pull:action:applied', 'sync.bootstrap:action:complete', 'sync.rescan:action:completed'] as const)
        ('refreshes a warm mention index after %s without local CRUD hooks', async event => {
        setHookEngine(createTypedHookEngine(createHookEngine()));
        let dispose: (() => void) | undefined;
        try {
            const plugin = (await import('../../mentions.client')).default;
            await (plugin as any)({ vueApp: { onUnmount: (callback: () => void) => { dispose = callback; } } });
            await useHooks().doAction('editor:request-extensions');
            const before = mocks.buildIndex.mock.calls.length;
            expect(before).toBe(1);
            const hash = 'sha256:' + 'b'.repeat(64);
            await getDb().file_meta.put({ hash, name: 'Remote', mime_type: 'text/plain', kind: 'file', size_bytes: 4,
                ref_count: 1, clock: 1, created_at: 1, updated_at: 1, deleted: false });
            await getDb().posts.put({ id: 'remote-file', postType: 'or3:file', title: 'Remote', content: 'text',
                file_hashes: JSON.stringify([hash]), clock: 1, created_at: 1, updated_at: 1, deleted: false });
            await useHooks().doAction(event, { scope: { workspaceId } } as never);
            await vi.waitFor(() => expect(mocks.buildIndex.mock.calls.at(-1)?.[1]).toContainEqual(expect.objectContaining({ id: 'remote-file', source: 'file' })));
        } finally { dispose?.(); setHookEngine(null); }
    });

    it('shares one in-flight build across concurrent callers', async () => {
        const first = initMentionsIndex();
        const second = initMentionsIndex();

        await Promise.all([first, second]);

        expect(first).toBe(second);
        expect(mocks.createDb).toHaveBeenCalledTimes(1);
        expect(mocks.buildIndex).toHaveBeenCalledTimes(1);
    });

    it('does not publish an initialization invalidated by resetIndex', async () => {
        let finishBuild: (() => void) | undefined;
        mocks.buildIndex.mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    finishBuild = resolve;
                })
        );

        const initializing = initMentionsIndex();
        await vi.waitFor(() => expect(finishBuild).toBeTypeOf('function'));

        resetIndex();
        finishBuild?.();
        await initializing;
        await searchMentions('document');

        expect(mocks.searchWithIndex).not.toHaveBeenCalled();
    });
});
