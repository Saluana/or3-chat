import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { createHookEngine } from '../../core/hooks/hooks';

const hookEngine = createHookEngine();
const docState: Record<string, any> = {};
const releaseDocumentMock = vi.hoisted(() => vi.fn());
const toastAddMock = vi.hoisted(() => vi.fn());

vi.mock('#app', () => ({ useNuxtApp: () => ({ $hooks: hookEngine }) }));
vi.mock('#imports', () => ({
    useToast: () => ({ add: toastAddMock }),
}));
vi.mock('~/composables/useHooks', () => ({
    useHooks: () => hookEngine as any,
}));
vi.mock('../documents/useDocumentsStore', () => ({
    releaseDocument: releaseDocumentMock,
    useDocumentState: (id: string) => docState[id],
}));

import { useMultiPane } from '~/composables/core/useMultiPane';
import { usePaneDocuments } from '~/composables/documents/usePaneDocuments';

describe('extended pane hooks coverage', () => {
    beforeEach(() => {
        hookEngine.removeAllCallbacks();
        for (const key of Object.keys(docState)) delete docState[key];
        releaseDocumentMock.mockClear();
        toastAddMock.mockClear();
    });

    it('emits the changed thread and respects selection vetoes', async () => {
        const { setPaneThread, panes } = useMultiPane({
            loadMessagesFor: async () =>
                [
                    { role: 'user', content: 'a' },
                    { role: 'assistant', content: 'b' },
                ] as any,
        });
        const changed = vi.fn();
        hookEngine.addAction('ui.pane.thread:action:changed', changed);
        hookEngine.addFilter('ui.pane.thread:filter:select', ((requested: string) =>
            requested === 'veto' ? false : requested) as (value: unknown) => unknown);

        await setPaneThread(0, 'veto');
        expect(changed).not.toHaveBeenCalled();

        await setPaneThread(0, 'thread-ABC');
        expect(changed).toHaveBeenCalledWith(
            expect.objectContaining({
                oldThreadId: '',
                newThreadId: 'thread-ABC',
                messageCount: 2,
                paneIndex: 0,
            })
        );
        expect(panes.value[0]!.messages).toHaveLength(2);
    });

    it('emits saved and changed hooks when replacing a pending document', async () => {
        const panes = ref([
            {
                id: 'p1',
                mode: 'doc',
                threadId: '',
                documentId: 'doc-old',
                messages: [],
                validating: false,
            } as any,
        ]);
        const activePaneIndex = ref(0);
        docState['doc-old'] = {
            id: 'doc-old',
            pendingTitle: 'T',
            pendingContent: 'Body',
            status: 'saved',
        };
        const flushDocument = vi.fn().mockResolvedValue(undefined);
        const { newDocumentInActive } = usePaneDocuments({
            panes,
            activePaneIndex,
            createNewDoc: vi.fn().mockResolvedValue({ id: 'doc-new' }),
            flushDocument,
        });
        const saved = vi.fn();
        const changed = vi.fn();
        hookEngine.addAction('ui.pane.doc:action:saved', saved);
        hookEngine.addAction('ui.pane.doc:action:changed', changed);

        await newDocumentInActive({ title: 'New' });

        expect(flushDocument).toHaveBeenCalledWith('doc-old');
        expect(saved).toHaveBeenCalledWith(
            expect.objectContaining({ newDocumentId: 'doc-old' })
        );
        expect(changed).toHaveBeenCalledWith(
            expect.objectContaining({
                oldDocumentId: 'doc-old',
                newDocumentId: 'doc-new',
                paneIndex: 0,
            })
        );
    });

    it('keeps the current document open when a flush fails before selection', async () => {
        const panes = ref([
            {
                id: 'p1',
                mode: 'doc',
                threadId: '',
                documentId: 'doc-old',
                messages: [],
                validating: false,
            } as any,
        ]);
        const flushDocument = vi
            .fn()
            .mockRejectedValue(new Error('disk full'));
        docState['doc-old'] = {
            id: 'doc-old',
            pendingContent: { type: 'doc', content: [] },
            status: 'idle',
        };
        const changed = vi.fn();
        hookEngine.addAction('ui.pane.doc:action:changed', changed);

        const { selectDocumentInActive } = usePaneDocuments({
            panes,
            activePaneIndex: ref(0),
            createNewDoc: vi.fn(),
            flushDocument,
        });

        await selectDocumentInActive('doc-next');

        expect(panes.value[0]!.documentId).toBe('doc-old');
        expect(panes.value[0]!.mode).toBe('doc');
        expect(releaseDocumentMock).not.toHaveBeenCalled();
        expect(changed).not.toHaveBeenCalled();
        expect(toastAddMock).toHaveBeenCalledWith(
            expect.objectContaining({
                color: 'error',
                title: 'Document: save failed',
            })
        );
    });

    it('switches documents after a successful flush', async () => {
        const panes = ref([
            {
                id: 'p1',
                mode: 'doc',
                threadId: '',
                documentId: 'doc-old',
                messages: [],
                validating: false,
            } as any,
        ]);
        docState['doc-old'] = {
            id: 'doc-old',
            pendingContent: { type: 'doc', content: [] },
            status: 'saved',
        };
        const flushDocument = vi.fn().mockResolvedValue(undefined);
        const { selectDocumentInActive } = usePaneDocuments({
            panes,
            activePaneIndex: ref(0),
            createNewDoc: vi.fn(),
            flushDocument,
        });

        await selectDocumentInActive('doc-next');

        expect(flushDocument).toHaveBeenCalledWith('doc-old');
        expect(releaseDocumentMock).toHaveBeenCalledWith('doc-old', {
            flush: false,
        });
        expect(panes.value[0]!.documentId).toBe('doc-next');
        expect(panes.value[0]!.mode).toBe('doc');
    });

    it('does not replace the pane when a flush reports an error status', async () => {
        const panes = ref([
            {
                id: 'p1',
                mode: 'doc',
                threadId: '',
                documentId: 'doc-old',
                messages: [],
                validating: false,
            } as any,
        ]);
        docState['doc-old'] = {
            id: 'doc-old',
            pendingTitle: 'Unsaved title',
            status: 'error',
        };
        const { newDocumentInActive } = usePaneDocuments({
            panes,
            activePaneIndex: ref(0),
            createNewDoc: vi.fn(),
            flushDocument: vi.fn().mockResolvedValue(undefined),
        });

        await newDocumentInActive({ title: 'Next' });

        expect(panes.value[0]!.documentId).toBe('doc-old');
        expect(releaseDocumentMock).not.toHaveBeenCalled();
    });

    it('applies document selection transforms and vetoes', async () => {
        const panes = ref([
            {
                id: 'p1',
                mode: 'chat',
                threadId: '',
                documentId: undefined,
                messages: [],
                validating: false,
            } as any,
        ]);
        const { newDocumentInActive, selectDocumentInActive } =
            usePaneDocuments({
                panes,
                activePaneIndex: ref(0),
                createNewDoc: vi.fn().mockResolvedValue({ id: 'doc-B' }),
                flushDocument: vi.fn(),
            });
        hookEngine.addFilter('ui.pane.doc:filter:select', ((requested: string) =>
            requested === 'doc-B' ? 'doc-B-transformed' : requested) as (
            value: unknown
        ) => unknown);

        await newDocumentInActive();
        expect(panes.value[0]!.documentId).toBe('doc-B-transformed');

        const changed = vi.fn();
        hookEngine.addAction('ui.pane.doc:action:changed', changed);
        hookEngine.addFilter('ui.pane.doc:filter:select', ((requested: string) =>
            requested === 'doc-C' ? false : requested) as (
            value: unknown
        ) => unknown);
        await selectDocumentInActive('doc-C');
        expect(changed).not.toHaveBeenCalled();
    });
});
