import Dexie from 'dexie';
import { ref, effectScope, type EffectScope } from 'vue';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { getDb, setActiveWorkspaceDb, evictWorkspaceDb } from '~/db/client';
import { useThreadCompaction } from '../useThreadCompaction';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { setHookEngine, useHooks } from '~/core/hooks/useHooks';
import { getHookBridge, _resetHookBridge } from '~/core/sync/hook-bridge';
import { getWriteTxTableNames } from '~/db/util';
import type { ORStreamEvent } from '~~/shared/openrouter/parseOpenRouterSSE';
import type { openRouterStream } from '~/utils/chat/openrouterStream';
const transport = vi.hoisted(() => vi.fn<typeof openRouterStream>());
vi.mock('~/utils/chat/openrouterStream', () => ({ openRouterStream: transport }));
const markdown = '## Objective\nFinish implementation.\n## Important Details\nKeep exact paths.\n## Work State\nTwo turns settled.\n## Next Move\nContinue safely.\n## Relevant Files\nNone.';
const envelope = JSON.stringify({ summary_markdown: markdown, landmarks: [{ message_id: 'm0', kind: 'decision', summary: 'Source evidence' }] });
let workspace: string;
let scopes: EffectScope[];
function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
function pauseInference() {
    const entered = deferred(); const release = deferred();
    transport.mockImplementation(async function* (): AsyncGenerator<ORStreamEvent> { entered.resolve(); await release.promise; yield { type: 'text', text: envelope }; yield { type: 'done' }; });
    return { entered: entered.promise, release: release.resolve };
}
function controller(extra: Partial<Parameters<typeof useThreadCompaction>[0]> = {}) {
    const threadId = ref<string | undefined>('source'); const model = ref('large-model'); const isBusy = ref(false);
    const scope = effectScope(); scopes.push(scope);
    const service = scope.run(() => useThreadCompaction({ threadId, model, isBusy, apiKey: 'scripted',
        getPreferences: async () => ({ maxContextTokens: null }),
        resolveModelMetadata: async () => ({ context_length: 1000000, top_provider: { max_completion_tokens: 8192 } }), ...extra }))!;
    return { ...service, threadId, model, isBusy, scope };
}
beforeEach(async () => {
    scopes = []; workspace = `compaction-controller-${crypto.randomUUID()}`; await setActiveWorkspaceDb(workspace).open();
    setHookEngine(createTypedHookEngine(createHookEngine())); transport.mockReset();
    await getDb().threads.put({ id: 'source', title: 'Source', status: 'ready', created_at: 1, updated_at: 1, clock: 1, deleted: false, pinned: false, forked: false });
    for (let index = 0; index < 4; index += 1) await getDb().messages.put({ id: `m${index}`, thread_id: 'source', role: index % 2 ? 'assistant' : 'user', index,
        pending: false, deleted: false, created_at: 1, updated_at: 1, clock: 1, data: { content: `Evidence${index} ${'Exact continuing task facts '.repeat(300)}` } });
    transport.mockImplementation(async function* (): AsyncGenerator<ORStreamEvent> { yield { type: 'text', text: envelope }; yield { type: 'done' }; });
    getHookBridge(getDb()).start();
});
afterEach(async () => { for (const scope of scopes) scope.stop(); _resetHookBridge(); const db = getDb(); setActiveWorkspaceDb(null); evictWorkspaceDb(workspace); await Dexie.delete(db.name); setHookEngine(null); });
it('captures the final settled local anchor and opens the durable child only after commit', async () => {
    const open = vi.fn(async (result: { thread: { id: string }; summary: { id: string } }) => {
        expect((await getDb().threads.get(result.thread.id))?.summary_message_id).toBe(result.summary.id);
        expect((await getDb().messages.get(result.summary.id))?.pending).toBe(false);
    });
    const service = controller({ onCommitted: open }); const result = await service.start();
    expect(result.ok).toBe(true); expect(service.state.value.status).toBe('complete'); expect(service.active.value).toBe(false);
    expect(open).toHaveBeenCalledOnce(); const child = (await getDb().threads.toArray()).find((row) => row.branch_mode === 'compacted')!;
    expect(child.anchor_message_id).toBe('m3'); expect(child.parent_thread_id).toBe('source'); expect(await getDb().pending_ops.count()).toBe(2);
});
it('rejects duplicate operations in the same pane and another pane for the same workspace/source', async () => {
    const paused = pauseInference(); const first = controller(); const second = controller(); const operation = first.start(); await paused.entered;
    expect(first.active.value).toBe(true); expect(await first.start()).toMatchObject({ ok: false, code: 'source_busy' });
    expect(await second.start()).toMatchObject({ ok: false, code: 'source_busy' }); expect(transport).toHaveBeenCalledOnce();
    paused.release(); expect((await operation).ok).toBe(true); expect(await getDb().threads.count()).toBe(2);
});
it('cancels without writes and releases the lock so an explicit repeat can succeed', async () => {
    const paused = pauseInference(); const service = controller(); const operation = service.start(); await paused.entered; service.cancel(); paused.release();
    expect(await operation).toMatchObject({ ok: false, code: 'cancelled' }); expect(await getDb().threads.count()).toBe(1); expect(await getDb().pending_ops.count()).toBe(0);
    expect((await service.start()).ok).toBe(true); expect(transport).toHaveBeenCalledTimes(2); expect(await getDb().threads.count()).toBe(2);
});
it.each(['model', 'thread', 'busy', 'dispose'] as const)('rejects late inference after its initiating view changes (%s)', async (change) => {
    const paused = pauseInference(); const service = controller(); const operation = service.start(); await paused.entered;
    if (change === 'model') service.model.value = 'another-model';
    if (change === 'thread') service.threadId.value = 'another-thread';
    if (change === 'busy') service.isBusy.value = true;
    if (change === 'dispose') service.scope.stop();
    paused.release(); expect(await operation).toMatchObject({ ok: false, code: change === 'busy' ? 'source_busy' : change === 'dispose' ? 'cancelled' : 'stale_source' });
    expect(await getDb().threads.count()).toBe(1); expect(await getDb().messages.count()).toBe(4); expect(await getDb().pending_ops.count()).toBe(0);
});
it('rejects A→B→A even when the original pane/source/model values return', async () => {
    const paused = pauseInference(); const service = controller(); const origin = getDb(); const operation = service.start(); await paused.entered;
    const other = `controller-other-${crypto.randomUUID()}`; const otherDb = setActiveWorkspaceDb(other); await otherDb.open(); setActiveWorkspaceDb(workspace);
    paused.release(); try { expect(await operation).toMatchObject({ ok: false, code: 'stale_source' }); expect(await origin.threads.count()).toBe(1); expect(await otherDb.threads.count()).toBe(0); }
    finally { evictWorkspaceDb(other); await Dexie.delete(otherDb.name); }
});
it('rejects a source edit during inference without committing a stale child', async () => {
    const paused = pauseInference(); const service = controller(); const operation = service.start(); await paused.entered;
    await getDb().transaction('rw', getWriteTxTableNames(getDb(), 'messages'), async () => {
        await getDb().messages.update('m0', { data: { content: 'Changed while summary was being generated' } });
    }); const outboxBeforeCommit = await getDb().pending_ops.count(); paused.release();
    expect(await operation).toMatchObject({ ok: false, code: 'stale_source' }); expect(await getDb().threads.count()).toBe(1); expect(await getDb().pending_ops.count()).toBe(outboxBeforeCommit);
});
it('keeps the committed receipt when navigation fails and permits a later sibling compaction', async () => {
    const service = controller({ onCommitted: async () => { throw new Error('Navigation unavailable'); } });
    const result = await service.start(); expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected saved child'); expect(result.warning).toContain('saved');
    expect(await getDb().threads.get(result.thread_id)).toBeDefined(); expect(await getDb().messages.get(result.summary_message_id)).toBeDefined();
    expect((await service.start()).ok).toBe(true); expect(await getDb().threads.count()).toBe(3);
});
it('returns the saved child without navigating a view that changes in a post-commit hook', async () => {
    const open = vi.fn(); const service = controller({ onCommitted: open });
    useHooks().addAction('branch.fork:action:after', () => { service.model.value = 'another-model'; });
    const result = await service.start(); expect(result.ok).toBe(true); expect(open).not.toHaveBeenCalled();
    if (!result.ok) throw new Error('Expected committed receipt');
    expect(await getDb().threads.get(result.thread_id)).toBeDefined(); expect(await getDb().messages.get(result.summary_message_id)).toBeDefined();
});
it('reports missing source history as a recoverable scope failure before inference', async () => {
    const service = controller(); service.threadId.value = 'missing-source';
    expect(await service.start()).toMatchObject({ ok: false, code: 'scope_incomplete' });
    expect(transport).not.toHaveBeenCalled(); expect(await getDb().threads.count()).toBe(1);
});
it('does not publish raw provider errors and allows an explicit retry after failure', async () => {
    transport.mockImplementation(async function* (): AsyncGenerator<ORStreamEvent> { throw new Error('PRIVATE_KEY_AND_TRANSCRIPT provider response'); });
    const service = controller(); const result = await service.start(); expect(result).toMatchObject({ ok: false, code: 'generation_failed' });
    expect(result).not.toHaveProperty('message', expect.stringContaining('PRIVATE_KEY_AND_TRANSCRIPT'));
    expect(service.active.value).toBe(false); expect(await getDb().threads.count()).toBe(1); expect(transport).toHaveBeenCalledOnce();
    transport.mockImplementation(async function* (): AsyncGenerator<ORStreamEvent> { yield { type: 'text', text: envelope }; yield { type: 'done' }; });
    expect((await service.start()).ok).toBe(true); expect(transport).toHaveBeenCalledTimes(2);
});
it('uses captured preferences and model for inference rather than later mutable setting values', async () => {
    const entered = deferred(); const release = deferred(); const preference = { maxContextTokens: 1000000 };
    const metadata = vi.fn(async (model: string) => { expect(model).toBe('large-model'); entered.resolve(); await release.promise; return { context_length: 1000000, top_provider: { max_completion_tokens: 8192 } }; });
    const service = controller({ getPreferences: async () => preference, resolveModelMetadata: metadata }); const operation = service.start(); await entered.promise;
    preference.maxContextTokens = 100; release.resolve(); expect((await operation).ok).toBe(true); expect(transport.mock.calls[0]![0].model).toBe('large-model');
    expect(await service.start()).toMatchObject({ ok: false, code: 'not_beneficial' }); expect(transport).toHaveBeenCalledOnce();
});
it('rejects busy and insufficient or inherited-only history before inference', async () => {
    const service = controller(); service.isBusy.value = true; expect(await service.start()).toMatchObject({ ok: false, code: 'source_busy' }); service.isBusy.value = false;
    expect(await service.start('m1')).toMatchObject({ ok: false, code: 'not_eligible' });
    await getDb().transaction('rw', getWriteTxTableNames(getDb(), 'threads'), async () => {
        await getDb().threads.put({ id: 'inherited-only', title: 'Reference', status: 'ready', created_at: 1, updated_at: 1, clock: 1, deleted: false, pinned: false,
            forked: true, parent_thread_id: 'source', anchor_message_id: 'm3', branch_mode: 'reference' });
    }); service.threadId.value = 'inherited-only';
    const outboxBeforeCompaction = await getDb().pending_ops.count();
    expect(await service.start()).toMatchObject({ ok: false, code: 'not_eligible' }); expect(transport).not.toHaveBeenCalled(); expect(await getDb().pending_ops.count()).toBe(outboxBeforeCompaction);
});
it('includes inherited history when the reference child has a local anchor', async () => {
    await getDb().transaction('rw', getWriteTxTableNames(getDb(), ['threads', 'messages']), async () => {
        await getDb().threads.put({ id: 'reference', title: 'Reference', status: 'ready', created_at: 1, updated_at: 1, clock: 1, deleted: false, pinned: false,
            forked: true, parent_thread_id: 'source', anchor_message_id: 'm3', branch_mode: 'reference' });
        await getDb().messages.put({ id: 'local', thread_id: 'reference', role: 'user', index: 0, pending: false, deleted: false, created_at: 2, updated_at: 2, clock: 2,
            data: { content: 'Local next request' } });
    }); const service = controller(); service.threadId.value = 'reference';
    expect((await service.start()).ok).toBe(true); const body = transport.mock.calls[0]![0].orMessages[1]!.content;
    expect(body).toContain('Evidence0'); expect(body).toContain('Local next request');
    const child = (await getDb().threads.toArray()).find((row) => row.branch_mode === 'compacted')!; expect(child.parent_thread_id).toBe('reference'); expect(child.anchor_message_id).toBe('local');
});
