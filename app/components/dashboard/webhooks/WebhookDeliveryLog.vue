<template>
    <UModal
        v-model:open="isOpen"
        :title="admin ? 'Admin Webhook Logs' : 'Webhook Delivery Logs'"
        :description="'Recent deliveries from the last 72 hours'"
        :ui="{
            overlay: 'z-[60]',
            content: 'z-[70] sm:min-w-[560px] sm:max-w-[680px]',
        }"
    >
        <template #body>
            <div class="space-y-4">
                <div class="flex items-center justify-between gap-3">
                    <div class="text-xs text-[var(--md-on-surface)] opacity-60">
                        Full request and response payloads are shown for diagnostics.
                    </div>
                    <UButton
                        size="sm"
                        variant="outline"
                        color="neutral"
                        :loading="pending"
                        @click="refreshLogs"
                    >
                        Refresh
                    </UButton>
                </div>

                <UAlert
                    v-if="errorMessage"
                    color="error"
                    title="Failed to load delivery logs"
                    :description="errorMessage"
                />

                <div v-else-if="pending" class="space-y-2">
                    <div
                        v-for="item in 3"
                        :key="item"
                        class="h-20 rounded-[var(--md-border-radius)] animate-pulse bg-[var(--md-surface-container-highest)]"
                    />
                </div>

                <div
                    v-else-if="logs.length === 0"
                    class="rounded-[var(--md-border-radius)] border-[length:var(--md-border-width)] border-dashed border-[color:var(--md-outline-variant)] bg-[var(--md-surface-container-low)] px-4 py-10 text-center text-sm text-[var(--md-on-surface)] opacity-60"
                >
                    No deliveries yet
                </div>

                <div v-else class="space-y-2">
                    <div
                        v-for="log in logs"
                        :key="log.id"
                        class="rounded-[var(--md-border-radius)] border-[length:var(--md-border-width)] border-[color:var(--md-outline-variant)] bg-[var(--md-surface)] p-3"
                    >
                        <div class="flex flex-wrap items-center gap-2">
                            <UBadge color="primary" variant="subtle">
                                {{ log.event_type }}
                            </UBadge>
                            <UBadge
                                :color="statusColor(log.status)"
                                variant="subtle"
                            >
                                {{ log.status }}
                            </UBadge>
                            <UBadge
                                v-if="log.http_status !== null"
                                :color="log.http_status >= 400 ? 'error' : 'success'"
                                variant="soft"
                            >
                                HTTP {{ log.http_status }}
                            </UBadge>
                            <span class="text-xs text-[var(--md-on-surface)] opacity-50">
                                {{ formatTimestamp(log.created_at) }}
                            </span>
                            <span class="text-xs text-[var(--md-on-surface)] opacity-50">
                                Attempt {{ log.attempt }}
                            </span>
                            <span
                                v-if="log.duration_ms !== null"
                                class="text-xs text-[var(--md-on-surface)] opacity-50"
                            >
                                {{ log.duration_ms }}ms
                            </span>
                        </div>

                        <div class="mt-2">
                            <UButton
                                size="xs"
                                variant="ghost"
                                color="neutral"
                                @click="toggleExpanded(log.id)"
                            >
                                {{ expandedLogId === log.id ? 'Hide details' : 'Show details' }}
                            </UButton>
                        </div>

                        <div
                            v-if="expandedLogId === log.id"
                            class="mt-3 space-y-3"
                        >
                            <div>
                                <div class="mb-1 text-xs font-semibold uppercase tracking-wider text-[var(--md-on-surface)] opacity-50">
                                    Request Payload
                                </div>
                                <pre class="max-h-56 overflow-auto rounded-[var(--md-border-radius)] border-[length:var(--md-border-width)] border-[color:var(--md-outline-variant)] bg-[var(--md-surface-container-low)] p-3 text-xs leading-relaxed">{{ formatJson(log.request_payload) }}</pre>
                            </div>
                            <div>
                                <div class="mb-1 text-xs font-semibold uppercase tracking-wider text-[var(--md-on-surface)] opacity-50">
                                    Response
                                </div>
                                <pre class="max-h-40 overflow-auto rounded-[var(--md-border-radius)] border-[length:var(--md-border-width)] border-[color:var(--md-outline-variant)] bg-[var(--md-surface-container-low)] p-3 text-xs leading-relaxed">{{ truncate(log.response_body) }}</pre>
                            </div>
                            <div
                                v-if="log.error_message"
                                class="text-xs text-[var(--md-error)]"
                            >
                                {{ log.error_message }}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </template>
    </UModal>
</template>

<script setup lang="ts">
import type { ManagedWebhookLog } from './types';

const props = defineProps<{
    admin?: boolean;
    webhookId: string | null;
}>();

const isOpen = defineModel<boolean>('open', { default: false });
const { getMessage } = useApiError();

const logs = ref<ManagedWebhookLog[]>([]);
const pending = ref(false);
const errorMessage = ref<string | null>(null);
const expandedLogId = ref<string | null>(null);

const endpoint = computed(() => {
    if (!props.webhookId) {
        return null;
    }

    return props.admin
        ? `/api/admin/webhooks/${props.webhookId}/logs`
        : `/api/webhooks/${props.webhookId}/logs`;
});

function statusColor(status: ManagedWebhookLog['status']) {
    if (status === 'success') return 'success';
    if (status === 'failed') return 'error';
    if (status === 'cancelled') return 'neutral';
    return 'warning';
}

function formatTimestamp(timestamp: number) {
    return new Date(timestamp).toLocaleString();
}

function truncate(value: string | null | undefined) {
    if (!value) {
        return 'No response body';
    }

    return value.length > 4_000 ? `${value.slice(0, 4_000)}…` : value;
}

function formatJson(value: string) {
    try {
        return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
        return value;
    }
}

function toggleExpanded(logId: string) {
    expandedLogId.value = expandedLogId.value === logId ? null : logId;
}

async function refreshLogs() {
    if (!endpoint.value) {
        logs.value = [];
        return;
    }

    pending.value = true;
    errorMessage.value = null;

    try {
        const response = await $fetch<{ logs: ManagedWebhookLog[] }>(
            endpoint.value,
            {
                credentials: 'include',
            }
        );
        logs.value = response.logs ?? [];
    } catch (error: unknown) {
        logs.value = [];
        errorMessage.value = getMessage(error, 'Unable to load delivery logs');
    } finally {
        pending.value = false;
    }
}

watch(
    [isOpen, endpoint],
    ([open, nextEndpoint]) => {
        if (!open) {
            expandedLogId.value = null;
            return;
        }

        if (!nextEndpoint) {
            logs.value = [];
            return;
        }

        void refreshLogs();
    }
);
</script>
