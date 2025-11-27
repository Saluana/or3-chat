import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
import { createHookEngine } from '../../core/hooks/hooks';

vi.mock('#app', () => ({ useNuxtApp: () => ({ $hooks: hookEngine }) }));

import { useMultiPane } from '../core/useMultiPane';
import { usePaneDocuments } from '../documents/usePaneDocuments';

// Provide hook engine AFTER declaration (var hoisting)
const hookEngine = createHookEngine();

// Minimal stubs
vi.mock('../../db', () => ({
    db: {
        messages: {
            where: () => ({
                between: () => ({ filter: () => ({ toArray: () => [] }) }),
            }),
        },
    },
}));
vi.mock('../useDocumentsStore', () => ({
    releaseDocument: vi.fn(),
    useDocumentState: (id: string) => ({
        id,
        pendingTitle: 't',
        pendingContent: 'c',
    }),
}));

// Fake doc create/flush
const createNewDoc = vi.fn().mockResolvedValue({ id: 'doc-1' });
const flushDocument = vi.fn().mockResolvedValue(undefined);

describe('multi-pane new hooks', () => {
    beforeEach(() => {
        hookEngine.removeAllCallbacks();
    });

    it('emits blur->switch->active order', () => {
        const calls: string[] = [];
        hookEngine.addAction('ui.pane.blur:action', () => calls.push('blur'));
        hookEngine.addAction('ui.pane.switch:action', () =>
            calls.push('switch')
        );
        hookEngine.addAction('ui.pane.active:action', () =>
            calls.push('active')
        );
        const { addPane, setActive } = useMultiPane();
        addPane(); // second pane
        setActive(1);
        expect(calls).toEqual(['blur', 'switch', 'active']);
    });

    it('thread filter can transform and changed fires', async () => {
        const { setPaneThread, panes } = useMultiPane();
        hookEngine.addFilter(
            'ui.pane.thread:filter:select',
            ((_req: string, _pane: unknown) => 'thread-X') as (
                v: unknown
            ) => unknown
        );
        let changed: {
            oldId: string;
            newId: string;
            paneIndex: number;
        } | null = null;
        hookEngine.addAction('ui.pane.thread:action:changed', ((payload: {
            oldThreadId: string;
            newThreadId: string;
            paneIndex: number;
        }) => {
            changed = {
                oldId: payload.oldThreadId,
                newId: payload.newThreadId,
                paneIndex: payload.paneIndex,
            };
        }) as (...args: unknown[]) => unknown);
        await setPaneThread(0, 'thread-1');
        expect(panes.value[0]!.threadId).toBe('thread-X');
        expect(changed).toEqual({
            oldId: '',
            newId: 'thread-X',
            paneIndex: 0,
        });
    });

    it('doc hooks fire on new document', async () => {
        const panes = ref([
            {
                id: 'p1',
                mode: 'chat',
                threadId: '',
                messages: [],
                validating: false,
            } as any,
        ]);
        const activePaneIndex = ref(0);
        const calls: string[] = [];
        hookEngine.addAction('ui.pane.doc:action:changed', () =>
            calls.push('doc:changed')
        );
        hookEngine.addAction('ui.pane.doc:action:saved', () =>
            calls.push('doc:saved')
        );
        const { newDocumentInActive } = usePaneDocuments({
            panes,
            activePaneIndex,
            createNewDoc,
            flushDocument,
        });
        await newDocumentInActive();
        expect(calls.includes('doc:changed')).toBe(true);
    });
});
