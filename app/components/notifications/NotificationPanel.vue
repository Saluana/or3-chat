<template>
    <div class="flex flex-col w-72">
        <!-- Header -->
        <div class="flex items-center justify-between px-3 py-2 border-b border-[var(--md-border-color)]">
            <span class="text-sm font-semibold text-[var(--md-on-surface)]">Notifications</span>
            <UButton
                v-if="unreadCount > 0"
                variant="link"
                color="primary"
                size="xs"
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
        <div v-if="notifications.length > 0 && !showClearConfirm" class="px-3 py-2 border-t border-[var(--md-border-color)]">
            <UButton
                variant="link"
                color="error"
                size="xs"
                block
                @click="showClearConfirm = true"
            >
                Clear all
            </UButton>
        </div>

        <!-- Inline clear confirmation -->
        <div v-if="showClearConfirm" class="px-3 py-2 border-t border-[var(--md-border-color)] bg-[var(--md-error-container)]">
            <p class="text-xs text-[var(--md-on-error-container)] mb-2">Clear all notifications?</p>
            <div class="flex gap-2">
                <UButton size="xs" variant="soft" color="neutral" @click="showClearConfirm = false">
                    Cancel
                </UButton>
                <UButton size="xs" color="error" @click="confirmClearAll">
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

const iconBell = useIcon('notification.bell');

const { notifications, unreadCount, loading, markRead, markAllRead, clearAll } =
    useNotifications();

const showClearConfirm = ref(false);

async function handleMarkAllRead() {
    await markAllRead();
}

async function confirmClearAll() {
    await clearAll();
    showClearConfirm.value = false;
}
</script>
