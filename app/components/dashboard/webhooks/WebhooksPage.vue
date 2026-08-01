<template>
    <div class="dashboard-page-frame">
        <header class="dashboard-page-intro">
            <div>
                <p class="dashboard-page-eyebrow">Integrations</p>
                <h1 class="dashboard-page-title">Webhook management</h1>
                <p class="dashboard-page-description">
                    Configure outbound deliveries for thread, message, document, and notification events.
                </p>
            </div>
            <UButton
                color="error"
                variant="soft"
                :loading="bulkDisabling"
                :disabled="webhooks.length === 0"
                @click="disableAll"
            >
                Disable All Webhooks
            </UButton>
        </header>

        <div class="section-card">
        <WebhooksList
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
        </div>

        <WebhookForm
            v-model:open="formOpen"
            :webhook="editingWebhook"
            @saved="handleSaved"
        />

        <WebhookDeliveryLog
            v-model:open="logsOpen"
            :webhook-id="activeLogWebhook?.id ?? null"
        />
    </div>
</template>

<script setup lang="ts">
import WebhookDeliveryLog from './WebhookDeliveryLog.vue';
import WebhookForm from './WebhookForm.vue';
import WebhooksList from './WebhooksList.vue';
import { useManagedWebhooks } from '~/composables/webhooks/useManagedWebhooks';

const {
    activeLogWebhook,
    bulkDisabling,
    deleteWebhook,
    disableAll,
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
} = await useManagedWebhooks({
    endpoint: '/api/webhooks',
    loadErrorMessage: 'Unable to load webhooks',
    deleteErrorMessage: 'Unable to delete webhook',
    updateErrorMessage: 'Unable to update webhook',
    testErrorMessage: 'Unable to send test ping',
    bulkDisable: {
        endpoint: '/api/webhooks/disable-all',
        confirmMessage: 'Disable every webhook in this workspace?',
        successTitle: 'Webhooks disabled',
        successDescription(disabled) {
            return `${disabled} webhook${disabled === 1 ? '' : 's'} disabled`;
        },
        failureDescription: 'Unable to disable webhooks',
    },
});
</script>
