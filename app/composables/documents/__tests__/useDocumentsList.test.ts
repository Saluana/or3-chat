import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { effectScope } from 'vue';
import { setActiveWorkspaceDb } from '~/db/client';
import { useHookEffect } from '../../core/useHookEffect';
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
        vi.stubGlobal('process', { ...process, client: true });
    });
    afterEach(() => vi.unstubAllGlobals());

    // Retained sidebar consumers must discard old reads and rerun invalidations
    // arriving during a read; current coalescing alone loses those changes.
    it.each(['workspace', 'dispose'] as const)('ignores a delayed list after %s', async action => {
        let finish!: (rows: documentsDb.Document[]) => void;
        vi.mocked(documentsDb.listDocuments).mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValue([]);
        const scope = effectScope();
        const api = scope.run(() => useDocumentsList())!;
        const pending = api.refresh();
        try {
            let destination: Promise<void> | undefined;
            if (action === 'dispose') scope.stop();
            else { setActiveWorkspaceDb('document-list-target'); destination = api.refresh(); }
            finish([{ id: 'origin', title: 'Private origin', content: null, created_at: 1, updated_at: 1, deleted: false }]);
            await Promise.all([pending, destination]);
            expect(api.docs.value).toEqual([]);
        } finally { scope.stop(); setActiveWorkspaceDb(null); }
    });

    it('refreshes again when a document changes during the current read', async () => {
        let finish!: (rows: documentsDb.Document[]) => void;
        vi.mocked(documentsDb.listDocuments).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }))
            .mockResolvedValue([{ id: 'new', title: 'New document', content: null, created_at: 1, updated_at: 1, deleted: false }]);
        const scope = effectScope();
        const api = scope.run(() => useDocumentsList())!;
        const pending = api.refresh();
        try {
            const callback = vi.mocked(useHookEffect).mock.calls.find(([name]) => name === 'db.documents.create:action:after')?.[1];
            expect(callback).toBeDefined();
            const invalidated = (callback as () => Promise<void>)();
            finish([]);
            await Promise.all([pending, invalidated]);
            expect(api.docs.value.map(doc => doc.id)).toEqual(['new']);
        } finally { scope.stop(); }
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
