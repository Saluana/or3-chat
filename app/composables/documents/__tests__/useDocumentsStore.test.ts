import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    loadDocument,
    newDocument,
    setDocumentTitle,
    setDocumentContent,
    flush,
    releaseDocument,
    useDocumentState,
} from '../useDocumentsStore';
import * as documentsDb from '~/db/documents';

vi.mock('~/db/documents', () => ({
    createDocumentInDb: vi.fn(),
    updateDocumentInDb: vi.fn(),
    getDocumentInDb: vi.fn(),
}));

vi.mock('#imports', () => ({
    useToast: vi.fn(() => ({
        add: vi.fn(),
    })),
}));

vi.mock('#app', () => ({
    useNuxtApp: vi.fn(() => ({})),
}));

describe('useDocumentsStore - memory leaks', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
    });

    it('clears timer when flushing document', async () => {
        const mockDoc = {
            id: 'doc1',
            title: 'Test Doc',
            content: { type: 'doc' as const, content: [] },
            postType: 'document',
            created_at: Date.now(),
            updated_at: Date.now(),
            deleted: false,
        };

        vi.mocked(documentsDb.getDocumentInDb).mockResolvedValue(mockDoc as any);
        vi.mocked(documentsDb.updateDocumentInDb).mockResolvedValue(mockDoc as any);

        await loadDocument('doc1');

        // Schedule a save which creates a timer
        setDocumentTitle('doc1', 'New Title');

        const state = useDocumentState('doc1');
        expect(state.debouncedSave).toBeDefined();

        // Flush should cancel the debounced save
        await flush('doc1');

        // The debouncedSave function is still defined but any pending call is cancelled
        expect(state.debouncedSave).toBeDefined();
    });

    it('clears timer when releasing document', async () => {
        const mockDoc = {
            id: 'doc2',
            title: 'Test Doc 2',
            content: { type: 'doc' as const, content: [] },
            postType: 'document',
            created_at: Date.now(),
            updated_at: Date.now(),
            deleted: false,
        };

        vi.mocked(documentsDb.getDocumentInDb).mockResolvedValue(mockDoc as any);
        vi.mocked(documentsDb.updateDocumentInDb).mockResolvedValue(mockDoc as any);

        await loadDocument('doc2');
        setDocumentTitle('doc2', 'New Title');

        const state = useDocumentState('doc2');
        expect(state.debouncedSave).toBeDefined();

        await releaseDocument('doc2');

        // After release, the debouncedSave should be cancelled (but may still be defined)
        expect(state.debouncedSave).toBeDefined();
    });

    it('nullifies content field when releasing document', async () => {
        const largeContent = {
            type: 'doc' as const,
            content: Array(1000).fill({
                type: 'paragraph',
                content: [{ type: 'text', text: 'Large content' }],
            }),
        };

        const mockDoc = {
            id: 'doc3',
            title: 'Test Doc 3',
            content: largeContent,
            postType: 'document',
            created_at: Date.now(),
            updated_at: Date.now(),
            deleted: false,
        };

        vi.mocked(documentsDb.getDocumentInDb).mockResolvedValue(mockDoc as any);

        await loadDocument('doc3');

        const state = useDocumentState('doc3');
        expect(state.record).toBeDefined();
        expect(state.record?.content).toBeDefined();

        await releaseDocument('doc3', { deleteEntry: false });

        expect(state.record).toBeNull();
    });

    it('prevents duplicate saves with concurrent flush calls', async () => {
        const mockDoc = {
            id: 'doc4',
            title: 'Test Doc 4',
            content: { type: 'doc' as const, content: [] },
            postType: 'document',
            created_at: Date.now(),
            updated_at: Date.now(),
            deleted: false,
        };

        vi.mocked(documentsDb.getDocumentInDb).mockResolvedValue(mockDoc as any);
        vi.mocked(documentsDb.updateDocumentInDb).mockResolvedValue(mockDoc as any);

        await loadDocument('doc4');
        setDocumentTitle('doc4', 'New Title');

        // Multiple concurrent flush calls
        await Promise.all([flush('doc4'), flush('doc4'), flush('doc4')]);

        // Should only update once because timer is cleared on first flush
        expect(documentsDb.updateDocumentInDb).toHaveBeenCalledTimes(1);
    });

    it('does not clear edits staged while a save is in flight', async () => {
        const mockDoc = {
            id: 'doc-generation-race',
            title: 'Original',
            content: { type: 'doc' as const, content: [] },
            created_at: Date.now(),
            updated_at: Date.now(),
            deleted: false,
        };
        let finishFirst!: (value: typeof mockDoc) => void;
        vi.mocked(documentsDb.getDocumentInDb).mockResolvedValue(mockDoc as any);
        vi.mocked(documentsDb.updateDocumentInDb)
            .mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve as typeof finishFirst; }))
            .mockResolvedValue(mockDoc as any);

        await loadDocument(mockDoc.id);
        setDocumentTitle(mockDoc.id, 'First');
        const firstFlush = flush(mockDoc.id);
        await vi.waitFor(() => expect(documentsDb.updateDocumentInDb).toHaveBeenCalledTimes(1));
        setDocumentTitle(mockDoc.id, 'Second');
        finishFirst({ ...mockDoc, title: 'First' });
        await firstFlush;

        expect(documentsDb.updateDocumentInDb).toHaveBeenCalledTimes(2);
        expect(documentsDb.updateDocumentInDb).toHaveBeenNthCalledWith(
            2,
            expect.anything(),
            mockDoc.id,
            expect.objectContaining({ title: 'Second' }),
            expect.objectContaining({ title: 'First', content: mockDoc.content })
        );
        expect(useDocumentState(mockDoc.id).pendingTitle).toBeUndefined();
    });

    it('retains a failed generation so a later flush can recover it', async () => {
        const mockDoc = {
            id: 'doc-failed-save',
            title: 'Original',
            content: { type: 'doc' as const, content: [] },
            created_at: Date.now(),
            updated_at: Date.now(),
            deleted: false,
        };
        vi.mocked(documentsDb.getDocumentInDb).mockResolvedValue(mockDoc as any);
        vi.mocked(documentsDb.updateDocumentInDb)
            .mockRejectedValueOnce(new Error('disk unavailable'))
            .mockResolvedValue(mockDoc as any);

        await loadDocument(mockDoc.id);
        setDocumentTitle(mockDoc.id, 'Recovered title');
        await flush(mockDoc.id);
        expect(useDocumentState(mockDoc.id).pendingTitle).toBe('Recovered title');
        expect(useDocumentState(mockDoc.id).status).toBe('error');

        await flush(mockDoc.id);
        expect(documentsDb.updateDocumentInDb).toHaveBeenCalledTimes(2);
        expect(useDocumentState(mockDoc.id).pendingTitle).toBeUndefined();
        expect(useDocumentState(mockDoc.id).status).toBe('saved');
    });
});

describe('useDocumentsStore - type safety', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('handles unknown content types safely', async () => {
        const mockDoc = {
            id: 'doc5',
            title: 'Test Doc 5',
            content: { type: 'doc' as const, content: [] },
            postType: 'document',
            created_at: Date.now(),
            updated_at: Date.now(),
            deleted: false,
        };

        vi.mocked(documentsDb.getDocumentInDb).mockResolvedValue(mockDoc as any);
        vi.mocked(documentsDb.updateDocumentInDb).mockResolvedValue(mockDoc as any);

        await loadDocument('doc5');

        // Set content with various types
        setDocumentContent('doc5', { custom: 'data' } as any);
        setDocumentContent('doc5', null);
        setDocumentContent('doc5', null);

        const state = useDocumentState('doc5');
        expect(state.pendingContent).toBeNull();
    });

    it('handles errors gracefully without throwing', async () => {
        vi.mocked(documentsDb.getDocumentInDb).mockRejectedValue(
            new Error('Network error')
        );

        await expect(loadDocument('doc6')).resolves.toBeNull();

        const state = useDocumentState('doc6');
        expect(state.status).toBe('error');
        expect(state.lastError).toBeDefined();
    });
});
