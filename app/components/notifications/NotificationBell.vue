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
                :class="[baseButtonClass, buttonClass]"
            >
                <template #default>
                    <span class="flex flex-col items-center gap-1 w-full relative">
                        <UIcon :name="iconBell" class="h-[24px] w-[24px]" />
                        <span
                            v-if="unreadCount > 0"
                            class="absolute -top-1 -right-1 bg-[var(--md-error)] text-[var(--md-on-error)] rounded-[var(--md-border-radius)] min-w-[16px] h-[16px] flex items-center justify-center text-[10px] font-bold px-1 notification-badge"
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
import { useThemeOverrides } from '~/composables/useThemeResolver';
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
    }>(),
    {
        popoverSide: 'right',
        popoverAlign: 'end',
        tooltipSide: 'right',
        buttonProps: undefined,
        buttonClass: undefined,
    }
);

const iconBell = useIcon('notification.bell');
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
