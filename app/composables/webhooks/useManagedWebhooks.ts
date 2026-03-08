import { computed, ref } from 'vue';
import { useFetch, useToast } from '#imports';
import type {
    ManagedWebhook,
    ManagedWebhookTestResult,
    ManagedWorkspaceOption,
} from '~/components/dashboard/webhooks/types';
import { useApiError } from '~/composables/useApiError';

export interface ManagedWebhooksWorkspaceOptionsConfig {
    endpoint: string;
    query?: Record<string, string>;
}

export interface ManagedWebhooksBulkDisableConfig {
    endpoint: string;
    confirmMessage: string;
    successTitle: string;
    successDescription: (disabled: number) => string;
    failureDescription: string;
}

export interface UseManagedWebhooksOptions {
    endpoint: string;
    loadErrorMessage: string;
    deleteErrorMessage: string;
    updateErrorMessage: string;
    testErrorMessage: string;
    workspaceOptions?: ManagedWebhooksWorkspaceOptionsConfig;
    bulkDisable?: ManagedWebhooksBulkDisableConfig;
}

export async function useManagedWebhooks(options: UseManagedWebhooksOptions) {
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
    } = await useFetch<{ webhooks: ManagedWebhook[] }>(options.endpoint, {
        credentials: 'include',
        default: () => ({ webhooks: [] }),
    });

    const workspaceFetch = options.workspaceOptions
        ? await useFetch<{ items: Array<{ id: string; name: string }> }>(
              options.workspaceOptions.endpoint,
              {
                  credentials: 'include',
                  query: options.workspaceOptions.query,
                  default: () => ({ items: [] }),
              }
          )
        : null;

    const webhooks = computed(() => data.value?.webhooks ?? []);
    const workspaceOptions = computed<ManagedWorkspaceOption[]>(() =>
        (workspaceFetch?.data.value?.items ?? []).map((workspace) => ({
            id: workspace.id,
            name: workspace.name,
        }))
    );
    const errorMessage = computed(() =>
        error.value ? getMessage(error.value, options.loadErrorMessage) : null
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
            await $fetch(`${options.endpoint}/${webhook.id}`, {
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
                description: getMessage(fetchError, options.deleteErrorMessage),
                color: 'error',
            });
        }
    }

    async function toggleWebhook(webhook: ManagedWebhook) {
        try {
            await $fetch(`${options.endpoint}/${webhook.id}/toggle`, {
                method: 'POST',
                credentials: 'include',
                body: {},
            });
            await refresh();
        } catch (fetchError: unknown) {
            toast.add({
                title: 'Update failed',
                description: getMessage(fetchError, options.updateErrorMessage),
                color: 'error',
            });
        }
    }

    async function disableAll() {
        if (!options.bulkDisable) {
            return;
        }

        if (!import.meta.client || !window.confirm(options.bulkDisable.confirmMessage)) {
            return;
        }

        bulkDisabling.value = true;
        try {
            const result = await $fetch<{ disabled: number }>(
                options.bulkDisable.endpoint,
                {
                    method: 'POST',
                    credentials: 'include',
                }
            );
            testResult.value = null;
            await refresh();
            toast.add({
                title: options.bulkDisable.successTitle,
                description: options.bulkDisable.successDescription(result.disabled),
                color: 'success',
            });
        } catch (fetchError: unknown) {
            toast.add({
                title: 'Bulk disable failed',
                description: getMessage(
                    fetchError,
                    options.bulkDisable.failureDescription
                ),
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
            const result = await $fetch<
                Omit<ManagedWebhookTestResult, 'webhookId'>
            >(`${options.endpoint}/${webhook.id}/test`, {
                method: 'POST',
                credentials: 'include',
            });
            testResult.value = {
                webhookId: webhook.id,
                ...result,
            };
            await refresh();
        } catch (fetchError: unknown) {
            toast.add({
                title: 'Test ping failed',
                description: getMessage(fetchError, options.testErrorMessage),
                color: 'error',
            });
        } finally {
            testingId.value = null;
        }
    }

    return {
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
        refresh,
        sendTestPing,
        testResult,
        testingId,
        toggleWebhook,
        webhooks,
        workspaceOptions,
    };
}
