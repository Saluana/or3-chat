<template>
    <USlideover v-model="isOpen" :side="side">
        <div class="flex flex-col h-full bg-[var(--md-surface)]">
            <!-- Header -->
            <div
                class="flex items-center justify-between p-4 border-b border-[var(--md-border-color)]"
            >
                <h2 class="text-xl font-bold text-[var(--md-on-surface)]">
                    Notifications
                </h2>
                <div class="flex items-center gap-2">
                    <UButton
                        v-if="unreadCount > 0"
                        variant="ghost"
                        color="primary"
                        size="sm"
                        @click="handleMarkAllRead"
                    >
                        Mark all read
                    </UButton>
                    <UButton
                        variant="ghost"
                        color="neutral"
                        size="sm"
                        @click="isOpen = false"
                        aria-label="Close"
                    >
                        <UIcon :name="iconClose" class="w-5 h-5" />
                    </UButton>
                </div>
            </div>

            <!-- Notifications list -->
            <div class="flex-1 overflow-y-auto">
                <div v-if="loading" class="p-8 text-center">
                    <div
                        class="text-[var(--md-on-surface-variant)] animate-pulse"
                    >
                        Loading notifications...
                    </div>
                </div>

                <div
                    v-else-if="notifications.length === 0"
                    class="p-8 text-center"
                >
                    <div class="flex flex-col items-center gap-4">
                        <UIcon
                            :name="iconBell"
                            class="w-16 h-16 text-[var(--md-on-surface-variant)] opacity-50"
                        />
                        <div class="text-[var(--md-on-surface-variant)]">
                            No notifications yet
                        </div>
                    </div>
                </div>

                <div v-else>
                    <NotificationItem
                        v-for="notification in notifications"
                        :key="notification.id"
                        :notification="notification"
                    />
                </div>
            </div>

            <!-- Footer -->
            <div
                v-if="notifications.length > 0"
                class="p-4 border-t border-[var(--md-border-color)]"
            >
                <UButton
                    variant="ghost"
                    color="error"
                    block
                    @click="showClearConfirm = true"
                >
                    Clear all notifications
                </UButton>
            </div>
        </div>
    </USlideover>

    <!-- Clear confirmation modal -->
    <UModal v-model="showClearConfirm">
        <div class="p-6 bg-[var(--md-surface)] rounded-lg">
            <h3 class="text-lg font-bold text-[var(--md-on-surface)] mb-2">
                Clear All Notifications?
            </h3>
            <p class="text-[var(--md-on-surface-variant)] mb-6">
                This will permanently remove all notifications. This action cannot be undone.
            </p>
            <div class="flex justify-end gap-3">
                <UButton
                    variant="ghost"
                    color="neutral"
                    @click="showClearConfirm = false"
                >
                    Cancel
                </UButton>
                <UButton
                    color="error"
                    @click="confirmClearAll"
                >
                    Clear All
                </UButton>
            </div>
        </div>
    </UModal>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useIcon } from '~/composables/useIcon';
import { useNotifications } from '~/composables/notifications/useNotifications';

const props = defineProps<{
    modelValue: boolean;
    side?: 'left' | 'right';
}>();

const emit = defineEmits<{
    (e: 'update:modelValue', value: boolean): void;
}>();

const iconClose = useIcon('close');
const iconBell = useIcon('notification.bell');

const { notifications, unreadCount, loading, markAllRead, clearAll } =
    useNotifications();

const isOpen = computed({
    get: () => props.modelValue,
    set: (value) => emit('update:modelValue', value),
});

const showClearConfirm = ref(false);

async function handleMarkAllRead() {
    await markAllRead();
}

async function confirmClearAll() {
    const count = await clearAll();
    console.log(`Cleared ${count} notifications`);
    showClearConfirm.value = false;
}
</script>
