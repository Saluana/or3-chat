<template>
    <div class="space-y-8">
        <div>
            <h2 class="text-2xl font-semibold mb-1">System</h2>
            <p class="text-sm opacity-70">
                Core system configuration and status.
            </p>
        </div>

        <div v-if="pending" class="grid grid-cols-1 md:grid-cols-2 gap-6 animate-pulse">
            <div class="h-64 bg-[var(--md-surface-container-highest)] rounded-[var(--md-sys-shape-corner-medium,12px)]"></div>
            <div class="h-64 bg-[var(--md-surface-container-highest)] rounded-[var(--md-sys-shape-corner-medium,12px)]"></div>
        </div>

        <div v-else-if="status" class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <!-- Status Card -->
             <div class="p-5 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-outline-variant)] bg-[var(--md-surface)]">
                <h3 class="text-lg font-medium mb-4">Status</h3>
                <div class="space-y-3 text-sm">
                    <div class="flex justify-between items-center py-2 border-b border-[var(--md-outline-variant)]/50">
                        <span class="opacity-70">Auth Provider</span>
                        <div class="flex items-center gap-2">
                            <span class="font-medium">{{ status.auth.provider }}</span>
                            <div class="w-2 h-2 rounded-full" :class="status.auth.enabled ? 'bg-green-500' : 'bg-gray-400'"></div>
                        </div>
                    </div>
                     <div class="flex justify-between items-center py-2 border-b border-[var(--md-outline-variant)]/50">
                        <span class="opacity-70">Sync Engine</span>
                        <div class="flex items-center gap-2">
                            <span class="font-medium">{{ status.sync.provider }}</span>
                            <div class="w-2 h-2 rounded-full" :class="status.sync.enabled ? 'bg-green-500' : 'bg-gray-400'"></div>
                        </div>
                    </div>
                     <div class="flex justify-between items-center py-2 border-b border-[var(--md-outline-variant)]/50">
                        <span class="opacity-70">Storage</span>
                        <div class="flex items-center gap-2">
                            <span class="font-medium">{{ status.storage.provider }}</span>
                            <div class="w-2 h-2 rounded-full" :class="status.storage.enabled ? 'bg-green-500' : 'bg-gray-400'"></div>
                        </div>
                    </div>
                     <div class="flex justify-between items-center py-2">
                        <span class="opacity-70">Background Streaming</span>
                        <div class="flex items-center gap-2">
                            <span class="font-medium">{{ status.backgroundStreaming.enabled ? 'Active' : 'Inactive' }}</span>
                             <div class="w-2 h-2 rounded-full" :class="status.backgroundStreaming.enabled ? 'bg-green-500' : 'bg-gray-400'"></div>
                        </div>
                    </div>
                </div>

                 <div v-if="warnings.length > 0" class="mt-6 p-3 rounded bg-amber-500/10 border border-amber-500/20">
                    <div class="text-xs font-bold text-amber-600 uppercase mb-2">Warnings</div>
                    <div class="space-y-1">
                        <div
                            v-for="(w, idx) in warnings"
                            :key="idx"
                            class="text-sm text-amber-600 dark:text-amber-400"
                        >
                            • {{ w.message }}
                        </div>
                    </div>
                </div>
            </div>

            <!-- Operations Card -->
            <div class="p-5 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-outline-variant)] bg-[var(--md-surface)]">
                 <h3 class="text-lg font-medium mb-4">Operations</h3>
                 <div class="space-y-4">
                    <p class="text-sm opacity-70">
                        Manage server lifecycle. These actions may cause temporary downtime.
                    </p>
                    <div class="flex flex-col gap-3">
                         <UButton
                            color="error"
                            variant="soft"
                            icon="i-heroicons-arrow-path"
                            :disabled="!isOwner || !status?.admin?.allowRestart"
                            @click="restart"
                        >
                            Restart Server
                        </UButton>
                        <UButton
                            color="error"
                            variant="soft"
                            icon="i-heroicons-wrench-screwdriver"
                            :disabled="!isOwner || !status?.admin?.allowRebuild"
                            @click="rebuildRestart"
                        >
                            Rebuild & Restart
                        </UButton>
                    </div>
                 </div>
            </div>
        </div>

        <div v-if="!pending && providerActions.length > 0">
            <h3 class="text-lg font-semibold mb-3">Provider Actions</h3>
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div
                    v-for="action in providerActions"
                    :key="action.kind + ':' + action.id"
                    class="p-4 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-lowest)]"
                >
                    <div class="flex justify-between items-start mb-2">
                         <div class="text-xs font-bold uppercase opacity-50 tracking-wider">{{ action.kind }}</div>
                         <div class="text-xs opacity-50">{{ action.provider }}</div>
                    </div>
                   
                    <div class="font-medium text-base mb-1">{{ action.label }}</div>
                     <div v-if="action.description" class="text-sm opacity-70 mb-4 h-10 line-clamp-2">
                        {{ action.description }}
                    </div>
                    <UButton
                        size="xs"
                        block
                        :color="action.danger ? 'error' : 'primary'"
                        :variant="action.danger ? 'soft' : 'solid'"
                        :disabled="!isOwner"
                        @click="runProviderAction(action)"
                    >
                        Run Action
                    </UButton>
                </div>
            </div>
        </div>

        <div v-if="!pending && entries.length > 0">
            <h3 class="text-lg font-semibold mb-3">Configuration</h3>
            <div class="p-5 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-outline-variant)] bg-[var(--md-surface)]">
                 <div class="space-y-4">
                    <div
                        v-for="entry in entries"
                        :key="entry.key"
                        class="grid grid-cols-1 md:grid-cols-12 gap-4 items-center"
                    >
                        <div class="md:col-span-4 font-mono text-sm opacity-80 truncate" :title="entry.key">{{ entry.key }}</div>
                        <div class="md:col-span-8">
                            <UInput
                                v-model="entry.value"
                                size="sm"
                                :disabled="!isOwner"
                                :placeholder="entry.masked ? '******' : ''"
                            >
                                <template #trailing v-if="entry.masked">
                                    <UBadge size="xs" color="neutral" variant="subtle">MASKED</UBadge>
                                </template>
                            </UInput>
                        </div>
                    </div>
                </div>
                <div class="mt-6 flex justify-end">
                    <UButton :disabled="!isOwner" @click="saveConfig" color="neutral" variant="solid">
                        Save Configuration
                    </UButton>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
