<template>
    <div
        class="notification-item flex flex-col p-3 hover:bg-[var(--md-surface-hover)] cursor-pointer transition-colors border-b border-[var(--md-border-color)] last:border-b-0"
        :class="{ 'bg-[var(--md-surface-container)]': !notification.read_at }"
        @click="handleClick"
    >
        <div class="flex items-start gap-3">
            <!-- Type icon -->
            <div
                class="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-[var(--md-border-radius)] bg-[var(--md-surface-container-high)] notification-type-icon"
            >
                <UIcon :name="typeIcon" class="w-5 h-5" />
            </div>

            <!-- Content -->
            <div class="flex-1 min-w-0">
                <!-- Title -->
                <div
                    class="font-medium text-[var(--md-on-surface)] mb-1 notification-title"
                    :class="{ 'font-bold': !notification.read_at }"
                >
                    {{ notification.title }}
                </div>

                <!-- Body -->
                <div
                    v-if="notification.body"
                    class="text-sm text-[var(--md-on-surface-variant)] mb-2 notification-body"
                >
                    {{ notification.body }}
                </div>

                <!-- Timestamp -->
                <div class="text-xs text-[var(--md-on-surface-variant)] notification-timestamp">
                    {{ formattedTime }}
                </div>
            </div>

            <!-- Unread indicator -->
            <div
                v-if="!notification.read_at"
                class="flex-shrink-0 w-2 h-2 rounded-full bg-[var(--md-primary)] notification-unread-indicator"
            />
        </div>

        <!-- Actions -->
        <div
            v-if="notification.actions && notification.actions.length > 0"
            class="flex gap-2 mt-3 pl-11 notification-actions"
        >
            <UButton
                v-for="action in notification.actions"
                :key="action.id"
                class="theme-btn notification-action-btn"
                variant="ghost"
                color="primary"
                size="sm"
                @click.stop="handleActionClick(action)"
            >
                {{ action.label }}
            </UButton>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, ref, inject } from 'vue';
import { useRouter } from 'vue-router';
import { useIcon } from '~/composables/useIcon';
import { useHooks } from '~/core/hooks/useHooks';
import type { Notification, NotificationAction } from '~/db/schema';
import { NOTIFICATION_POPOVER_CLOSE_KEY } from './notification-popover';
import { getGlobalMultiPaneApi } from '~/utils/multiPaneApi';

const props = defineProps<{
    notification: Notification;
    onMarkRead: (id: string) => Promise<void>;
}>();

const router = useRouter();
const hooks = useHooks();
const hasMarkedRead = ref(false);
const closePopover = inject<() => void>(NOTIFICATION_POPOVER_CLOSE_KEY, null);

// Pre-compute all possible icons at setup time to avoid calling useIcon inside computed
// This follows Vue best practices - composables should only be called at setup, not in getters
const icons = {
    'ai.message.received': useIcon('notification.message'),
    'workflow.completed': useIcon('notification.workflow'),
    'sync.conflict': useIcon('notification.sync'),
    'system.warning': useIcon('notification.warning'),
    default: useIcon('notification.default'),
} as const;

// Type-safe lookup using pre-computed icons
// We access .value to unwrap the ComputedRef and return a plain string
const typeIcon = computed(() => {
    const notificationType = props.notification.type;
    if (notificationType in icons) {
        return icons[notificationType as keyof typeof icons].value;
    }
    return icons.default.value;
});

// Format timestamp as relative time
// Note: timestamps are in seconds (nowSec()), so we multiply by 1000 for comparison with Date.now()
const formattedTime = computed(() => {
    const now = Date.now();
    // created_at is in seconds, convert to milliseconds
    const created = props.notification.created_at * 1000;
    const diff = now - created;

    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
});

const markReadOnce = async (): Promise<void> => {
    if (props.notification.read_at || hasMarkedRead.value) return;
    hasMarkedRead.value = true;
    await props.onMarkRead(props.notification.id);
};

async function handleClick() {
    await markReadOnce();
    closePopover?.();

    // If there's a default navigate action, execute it
    const navigateAction = props.notification.actions?.find(
        (a) => a.kind === 'navigate'
    );
    if (navigateAction) {
        await handleActionClick(navigateAction);
    }
}

async function handleActionClick(action: NotificationAction) {
    await markReadOnce();
    closePopover?.();

    if (action.kind === 'navigate') {
        const target = (action.target ?? {}) as {
            route?: string;
            threadId?: string;
            documentId?: string;
            thread_id?: string;
            document_id?: string;
        };
        const threadId = target.threadId ?? target.thread_id;
        const documentId = target.documentId ?? target.document_id;
        const multiPane = getGlobalMultiPaneApi();
        if (threadId && multiPane) {
            const idx = multiPane.activePaneIndex.value ?? 0;
            multiPane.updatePane(idx, {
                mode: 'chat',
                documentId: undefined,
            });
            await multiPane.setPaneThread(idx, threadId);
            return;
        }
        if (documentId && multiPane) {
            const idx = multiPane.activePaneIndex.value ?? 0;
            multiPane.updatePane(idx, {
                mode: 'doc',
                threadId: '',
            });
            await multiPane.setPaneApp(idx, 'doc', { recordId: documentId });
            return;
        }
        // Handle navigation
        if (target.route) {
            await router.push(target.route);
        } else if (threadId) {
            await router.push(`/chat/${threadId}`);
        } else if (documentId) {
            await router.push(`/docs/${documentId}`);
        }
    } else if (action.kind === 'callback') {
        // Emit hook for callback actions
        await hooks.doAction('notify:action:clicked', {
            notification: props.notification,
            action,
        });
    }
}
</script>

<style scoped>
.notification-item:hover {
    background-color: var(--md-surface-hover);
}
</style>
