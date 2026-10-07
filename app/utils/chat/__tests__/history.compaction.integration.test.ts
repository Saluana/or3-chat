import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { ref } from 'vue';
import { getDb, setActiveWorkspaceDb, evictWorkspaceDb } from '~/db/client';
import type { Thread, Message } from '~/db/schema';
import type { ChatMessage } from '../types';
import { ensureThreadHistoryLoaded } from '../history';
import { ensureUiMessage } from '../uiMessages';
import { buildContext } from '~/db/branching';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { setHookEngine } from '~/core/hooks/useHooks';
import { testRuntimeConfig } from '~~/tests/setup';

let workspace: string;
let originalSsrAuth: boolean;
const databases = new Map<string, string>();
beforeEach(async () => {
    originalSsrAuth = testRuntimeConfig.value.public.ssrAuthEnabled;
    testRuntimeConfig.value.public.ssrAuthEnabled = false;
    workspace = `compaction-history-${crypto.randomUUID()}`;
    setHookEngine(createTypedHookEngine(createHookEngine()));
    const db = setActiveWorkspaceDb(workspace); await db.open(); databases.set(workspace, db.name);
});
afterEach(async () => {
    testRuntimeConfig.value.public.ssrAuthEnabled = originalSsrAuth;
    setActiveWorkspaceDb(null);
    for (const [id, name] of databases) { evictWorkspaceDb(id); await Dexie.delete(name); }
    databases.clear(); setHookEngine(null);
});
const thread = (id: string, extra: Partial<Thread> = {}) => getDb().threads.put({ id, title: id,
    status: 'ready', pinned: false, deleted: false, forked: false, created_at: 1, updated_at: 1, clock: 1, ...extra });
const message = (id: string, threadId: string, index: number, extra: Partial<Message> = {}) => getDb().messages.put({
    id, thread_id: threadId, index, order_key: `${index}:${id}`, role: 'user', data: { content: id },
    pending: false, deleted: false, created_at: 1, updated_at: 1, clock: 1, ...extra });
function summaryData(source: string, anchor: string) {
    return { kind: 'compaction', content: 'Historical reference summary', compaction: {
        version: 1, compaction_id: 'operation', source_thread_id: source, anchor_message_id: anchor,
        anchor_index: 0, generated_at: 1, model: 'model', message_count: 3, prior_message_count: 0,
        summary_markdown: 'Historical reference summary', landmarks: [], history_scope: { version: 1,
            segments: [{ thread_id: source, messages: [{ message_id: anchor, clock: 1 }] }] },
    } };
}
async function loaded(id: string) {
    const target = ref<string | undefined>(id); const forThread = ref<string | null>(null); const rows = ref<ChatMessage[]>([]);
    const ready = await ensureThreadHistoryLoaded(target, forThread, rows);
    return { ready, rows: rows.value, loaded: forThread.value };
}

