import Dexie from 'dexie';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';
import { getDb, setActiveWorkspaceDb, evictWorkspaceDb } from '~/db/client';
import { continueMessageImpl, type ContinueMessageContext } from '../continue';
import { createChatRequest } from '../requestController';
import type { ChatMessage } from '~/utils/chat/types';

const boundary = vi.hoisted(() => ({ build: vi.fn(), provider: vi.fn(), report: vi.fn() }));
vi.mock('../messageBuild', () => ({
    buildOpenRouterMessagesForSend: boundary.build,
    enforceOpenRouterMessageTokenBudget: async (messages: unknown[]) => messages,
}));
vi.mock('~/utils/chat/openrouterStream', () => ({
    openRouterStreamWithRetry: boundary.provider, startBackgroundStream: boundary.provider,
}));
vi.mock('~/utils/errors', () => ({ reportError: boundary.report, err: (_code: string, message: string) => new Error(message) }));
let workspace: string;
beforeEach(async () => {
    workspace = `continue-compaction-${crypto.randomUUID()}`;
    await setActiveWorkspaceDb(workspace).open();
    boundary.build.mockReset(); boundary.provider.mockReset(); boundary.report.mockReset();
    // Stop at preparation's actual payload boundary. This owner does not qualify
    // streaming or persistence; those retain their canonical lifecycle tests.
    boundary.build.mockResolvedValue([]);
});
afterEach(async () => {
    const db = getDb(); setActiveWorkspaceDb(null); evictWorkspaceDb(workspace); await Dexie.delete(db.name);
});
async function thread(id: string, extra: Record<string, unknown> = {}) {
    await getDb().threads.put({ id, status: 'ready', created_at: 1, updated_at: 1, clock: 1, deleted: false, pinned: false, forked: false, ...extra });
}
async function row(id: string, owner: string, index: number, role: 'user' | 'assistant' | 'system' = 'user', data: Record<string, unknown> = { content: id }) {
    await getDb().messages.put({ id, thread_id: owner, index, role, data, created_at: 1, updated_at: 1, clock: 1, pending: false, deleted: false });
}
async function prepare(owner: string, target: string, cancelDuringRead = false) {
    const db = getDb(); const accumulator = { reset: vi.fn(), append: vi.fn(), finalize: vi.fn(), state: { finalized: false } };
    const request = createChatRequest({ requestId: 'continue', kind: 'continue', originDb: db, workspaceId: workspace, threadId: owner, accumulator });
    request.ownsView = () => !request.cancelled;
    const ctx: ContinueMessageContext = { request, loading: ref(false), aborted: ref(false), abortController: ref(null),
        threadIdRef: ref(owner), tailAssistant: ref(null), rawMessages: ref([]), messages: ref([]), streamId: ref(undefined),
        streamAcc: accumulator, streamState: accumulator.state, hooks: { applyFilters: async (_name, value) => value },
        effectiveApiKey: ref('scripted'), hasInstanceKey: ref(false), defaultModelId: 'model', getSystemPromptContent: async () => null,
        useAiSettings: () => ({ settings: ref(undefined) }), resetStream: vi.fn() };
    const cancel = (value: unknown) => { if (cancelDuringRead) request.cancelled = true; return value; };
    const before = await db.messages.toArray();
    db.threads.hook('reading', cancel);
    try { await continueMessageImpl(ctx, target); } finally { db.threads.hook('reading').unsubscribe(cancel); }
    expect(await db.messages.toArray()).toEqual(before);
    expect(boundary.provider).not.toHaveBeenCalled();
    return ctx;
}
function inputs(): ChatMessage[] { return boundary.build.mock.calls[0]?.[0]?.effectiveMessages ?? []; }
function summary() {
    return { kind: 'compaction', content: 'Historical summary', compaction: { version: 1, compaction_id: 'operation', source_thread_id: 'old', anchor_message_id: 'old-anchor', anchor_index: 0,
        generated_at: 1, model: 'model', message_count: 4, prior_message_count: 0, summary_markdown: 'Historical summary', landmarks: [], history_scope: { version: 1, segments: [] } } };
}
describe('native continuation canonical preparation', () => {
    it('retains two reference generations in segment order and stops at the selected target ID', async () => {
        await thread('root'); await row('root-user', 'root', 0); await row('root-anchor', 'root', 1, 'assistant'); await row('root-later', 'root', 2);
        await thread('first', { branch_mode: 'reference', parent_thread_id: 'root', anchor_message_id: 'root-anchor' });
        await row('first-user', 'first', 0); await row('first-anchor', 'first', 1, 'assistant'); await row('first-later', 'first', 2);
        await thread('second', { branch_mode: 'reference', parent_thread_id: 'first', anchor_message_id: 'first-anchor' });
        await row('second-user', 'second', 0); await row('target', 'second', 1, 'assistant'); await row('second-later', 'second', 2);
        await prepare('second', 'target');
        expect(inputs().filter((item) => !item.id?.startsWith('system-') && !item.id?.startsWith('continue-')).map((item) => item.id))
            .toEqual(['root-user', 'root-anchor', 'first-user', 'first-anchor', 'second-user', 'target']);
    });
    it('uses only the summary and new turns at a compacted boundary with its original source absent', async () => {
        await thread('child', { branch_mode: 'compacted', parent_thread_id: 'old', anchor_message_id: 'old-anchor', summary_message_id: 'summary' });
        await row('summary', 'child', 0, 'system', summary()); await row('new-user', 'child', 1); await row('target', 'child', 2, 'assistant'); await row('later', 'child', 3);
        await prepare('child', 'target');
        expect(inputs().filter((item) => !item.id?.startsWith('system-') && !item.id?.startsWith('continue-')).map((item) => item.id)).toEqual(['summary', 'new-user', 'target']);
        expect(inputs().find((item) => item.id === 'summary')?.role).toBe('system');
    });
    it.each(['missing', 'wrong-role', 'wrong-source'] as const)('rejects an invalid summary pair (%s) before payload preparation and pending writes', async (kind) => {
        await thread('child', { branch_mode: 'compacted', parent_thread_id: 'old', anchor_message_id: 'old-anchor', summary_message_id: 'summary' });
        if (kind !== 'missing') { const data = summary(); if (kind === 'wrong-source') data.compaction.source_thread_id = 'foreign'; await row('summary', 'child', 0, kind === 'wrong-role' ? 'assistant' : 'system', data); }
        await row('target', 'child', 1, 'assistant');
        await prepare('child', 'target'); expect(boundary.build).not.toHaveBeenCalled();
        expect(boundary.report.mock.calls[0]?.[0]).toMatchObject({ code: 'summary_pending' });
    });
    it('abandons a canonical read after request ownership is lost without preparing a payload', async () => {
        await thread('child', { branch_mode: 'compacted' }); await row('target', 'child', 0, 'assistant');
        await prepare('child', 'target', true); expect(boundary.build).not.toHaveBeenCalled();
    });
});
