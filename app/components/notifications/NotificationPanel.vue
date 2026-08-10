<template>
    <div class="flex flex-col w-72">
        <!-- Header -->
        <div class="flex items-center justify-between px-3 py-2 border-b-[length:var(--md-border-width-subtle,var(--md-border-width))] border-[var(--md-border-color)]">
            <span class="text-sm font-semibold text-[var(--md-on-surface)]">Notifications</span>
            <UButton
                v-if="unreadCount > 0"
                v-bind="markAllReadButtonProps"
                @click="handleMarkAllRead"
            >
                Mark all read
            </UButton>
        </div>

        <!-- Notifications list -->
        <div class="overflow-y-auto max-h-80">
            <div v-if="loading" class="p-4 text-center">
                <span class="text-xs text-[var(--md-on-surface-variant)] animate-pulse">
                    Loading...
                </span>
            </div>

            <div v-else-if="notifications.length === 0" class="flex flex-col items-center justify-center p-8 min-h-[120px]">
                <UIcon
                    :name="iconBell"
                    class="w-8 h-8 mb-2 text-[var(--md-on-surface-variant)] opacity-40"
                />
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

        <!-- Footer -->
        <div v-if="notifications.length > 0 && !showClearConfirm" class="px-3 py-2 border-t-[length:var(--md-border-width-subtle,var(--md-border-width))] border-[var(--md-border-color)]">
            <UButton
                v-bind="clearAllButtonProps"
                @click="showClearConfirm = true"
            >
                Clear all
            </UButton>
        </div>

        <!-- Inline clear confirmation -->
        <div v-if="showClearConfirm" class="px-3 py-2 border-t-[length:var(--md-border-width-subtle,var(--md-border-width))] border-[var(--md-border-color)] bg-[var(--md-error-container)]">
            <p class="text-xs text-[var(--md-on-error-container)] mb-2">Clear all notifications?</p>
            <div class="flex gap-2">
                <UButton v-bind="clearCancelButtonProps" @click="showClearConfirm = false">
                    Cancel
                </UButton>
                <UButton v-bind="clearConfirmButtonProps" @click="confirmClearAll">
                    Clear
                </UButton>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useIcon } from '~/composables/useIcon';
import { useNotifications } from '~/composables/notifications/useNotifications';
import { useThemeOverrides } from '~/composables/useThemeResolver';

const iconBell = useIcon('notification.bell');

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
    variant: 'link' as const,
    color: 'primary' as const,
    size: 'xs' as const,
    class: 'w-fit',
    ...markAllReadOverrides.value,
}));

const clearAllButtonProps = computed(() => ({
    variant: 'ghost' as const,
    color: 'error' as const,
    size: 'xs' as const,
    block: true,
    ...clearAllOverrides.value,
}));

const clearCancelButtonProps = computed(() => ({
    variant: 'solid' as const,
    size: 'sm' as const,
    class: 'w-fit',
    ...clearCancelOverrides.value,
}));

const clearConfirmButtonProps = computed(() => ({
    variant: 'solid' as const,
    color: 'error' as const,
    size: 'sm' as const,
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
