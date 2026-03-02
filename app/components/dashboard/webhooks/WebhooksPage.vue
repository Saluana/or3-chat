<template>
    <div class="space-y-6 p-6">
        <div class="flex flex-wrap items-center justify-between gap-3 rounded-[var(--md-border-radius)] border-[length:var(--md-border-width)] border-[color:var(--md-outline-variant)] bg-[var(--md-surface-container-low)] p-4">
            <div>
                <div class="text-lg font-semibold text-[var(--md-on-surface)]">Webhook Management</div>
                <p class="mt-0.5 text-sm text-[var(--md-on-surface)] opacity-60">
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
        </div>

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
import type {
    ManagedWebhook,
    ManagedWebhookTestResult,
} from './types';

const toast = useToast();
const { getMessage } = useApiError();

const formOpen = ref(false);
const logsOpen = ref(false);
const editingWebhook = ref<ManagedWebhook | null>(null);
const activeLogWebhook = ref<ManagedWebhook | null>(null);
const bulkDisabling = ref(false);
const testingId = ref<string | null>(null);
const testResult = ref<ManagedWebhookTestResult | null>(null);

const {
    data,
    pending,
    error,
    refresh,
} = await useFetch<{ webhooks: ManagedWebhook[] }>('/api/webhooks', {
    credentials: 'include',
    default: () => ({ webhooks: [] }),
});

const webhooks = computed(() => data.value?.webhooks ?? []);
const errorMessage = computed(() =>
    error.value ? getMessage(error.value, 'Unable to load webhooks') : null
);

function openCreate() {
    editingWebhook.value = null;
    formOpen.value = true;
}

function openEdit(webhook: ManagedWebhook) {
    editingWebhook.value = webhook;
    formOpen.value = true;
}

function openLogs(webhook: ManagedWebhook) {
    activeLogWebhook.value = webhook;
    logsOpen.value = true;
}

async function handleSaved() {
    await refresh();
}

async function deleteWebhook(webhook: ManagedWebhook) {
    if (!import.meta.client || !window.confirm(`Delete "${webhook.label || webhook.url}"?`)) {
        return;
    }

    try {
        await $fetch(`/api/webhooks/${webhook.id}`, {
            method: 'DELETE',
            credentials: 'include',
        });
        if (activeLogWebhook.value?.id === webhook.id) {
            logsOpen.value = false;
            activeLogWebhook.value = null;
        }
        await refresh();
    } catch (fetchError: unknown) {
        toast.add({
            title: 'Delete failed',
            description: getMessage(fetchError, 'Unable to delete webhook'),
            color: 'error',
        });
    }
}

async function toggleWebhook(webhook: ManagedWebhook) {
    try {
        await $fetch<{ webhook: ManagedWebhook }>(`/api/webhooks/${webhook.id}/toggle`, {
            method: 'POST',
            credentials: 'include',
            body: {},
        });
        await refresh();
    } catch (fetchError: unknown) {
        toast.add({
            title: 'Update failed',
            description: getMessage(fetchError, 'Unable to update webhook'),
            color: 'error',
        });
    }
}

async function disableAll() {
    if (!import.meta.client || !window.confirm('Disable every webhook in this workspace?')) {
        return;
    }

    bulkDisabling.value = true;
    try {
        const result = await $fetch<{ disabled: number }>('/api/webhooks/disable-all', {
            method: 'POST',
            credentials: 'include',
        });
        testResult.value = null;
        await refresh();
        toast.add({
            title: 'Webhooks disabled',
            description: `${result.disabled} webhook${result.disabled === 1 ? '' : 's'} disabled`,
            color: 'success',
        });
    } catch (fetchError: unknown) {
        toast.add({
            title: 'Bulk disable failed',
            description: getMessage(fetchError, 'Unable to disable webhooks'),
            color: 'error',
        });
    } finally {
        bulkDisabling.value = false;
    }
}

async function sendTestPing(webhook: ManagedWebhook) {
    testingId.value = webhook.id;
    testResult.value = null;

    try {
        const result = await $fetch<Omit<ManagedWebhookTestResult, 'webhookId'>>(
            `/api/webhooks/${webhook.id}/test`,
            {
                method: 'POST',
                credentials: 'include',
            }
        );
        testResult.value = {
            webhookId: webhook.id,
            ...result,
        };
        await refresh();
    } catch (fetchError: unknown) {
        toast.add({
            title: 'Test ping failed',
            description: getMessage(fetchError, 'Unable to send test ping'),
            color: 'error',
        });
    } finally {
        testingId.value = null;
    }
}
</script>