definePageMeta({
    layout: 'admin',
});

type StatusResponse = {
    status: {
        auth: {
            enabled: boolean;
            provider: string;
            details?: Record<string, unknown>;
            actions?: ProviderAction[];
        };
        sync: {
            enabled: boolean;
            provider: string;
            details?: Record<string, unknown>;
            actions?: ProviderAction[];
        };
        storage: {
            enabled: boolean;
            provider: string;
            details?: Record<string, unknown>;
            actions?: ProviderAction[];
        };
        backgroundStreaming: { enabled: boolean; storageProvider: string };
        admin?: { allowRestart: boolean; allowRebuild: boolean };
    };
    warnings: Array<{ level: 'warning' | 'error'; message: string }>;
    session?: { role?: string };
};

type ProviderAction = {
    id: string;
    label: string;
    description?: string;
    danger?: boolean;
};

type ConfigEntry = { key: string; value: string | null; masked: boolean };

const { data: statusData, status: statusFetchStatus } = await useLazyFetch<StatusResponse>(
    '/api/admin/system/status'
);
const { data: configData, status: configFetchStatus } = await useLazyFetch<{ entries: ConfigEntry[] }>(
    '/api/admin/system/config'
);

const pending = computed(() => statusFetchStatus.value === 'pending' || configFetchStatus.value === 'pending');
const status = computed(() => statusData.value?.status);
const warnings = computed(() => statusData.value?.warnings ?? []);
const entries = ref<ConfigEntry[]>([]);
const role = computed(() => statusData.value?.session?.role);
const isOwner = computed(() => role.value === 'owner');

const providerActions = computed(() => {
    if (!status.value) return [];
    const actions: Array<
        ProviderAction & { kind: 'auth' | 'sync' | 'storage'; provider: string }
    > = [];
    for (const kind of ['auth', 'sync', 'storage'] as const) {
        const provider = status.value[kind].provider;
        if (!status.value[kind].enabled) continue;
        const list = status.value[kind].actions ?? [];
        for (const action of list) {
            actions.push({ ...action, kind, provider });
        }
    }
    return actions;
});

watch(
    () => configData.value?.entries,
    (next) => {
        if (next) entries.value = next.map((e) => ({ ...e }));
    },
    { immediate: true }
);

async function saveConfig() {
    await $fetch('/api/admin/system/config/write', {
        method: 'POST',
        body: { entries: entries.value.map((e) => ({ key: e.key, value: e.value })) },
        headers: { 'x-or3-admin-intent': 'admin' },
    });
}

async function restart() {
    if (!confirm('Restart the server now?')) return;
    await $fetch('/api/admin/system/restart', {
        method: 'POST',
        headers: { 'x-or3-admin-intent': 'admin' },
    });
}

async function rebuildRestart() {
    if (!confirm('Rebuild and restart the server now?')) return;
    await $fetch('/api/admin/system/rebuild-restart', {
        method: 'POST',
        headers: { 'x-or3-admin-intent': 'admin' },
    });
}

async function runProviderAction(action: {
    id: string;
    label: string;
    kind: 'auth' | 'sync' | 'storage';
    provider: string;
    danger?: boolean;
}) {
    if (action.danger && !confirm(`Run ${action.label}?`)) return;
    await $fetch('/api/admin/system/provider-action', {
        method: 'POST',
        headers: { 'x-or3-admin-intent': 'admin' },
        body: { kind: action.kind, actionId: action.id },
    });
}
</script>
