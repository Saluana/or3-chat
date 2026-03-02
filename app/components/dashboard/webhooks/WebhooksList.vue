<template>
    <section class="space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
                <h2 class="text-lg font-semibold text-[var(--md-on-surface)]">
                    {{ admin ? 'Admin Webhooks' : 'Webhooks' }}
                </h2>
                <p class="mt-0.5 text-sm text-[var(--md-on-surface)] opacity-60">
                    {{ admin ? 'Manage instance-level webhooks and custom Nitro hook subscriptions.' : 'Manage outbound webhook subscriptions for your current workspace.' }}
                </p>
            </div>
            <UButton
                color="primary"
                @click="$emit('create')"
            >
                New Webhook
            </UButton>
        </div>

        <UAlert
            v-if="errorMessage"
            color="error"
            title="Unable to load webhooks"
            :description="errorMessage"
        />

        <div v-else-if="loading" class="space-y-2">
            <div
                v-for="item in 3"
                :key="item"
                class="h-24 rounded-[var(--md-border-radius)] animate-pulse bg-[var(--md-surface-container-highest)]"
            />
        </div>

        <div
            v-else-if="webhooks.length === 0"
            class="rounded-[var(--md-border-radius)] border-[length:var(--md-border-width)] border-dashed border-[color:var(--md-outline-variant)] bg-[var(--md-surface-container-low)] px-4 py-10 text-center"
        >
            <div class="text-base font-semibold text-[var(--md-on-surface)]">No webhooks yet</div>
            <p class="mt-1 text-sm text-[var(--md-on-surface)] opacity-60">
                Create your first webhook to start receiving outbound events.
            </p>
            <UButton
                class="mt-4"
                color="primary"
                @click="$emit('create')"
            >
                Create Webhook
            </UButton>
        </div>

        <div v-else class="space-y-2">
            <article
                v-for="webhook in webhooks"
                :key="webhook.id"
                class="rounded-[var(--md-border-radius)] border-[length:var(--md-border-width)] border-[color:var(--md-outline-variant)] bg-[var(--md-surface)] p-4"
            >
                <div class="flex flex-wrap items-start justify-between gap-3">
                    <div class="min-w-0 flex-1">
                        <div class="flex flex-wrap items-center gap-2">
                            <span
                                class="h-2.5 w-2.5 shrink-0 rounded-full"
                                :class="healthDotClass(webhook)"
                            />
                            <span class="font-semibold text-[var(--md-on-surface)]">
                                {{ webhook.label || 'Untitled Webhook' }}
                            </span>
                            <UBadge
                                :color="webhook.enabled ? 'primary' : 'neutral'"
                                variant="subtle"
                            >
                                {{ webhook.enabled ? 'Enabled' : 'Disabled' }}
                            </UBadge>
                            <UBadge
                                v-if="webhook.workspace_id && admin"
                                color="neutral"
                                variant="soft"
                            >
                                {{ webhook.workspace_id }}
                            </UBadge>
                        </div>
                        <div class="mt-1 break-all text-sm text-[var(--md-on-surface)] opacity-65">
                            {{ webhook.url }}
                        </div>
                        <div class="mt-2 text-xs text-[var(--md-on-surface)] opacity-50">
                            Updated {{ formatTimestamp(webhook.updated_at) }}
                        </div>

                        <div class="mt-3 flex flex-wrap gap-1.5">
                            <UBadge
                                v-for="eventType in webhook.events"
                                :key="eventType"
                                color="neutral"
                                variant="soft"
                            >
                                {{ eventType }}
                            </UBadge>
                            <UBadge
                                v-if="admin && webhook.custom_hooks.length > 0"
                                color="warning"
                                variant="subtle"
                            >
                                + {{ webhook.custom_hooks.length }} custom hooks
                            </UBadge>
                        </div>
                    </div>

                    <div class="flex flex-wrap items-center gap-1.5">
                        <UButton
                            size="sm"
                            variant="outline"
                            color="neutral"
                            @click="$emit('logs', webhook)"
                        >
                            Logs
                        </UButton>
                        <UButton
                            size="sm"
                            variant="outline"
                            color="neutral"
                            :loading="testingId === webhook.id"
                            @click="$emit('test', webhook)"
                        >
                            Test
                        </UButton>
                        <UButton
                            size="sm"
                            variant="outline"
                            color="neutral"
                            @click="$emit('edit', webhook)"
                        >
                            Edit
                        </UButton>
                        <UButton
                            size="sm"
                            :variant="webhook.enabled ? 'outline' : 'solid'"
                            :color="webhook.enabled ? 'neutral' : 'primary'"
                            @click="$emit('toggle', webhook)"
                        >
                            {{ webhook.enabled ? 'Disable' : 'Enable' }}
                        </UButton>
                        <UButton
                            size="sm"
                            variant="ghost"
                            color="error"
                            @click="$emit('delete', webhook)"
                        >
                            Delete
                        </UButton>
                    </div>
                </div>

                <WebhookTestPing
                    v-if="testResult?.webhookId === webhook.id"
                    class="mt-3"
                    :result="testResult"
                    @dismiss="$emit('dismiss-test')"
                />
            </article>
        </div>
    </section>
</template>

<script setup lang="ts">
import WebhookTestPing from './WebhookTestPing.vue';
import type {
    ManagedWebhook,
    ManagedWebhookTestResult,
} from './types';

defineProps<{
    admin?: boolean;
    webhooks: ManagedWebhook[];
    loading: boolean;
    errorMessage: string | null;
    testingId?: string | null;
    testResult?: ManagedWebhookTestResult | null;
}>();

defineEmits<{
    create: [];
    edit: [webhook: ManagedWebhook];
    delete: [webhook: ManagedWebhook];
    toggle: [webhook: ManagedWebhook];
    logs: [webhook: ManagedWebhook];
    test: [webhook: ManagedWebhook];
    'dismiss-test': [];
}>();

function healthDotClass(webhook: ManagedWebhook) {
    if (!webhook.enabled) {
        return 'bg-[var(--md-on-surface)]/30';
    }
    if (webhook.health === 'healthy') {
        return 'bg-emerald-500';
    }
    if (webhook.health === 'failing') {
        return 'bg-amber-500';
    }
    return 'bg-[var(--md-on-surface)]/40';
}

function formatTimestamp(timestamp: number) {
    return new Date(timestamp).toLocaleString();
}
</script>
