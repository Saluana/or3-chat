import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useDocumentsList } from '../useDocumentsList';
import * as documentsDb from '~/db/documents';

vi.mock('~/db/documents', () => ({
    listDocuments: vi.fn(),
}));

vi.mock('#imports', () => ({
    useToast: vi.fn(() => ({
        add: vi.fn(),
    })),
}));

vi.mock('../../core/useHookEffect', () => ({
    useHookEffect: vi.fn(),
}));

describe('useDocumentsList - race conditions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('prevents concurrent refresh calls from racing', async () => {
        const mockDocs = [
            {
                id: 'doc1',
                title: 'Doc 1',
                content: { type: 'doc', content: [] },
                postType: 'document',
                created_at: Date.now(),
                updated_at: Date.now(),
                deleted: false,
            },
        ];

        let resolveCount = 0;
        vi.mocked(documentsDb.listDocuments).mockImplementation(async () => {
            resolveCount++;
            await new Promise((resolve) => setTimeout(resolve, 100));
            return mockDocs as any;
        });

        const { refresh } = useDocumentsList();

        // Trigger multiple concurrent refreshes
        const promise1 = refresh();
        const promise2 = refresh();
        const promise3 = refresh();

        await Promise.all([promise1, promise2, promise3]);

        // Should only fetch once despite multiple calls
        expect(documentsDb.listDocuments).toHaveBeenCalledTimes(1);
    });

    it('strips content field from documents for memory efficiency', async () => {
        const mockDocs = [
            {
                id: 'doc1',
                title: 'Doc 1',
                content: { type: 'doc', content: [] }, // Large content
                postType: 'document',
                created_at: Date.now(),
                updated_at: Date.now(),
                deleted: false,
                meta: {},
            },
        ];

        vi.mocked(documentsDb.listDocuments).mockResolvedValue(mockDocs as any);

        const { docs, refresh } = useDocumentsList();
        await refresh();

        expect(docs.value).toHaveLength(1);
        expect(docs.value[0]?.content).toBe(null);
        expect(docs.value[0]?.title).toBe('Doc 1');
    });

    it('handles errors without crashing', async () => {
        vi.mocked(documentsDb.listDocuments).mockRejectedValue(
            new Error('Network error')
        );

        const { error, loading, refresh } = useDocumentsList();

        await refresh();

        expect(error.value).toBeDefined();
        expect(loading.value).toBe(false);
    });
});
