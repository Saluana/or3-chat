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
                    
                    <!-- Info about disabled buttons -->
                    <div v-if="!status?.admin?.allowRestart && !status?.admin?.allowRebuild" class="p-3 rounded bg-blue-500/10 border border-blue-500/20">
                        <div class="text-xs font-bold text-blue-600 uppercase mb-1">Info</div>
                        <div class="text-sm text-blue-600 dark:text-blue-400">
                            Server operations are disabled. To enable, set <code class="text-xs bg-black/10 dark:bg-white/10 px-1 py-0.5 rounded">OR3_ADMIN_ALLOW_RESTART=true</code> or <code class="text-xs bg-black/10 dark:bg-white/10 px-1 py-0.5 rounded">OR3_ADMIN_ALLOW_REBUILD=true</code> in your environment.
                        </div>
                    </div>

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

        <!-- Grouped Configuration -->
        <div v-if="!pending && enrichedEntries.length > 0">
            <h3 class="text-lg font-semibold mb-3">Configuration</h3>
            <div class="space-y-6">
                <div
                    v-for="group in configGroups"
                    :key="group"
                    class="p-5 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-outline-variant)] bg-[var(--md-surface)]"
                >
                    <h4 class="text-base font-semibold mb-4 flex items-center gap-2">
                        <span class="w-1 h-4 rounded-full" :class="getGroupColor(group)"></span>
                        {{ group }}
                    </h4>
                    <div class="space-y-5">
                        <div
                            v-for="entry in getEntriesForGroup(group)"
                            :key="entry.key"
                            class="space-y-2"
                        >
                            <label class="block">
                                <div class="flex items-start justify-between mb-1">
                                    <div class="flex-1">
                                        <div class="font-medium text-sm">{{ entry.label }}</div>
                                        <div class="text-xs opacity-60 mt-0.5">{{ entry.description }}</div>
                                    </div>
                                    <code class="text-xs opacity-40 font-mono ml-2 mt-0.5">{{ entry.key }}</code>
                                </div>
                                <UInput
                                    v-model="entry.value"
                                    size="sm"
                                    :disabled="!isOwner"
                                    :placeholder="entry.masked ? '******' : ''"
                                    class="w-full"
                                >
                                    <template #trailing v-if="entry.masked">
                                        <UBadge size="xs" color="neutral" variant="subtle">MASKED</UBadge>
                                    </template>
                                </UInput>
                            </label>
                        </div>
                    </div>
                </div>

                <div class="flex justify-end">
                    <UButton :disabled="!isOwner" @click="saveConfig" color="neutral" variant="solid" icon="i-heroicons-check">
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

type EnrichedConfigEntry = {
    key: string;
    value: string | null;
    masked: boolean;
    label: string;
    description: string;
    group: string;
    order: number;
};

type ConfigGroup = 
    | 'Auth'
    | 'Sync'
    | 'Storage'
    | 'UI & Branding'
    | 'Features'
    | 'Limits & Security'
    | 'Background Processing'
    | 'Admin'
    | 'External Services';

const { data: statusData, status: statusFetchStatus } = await useLazyFetch<StatusResponse>(
    '/api/admin/system/status'
);
const { data: enrichedConfigData, status: configFetchStatus } = await useLazyFetch<{ entries: EnrichedConfigEntry[] }>(
    '/api/admin/system/config/enriched'
);

const pending = computed(() => statusFetchStatus.value === 'pending' || configFetchStatus.value === 'pending');
const status = computed(() => statusData.value?.status);
const warnings = computed(() => statusData.value?.warnings ?? []);
const enrichedEntries = ref<EnrichedConfigEntry[]>([]);
const role = computed(() => statusData.value?.session?.role);
const isOwner = computed(() => role.value === 'owner');

const configGroups: ConfigGroup[] = [
    'Auth',
    'Sync',
    'Storage',
    'UI & Branding',
    'Features',
    'Limits & Security',
    'Background Processing',
    'Admin',
    'External Services',
];

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
    () => enrichedConfigData.value?.entries,
    (next) => {
        if (next) {
            enrichedEntries.value = next.map((e) => ({ ...e })).sort((a, b) => {
                const groupCompare = configGroups.indexOf(a.group as ConfigGroup) - configGroups.indexOf(b.group as ConfigGroup);
                if (groupCompare !== 0) return groupCompare;
                return a.order - b.order;
            });
        }
    },
    { immediate: true }
);

function getEntriesForGroup(group: ConfigGroup): EnrichedConfigEntry[] {
    return enrichedEntries.value.filter((e) => e.group === group);
}

function getGroupColor(group: ConfigGroup): string {
    const colors: Record<ConfigGroup, string> = {
        'Auth': 'bg-blue-500',
        'Sync': 'bg-green-500',
        'Storage': 'bg-purple-500',
        'UI & Branding': 'bg-pink-500',
        'Features': 'bg-yellow-500',
        'Limits & Security': 'bg-red-500',
        'Background Processing': 'bg-indigo-500',
        'Admin': 'bg-gray-500',
        'External Services': 'bg-teal-500',
    };
    return colors[group] || 'bg-gray-500';
}

async function saveConfig() {
    await $fetch('/api/admin/system/config/write', {
        method: 'POST',
        body: { entries: enrichedEntries.value.map((e) => ({ key: e.key, value: e.value })) },
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
