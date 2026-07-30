import { beforeEach, describe, expect, it } from 'vitest';
import {
    listRegisteredDocumentHistoryActionIds,
    registerDocumentHistoryAction,
    unregisterDocumentHistoryAction,
    useDocumentHistoryActions,
} from '../documents/useDocumentHistoryActions';
import {
    listRegisteredThreadHistoryActionIds,
    registerThreadHistoryAction,
    unregisterThreadHistoryAction,
    useThreadHistoryActions,
} from '../threads/useThreadHistoryActions';

type TestAction = {
    id: string;
    icon: string;
    label: string;
    order?: number;
    handler: () => void;
};

const surfaces = [
    {
        label: 'document',
        register: registerDocumentHistoryAction as (action: TestAction) => void,
        unregister: unregisterDocumentHistoryAction,
        listIds: listRegisteredDocumentHistoryActionIds,
        useActions: useDocumentHistoryActions as unknown as () => {
            readonly value: readonly TestAction[];
        },
    },
    {
        label: 'thread',
        register: registerThreadHistoryAction as (action: TestAction) => void,
        unregister: unregisterThreadHistoryAction,
        listIds: listRegisteredThreadHistoryActionIds,
        useActions: useThreadHistoryActions as unknown as () => {
            readonly value: readonly TestAction[];
        },
    },
];

describe.each(surfaces)('$label history actions', (surface) => {
    beforeEach(() => {
        for (const id of surface.listIds()) surface.unregister(id);
    });

    it('registers, replaces, and unregisters actions reactively', () => {
        const actions = surface.useActions();
        surface.register({
            id: 'test:action',
            icon: 'first',
            label: 'First',
            handler: () => {},
        });
        surface.register({
            id: 'test:action',
            icon: 'replacement',
            label: 'Replacement',
            handler: () => {},
        });

        expect(surface.listIds()).toEqual(['test:action']);
        expect(actions.value).toMatchObject([
            { id: 'test:action', label: 'Replacement' },
        ]);

        surface.unregister('test:action');
        expect(actions.value).toEqual([]);
    });

    it('sorts explicit order around the default order', () => {
        for (const action of [
            { id: 'last', order: 300 },
            { id: 'first', order: 100 },
            { id: 'middle' },
        ]) {
            surface.register({
                ...action,
                icon: action.id,
                label: action.id,
                handler: () => {},
            });
        }

        expect(surface.useActions().value.map((action) => action.id)).toEqual([
            'first',
            'middle',
            'last',
        ]);
    });
});
