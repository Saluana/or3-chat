import { beforeEach, describe, expect, it } from 'vitest';
import {
    listRegisteredMessageActionIds,
    registerMessageAction,
    unregisterMessageAction,
    useMessageActions,
} from '../useMessageActions';

describe('useMessageActions', () => {
    beforeEach(() => {
        listRegisteredMessageActionIds().forEach((id) => unregisterMessageAction(id));
    });

    it('filters actions by role and access policy', () => {
        registerMessageAction({
            id: 'test:assistant-auth',
            icon: 'pixelarticons:lock',
            tooltip: 'Auth only',
            showOn: 'assistant',
            access: { authRequired: true },
            handler: () => {},
        });

        registerMessageAction({
            id: 'test:user-open',
            icon: 'pixelarticons:user',
            tooltip: 'Open',
            showOn: 'user',
            handler: () => {},
        });

        const assistant = useMessageActions({ role: 'assistant' }).value;
        const user = useMessageActions({ role: 'user' }).value;

        expect(assistant.map((entry) => entry.id)).toEqual([]);
        expect(user.map((entry) => entry.id)).toEqual(['test:user-open']);
    });
});
