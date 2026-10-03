<template>
    <UPopover v-model:open="open" :content="popoverContent">
        <UTooltip
            id="tooltip-notifications"
            :delay-duration="0"
            :content="tooltipContent"
            :text="tooltipText"
        >
            <UButton
                v-bind="mergedButtonProps"
                type="button"
                aria-label="Notifications"
                :class="['notification-bell-btn', baseButtonClass, buttonClass]"
            >
                <template #default>
                    <span class="flex flex-col items-center gap-1 w-full relative">
                        <svg
                            v-if="activeTheme === 'blank'"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.6"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            class="iconify"
                            :class="compact ? 'h-5 w-5' : 'h-[22px] w-[22px]'"
                            aria-hidden="true"
                        >
                            <path d="M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3H4a4 4 0 0 0 2-3v-3a7 7 0 0 1 4-6M9 17v1a3 3 0 0 0 6 0v-1" />
                        </svg>
                        <UIcon
                            v-else
                            :name="iconBell"
                            :class="compact ? 'h-5 w-5' : 'h-[24px] w-[24px]'"
                        />
                        <span
                            v-if="unreadCount > 0"
                            class="absolute -top-1 -right-1 bg-[var(--md-error)] text-[var(--md-on-error)] rounded-full min-w-[16px] h-[16px] flex items-center justify-center text-[10px] font-bold px-1 notification-badge"
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
import { computed, ref, watch, provide } from 'vue';
import { useRoute } from 'vue-router';
import { useThemeOverrides, useThemeResolver } from '~/composables/useThemeResolver';
import { useIcon } from '~/composables/useIcon';
import { useNotifications } from '~/composables/notifications/useNotifications';
import { NOTIFICATION_POPOVER_CLOSE_KEY } from './notification-popover';

const props = withDefaults(
    defineProps<{
        popoverSide?: 'left' | 'right' | 'top' | 'bottom';
        popoverAlign?: 'start' | 'center' | 'end';
        tooltipSide?: 'left' | 'right' | 'top' | 'bottom';
        buttonProps?: Record<string, unknown>;
        buttonClass?: string;
        compact?: boolean;
    }>(),
    {
        popoverSide: 'right',
        popoverAlign: 'end',
        tooltipSide: 'right',
        buttonProps: undefined,
        buttonClass: undefined,
        compact: false,
    }
);

const iconBell = useIcon('notification.bell');
const { activeTheme } = useThemeResolver();
const { unreadCount } = useNotifications();
const open = ref(false);
const route = useRoute();
const closePopover = () => {
    open.value = false;
};

watch(
    () => route.fullPath,
    () => {
        closePopover();
    }
);

provide(NOTIFICATION_POPOVER_CLOSE_KEY, closePopover);

const popoverContent = computed(() => ({
    side: props.popoverSide,
    align: props.popoverAlign,
}));

const tooltipContent = computed(() => ({
    side: props.tooltipSide,
}));

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

const mergedButtonProps = computed(() => ({
    ...(props.buttonProps ? {} : buttonProps.value),
    ...(props.buttonProps ?? {}),
}));

const baseButtonClass = computed(() =>
    props.buttonProps ? 'relative' : 'relative w-[48px] h-[48px] !p-0'
);
</script>
