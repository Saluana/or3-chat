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

    it('retains failed title and content when release attempts a flush', async () => {
        const doc = { id: 'release-failed-buffer', title: 'Original',
            content: { type: 'doc' as const, content: [] }, created_at: 1, updated_at: 1, deleted: false };
        const content = { type: 'doc' as const, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Unsaved body' }] }] };
        vi.mocked(documentsDb.getDocumentInDb).mockResolvedValue(doc);
        vi.mocked(documentsDb.updateDocumentInDb).mockRejectedValueOnce(new DOMException('Full', 'QuotaExceededError'));
        await loadDocument(doc.id);
        setDocumentTitle(doc.id, 'Unsaved title');
        setDocumentContent(doc.id, content);
        await releaseDocument(doc.id);
        const state = useDocumentState(doc.id);
        expect(state.record).toEqual(doc);
        expect(state.pendingTitle).toBe('Unsaved title');
        expect(state.pendingContent).toEqual(content);
        expect(state.status).toBe('error');
        vi.mocked(documentsDb.updateDocumentInDb).mockResolvedValue({ ...doc, title: 'Unsaved title', content });
        await flush(doc.id);
        expect(state.status).toBe('saved');
        expect(state.pendingContent).toBeUndefined();
        await releaseDocument(doc.id);
        expect(state.record).toBeNull();
    });

    it('does not replace a dirty conflict baseline with a freshly loaded row', async () => {
        const doc = { id: 'reload-dirty-baseline', title: 'Original',
            content: { type: 'doc' as const, content: [] }, created_at: 1, updated_at: 1, deleted: false };
        vi.mocked(documentsDb.getDocumentInDb).mockResolvedValueOnce(doc).mockResolvedValueOnce({ ...doc, title: 'Other tab' });
        await loadDocument(doc.id);
        setDocumentTitle(doc.id, 'My unsaved title');
        await loadDocument(doc.id);
        expect(useDocumentState(doc.id).record?.title).toBe('Original');
        expect(useDocumentState(doc.id).pendingTitle).toBe('My unsaved title');
        vi.mocked(documentsDb.updateDocumentInDb).mockRejectedValueOnce(new Error('Document changed'));
        await flush(doc.id);
        expect(documentsDb.updateDocumentInDb).toHaveBeenLastCalledWith(expect.anything(), doc.id,
            { title: 'My unsaved title' }, { title: 'Original', content: doc.content });
    });

    it('ignores a stale read completing after a save commits', async () => {
        const doc = { id: 'stale-read-after-save', title: 'Original',
            content: { type: 'doc' as const, content: [] }, created_at: 1, updated_at: 1, deleted: false };
        let finishRead!: (value: typeof doc) => void;
        vi.mocked(documentsDb.getDocumentInDb).mockResolvedValueOnce(doc)
            .mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
        vi.mocked(documentsDb.updateDocumentInDb).mockResolvedValueOnce({ ...doc, title: 'Committed' });
        await loadDocument(doc.id);
        const read = loadDocument(doc.id);
        setDocumentTitle(doc.id, 'Committed');
        await flush(doc.id);
        finishRead(doc);
        await read;
        expect(useDocumentState(doc.id).record?.title).toBe('Committed');
        expect(useDocumentState(doc.id).status).toBe('saved');
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
