<template>
    <div class="space-y-6">
        <div class="rounded-[var(--md-border-radius)] border-[length:var(--md-border-width)] border-[var(--md-outline-variant)] bg-[var(--md-surface)] p-5">
            <h1 class="text-2xl font-semibold">Admin Webhooks</h1>
            <p class="mt-1 text-sm opacity-70">
                Manage deployment-wide operational webhooks, including curated admin events and advanced custom Nitro hooks.
            </p>
        </div>

        <WebhooksList
            admin
            :webhooks="webhooks"
            :loading="pending"
            :error-message="errorMessage"
            :testing-id="testingId"
            :test-result="testResult"
            @create="openCreate"
            @edit="openEdit"
            @delete="deleteWebhook"
            @toggle="toggleWebhook"
            @logs="openLogs"
            @test="sendTestPing"
            @dismiss-test="testResult = null"
        />

        <WebhookForm
            v-model:open="formOpen"
            admin
            :webhook="editingWebhook"
            :workspaces="workspaceOptions"
            @saved="handleSaved"
        />

        <WebhookDeliveryLog
            v-model:open="logsOpen"
            admin
            :webhook-id="activeLogWebhook?.id ?? null"
        />
    </div>
</template>

<script setup lang="ts">
import WebhookDeliveryLog from '~/components/dashboard/webhooks/WebhookDeliveryLog.vue';
import WebhookForm from '~/components/dashboard/webhooks/WebhookForm.vue';
import WebhooksList from '~/components/dashboard/webhooks/WebhooksList.vue';
import { useManagedWebhooks } from '~/composables/webhooks/useManagedWebhooks';

definePageMeta({
    layout: 'admin',
    middleware: ['admin-auth'],
});

const {
    activeLogWebhook,
    deleteWebhook,
    editingWebhook,
    errorMessage,
    formOpen,
    handleSaved,
    logsOpen,
    openCreate,
    openEdit,
    openLogs,
    pending,
    sendTestPing,
    testResult,
    testingId,
    toggleWebhook,
    webhooks,
    workspaceOptions,
} = await useManagedWebhooks({
    endpoint: '/api/admin/webhooks',
    loadErrorMessage: 'Unable to load admin webhooks',
    deleteErrorMessage: 'Unable to delete admin webhook',
    updateErrorMessage: 'Unable to update admin webhook',
    testErrorMessage: 'Unable to send test ping',
    workspaceOptions: {
        endpoint: '/api/admin/workspaces',
        query: {
            perPage: '100',
        },
    },
});
</script>
