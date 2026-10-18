<template>
    <div class="space-y-8">
        <header>
            <div class="flex items-center gap-3">
                <div
                    class="flex h-10 w-10 items-center justify-center rounded-[var(--md-sys-shape-corner-medium,12px)] bg-[var(--md-primary)]/10 text-[var(--md-primary)]"
                >
                    <UIcon name="i-heroicons-wrench-screwdriver" class="h-5 w-5" />
                </div>
                <div>
                    <h2 class="text-2xl font-semibold">Operations</h2>
                    <p class="mt-1 text-sm opacity-70">
                        Monitor OR3 and perform routine server maintenance.
                    </p>
                </div>
            </div>
        </header>

        <ClientOnly>
            <div
                v-if="pending || !status"
                class="grid grid-cols-1 gap-6 animate-pulse md:grid-cols-2"
            >
                <div class="h-64 rounded-[var(--md-sys-shape-corner-medium,12px)] bg-[var(--md-surface-container-highest)]" />
                <div class="h-64 rounded-[var(--md-sys-shape-corner-medium,12px)] bg-[var(--md-surface-container-highest)]" />
            </div>

            <template v-else>
                <div class="grid grid-cols-1 gap-6 md:grid-cols-2">
                    <AdminSystemStatusCard :status="status" :warnings="warnings" />
                    <AdminSystemOperationsCard
                        :is-owner="isOwner"
                        :allow-restart="Boolean(status.admin?.allowRestart)"
                        :can-restart="serverRestart.canRestart.value"
                        :busy="serverRestart.busy.value"
                        :progress="serverRestart.progress.value"
                        :needs-attention="serverRestart.operation.value?.phase === 'needs_attention'"
                        :can-cancel="serverRestart.operation.value?.phase === 'preparing'"
                        :reason="serverRestart.status.value?.capability.reason"
                        :saved-pending="Boolean(serverRestart.status.value?.capability.applySaved && serverRestart.status.value?.activeRevision !== serverRestart.status.value?.savedRevision)"
                        @restart="restart"
                        @apply-saved="serverRestart.restart('saved')"
                        @reconcile="serverRestart.reconcile()"
                        @cancel="serverRestart.cancel()"
                    />
                </div>

                <AdminSystemUpdateCard v-if="isOwner" :is-owner="isOwner" />

                <section v-if="providerActions.length" class="space-y-3">
                    <div>
                        <h3 class="text-lg font-semibold">Maintenance</h3>
                        <p class="mt-1 text-sm opacity-60">
                            Provider-specific cleanup and recovery tools.
                        </p>
                    </div>
                    <AdminSystemProviderActions
                        :actions="providerActions"
                        :is-owner="isOwner"
                        :running-action-id="runningActionId"
                        :result="providerActionResult"
                        @run="runProviderAction"
                    />
                </section>

                <section
                    class="rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-low)] p-5"
                >
                    <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div class="flex items-start gap-3">
                            <div
                                class="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--md-sys-shape-corner-small,8px)] bg-[var(--md-surface-container-highest)]"
                            >
                                <UIcon name="i-heroicons-adjustments-horizontal" class="h-5 w-5 opacity-70" />
                            </div>
                            <div>
                                <h3 class="text-sm font-semibold">Looking for infrastructure settings?</h3>
                                <p class="mt-1 text-xs leading-relaxed opacity-60">
                                    Authentication, databases, storage, security, background jobs,
                                    and service credentials now live in Advanced Settings.
                                </p>
                            </div>
                        </div>
                        <UButton
                            to="/admin/advanced"
                            color="neutral"
                            variant="soft"
                            trailing-icon="i-heroicons-arrow-right"
                            class="shrink-0"
                        >
                            Advanced Settings
                        </UButton>
                    </div>
                </section>
                <WorkspaceSelector
                    v-if="showStorageWorkspaceSelector"
                    v-model="showStorageWorkspaceSelector"
                    description="Choose the workspace whose storage usage you want to view."
                    @select="viewStorageUsage"
                />
            </template>

            <template #fallback>
                <div class="grid grid-cols-1 gap-6 animate-pulse md:grid-cols-2">
                    <div class="h-64 rounded-[var(--md-sys-shape-corner-medium,12px)] bg-[var(--md-surface-container-highest)]" />
                    <div class="h-64 rounded-[var(--md-sys-shape-corner-medium,12px)] bg-[var(--md-surface-container-highest)]" />
                </div>
            </template>
        </ClientOnly>
    </div>
</template>

<script setup lang="ts">
import { ADMIN_HEADERS } from '~/composables/admin/useAdminExtensions';
import { useAdminSystemStatus } from '~/composables/admin/useAdminData';
import { useServerRestart } from '~/composables/admin/useServerRestart';
import { useConfirmDialog } from '~/composables/admin/useConfirmDialog';
import { parseErrorMessage } from '~/utils/admin/parse-error';
import type { ProviderAction } from '~/composables/admin/useAdminTypes';
import AdminSystemStatusCard from '~/components/admin/system/AdminSystemStatusCard.vue';
import AdminSystemOperationsCard from '~/components/admin/system/AdminSystemOperationsCard.vue';
import AdminSystemProviderActions from '~/components/admin/system/AdminSystemProviderActions.vue';
import AdminSystemUpdateCard from '~/components/admin/system/AdminSystemUpdateCard.vue';
import WorkspaceSelector from '~/components/admin/WorkspaceSelector.vue';

