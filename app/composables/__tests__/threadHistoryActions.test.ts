import { describe, it, expect, beforeEach } from 'vitest';
import {
    registerThreadHistoryAction,
    unregisterThreadHistoryAction,
    listRegisteredThreadHistoryActionIds,
    useThreadHistoryActions,
} from '../ui-extensions/threads/useThreadHistoryActions';

describe('useThreadHistoryActions', () => {
    beforeEach(() => {
        // Clear registry before each test
        const ids = listRegisteredThreadHistoryActionIds();
        ids.forEach((id) => unregisterThreadHistoryAction(id));
    });

    it('registers a thread history action', () => {
        registerThreadHistoryAction({
            id: 'test:export',
            icon: 'i-carbon-download',
            label: 'Export Thread',
            handler: async ({ document }) => {
                console.log('Exporting thread:', document.id);
            },
        });

        const ids = listRegisteredThreadHistoryActionIds();
        expect(ids).toContain('test:export');
    });

    it('unregisters a thread history action', () => {
        registerThreadHistoryAction({
            id: 'test:share',
            icon: 'i-carbon-share',
            label: 'Share Thread',
            handler: async ({ document }) => {
                console.log('Sharing thread:', document.id);
            },
        });

        expect(listRegisteredThreadHistoryActionIds()).toContain('test:share');

        unregisterThreadHistoryAction('test:share');

        expect(listRegisteredThreadHistoryActionIds()).not.toContain(
            'test:share'
        );
    });

    it('replaces action with duplicate id', () => {
        registerThreadHistoryAction({
            id: 'test:action',
            icon: 'i-carbon-add',
            label: 'First Action',
            handler: () => {},
        });

        registerThreadHistoryAction({
            id: 'test:action',
            icon: 'i-carbon-subtract',
            label: 'Second Action',
            handler: () => {},
        });

        const ids = listRegisteredThreadHistoryActionIds();
        expect(ids.filter((id) => id === 'test:action')).toHaveLength(1);
    });

    it('sorts actions by order (default 200)', () => {
        registerThreadHistoryAction({
            id: 'test:last',
            icon: 'i-carbon-z',
            label: 'Last',
            order: 300,
            handler: () => {},
        });

        registerThreadHistoryAction({
            id: 'test:first',
            icon: 'i-carbon-a',
            label: 'First',
            order: 100,
            handler: () => {},
        });

        registerThreadHistoryAction({
            id: 'test:middle',
            icon: 'i-carbon-m',
            label: 'Middle',
            // order defaults to 200
            handler: () => {},
        });

        const actions = useThreadHistoryActions();
        const ids = actions.value.map((a) => a.id);

        expect(ids).toEqual(['test:first', 'test:middle', 'test:last']);
    });

    it('maintains reactivity when actions are added', () => {
        const actions = useThreadHistoryActions();

        expect(actions.value).toHaveLength(0);

        registerThreadHistoryAction({
            id: 'test:new',
            icon: 'i-carbon-add',
            label: 'New Action',
            handler: () => {},
        });

        expect(actions.value).toHaveLength(1);
        expect(actions.value[0]?.id).toBe('test:new');
    });

    it('maintains reactivity when actions are removed', () => {
        registerThreadHistoryAction({
            id: 'test:remove',
            icon: 'i-carbon-trash-can',
            label: 'Remove Me',
            handler: () => {},
        });

        const actions = useThreadHistoryActions();
        expect(actions.value).toHaveLength(1);

        unregisterThreadHistoryAction('test:remove');

        expect(actions.value).toHaveLength(0);
    });
});
