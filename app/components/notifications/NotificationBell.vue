<template>
    <UPopover :content="{ side: 'right', align: 'end' }">
        <UTooltip
            id="tooltip-notifications"
            :delay-duration="0"
            :content="{ side: 'right' }"
            :text="tooltipText"
        >
            <UButton
                v-bind="buttonProps"
                type="button"
                aria-label="Notifications"
                class="relative w-[48px] h-[48px] !p-0"
            >
                <template #default>
                    <span class="flex flex-col items-center gap-1 w-full relative">
                        <UIcon :name="iconBell" class="h-[24px] w-[24px]" />
                        <span
                            v-if="unreadCount > 0"
                            class="absolute -top-1 -right-1 bg-[var(--md-error)] text-[var(--md-on-error)] rounded-full min-w-[16px] h-[16px] flex items-center justify-center text-[10px] font-bold px-1"
                            :aria-label="`${unreadCount} unread notifications`"
                        >
                            {{ unreadCount > 99 ? '99+' : unreadCount }}
                        </span>
                    </span>
                </template>
            </UButton>
        </UTooltip>
        <template #content>
            <NotificationsNotificationPanel />
        </template>
    </UPopover>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { useIcon } from '~/composables/useIcon';
import { useNotifications } from '~/composables/notifications/useNotifications';

const iconBell = useIcon('notification.bell');
const { unreadCount } = useNotifications();

const tooltipText = computed(() => {
    if (unreadCount.value === 0) return 'Notifications';
    return `Notifications (${unreadCount.value > 99 ? '99+' : unreadCount.value} unread)`;
});

const buttonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'sidebar',
        identifier: 'sidebar.bottom-nav.notifications',
        isNuxtUI: true,
    });
    return {
        variant: 'soft' as const,
        color: 'neutral' as const,
        block: true,
        ...overrides.value,
    };
});
</script>