definePageMeta({
    layout: 'admin',
    middleware: ['admin-auth'],
});

const { data: statusData, status: statusFetchStatus } = useAdminSystemStatus();
const { confirm } = useConfirmDialog();
const toast = useToast();
const route = useRoute();
const router = useRouter();

const pending = computed(() => statusFetchStatus.value === 'pending');
const status = computed(() => statusData.value?.status);
const warnings = computed(() => statusData.value?.warnings ?? []);
const isOwner = computed(() => statusData.value?.session?.role === 'owner');
const providerActionResult = ref<{ label: string; value: unknown } | null>(null);
const runningActionId = ref<string | null>(null);
const showStorageWorkspaceSelector = ref(false);

const providerActions = computed(() => {
    if (!status.value) return [];
    const actions: Array<
        ProviderAction & { kind: 'auth' | 'sync' | 'storage'; provider: string }
    > = [];
    for (const kind of ['auth', 'sync', 'storage'] as const) {
        const provider = status.value[kind].provider;
        if (!status.value[kind].enabled) continue;
        for (const action of status.value[kind].actions ?? []) {
            actions.push({ ...action, kind, provider });
        }
    }
    return actions;
});
const storageUsageAction = computed(() => providerActions.value.find(action =>
    action.kind === 'storage' && action.id === 'storage.usage'));

// Consume the notice link after status loads so it opens the chooser on both
// entry points, including repeated clicks after cancellation.
watch([() => route.hash, statusFetchStatus], ([hash, fetchStatus]) => {
    if (hash !== '#storage-usage' || fetchStatus === 'pending' || fetchStatus === 'idle') return;
    openStorageUsage();
    void router.replace({ query: route.query, hash: '' });
}, { immediate: true });

function openStorageUsage() {
    if (!isOwner.value || !storageUsageAction.value) {
        toast.add({
            title: 'Storage usage unavailable',
            description: statusFetchStatus.value === 'error'
                ? 'Could not load server status. Refresh this page and try again.'
                : !isOwner.value
                    ? 'Only the server owner can view storage usage.'
                    : 'The active storage provider does not offer storage usage checks.',
            color: 'warning',
        });
        return;
    }
    if (runningActionId.value) {
        toast.add({ title: 'Action in progress', description: 'Wait for the current check to finish, then try again.', color: 'info' });
        return;
    }
    showStorageWorkspaceSelector.value = true;
}

function viewStorageUsage(workspace: { id: string; name: string }) {
    if (storageUsageAction.value) void runProviderAction(storageUsageAction.value, workspace);
}

const serverRestart = useServerRestart(
    isOwner,
    computed(() => status.value?.admin?.allowRestart)
);

async function restart() {
    await serverRestart.restart();
}

async function runProviderAction(action: {
    id: string;
    label: string;
    kind: 'auth' | 'sync' | 'storage';
    provider: string;
    danger?: boolean;
    description?: string;
}, workspace?: { id: string; name: string }) {
    if (action.kind === 'storage' && action.id === 'storage.usage' && !workspace) {
        openStorageUsage();
        return;
    }
    if (runningActionId.value) return;
    if (action.danger) {
        const confirmed = await confirm({
            title: 'Run Provider Action',
            message: [
                `Are you sure you want to run "${action.label}"?`,
                action.description || null,
                'This action cannot be undone.',
            ]
                .filter(Boolean)
                .join(' '),
            danger: true,
            confirmText: 'Run',
        });
        if (!confirmed) return;
    }

    try {
        runningActionId.value = action.kind + ':' + action.id;
        providerActionResult.value = null;
        const response = await $fetch<{ ok: boolean; result: unknown }>('/api/admin/system/provider-action', {
            method: 'POST',
            headers: ADMIN_HEADERS,
            body: { kind: action.kind, actionId: action.id, workspaceId: workspace?.id },
        });
        providerActionResult.value = {
            label: workspace ? `Storage usage for ${workspace.name}` : action.label,
            value: response.result,
        };
        const disabled = response.result !== null && typeof response.result === 'object'
            && 'status' in response.result && response.result.status === 'disabled';
        toast.add({
            title: disabled ? 'Action disabled' : 'Action completed',
            description: disabled ? 'No files were deleted. See the provider result for the reason.' : `${action.label} returned a result below.`,
            color: disabled ? 'warning' : 'success',
        });
        await nextTick();
        const resultElement = document.getElementById('provider-action-result');
        resultElement?.focus({ preventScroll: true });
        resultElement?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error: unknown) {
        toast.add({
            title: 'Action failed',
            description: parseErrorMessage(error, 'Action failed'),
            color: 'error',
        });
    } finally {
        runningActionId.value = null;
    }
}
</script>