describe('canonical lineage history and summary readiness', () => {
    // Moving a reference or compacted branch must revoke foreign ancestry at
    // both normal context and workspace-read boundaries. Existing
    // lineage cases are all ordinary chats and cannot detect project leakage.
    it.each(['reference', 'compacted', 'inherited-summary'] as const)('refuses foreign project provenance in %s history', async mode => {
        const db = getDb();
        await db.projects.bulkPut(['a', 'b'].map(id => ({ id, name: id, data: [], created_at: 1, updated_at: 1, deleted: false, clock: 1 })));
        await thread('source', { project_id: 'a' }); await message('anchor', 'source', 0);
        await thread('child', { project_id: 'a', parent_thread_id: 'source', branch_mode: mode === 'reference' ? 'reference' : 'compacted', anchor_message_id: 'anchor', summary_message_id: mode === 'reference' ? null : 'summary' });
        if (mode !== 'reference') await message('summary', 'child', 0, { role: 'system', data: summaryData('source', 'anchor') });
        await message('child-local', 'child', 1);
        expect((await buildContext({ threadId: 'child' })).map(row => row.id)).toContain('child-local');
        if (mode === 'inherited-summary') {
            await thread('foreign', { project_id: 'b' });
            await message('foreign-anchor', 'foreign', 0);
            await message('inherited', 'source', 0, { role: 'system', data: summaryData('foreign', 'foreign-anchor') });
            const data = summaryData('source', 'anchor');
            await db.messages.update('summary', { data: { ...data, compaction: { ...data.compaction, history_scope: { ...data.compaction.history_scope, inherited_scope_message_id: 'inherited' } } } });
        } else await db.threads.update('source', { project_id: 'b' });
        const { workspaceRead } = await import('../workspace-items');
        const { captureWorkspaceOperation } = await import('../workspace-access');
        const context = { workspaceId: workspace, threadId: 'child', subject: null, messageId: null, callId: 'read', requestId: 'read', abortSignal: new AbortController().signal };
        const results = await Promise.allSettled([buildContext({ threadId: 'child' }),
            workspaceRead(captureWorkspaceOperation(context), { kind: 'chat', id: 'child' }, undefined, context)]);
        expect(results.map(result => result.status)).toEqual(['rejected', 'rejected']);
        for (const result of results) if (result.status === 'rejected') expect(String(result.reason)).toMatch(/project|permitted|provenance/i);
    });
    it('hydrates separate canonical tool evidence through the production pane seed without rewriting stored history', async () => {
        await thread('original');
        await message('assistant', 'original', 0, { role: 'assistant', data: {
            content: 'Inspecting source', plugin_receipt: { retained: true },
            tool_calls: [{ id: 'lookup', name: 'read_source_evidence', label: 'Read source evidence', runtime: 'client', completedAt: 123, args: '{}',
                status: 'error', result: 'Stale embedded result', error: 'Stale embedded error' }],
        } });
        await message('tool-evidence', 'original', 1, { role: 'tool', data: {
            content: 'Canonical tool evidence: preserve app/example.ts exactly.',
            tool_call_id: 'lookup', tool_name: 'read_source_evidence', parent_assistant_id: 'assistant',
        } });
        const stored = await getDb().messages.toArray();
        const { useMultiPane } = await import('~/composables/core/useMultiPane');
        const seed = await useMultiPane().loadMessagesFor('original');
        expect(seed.map((row) => row.id)).toEqual(['assistant', 'tool-evidence']);
        expect(seed[0]?.data).toMatchObject({ plugin_receipt: { retained: true } });
        expect(ensureUiMessage(seed[0]!)).toMatchObject({ toolCalls: [{
            id: 'lookup', label: 'Read source evidence', runtime: 'client', completedAt: 123, status: 'complete',
            result: 'Canonical tool evidence: preserve app/example.ts exactly.', error: undefined,
        }] });
        expect(await getDb().messages.toArray()).toEqual(stored);
    });
    it('preserves pending tool presentation metadata by call identity without a separate result row', async () => {
        await thread('original');
        await message('assistant', 'original', 0, { role: 'assistant', data: {
            content: '', tool_calls: [
                { id: 'lookup', name: 'opaque_lookup', label: 'Inspect source', runtime: 'client', status: 'pending', completedAt: 123 },
                { id: 'server', name: 'opaque_lookup', label: 'Search shared lists', runtime: 'server', status: 'loading' },
            ],
        } });
        const stored = await getDb().messages.toArray();
        const { useMultiPane } = await import('~/composables/core/useMultiPane');
        const seed = await useMultiPane().loadMessagesFor('original');
        expect(ensureUiMessage(seed[0]!)).toMatchObject({ toolCalls: [
            { id: 'lookup', label: 'Inspect source', runtime: 'client', status: 'pending', completedAt: 123 },
            { id: 'server', label: 'Search shared lists', runtime: 'server', status: 'loading' },
        ] });
        expect(await getDb().messages.toArray()).toEqual(stored);
    });
    it('loads two anchored reference generations by ID with canonical tool roles and excludes superseded/deleted rows', async () => {
        await thread('root'); await message('r-user', 'root', 0);
        await message('r-call', 'root', 1, { role: 'assistant', data: { content: '', tool_calls: [{ id: 'call', name: 'lookup', args: '{}', status: 'complete' }] } });
        await message('r-result', 'root', 2, { role: 'tool', data: { content: 'Result', tool_call_id: 'call', tool_name: 'lookup' } });
        await message('r-anchor', 'root', 3, { role: 'assistant' });
        await message('superseded', 'root', 2, { data: { content: 'old', superseded_by: 'r-anchor' } });
        await message('deleted', 'root', 2, { deleted: true });
        await message('later', 'root', 4);
        await thread('first', { parent_thread_id: 'root', branch_mode: 'reference', anchor_message_id: 'r-anchor', anchor_index: 999 });
        await message('f-user', 'first', 0); await message('f-anchor', 'first', 1, { role: 'assistant' });
        await message('f-later', 'first', 2);
        await thread('second', { parent_thread_id: 'first', branch_mode: 'reference', anchor_message_id: 'f-anchor', anchor_index: 0 });
        await message('s-user', 'second', 0);
        const result = await loaded('second');
        expect(result.ready).toBe(true);
        expect(result.rows.map((row) => row.id)).toEqual(['r-user', 'r-call', 'r-result', 'r-anchor', 'f-user', 'f-anchor', 's-user']);
        expect(result.rows.find((row) => row.id === 'r-result')).toMatchObject({ role: 'tool', tool_call_id: 'call' });
        expect((await buildContext({ threadId: 'second' })).map((row) => row.id)).toEqual(result.rows.map((row) => row.id));
        expect((await buildContext({ threadId: 'second' })).find((row) => row.id === 'r-result')?.role).toBe('tool');
    });
    it('keeps copy and legacy unanchored branches local', async () => {
        await thread('root'); await message('parent-only', 'root', 0);
        await thread('copy', { parent_thread_id: 'root', branch_mode: 'copy' }); await message('copied-local', 'copy', 0);
        await thread('legacy', { parent_thread_id: 'root', anchor_index: 0 }); await message('legacy-local', 'legacy', 0);
        expect((await loaded('copy')).rows.map((row) => row.id)).toEqual(['copied-local']);
        expect((await loaded('legacy')).rows.map((row) => row.id)).toEqual(['legacy-local']);
        expect((await buildContext({ threadId: 'legacy' })).map((row) => row.id)).toEqual(['legacy-local']);
    });
    it('waits for a valid summary pair and stops ancestor expansion while keeping a summary usable after source deletion', async () => {
        await thread('source'); await message('private-original', 'source', 0);
        await thread('compacted', { parent_thread_id: 'source', anchor_message_id: 'private-original', anchor_index: 0,
            branch_mode: 'compacted', summary_message_id: 'summary', root_thread_id: 'source', fork_reason: 'compaction' });
        await message('new-local', 'compacted', 1);
        expect(await loaded('compacted')).toMatchObject({ ready: false, rows: [], loaded: null });
        await message('summary', 'compacted', 0, { role: 'assistant', data: summaryData('source', 'private-original') });
        expect((await loaded('compacted')).ready).toBe(false);
        await getDb().messages.update('summary', { role: 'system', data: { ...summaryData('source', 'private-original'), compaction: { ...summaryData('source', 'private-original').compaction, version: 2 } } });
        expect((await loaded('compacted')).ready).toBe(false);
        await getDb().messages.update('summary', { role: 'system', data: summaryData('source', 'private-original') });
        const valid = await loaded('compacted');
        expect(valid.ready).toBe(true);
        expect(valid.rows.map((row) => row.id)).toEqual(['summary', 'new-local']);
        expect(valid.rows[0]?.data).toMatchObject({ kind: 'compaction' });
        await getDb().threads.update('source', { deleted: true });
        expect((await loaded('compacted')).rows.map((row) => row.id)).toEqual(['summary', 'new-local']);
    });
    it('rejects invalid anchors/cycles and traverses more than128 valid reference generations without an application cutoff', async () => {
        await thread('root'); await message('anchor-0', 'root', 0);
        let parent = 'root';
        for (let index = 1; index <= 130; index += 1) {
            const id = `generation-${index}`;
            await thread(id, { parent_thread_id: parent, branch_mode: 'reference', anchor_message_id: `anchor-${index - 1}`, anchor_index: 0 });
            await message(`anchor-${index}`, id, 0); parent = id;
        }
        expect((await loaded(parent)).rows.map((row) => row.id)).toHaveLength(131);
        await getDb().threads.update(parent, { anchor_message_id: 'missing' });
        await expect(buildContext({ threadId: parent })).rejects.toThrow(/anchor/i);
        await getDb().threads.update(parent, { anchor_message_id: 'anchor-130', parent_thread_id: parent });
        await expect(buildContext({ threadId: parent })).rejects.toThrow(/lineage|cyclic/i);
    });
    it.each(['A→B', 'A→B→A'])('does not publish a same-ID history read after navigation %s during the actual DB read', async (path) => {
        await thread('same'); await message('A-private', 'same', 0);
        const dbA = getDb();
        const other = `other-${crypto.randomUUID()}`;
        const dbB = setActiveWorkspaceDb(other); await dbB.open(); databases.set(other, dbB.name);
        await thread('same'); await message('B-private', 'same', 0);
        setActiveWorkspaceDb(workspace);
        let changed = false;
        const switchWhileReading = (row: Message) => {
            if (!changed) { changed = true; setActiveWorkspaceDb(other); if (path === 'A→B→A') setActiveWorkspaceDb(workspace); }
            return row;
        };
        dbA.messages.hook('reading', switchWhileReading);
        try {
            const result = await loaded('same');
            expect(changed).toBe(true); expect(result).toMatchObject({ ready: false, rows: [], loaded: null });
        } finally { dbA.messages.hook('reading').unsubscribe(switchWhileReading); }
    });
});
