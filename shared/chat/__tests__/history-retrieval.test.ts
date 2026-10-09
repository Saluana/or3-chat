import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHistoryRetrievalService, type HistoryRetrievalContext } from '../history-retrieval';
import type { CanonicalHistoryRecord } from '../background-history';
import type { CompactionData } from '../compaction';

afterEach(() => vi.unstubAllGlobals());

function historyContext(): HistoryRetrievalContext {
    const messages: CanonicalHistoryRecord[] = Array.from({ length: 501 }, (_, index) => ({
        id: `message-${index}`, clock: 1, thread_id: 'parent', index, role: 'user', data: { content: `Evidence ${index}` },
    }));
    const metadata: CompactionData = {
        version: 1, compaction_id: 'compaction', source_thread_id: 'parent', anchor_message_id: 'message-500', anchor_index: 500,
        generated_at: 1, model: 'fixture', message_count: 501, prior_message_count: 0, summary_markdown: 'Evidence summary', landmarks: [],
        history_scope: { version: 1, segments: [{ thread_id: 'parent', messages: messages.map(row => ({ message_id: row.id, clock: row.clock })) }] },
    };
    const records = new Map<string, CanonicalHistoryRecord>([
        ...messages.map(row => [row.id, row] as const),
        ['parent', { id: 'parent', clock: 1 }],
        ['child', { id: 'child', clock: 1, parent_thread_id: 'parent', anchor_message_id: 'message-500', branch_mode: 'compacted', summary_message_id: 'summary' }],
        ['summary', { id: 'summary', clock: 1, thread_id: 'child', role: 'system', data: { kind: 'compaction', compaction: metadata } }],
    ]);
    return { subject: 'user', workspaceId: 'workspace', threadId: 'child', signal: new AbortController().signal,
        authorize() {}, revision: () => 'revision-1',
        read: async query => query.kind === 'thread'
            ? { status: 'ok', thread: records.get(query.thread_id) }
            : query.kind === 'messages'
                ? { status: 'ok', messages: query.message_ids.flatMap(id => records.has(id) ? [records.get(id)!] : []) }
                : { status: 'scope_incomplete' },
    };
}

describe.each(['native', 'http'] as const)('signed history cursors in %s contexts', (context) => {
    it('continues searches and refuses tampered, foreign, and rebound cursors', async () => {
        if (context === 'http') vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
        const service = createHistoryRetrievalService();
        const ctx = historyContext();
        const first = await service.searchParent(ctx, { query: 'evidence' });
        expect(first).toMatchObject({ status: 'ok', scan_complete: false, scanned_rows: 500 });
        if (!('next_cursor' in first) || !first.next_cursor) throw new Error('Search must provide a signed continuation.');
        const cursor = first.next_cursor;
        expect(await service.searchParent(ctx, { query: 'evidence', cursor })).toMatchObject({
            status: 'ok', scan_complete: true, results: [{ message_id: 'message-500' }],
        });
        const [body, signature] = cursor.split('.');
        const alteredSignature = (signature![0] === 'A' ? 'B' : 'A') + signature!.slice(1);
        expect(await service.searchParent(ctx, { query: 'evidence', cursor: `${body}.${alteredSignature}` })).toMatchObject({ status: 'scope_incomplete' });
        expect(await createHistoryRetrievalService().searchParent(ctx, { query: 'evidence', cursor })).toMatchObject({ status: 'scope_incomplete' });
        expect(await service.searchParent(ctx, { query: 'other', cursor })).toMatchObject({ status: 'scope_incomplete' });
        expect(await service.searchParent({ ...ctx, subject: 'other-user' }, { query: 'evidence', cursor })).toMatchObject({ status: 'scope_incomplete' });
    });
});
