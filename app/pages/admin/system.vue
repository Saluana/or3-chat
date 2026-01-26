<template>
    <div class="space-y-4">
        <UCard v-if="status">
            <template #header>
                <h2 class="text-lg font-semibold">System Status</h2>
            </template>
            <div class="space-y-2 text-sm">
                <div>
                    Auth: <span class="font-medium">{{ status.auth.provider }}</span>
                    <span class="opacity-70">({{ status.auth.enabled ? 'enabled' : 'disabled' }})</span>
                </div>
                <div>
                    Sync: <span class="font-medium">{{ status.sync.provider }}</span>
                    <span class="opacity-70">({{ status.sync.enabled ? 'enabled' : 'disabled' }})</span>
                </div>
                <div>
                    Storage: <span class="font-medium">{{ status.storage.provider }}</span>
                    <span class="opacity-70">({{ status.storage.enabled ? 'enabled' : 'disabled' }})</span>
                </div>
                <div>
                    Background Streaming:
                    <span class="font-medium">
                        {{ status.backgroundStreaming.enabled ? 'enabled' : 'disabled' }}
                    </span>
                </div>
                <div v-if="warnings.length > 0" class="mt-3 space-y-1">
                    <div
                        v-for="(w, idx) in warnings"
                        :key="idx"
                        class="text-amber-400"
                    >
                        {{ w.message }}
                    </div>
                </div>
            </div>
        </UCard>

        <UCard v-if="providerActions.length > 0">
            <template #header>
                <h3 class="text-base font-semibold">Provider Actions</h3>
            </template>
            <div class="space-y-3 text-sm">
                <div
                    v-for="action in providerActions"
                    :key="action.kind + ':' + action.id"
                    class="flex items-center justify-between border-b border-[var(--md-outline-variant)] pb-2"
                >
                    <div>
                        <div class="font-medium">{{ action.label }}</div>
                        <div class="opacity-70 text-xs">
                            {{ action.kind }} • {{ action.provider }}
                        </div>
                        <div v-if="action.description" class="text-xs opacity-70">
                            {{ action.description }}
                        </div>
                    </div>
                    <UButton
                        size="xs"
                        :color="action.danger ? 'error' : 'primary'"
                        :disabled="!isOwner"
                        @click="runProviderAction(action)"
                    >
                        Run
                    </UButton>
                </div>
            </div>
        </UCard>

        <UCard v-if="entries.length > 0">
            <template #header>
                <h3 class="text-base font-semibold">Configuration</h3>
            </template>
            <div class="space-y-3 text-sm">
                <div
                    v-for="entry in entries"
                    :key="entry.key"
                    class="grid grid-cols-1 md:grid-cols-3 gap-2 items-center"
                >
                    <div class="font-medium">{{ entry.key }}</div>
                    <UInput
                        v-model="entry.value"
                        size="sm"
                        :disabled="!isOwner"
                        :placeholder="entry.masked ? '******' : ''"
                    />
                    <div class="text-xs opacity-60">
                        {{ entry.masked ? 'masked' : '' }}
                    </div>
                </div>
                <div class="pt-2">
                    <UButton size="sm" :disabled="!isOwner" @click="saveConfig">
                        Save Config
                    </UButton>
                </div>
            </div>
        </UCard>

        <UCard>
            <template #header>
                <h3 class="text-base font-semibold">Operations</h3>
            </template>
            <div class="flex items-center gap-2">
                <UButton
                    size="sm"
                    color="error"
                    variant="soft"
                    :disabled="!isOwner || !status?.admin?.allowRestart"
                    @click="restart"
                >
                    Restart
                </UButton>
                <UButton
                    size="sm"
                    color="error"
                    variant="soft"
                    :disabled="!isOwner || !status?.admin?.allowRebuild"
                    @click="rebuildRestart"
                >
                    Rebuild + Restart
                </UButton>
            </div>
        </UCard>
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

const { data: statusData } = await useFetch<StatusResponse>(
    '/api/admin/system/status'
);
const { data: configData } = await useFetch<{ entries: ConfigEntry[] }>(
    '/api/admin/system/config'
);

const status = computed(() => statusData.value?.status);
const warnings = computed(() => statusData.value?.warnings ?? []);
const entries = ref<ConfigEntry[]>(configData.value?.entries ?? []);
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
