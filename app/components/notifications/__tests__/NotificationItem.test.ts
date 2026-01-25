import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { computed } from 'vue';
import NotificationItem from '../NotificationItem.vue';
import type { Notification } from '~/db/schema';

const pushMock = vi.fn();
const doActionMock = vi.fn();

vi.mock('vue-router', () => ({
    useRouter: () => ({ push: pushMock }),
}));

vi.mock('~/composables/useIcon', () => ({
    useIcon: (token: string) => computed(() => token),
}));

vi.mock('~/core/hooks/useHooks', () => ({
    useHooks: () => ({ doAction: doActionMock }),
}));

const baseNotification = (): Notification => ({
    id: 'n1',
    user_id: 'local-user',
    type: 'system.warning',
    title: 'Alert',
    body: 'Body',
    actions: [
        {
            id: 'a1',
            label: 'Open',
            kind: 'navigate',
            target: { route: '/chat/123' },
        },
    ],
    deleted: false,
    created_at: 10,
    updated_at: 10,
    clock: 10,
});

const UButtonStub = {
    template: '<button type="button" @click="$emit(\'click\', $event)"><slot /></button>',
};

const UIconStub = {
    template: '<span />',
};

describe('NotificationItem', () => {
    beforeEach(() => {
        pushMock.mockClear();
        doActionMock.mockClear();
    });

    it('marks read once when clicking the item with a navigate action', async () => {
        const onMarkRead = vi.fn().mockResolvedValue(undefined);
        const wrapper = mount(NotificationItem, {
            props: {
                notification: baseNotification(),
                onMarkRead,
            },
            global: {
                stubs: { UButton: UButtonStub, UIcon: UIconStub },
            },
        });

        await wrapper.trigger('click');

        expect(onMarkRead).toHaveBeenCalledTimes(1);
        expect(pushMock).toHaveBeenCalledWith('/chat/123');
    });

    it('marks read once when clicking an action button', async () => {
        const onMarkRead = vi.fn().mockResolvedValue(undefined);
        const wrapper = mount(NotificationItem, {
            props: {
                notification: baseNotification(),
                onMarkRead,
            },
            global: {
                stubs: { UButton: UButtonStub, UIcon: UIconStub },
            },
        });

        await wrapper.find('button').trigger('click');

        expect(onMarkRead).toHaveBeenCalledTimes(1);
        expect(pushMock).toHaveBeenCalledWith('/chat/123');
    });

    it('emits hook action for callback actions', async () => {
        const onMarkRead = vi.fn().mockResolvedValue(undefined);
        const notification = baseNotification();
        notification.actions = [
            {
                id: 'cb1',
                label: 'Run',
                kind: 'callback',
                data: { foo: 'bar' },
            },
        ];
        const wrapper = mount(NotificationItem, {
            props: {
                notification,
                onMarkRead,
            },
            global: {
                stubs: { UButton: UButtonStub, UIcon: UIconStub },
            },
        });

        await wrapper.find('button').trigger('click');

        expect(onMarkRead).toHaveBeenCalledTimes(1);
        expect(doActionMock).toHaveBeenCalledWith('notify:action:clicked', {
            notification,
            action: notification.actions[0],
        });
    });

    it('routes to thread when target threadId is provided', async () => {
        const onMarkRead = vi.fn().mockResolvedValue(undefined);
        const notification = baseNotification();
        notification.actions = [
            {
                id: 'nav1',
                label: 'Open thread',
                kind: 'navigate',
                target: { threadId: 'thread-9' },
            },
        ];
        const wrapper = mount(NotificationItem, {
            props: {
                notification,
                onMarkRead,
            },
            global: {
                stubs: { UButton: UButtonStub, UIcon: UIconStub },
            },
        });

        await wrapper.trigger('click');

        expect(pushMock).toHaveBeenCalledWith('/chat/thread-9');
    });
});
