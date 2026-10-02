import Dexie from 'dexie';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { getDb, setActiveWorkspaceDb, evictWorkspaceDb, Or3DB } from '../client';
import { ThreadSchema } from '../schema';
import { forkThread as anchoredFork, retryBranch } from '../branching';
import { forkThread as ordinaryFork, createThread, upsertThread } from '../threads';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { setHookEngine, useHooks } from '~/core/hooks/useHooks';
let workspace: string;
beforeEach(async () => {
    workspace = `fork-lineage-${crypto.randomUUID()}`;
    setHookEngine(createTypedHookEngine(createHookEngine()));
    await setActiveWorkspaceDb(workspace).open();
    const base = { status: 'ready', deleted: false, pinned: false, forked: false, created_at: 1, updated_at: 1, clock: 1 };
    await getDb().threads.bulkPut([
        { ...base, id: 'root' }, { ...base, id: 'legacy', parent_thread_id: 'root' },
        { ...base, id: 'compacted', parent_thread_id: 'legacy', root_thread_id: 'untrusted-denormalized',
            branch_mode: 'compacted', anchor_message_id: 'legacy-anchor', summary_message_id: 'parent-summary', fork_reason: 'compaction' },
    ]);
    await getDb().messages.bulkPut([
        { id: 'parent-summary', thread_id: 'compacted', role: 'system', index: 0, data: { content: 'Historical reference' }, pending: false, deleted: false, created_at: 1, updated_at: 1, clock: 1 },
        { id: 'own-anchor', thread_id: 'compacted', role: 'user', index: 1, data: { content: 'New question' }, pending: false, deleted: false, created_at: 1, updated_at: 1, clock: 1 },
    ]);
});
afterEach(async () => { const name = getDb().name; setActiveWorkspaceDb(null); evictWorkspaceDb(workspace); await Dexie.delete(name); setHookEngine(null); });

describe('ordinary forks after compaction', () => {
    it.each(['anchored', 'legacy'] as const)('clears summary-only pointers and stamps the real legacy root through %s fork', async (api) => {
        const child = api === 'anchored' ? (await anchoredFork({ sourceThreadId: 'compacted', anchorMessageId: 'own-anchor' })).thread
            : await ordinaryFork('compacted');
        expect(child).toMatchObject({ parent_thread_id: 'compacted', root_thread_id: 'root', summary_message_id: null, fork_reason: 'manual' });
        expect(child.branch_mode).toBe(api === 'anchored' ? 'reference' : null);
        expect(await getDb().threads.get('compacted')).toMatchObject({ summary_message_id: 'parent-summary', branch_mode: 'compacted' });
        expect(await getDb().messages.where('thread_id').equals(child.id).count()).toBe(0);
    });
    it('records retry provenance and protects a compacted boundary during ordinary upserts', async () => {
        await getDb().messages.put({ id: 'reply', thread_id: 'compacted', role: 'assistant', index: 2, data: { content: 'Answer' }, pending: false, deleted: false, created_at: 2, updated_at: 2, clock: 1 });
        const child = (await retryBranch({ assistantMessageId: 'reply' })).thread;
        expect(child).toMatchObject({ root_thread_id: 'root', fork_reason: 'retry', summary_message_id: null, branch_mode: 'reference' });
        const source = (await getDb().threads.get('compacted'))!;
        await upsertThread({ ...source, title: 'Renamed' });
        expect((await getDb().threads.get('compacted'))?.title).toBe('Renamed');
        await expect(upsertThread({ ...source, branch_mode: 'reference', summary_message_id: null })).rejects.toThrow(/atomic|validated/i);
        expect((await getDb().threads.get('compacted'))?.branch_mode).toBe('compacted');
    });
    it('rejects a before-action mutating a normal fork or create into a compacted boundary without writes', async () => {
        const count = await getDb().threads.count();
        const hooks = useHooks();
        hooks.addAction('db.threads.create:action:before', ({ entity }) => { entity.branch_mode = 'compacted'; });
        await expect(createThread({ title: 'Forged' })).rejects.toThrow(/atomic|validated/i);
        hooks.addAction('db.threads.fork:action:before', (payload) => { (payload as { fork: { branch_mode?: string | null } }).fork.branch_mode = 'compacted'; });
        await expect(ordinaryFork('legacy')).rejects.toThrow(/atomic|validated/i);
        expect(await getDb().threads.count()).toBe(count);
    });
    it('refuses generic create/upsert/fork and branch filters making unvalidated compacted threads', async () => {
        const count = await getDb().threads.count();
        await expect(createThread({ branch_mode: 'compacted', summary_message_id: 'forged' })).rejects.toThrow(/atomic|validated/i);
        await expect(ordinaryFork('legacy', { branch_mode: 'compacted', summary_message_id: 'forged' })).rejects.toThrow(/atomic|validated/i);
        const forged = ThreadSchema.parse({ id: 'forged', branch_mode: 'compacted', summary_message_id: 'forged-summary',
            status: 'ready', deleted: false, pinned: false, forked: true, created_at: 1, updated_at: 1, clock: 1 });
        await expect(upsertThread(forged)).rejects.toThrow(/atomic|validated/i);
        const hooks = useHooks();
        hooks.addFilter('branch.fork:filter:options', (options) => ({ ...options, mode: 'compacted' as const }));
        await expect(anchoredFork({ sourceThreadId: 'compacted', anchorMessageId: 'own-anchor' })).rejects.toThrow(/atomic|validated/i);
        expect(await getDb().threads.count()).toBe(count);
    });
});

describe('root index upgrade', () => {
    it('adds queryable lineage indexes without rewriting legacy rows or producing startup outbox records', async () => {
        const name = `root-index-upgrade-${crypto.randomUUID()}`;
        const legacy = new Dexie(name);
        legacy.version(20).stores({ threads: 'id, parent_thread_id', pending_ops: 'id, status, [status+readyAt+createdAt+id]' });
        await legacy.open();
        const row = { id: 'old-root', created_at: 1, updated_at: 1, clock: 9, status: 'ready', deleted: false, pinned: false, forked: false };
        const child = { ...row, id: 'old-child', parent_thread_id: 'old-root', root_thread_id: 'old-root' };
        await legacy.table('threads').bulkPut([row, child]); legacy.close();
        const upgraded = new Or3DB(name);
        try {
            await upgraded.open();
            expect(await upgraded.threads.get('old-root')).toEqual(row);
            expect(await upgraded.threads.where('root_thread_id').equals('old-root').primaryKeys()).toEqual(['old-child']);
            expect(await upgraded.pending_ops.count()).toBe(0);
        } finally { upgraded.close(); await Dexie.delete(name); }
    });
});
