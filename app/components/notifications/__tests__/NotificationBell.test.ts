import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref, computed, defineComponent, h } from 'vue';
import NotificationBell from '../NotificationBell.vue';

const unreadCountRef = ref(0);

vi.mock('~/composables/notifications/useNotifications', () => ({
    useNotifications: () => ({
        unreadCount: computed(() => unreadCountRef.value),
    }),
}));

vi.mock('~/composables/useIcon', () => ({
    useIcon: () => computed(() => 'icon-bell'),
}));

vi.mock('vue-router', () => ({
    useRoute: () => ({ fullPath: '/' }),
}));

const UPopoverStub = defineComponent({
    setup(_props, { slots }) {
        return () =>
            h('div', [slots.default?.(), slots.content ? slots.content() : null]);
    },
});

const UTooltipStub = defineComponent({
    props: { text: { type: String, default: '' } },
    setup(props, { slots }) {
        return () => h('div', { 'data-tooltip': props.text }, slots.default?.());
    },
});

const UButtonStub = {
    template: '<button type="button"><slot /></button>',
};

const UIconStub = {
    template: '<span class="icon" />',
};

describe('NotificationBell', () => {
    beforeEach(() => {
        unreadCountRef.value = 0;
    });

    it('shows tooltip with no unread count', () => {
        const wrapper = mount(NotificationBell, {
            global: {
                stubs: {
                    UPopover: UPopoverStub,
                    UTooltip: UTooltipStub,
                    UButton: UButtonStub,
                    UIcon: UIconStub,
                    NotificationsNotificationPanel: true,
                },
            },
        });

        const tooltip = wrapper.find('[data-tooltip]');
        expect(tooltip.attributes('data-tooltip')).toBe('Notifications');
        expect(wrapper.find('[aria-label="0 unread notifications"]').exists()).toBe(false);
    });

    it('caps badge at 99+ and updates tooltip', () => {
        unreadCountRef.value = 120;
        const wrapper = mount(NotificationBell, {
            global: {
                stubs: {
                    UPopover: UPopoverStub,
                    UTooltip: UTooltipStub,
                    UButton: UButtonStub,
                    UIcon: UIconStub,
                    NotificationsNotificationPanel: true,
                },
            },
        });

        const tooltip = wrapper.find('[data-tooltip]');
        expect(tooltip.attributes('data-tooltip')).toBe('Notifications (99+ unread)');
        expect(wrapper.text()).toContain('99+');
    });
});
