import Dexie from 'dexie';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { getWriteTxTableNames } from '../util';
import { getDb, setActiveWorkspaceDb, evictWorkspaceDb } from '../client';
import { getHookBridge, _resetHookBridge } from '~/core/sync/hook-bridge';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { setHookEngine, useHooks } from '~/core/hooks/useHooks';
import { captureCompaction, validateCompactionSummary, createCompactedFork } from '../compaction';
let workspace: string;
beforeEach(async () => {
    workspace = `compacted-write-${crypto.randomUUID()}`;
    setHookEngine(createTypedHookEngine(createHookEngine()));
    await setActiveWorkspaceDb(workspace).open();
    await getDb().threads.put({ id: 'source', title: 'Original', status: 'ready', deleted: false, pinned: true, forked: false,
        created_at: 1, updated_at: 1, clock: 1, project_id: 'project', system_prompt_id: 'prompt' });
    for (let index = 0; index < 4; index += 1) await getDb().messages.put({ id: `m${index}`, thread_id: 'source', index,
        role: index % 2 ? 'assistant' : 'user', data: { content: `Message${index} ${'Detailed task evidence '.repeat(300)}` },
        deleted: false, pending: false, clock: 1, created_at: 1, updated_at: 1, order_key: `1:${index}` });
    getHookBridge(getDb()).start();
});
afterEach(async () => { _resetHookBridge(); const name = getDb().name; setActiveWorkspaceDb(null); evictWorkspaceDb(workspace); await Dexie.delete(name); setHookEngine(null); });
const markdown = '## Objective\nComplete the task.\n## Important Details\nPreserve exact evidence.\n## Work State\nTwo turns settled.\n## Next Move\nContinue implementation.\n## Relevant Files\nNone.';
const countText = async (text: string) => Math.ceil(text.length / 4);
async function prepared(sourceThreadId = 'source', anchorMessageId = 'm3') {
    const capture = await captureCompaction({ sourceThreadId, anchorMessageId, model: 'large-model' });
    const summary = await validateCompactionSummary(capture, JSON.stringify({ summary_markdown: markdown,
        landmarks: [{ message_id: sourceThreadId === 'source' ? 'm0' : 'new0', kind: 'decision', summary: 'Task evidence' }] }),
        { targetTokens: 4096, countText });
    return { capture, summary };
}
describe('atomic compacted fork', () => {
    it('commits one summary and child/outbox, leaves originals intact, replays the same operation and permits separate siblings', async () => {
        const originalThread = await getDb().threads.get('source'); const originals = await getDb().messages.toArray();
        const first = await prepared(); const committed = await createCompactedFork(first);
        expect(committed.thread).toMatchObject({ branch_mode: 'compacted', parent_thread_id: 'source', root_thread_id: 'source',
            anchor_message_id: 'm3', summary_message_id: committed.summary.id, fork_reason: 'compaction', deleted: false, status: 'ready', pinned: false,
            project_id: 'project', system_prompt_id: 'prompt' });
        expect(committed.summary).toMatchObject({ role: 'system', thread_id: committed.thread.id, index: 0, pending: false,
            data: { kind: 'compaction', compaction: { source_thread_id: 'source', model: 'large-model' } } });
        expect(committed.summary.order_key).toBeTruthy(); expect(committed.summary.hlc).toBeTruthy();
        expect(await getDb().threads.get('source')).toEqual(originalThread);
        expect(await getDb().messages.where('thread_id').equals('source').toArray()).toEqual(originals);
        const operations = await getDb().pending_ops.toArray(); expect(operations).toHaveLength(2);
        expect(new Set(operations.map((row) => row.tableName))).toEqual(new Set(['threads', 'messages']));
        const replay = await createCompactedFork(first); expect(replay.thread.id).toBe(committed.thread.id);
        expect(await getDb().pending_ops.count()).toBe(2);
        expect((await createCompactedFork(await prepared())).thread.id).not.toBe(committed.thread.id);
    });
    it.each(['edit', 'insert', 'reindex', 'delete', 'pending'] as const)('refuses changed selected membership/eligibility (%s) without partial writes', async (change) => {
        const value = await prepared();
        await getDb().transaction('rw', getWriteTxTableNames(getDb(), 'messages', { includeTombstones: true }), async () => {
        if (change === 'edit') await getDb().messages.update('m1', { data: { content: 'Changed without a thread clock bump' } });
        if (change === 'insert') await getDb().messages.put({ id: 'insert', thread_id: 'source', role: 'user', index: 1, order_key: '1:insert', data: { content: 'Inserted before anchor' }, pending: false, deleted: false, clock: 1, created_at: 1, updated_at: 1 });
        if (change === 'reindex') await getDb().messages.update('m1', { index: 9000 });
        if (change === 'delete') await getDb().messages.delete('m1');
        if (change === 'pending') await getDb().messages.update('m3', { pending: true });
        });
        const before = await getDb().pending_ops.count();
        await expect(createCompactedFork(value)).rejects.toThrow(/stale|settled|pending|changed/i);
        expect(await getDb().threads.count()).toBe(1); expect(await getDb().messages.where('thread_id').notEqual('source').count()).toBe(0);
        expect(await getDb().pending_ops.count()).toBe(before);
    });
    it('rolls back a real second-write failure, including captured outbox records, then can retry the preallocated operation', async () => {
        const value = await prepared();
        const failSummary = (_key: unknown, row: { thread_id?: string }) => { if (row.thread_id !== 'source') throw new Error('Summary write failed'); };
        getDb().messages.hook('creating', failSummary);
        await expect(createCompactedFork(value)).rejects.toThrow(/Summary write failed/);
        expect(await getDb().threads.count()).toBe(1); expect(await getDb().messages.count()).toBe(4); expect(await getDb().pending_ops.count()).toBe(0);
        getDb().messages.hook('creating').unsubscribe(failSummary);
        expect((await createCompactedFork(value)).thread.id).toBe(value.capture.childThreadId);
    });
    it('cancels during the actual child write and rejects A→B→A with the same DB handle', async () => {
        const value = await prepared(); const controller = new AbortController();
        const cancelWrite = (_key: unknown, row: { branch_mode?: string }) => { if (row.branch_mode === 'compacted') controller.abort(); };
        getDb().threads.hook('creating', cancelWrite);
        await expect(createCompactedFork({ ...value, signal: controller.signal })).rejects.toThrow(/cancel|abort/i);
        getDb().threads.hook('creating').unsubscribe(cancelWrite);
        expect(await getDb().threads.count()).toBe(1); expect(await getDb().pending_ops.count()).toBe(0);
        const other = `other-${crypto.randomUUID()}`; const otherDb = setActiveWorkspaceDb(other); await otherDb.open(); setActiveWorkspaceDb(workspace);
        try { await expect(createCompactedFork(value)).rejects.toThrow(/workspace|stale/i); }
        finally { evictWorkspaceDb(other); await Dexie.delete(otherDb.name); }
        expect(await getDb().threads.count()).toBe(1);
    });
    it('returns a committed child despite a post-action failure or later cancellation', async () => {
        const value = await prepared(); const controller = new AbortController();
        useHooks().addAction('branch.fork:action:after', () => { controller.abort(); throw new Error('Post-commit navigation failed'); });
        const committed = await createCompactedFork({ ...value, signal: controller.signal });
        expect(await getDb().threads.get(committed.thread.id)).toBeTruthy();
        expect((await createCompactedFork({ ...value, signal: controller.signal })).thread.id).toBe(committed.thread.id);
    });
    it('rolls scope forward by referencing the validated prior summary instead of duplicating its old IDs', async () => {
        const first = await createCompactedFork(await prepared());
        await getDb().transaction('rw', getWriteTxTableNames(getDb(), 'messages'), async () => {
        for (let index = 0; index < 4; index += 1) await getDb().messages.put({ id: `new${index}`, thread_id: first.thread.id, index: index + 1,
            role: index % 2 ? 'assistant' : 'user', data: { content: 'New settled task facts '.repeat(300) }, pending: false, deleted: false, clock: 1, created_at: 2, updated_at: 2 });
        });
        const second = await prepared(first.thread.id, 'new3');
        expect(second.capture.historyScope.inherited_scope_message_id).toBe(first.summary.id);
        expect(second.capture.historyScope.segments.flatMap((part) => part.messages.map((row) => row.message_id))).toEqual(['new0', 'new1', 'new2', 'new3']);
        const committed = await createCompactedFork(second);
        expect(committed.thread.root_thread_id).toBe('source');
        expect((committed.summary.data as { compaction: { history_scope: unknown } }).compaction.history_scope).toEqual(second.capture.historyScope);
    });
    it('rejects a branch filter changing the prepared source before any commit', async () => {
        const value = await prepared();
        useHooks().addFilter('branch.fork:filter:options', (options) => ({ ...options, sourceThreadId: 'foreign' }));
        await expect(createCompactedFork(value)).rejects.toMatchObject({ code: 'stale_source' });
        expect(await getDb().threads.count()).toBe(1); expect(await getDb().pending_ops.count()).toBe(0);
    });
    it('blocks source-level pending tools even when the requested anchor precedes that exchange', async () => {
        await getDb().transaction('rw', getWriteTxTableNames(getDb(), 'messages'), () => getDb().messages.put({
            id: 'later-call', thread_id: 'source', role: 'assistant', index: 4, data: { content: '', tool_calls: [{ id: 'pending-call', name: 'lookup', args: '{}', status: 'pending' }] },
            pending: false, deleted: false, clock: 1, created_at: 2, updated_at: 2 }));
        await expect(captureCompaction({ sourceThreadId: 'source', anchorMessageId: 'm3', model: 'large-model' })).rejects.toMatchObject({ code: 'source_busy' });
        expect(await getDb().threads.count()).toBe(1);
    });
    it.each([
        { summary_markdown: `~~~\n${markdown}\n~~~`, landmarks: [{ message_id: 'm0', kind: 'decision', summary: 'Evidence' }] },
        { summary_markdown: markdown, landmarks: [{ message_id: 'm0', kind: 'decision', summary: 'x'.repeat(201) }] },
        { summary_markdown: markdown, landmarks: [{ message_id: 'foreign', kind: 'decision', summary: 'Unrelated' }] },
        { summary_markdown: markdown, landmarks: [{ message_id: 'm0', kind: 'decision', summary: 'Evidence', thread_id: 'forged' }] },
    ])('rejects invalid model sections or model-authored/out-of-scope landmarks before writes %#', async (response) => {
        const { capture } = await prepared();
        await expect(validateCompactionSummary(capture, JSON.stringify(response), { targetTokens: 4096, countText })).rejects.toMatchObject({ code: 'invalid_summary' });
        expect(await getDb().threads.count()).toBe(1); expect(await getDb().pending_ops.count()).toBe(0);
    });
    it('derives trusted landmark ownership, discards unrelated/duplicate IDs and accepts code bodies under real headings', async () => {
        const { capture } = await prepared();
        const summary = await validateCompactionSummary(capture, JSON.stringify({ summary_markdown: markdown.replace('None.', '```text\napp/main.ts\n```'),
            landmarks: [{ message_id: 'foreign', kind: 'decision', summary: 'Unrelated' }, { message_id: 'm0', kind: 'code', summary: 'Exact evidence' },
                { message_id: 'm0', kind: 'decision', summary: 'Duplicate' }] }), { targetTokens: 4096, countText });
        expect(summary.discardedLandmarks).toBe(2);
        const committed = await createCompactedFork({ capture, summary });
        expect((committed.summary.data as { compaction: { landmarks: unknown[] } }).compaction.landmarks).toEqual([
            { message_id: 'm0', kind: 'code', summary: 'Exact evidence', index: 0, role: 'user', thread_id: 'source' },
        ]);
    });
    it('refuses a copied prior scope pointing outside the actual parent path', async () => {
        const first = await createCompactedFork(await prepared());
        await getDb().transaction('rw', getWriteTxTableNames(getDb(), 'messages'), async () => {
            for (let index = 0; index < 4; index += 1) await getDb().messages.put({ id: `new${index}`, thread_id: first.thread.id, index: index + 1,
                role: index % 2 ? 'assistant' : 'user', data: { content: 'New task evidence '.repeat(300) }, pending: false, deleted: false, clock: 1, created_at: 2, updated_at: 2 });
            const data = first.summary.data as { compaction: Record<string, unknown> };
            await getDb().messages.update(first.summary.id, { data: { ...data, compaction: { ...data.compaction,
                history_scope: { version: 1, segments: [{ thread_id: 'sibling', messages: [{ message_id: 'foreign', clock: 1 }] }] } } } });
        });
        await expect(captureCompaction({ sourceThreadId: first.thread.id, anchorMessageId: 'new3', model: 'large-model' })).rejects.toMatchObject({ code: 'scope_incomplete' });
        expect(await getDb().threads.count()).toBe(2);
    });
    it('rejects the complete stored row at the real256KiB boundary without truncating its captured membership', async () => {
        _resetHookBridge();
        const rows = Array.from({ length: 3000 }, (_, offset) => ({ id: `historical-${offset}-${'r'.repeat(90)}`, thread_id: 'source', index: offset + 4,
            role: offset % 2 ? 'assistant' : 'user', data: { content: 'Settled task history with exact evidence.' },
            pending: false, deleted: false, clock: 1, created_at: 1, updated_at: 1 }));
        await getDb().messages.bulkPut(rows); getHookBridge(getDb()).start();
        const value = await prepared('source', rows.at(-1)!.id);
        expect(value.capture.historyScope.segments[0]!.messages).toHaveLength(3004);
        await expect(createCompactedFork(value)).rejects.toMatchObject({ code: 'summary_too_large' });
        expect(await getDb().threads.count()).toBe(1); expect(await getDb().pending_ops.count()).toBe(0);
        expect(await getDb().messages.count()).toBe(3004);
    });
    it('rejects forged summaries, oversized persisted artifacts and inactive sources before mutation', async () => {
        const value = await prepared();
        await expect(createCompactedFork({ ...value, summary: { ...value.summary } })).rejects.toThrow(/validated|capture/i);
        await expect(validateCompactionSummary(value.capture, JSON.stringify({ summary_markdown: `${markdown}\n${'x'.repeat(270000)}`, landmarks: [] }), { targetTokens: 4096, countText })).rejects.toMatchObject({ code: 'summary_too_large' });
        await getDb().transaction('rw', getWriteTxTableNames(getDb(), 'messages'), () => getDb().messages.update('m3', { pending: true }));
        await expect(captureCompaction({ sourceThreadId: 'source', anchorMessageId: 'm3', model: 'large-model' })).rejects.toThrow(/pending|settled/i);
        expect(await getDb().threads.count()).toBe(1);
    });
});
