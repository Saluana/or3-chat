<template>
    <div class="notification-panel flex w-80 max-w-[calc(100vw-2rem)] flex-col">
        <!-- Header -->
        <div class="notification-panel-header flex items-center justify-between gap-2 px-3 py-2.5">
            <div class="flex min-w-0 items-center gap-2">
                <span class="text-sm font-semibold text-[var(--md-on-surface)]">Notifications</span>
                <span
                    v-if="unreadCount > 0"
                    class="notification-panel-count rounded-full px-1.5 text-[11px] font-semibold leading-[18px]"
                >
                    {{ unreadCount > 99 ? '99+' : unreadCount }} new
                </span>
            </div>
            <UButton
                v-if="unreadCount > 0"
                v-bind="markAllReadButtonProps"
                @click="handleMarkAllRead"
            >
                Mark all read
            </UButton>
        </div>

        <!-- Notifications list -->
        <div class="max-h-[min(22rem,60vh)] overflow-y-auto overscroll-contain">
            <div v-if="loading" class="p-4 text-center or3-loading-delay">
                <span class="text-xs text-[var(--md-on-surface-variant)] animate-pulse">
                    Loading…
                </span>
            </div>

            <div v-else-if="notifications.length === 0" class="flex min-h-[140px] flex-col items-center justify-center gap-1 p-8 text-center">
                <UIcon
                    :name="iconBell"
                    class="mb-1 h-8 w-8 text-[var(--md-on-surface-variant)] opacity-40"
                />
                <span class="text-sm font-medium text-[var(--md-on-surface)]">You're all caught up</span>
                <span class="text-xs text-[var(--md-on-surface-variant)]">
                    No notifications
                </span>
            </div>

            <template v-else>
                <NotificationsNotificationItem
                    v-for="notification in notifications"
                    :key="notification.id"
                    :notification="notification"
                    :on-mark-read="markRead"
                />
            </template>
        </div>

        <!-- Footer: clear all, confirmed in place -->
        <div
            v-if="notifications.length > 0"
            class="notification-panel-footer flex min-h-11 items-center justify-between gap-2 px-3 py-1.5"
        >
            <template v-if="!showClearConfirm">
                <span class="text-xs text-[var(--md-on-surface-variant)]">
                    {{ notifications.length }} {{ notifications.length === 1 ? 'notification' : 'notifications' }}
                </span>
                <UButton
                    v-bind="clearAllButtonProps"
                    @click="showClearConfirm = true"
                >
                    Clear all
                </UButton>
            </template>
            <template v-else>
                <span role="alert" class="min-w-0 text-xs font-medium text-[var(--md-on-surface)]">
                    Clear all notifications?
                </span>
                <div class="flex shrink-0 gap-1.5">
                    <UButton v-bind="clearCancelButtonProps" @click="showClearConfirm = false">
                        Cancel
                    </UButton>
                    <UButton v-bind="clearConfirmButtonProps" @click="confirmClearAll">
                        Clear
                    </UButton>
                </div>
            </template>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useIcon } from '~/composables/useIcon';
import { useNotifications } from '~/composables/notifications/useNotifications';
import { useThemeOverrides } from '~/composables/useThemeResolver';

const iconBell = useIcon('notification.bell');
const iconTrash = useIcon('ui.trash');
const iconCheck = useIcon('ui.check');

const { notifications, unreadCount, loading, markRead, markAllRead, clearAll } =
    useNotifications();

const showClearConfirm = ref(false);

const markAllReadOverrides = useThemeOverrides({
    component: 'button',
    context: 'sidebar',
    identifier: 'notifications.mark-all-read',
    isNuxtUI: true,
});

const clearAllOverrides = useThemeOverrides({
    component: 'button',
    context: 'sidebar',
    identifier: 'notifications.clear-all',
    isNuxtUI: true,
});

const clearCancelOverrides = useThemeOverrides({
    component: 'button',
    context: 'sidebar',
    identifier: 'notifications.clear.cancel',
    isNuxtUI: true,
});

const clearConfirmOverrides = useThemeOverrides({
    component: 'button',
    context: 'sidebar',
    identifier: 'notifications.clear.confirm',
    isNuxtUI: true,
});

const markAllReadButtonProps = computed(() => ({
    variant: 'ghost' as const,
    color: 'primary' as const,
    size: 'xs' as const,
    icon: iconCheck.value,
    class: 'w-fit shrink-0',
    ...markAllReadOverrides.value,
}));

const clearAllButtonProps = computed(() => ({
    variant: 'ghost' as const,
    color: 'neutral' as const,
    size: 'xs' as const,
    icon: iconTrash.value,
    class: 'notification-clear-all w-fit',
    ...clearAllOverrides.value,
}));

const clearCancelButtonProps = computed(() => ({
    variant: 'ghost' as const,
    color: 'neutral' as const,
    size: 'xs' as const,
    class: 'w-fit',
    ...clearCancelOverrides.value,
}));

const clearConfirmButtonProps = computed(() => ({
    variant: 'solid' as const,
    color: 'error' as const,
    size: 'xs' as const,
    class: 'w-fit',
    ...clearConfirmOverrides.value,
}));

async function handleMarkAllRead() {
    await markAllRead();
}

async function confirmClearAll() {
    await clearAll();
    showClearConfirm.value = false;
}
</script>

<style scoped>
.notification-panel-header {
    border-bottom: var(--md-border-width-subtle, var(--md-border-width, 1px)) solid var(--md-border-color);
}
.notification-panel-footer {
    border-top: var(--md-border-width-subtle, var(--md-border-width, 1px)) solid var(--md-border-color);
}
.notification-panel-count {
    color: var(--md-on-primary);
    background: var(--md-primary);
}
.notification-panel :deep(.notification-clear-all:hover) {
    color: var(--md-error);
}
</style>
