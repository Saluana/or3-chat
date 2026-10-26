import { describe, expect, it, vi } from 'vitest';
import { getDb } from '~/db/client';
import {
    searchDocumentAiMentions,
    formatDocumentAiReferenceContext,
    uniqueDocumentAiReferences,
} from '../document-ai-context';

const mentions = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock('~/plugins/ChatMentions/useChatMentions', () => ({
    setMentionsConfig: vi.fn(), initMentionsIndex: vi.fn(), searchMentions: mentions.search,
}));
describe('Document AI reference context', () => {
    it('only suggests sources the document composer can resolve', async () => {
        mentions.search.mockResolvedValue([
            { id: 'self', source: 'document', label: 'Current' },
            { id: 'file', source: 'file', label: 'Unresolved file' },
            { id: 'doc', source: 'document', label: 'Other document' },
            { id: 'chat', source: 'chat', label: 'Conversation' },
        ]);
        expect(await searchDocumentAiMentions('', { currentDocumentId: 'self', documentsEnabled: true, conversationsEnabled: true }))
            .toEqual([{ id: 'doc', source: 'document', label: 'Other document' }, { id: 'chat', source: 'chat', label: 'Conversation' }]);
    });
    it('excludes Trash and unsupported item state when indexed mention search is unavailable', async () => {
        mentions.search.mockRejectedValueOnce(new Error('Index unavailable'));
        const db = getDb();
        const ids = ['mention-active', 'mention-trashed', 'mention-future'];
        try {
            await db.posts.bulkPut(ids.map((id, index) => ({ id, title: 'Fallback evidence', postType: 'doc', content: '{"type":"doc","content":[]}',
                created_at: 1, updated_at: 1, clock: 0, deleted: false,
                meta: index === 0 ? undefined : JSON.stringify({ 'or3.workspace-item': { version: index === 1 ? 1 : 2, trashed_at: index === 1 ? 1 : null } }),
            })));
            const items = await searchDocumentAiMentions('Fallback evidence', { currentDocumentId: 'self', documentsEnabled: true, conversationsEnabled: false });
            expect(items.map(item => item.id)).toEqual(['mention-active']);
        } finally { await db.posts.bulkDelete(ids); }
    });
    it('deduplicates references by source and id while preserving order', () => {
        expect(uniqueDocumentAiReferences([
            { id: 'doc-1', source: 'document', label: 'Plan' },
            { id: 'doc-1', source: 'document', label: 'Plan duplicate' },
            { id: 'doc-1', source: 'chat', label: 'Chat with same id' },
        ])).toEqual([
            { id: 'doc-1', source: 'document', label: 'Plan' },
            { id: 'doc-1', source: 'chat', label: 'Chat with same id' },
        ]);
    });

    it('escapes reference metadata and content in a read-only XML block', () => {
        const value = formatDocumentAiReferenceContext([{
            reference: { id: 'doc&1', source: 'document', label: 'Q4 <Plan>' },
            content: 'Use "safe" evidence & facts.',
        }]);
        expect(value).toContain('type="reference"');
        expect(value).toContain('id="doc&amp;1"');
        expect(value).toContain('label="Q4 &lt;Plan&gt;"');
        expect(value).toContain('Use &quot;safe&quot; evidence &amp; facts.');
    });
});
