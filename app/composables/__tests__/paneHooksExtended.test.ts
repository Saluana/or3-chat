import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { createHookEngine } from '../../core/hooks/hooks';

const hookEngine = createHookEngine();
const docState: Record<string, any> = {};

vi.mock('#app', () => ({ useNuxtApp: () => ({ $hooks: hookEngine }) }));
vi.mock('~/composables/useHooks', () => ({
    useHooks: () => hookEngine as any,
}));
vi.mock('../documents/useDocumentsStore', () => ({
    releaseDocument: vi.fn(),
    useDocumentState: (id: string) => docState[id],
}));

import { useMultiPane } from '~/composables/core/useMultiPane';
import { usePaneDocuments } from '~/composables/documents/usePaneDocuments';

describe('extended pane hooks coverage', () => {
    beforeEach(() => {
        hookEngine.removeAllCallbacks();
        for (const key of Object.keys(docState)) delete docState[key];
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
