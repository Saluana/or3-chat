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
                        :allow-rebuild="Boolean(status.admin?.allowRebuild)"
                        @restart="restart"
                        @rebuild-restart="rebuildRestart"
                    />
                </div>

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

definePageMeta({
    layout: 'admin',
    middleware: ['admin-auth'],
});

const { data: statusData, status: statusFetchStatus } = useAdminSystemStatus();
const { confirm } = useConfirmDialog();
const toast = useToast();

const pending = computed(() => statusFetchStatus.value === 'pending');
const status = computed(() => statusData.value?.status);
const warnings = computed(() => statusData.value?.warnings ?? []);
const isOwner = computed(() => statusData.value?.session?.role === 'owner');

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

const serverRestart = useServerRestart(
    isOwner,
    computed(() => status.value?.admin?.allowRestart)
);

async function restart() {
    await serverRestart.restart();
}

async function rebuildRestart() {
    const confirmed = await confirm({
        title: 'Rebuild & Restart Server',
        message:
            'Are you sure you want to rebuild and restart the server now? This process may take several minutes.',
        danger: true,
        confirmText: 'Rebuild & Restart',
    });
    if (!confirmed) return;

    try {
        await $fetch('/api/admin/system/rebuild-restart', {
            method: 'POST',
            headers: ADMIN_HEADERS,
        });
        toast.add({
            title: 'Rebuild initiated',
            description: 'The server is rebuilding and will restart.',
            color: 'success',
        });
    } catch (error: unknown) {
        toast.add({
            title: 'Rebuild failed',
            description: parseErrorMessage(error, 'Rebuild failed'),
            color: 'error',
        });
    }
}

async function runProviderAction(action: {
    id: string;
    label: string;
    kind: 'auth' | 'sync' | 'storage';
    provider: string;
    danger?: boolean;
    description?: string;
}) {
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
        await $fetch('/api/admin/system/provider-action', {
            method: 'POST',
            headers: ADMIN_HEADERS,
            body: { kind: action.kind, actionId: action.id },
        });
        toast.add({
            title: 'Action completed',
            description: `${action.label} executed successfully.`,
            color: 'success',
        });
    } catch (error: unknown) {
        toast.add({
            title: 'Action failed',
            description: parseErrorMessage(error, 'Action failed'),
            color: 'error',
        });
    }
}
</script>
