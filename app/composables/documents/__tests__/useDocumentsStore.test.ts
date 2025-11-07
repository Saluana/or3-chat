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
    createDocument: vi.fn(),
    updateDocument: vi.fn(),
    getDocument: vi.fn(),
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
            content: { type: 'doc', content: [] },
            postType: 'document',
            created_at: Date.now(),
            updated_at: Date.now(),
            deleted: false,
        };

        vi.mocked(documentsDb.getDocument).mockResolvedValue(mockDoc);
        vi.mocked(documentsDb.updateDocument).mockResolvedValue(mockDoc);

        await loadDocument('doc1');
        
        // Schedule a save which creates a timer
        setDocumentTitle('doc1', 'New Title');
        
        const state = useDocumentState('doc1');
        expect(state.timer).toBeDefined();
        
        // Flush should clear the timer
        await flush('doc1');
        
        expect(state.timer).toBeUndefined();
    });

    it('clears timer when releasing document', async () => {
        const mockDoc = {
            id: 'doc2',
            title: 'Test Doc 2',
            content: { type: 'doc', content: [] },
            postType: 'document',
            created_at: Date.now(),
            updated_at: Date.now(),
            deleted: false,
        };

        vi.mocked(documentsDb.getDocument).mockResolvedValue(mockDoc);
        vi.mocked(documentsDb.updateDocument).mockResolvedValue(mockDoc);

        await loadDocument('doc2');
        setDocumentTitle('doc2', 'New Title');
        
        const state = useDocumentState('doc2');
        expect(state.timer).toBeDefined();
        
        await releaseDocument('doc2');
        
        expect(state.timer).toBeUndefined();
    });

    it('nullifies content field when releasing document', async () => {
        const largeContent = {
            type: 'doc',
            content: Array(1000).fill({ type: 'paragraph', content: [{ type: 'text', text: 'Large content' }] }),
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

        vi.mocked(documentsDb.getDocument).mockResolvedValue(mockDoc);

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
            content: { type: 'doc', content: [] },
            postType: 'document',
            created_at: Date.now(),
            updated_at: Date.now(),
            deleted: false,
        };

        vi.mocked(documentsDb.getDocument).mockResolvedValue(mockDoc);
        vi.mocked(documentsDb.updateDocument).mockResolvedValue(mockDoc);

        await loadDocument('doc4');
        setDocumentTitle('doc4', 'New Title');
        
        // Multiple concurrent flush calls
        await Promise.all([flush('doc4'), flush('doc4'), flush('doc4')]);
        
        // Should only update once because timer is cleared on first flush
        expect(documentsDb.updateDocument).toHaveBeenCalledTimes(1);
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
            content: { type: 'doc', content: [] },
            postType: 'document',
            created_at: Date.now(),
            updated_at: Date.now(),
            deleted: false,
        };

        vi.mocked(documentsDb.getDocument).mockResolvedValue(mockDoc);
        vi.mocked(documentsDb.updateDocument).mockResolvedValue(mockDoc);

        await loadDocument('doc5');
        
        // Set content with various types
        setDocumentContent('doc5', { custom: 'data' });
        setDocumentContent('doc5', null);
        setDocumentContent('doc5', undefined);
        
        const state = useDocumentState('doc5');
        expect(state.pendingContent).toBeUndefined();
    });

    it('handles errors gracefully without throwing', async () => {
        vi.mocked(documentsDb.getDocument).mockRejectedValue(new Error('Network error'));

        await expect(loadDocument('doc6')).resolves.toBeNull();
        
        const state = useDocumentState('doc6');
        expect(state.status).toBe('error');
        expect(state.lastError).toBeDefined();
    });
});
