import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { computed } from 'vue';
import NotificationItem from '../NotificationItem.vue';
import type { Notification } from '~/db/schema';

const pushMock = vi.fn();

vi.mock('vue-router', () => ({
    useRouter: () => ({ push: pushMock }),
}));

vi.mock('~/composables/useIcon', () => ({
    useIcon: (token: string) => computed(() => token),
}));

const baseNotification = (): Notification => ({
    id: 'n1',
    user_id: 'temp-user',
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
});
