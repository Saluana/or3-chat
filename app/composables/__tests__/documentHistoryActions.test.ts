import { describe, it, expect, beforeEach } from 'vitest';
import {
    registerDocumentHistoryAction,
    unregisterDocumentHistoryAction,
    listRegisteredDocumentHistoryActionIds,
    useDocumentHistoryActions,
} from '../documents/useDocumentHistoryActions';

describe('useDocumentHistoryActions', () => {
    beforeEach(() => {
        // Clear registry before each test
        const ids = listRegisteredDocumentHistoryActionIds();
        ids.forEach((id) => unregisterDocumentHistoryAction(id));
    });

    it('registers a document history action', () => {
        registerDocumentHistoryAction({
            id: 'test:export',
            icon: 'i-carbon-download',
            label: 'Export Document',
            handler: async ({ document }) => {
                console.log('Exporting document:', document.id);
            },
        });

        const ids = listRegisteredDocumentHistoryActionIds();
        expect(ids).toContain('test:export');
    });

    it('unregisters a document history action', () => {
        registerDocumentHistoryAction({
            id: 'test:share',
            icon: 'i-carbon-share',
            label: 'Share Document',
            handler: async ({ document }) => {
                console.log('Sharing document:', document.id);
            },
        });

        expect(listRegisteredDocumentHistoryActionIds()).toContain(
            'test:share'
        );

        unregisterDocumentHistoryAction('test:share');

        expect(listRegisteredDocumentHistoryActionIds()).not.toContain(
            'test:share'
        );
    });

    it('replaces action with duplicate id', () => {
        registerDocumentHistoryAction({
            id: 'test:action',
            icon: 'i-carbon-add',
            label: 'First Action',
            handler: () => {},
        });

        registerDocumentHistoryAction({
            id: 'test:action',
            icon: 'i-carbon-subtract',
            label: 'Second Action',
            handler: () => {},
        });

        const ids = listRegisteredDocumentHistoryActionIds();
        expect(ids.filter((id) => id === 'test:action')).toHaveLength(1);
    });

    it('sorts actions by order (default 200)', () => {
        registerDocumentHistoryAction({
            id: 'test:last',
            icon: 'i-carbon-z',
            label: 'Last',
            order: 300,
            handler: () => {},
        });

        registerDocumentHistoryAction({
            id: 'test:first',
            icon: 'i-carbon-a',
            label: 'First',
            order: 100,
            handler: () => {},
        });

        registerDocumentHistoryAction({
            id: 'test:middle',
            icon: 'i-carbon-m',
            label: 'Middle',
            // order defaults to 200
            handler: () => {},
        });

        const actions = useDocumentHistoryActions();
        const ids = actions.value.map((a) => a.id);

        expect(ids).toEqual(['test:first', 'test:middle', 'test:last']);
    });

    it('maintains reactivity when actions are added', () => {
        const actions = useDocumentHistoryActions();

        expect(actions.value).toHaveLength(0);

        registerDocumentHistoryAction({
            id: 'test:new',
            icon: 'i-carbon-add',
            label: 'New Action',
            handler: () => {},
        });

        expect(actions.value).toHaveLength(1);
        expect(actions.value[0]?.id).toBe('test:new');
    });

    it('maintains reactivity when actions are removed', () => {
        registerDocumentHistoryAction({
            id: 'test:remove',
            icon: 'i-carbon-trash-can',
            label: 'Remove Me',
            handler: () => {},
        });

        const actions = useDocumentHistoryActions();
        expect(actions.value).toHaveLength(1);

        unregisterDocumentHistoryAction('test:remove');

        expect(actions.value).toHaveLength(0);
    });
});
