<template>
    <div
        class="notification-item relative flex cursor-pointer gap-3 px-3 py-3 transition-colors"
        :class="{ 'notification-item--unread': !notification.read_at }"
        @click="handleClick"
    >
        <!-- Type icon -->
        <div
            class="notification-type-icon flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[var(--md-border-radius-small,var(--md-border-radius))] bg-[var(--md-surface-container-high)]"
        >
            <UIcon :name="typeIcon" class="h-[18px] w-[18px]" />
        </div>

        <!-- Content -->
        <div class="min-w-0 flex-1">
            <div class="flex items-baseline gap-2">
                <div
                    class="notification-title min-w-0 flex-1 wrap-anywhere text-sm text-[var(--md-on-surface)]"
                    :class="notification.read_at ? 'font-medium' : 'font-semibold'"
                >
                    {{ notification.title }}
                </div>
                <div class="notification-timestamp shrink-0 text-[11px] text-[var(--md-on-surface-variant)]">
                    {{ formattedTime }}
                </div>
                <span
                    v-if="!notification.read_at"
                    class="notification-unread-indicator h-2 w-2 shrink-0 self-center rounded-full bg-[var(--md-primary)]"
                ><span class="sr-only">Unread</span></span>
            </div>

            <div
                v-if="notification.body"
                class="notification-body mt-0.5 wrap-anywhere text-xs leading-relaxed text-[var(--md-on-surface-variant)]"
            >
                {{ notification.body }}
            </div>

            <!-- Actions -->
            <div
                v-if="notification.actions && notification.actions.length > 0"
                class="notification-actions mt-1.5 flex flex-wrap gap-x-3"
            >
                <UButton
                    v-for="action in notification.actions"
                    :key="action.id"
                    class="theme-btn notification-action-btn h-auto! min-w-0! px-0! py-0.5!"
                    variant="link"
                    color="primary"
                    size="xs"
                    @click.stop="handleActionClick(action)"
                >
                    {{ action.label }}
                </UButton>
            </div>
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
import { getActiveWorkspaceId } from '~/db/client';
import { getGlobalMultiPaneApi } from '~/utils/multiPaneApi';

const props = defineProps<{
    notification: Notification;
    onMarkRead: (id: string) => Promise<void>;
}>();

const router = useRouter();
const hooks = useHooks();
const hasMarkedRead = ref(false);
const closePopover = inject<(() => void) | null>(
    NOTIFICATION_POPOVER_CLOSE_KEY,
    null
);

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

function actionIsCurrent(action: NotificationAction): boolean {
    const workspaceId = action.data?.workspaceId;
    return typeof workspaceId !== 'string' || workspaceId === (getActiveWorkspaceId() ?? 'local');
}

async function handleClick() {
    const scopedAction = props.notification.actions?.find(a => a.kind === 'navigate');
    if (scopedAction && !actionIsCurrent(scopedAction)) return;
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
    if (!actionIsCurrent(action)) return;
    await markReadOnce();
    if (!actionIsCurrent(action)) return;
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
.notification-item + .notification-item {
    border-top: var(--md-border-width-subtle, var(--md-border-width, 1px)) solid var(--md-border-color);
}
.notification-item--unread {
    background-color: color-mix(in srgb, var(--md-primary) 6%, transparent);
}
.notification-item:hover {
    background-color: var(--md-surface-hover);
}
</style>
