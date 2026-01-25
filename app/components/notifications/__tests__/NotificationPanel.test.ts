import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref, computed } from 'vue';
import NotificationPanel from '../NotificationPanel.vue';
import type { Notification } from '~/db/schema';

const notificationsRef = ref<Notification[]>([]);
const unreadCountRef = ref(0);
const loadingRef = ref(false);
const markReadMock = vi.fn();
const markAllReadMock = vi.fn();
const clearAllMock = vi.fn().mockResolvedValue(0);

vi.mock('~/composables/notifications/useNotifications', () => ({
    useNotifications: () => ({
        notifications: computed(() => notificationsRef.value),
        unreadCount: computed(() => unreadCountRef.value),
        loading: computed(() => loadingRef.value),
        markRead: markReadMock,
        markAllRead: markAllReadMock,
        clearAll: clearAllMock,
    }),
}));

vi.mock('~/composables/useIcon', () => ({
    useIcon: () => computed(() => 'icon-bell'),
}));

const UButtonStub = {
    emits: ['click'],
    template: '<button type="button" @click="$emit(\'click\')"><slot /></button>',
};

const UIconStub = {
    template: '<span class="icon" />',
};

const NotificationItemStub = {
    template: '<div class="notification-item-stub" />',
    props: ['notification', 'onMarkRead'],
};

describe('NotificationPanel', () => {
    beforeEach(() => {
        notificationsRef.value = [];
        unreadCountRef.value = 0;
        loadingRef.value = false;
        markReadMock.mockClear();
        markAllReadMock.mockClear();
        clearAllMock.mockClear();
    });

    it('renders loading state', () => {
        loadingRef.value = true;
        const wrapper = mount(NotificationPanel, {
            global: {
                stubs: {
                    UButton: UButtonStub,
                    UIcon: UIconStub,
                    NotificationsNotificationItem: NotificationItemStub,
                },
            },
        });

        expect(wrapper.text()).toContain('Loading...');
    });

    it('renders empty state when no notifications', () => {
        const wrapper = mount(NotificationPanel, {
            global: {
                stubs: {
                    UButton: UButtonStub,
                    UIcon: UIconStub,
                    NotificationsNotificationItem: NotificationItemStub,
                },
            },
        });

        expect(wrapper.text()).toContain('No notifications');
    });

    it('marks all read when button clicked', async () => {
        notificationsRef.value = [
            {
                id: 'n1',
                user_id: 'local-user',
                type: 'system.warning',
                title: 'Alert',
                deleted: false,
                created_at: 1,
                updated_at: 1,
                clock: 1,
            },
        ];
        unreadCountRef.value = 2;

        const wrapper = mount(NotificationPanel, {
            global: {
                stubs: {
                    UButton: UButtonStub,
                    UIcon: UIconStub,
                    NotificationsNotificationItem: NotificationItemStub,
                },
            },
        });

        markAllReadMock.mockClear();

        const markAllReadButton = wrapper
            .findAll('button')
            .find((btn) => btn.text().includes('Mark all read'));
        if (!markAllReadButton) throw new Error('Mark all read button not found');
        await markAllReadButton.trigger('click');

        expect(markAllReadMock).toHaveBeenCalledTimes(1);
    });

    it('confirms clear all flow', async () => {
        notificationsRef.value = [
            {
                id: 'n1',
                user_id: 'local-user',
                type: 'system.warning',
                title: 'Alert',
                deleted: false,
                created_at: 1,
                updated_at: 1,
                clock: 1,
            },
        ];

        const wrapper = mount(NotificationPanel, {
            global: {
                stubs: {
                    UButton: UButtonStub,
                    UIcon: UIconStub,
                    NotificationsNotificationItem: NotificationItemStub,
                },
            },
        });

        const clearButton = wrapper.findAll('button').find((btn) =>
            btn.text().includes('Clear all')
        );
        if (!clearButton) throw new Error('Clear button not found');
        await clearButton.trigger('click');

        expect(wrapper.text()).toContain('Clear all notifications?');

        const confirmButton = wrapper.findAll('button').find((btn) =>
            btn.text().includes('Clear')
        );
        if (!confirmButton) throw new Error('Confirm button not found');
        await confirmButton.trigger('click');

        expect(clearAllMock).toHaveBeenCalledTimes(1);
        expect(wrapper.text()).not.toContain('Clear all notifications?');
    });
});
