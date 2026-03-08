<template>
    <div class="space-y-6">
        <div class="rounded-2xl border border-[var(--md-outline-variant)] bg-[var(--md-surface)] p-5">
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
import type {
    ManagedWebhook,
    ManagedWebhookTestResult,
    ManagedWorkspaceOption,
} from '~/components/dashboard/webhooks/types';

definePageMeta({
    layout: 'admin',
    middleware: ['admin-auth'],
});

const toast = useToast();
const { getMessage } = useApiError();

const formOpen = ref(false);
const logsOpen = ref(false);
const editingWebhook = ref<ManagedWebhook | null>(null);
const activeLogWebhook = ref<ManagedWebhook | null>(null);
const testingId = ref<string | null>(null);
const testResult = ref<ManagedWebhookTestResult | null>(null);

const {
    data,
    pending,
    error,
    refresh,
} = await useFetch<{ webhooks: ManagedWebhook[] }>('/api/admin/webhooks', {
    credentials: 'include',
    default: () => ({ webhooks: [] }),
});

const { data: workspaceData } = await useFetch<{
    items: Array<{ id: string; name: string }>;
}>('/api/admin/workspaces', {
    credentials: 'include',
    query: {
        perPage: '100',
    },
    default: () => ({ items: [] }),
});

const webhooks = computed(() => data.value?.webhooks ?? []);
const workspaceOptions = computed<ManagedWorkspaceOption[]>(() =>
    (workspaceData.value?.items ?? []).map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
    }))
);
const errorMessage = computed(() =>
    error.value ? getMessage(error.value, 'Unable to load admin webhooks') : null
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
        await $fetch(`/api/admin/webhooks/${webhook.id}`, {
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
            description: getMessage(fetchError, 'Unable to delete admin webhook'),
            color: 'error',
        });
    }
}

async function toggleWebhook(webhook: ManagedWebhook) {
    try {
        await $fetch(`/api/admin/webhooks/${webhook.id}/toggle`, {
            method: 'POST',
            credentials: 'include',
            body: {},
        });
        await refresh();
    } catch (fetchError: unknown) {
        toast.add({
            title: 'Update failed',
            description: getMessage(fetchError, 'Unable to update admin webhook'),
            color: 'error',
        });
    }
}

async function sendTestPing(webhook: ManagedWebhook) {
    testingId.value = webhook.id;
    testResult.value = null;

    try {
        const result = await $fetch<Omit<ManagedWebhookTestResult, 'webhookId'>>(
            `/api/admin/webhooks/${webhook.id}/test`,
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
