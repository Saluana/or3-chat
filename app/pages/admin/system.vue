<template>
    <div class="space-y-8">
        <div>
            <h2 class="text-2xl font-semibold mb-1">System</h2>
            <p class="text-sm opacity-70">
                Core system configuration and status.
            </p>
        </div>

        <ClientOnly>
            <!-- Skeleton: show when pending OR when no data yet -->
            <div v-if="pending || !status" class="grid grid-cols-1 md:grid-cols-2 gap-6 animate-pulse">
                <div class="h-64 bg-[var(--md-surface-container-highest)] rounded-[var(--md-sys-shape-corner-medium,12px)]"></div>
                <div class="h-64 bg-[var(--md-surface-container-highest)] rounded-[var(--md-sys-shape-corner-medium,12px)]"></div>
            </div>

            <template v-else>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <!-- Status Card -->
             <div class="p-5 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-outline-variant)] bg-[var(--md-surface)]">
                <h3 class="text-lg font-medium mb-4">Status</h3>
                <div class="space-y-3 text-sm">
                    <div class="flex justify-between items-center py-2 border-b border-[var(--md-outline-variant)]/50">
                        <span class="opacity-70">Auth Provider</span>
                        <div class="flex items-center gap-2">
                            <span class="font-medium">{{ status.auth.provider }}</span>
                            <div class="w-2 h-2 rounded-full" :class="status.auth.enabled ? 'bg-[var(--md-sys-color-success,#10b981)]' : 'bg-[var(--md-outline-variant)]'"></div>
                        </div>
                    </div>
                     <div class="flex justify-between items-center py-2 border-b border-[var(--md-outline-variant)]/50">
                        <span class="opacity-70">Sync Engine</span>
                        <div class="flex items-center gap-2">
                            <span class="font-medium">{{ status.sync.provider }}</span>
                            <div class="w-2 h-2 rounded-full" :class="status.sync.enabled ? 'bg-[var(--md-sys-color-success,#10b981)]' : 'bg-[var(--md-outline-variant)]'"></div>
                        </div>
                    </div>
                     <div class="flex justify-between items-center py-2 border-b border-[var(--md-outline-variant)]/50">
                        <span class="opacity-70">Storage</span>
                        <div class="flex items-center gap-2">
                            <span class="font-medium">{{ status.storage.provider }}</span>
                            <div class="w-2 h-2 rounded-full" :class="status.storage.enabled ? 'bg-[var(--md-sys-color-success,#10b981)]' : 'bg-[var(--md-outline-variant)]'"></div>
                        </div>
                    </div>
                     <div class="flex justify-between items-center py-2">
                        <span class="opacity-70">Background Streaming</span>
                        <div class="flex items-center gap-2">
                            <span class="font-medium">{{ status.backgroundStreaming.enabled ? 'Active' : 'Inactive' }}</span>
                             <div class="w-2 h-2 rounded-full" :class="status.backgroundStreaming.enabled ? 'bg-[var(--md-sys-color-success,#10b981)]' : 'bg-[var(--md-outline-variant)]'"></div>
                        </div>
                    </div>
                </div>

                 <div v-if="warnings.length > 0" class="mt-6 p-3 rounded bg-[var(--md-sys-color-warning-container,#fef3c7)] border border-[var(--md-sys-color-warning,#f59e0b)]/20">
                    <div class="text-xs font-bold text-[var(--md-sys-color-on-warning-container,#92400e)] uppercase mb-2">Warnings</div>
                    <div class="space-y-1">
                        <div
                            v-for="(w, idx) in warnings"
                            :key="idx"
                            class="text-sm text-[var(--md-sys-color-on-warning-container,#92400e)]"
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
                    <div v-if="!status?.admin?.allowRestart && !status?.admin?.allowRebuild" class="p-3 rounded bg-[var(--md-sys-color-info-container,#dbeafe)] border border-[var(--md-sys-color-info,#3b82f6)]/20">
                        <div class="text-xs font-bold text-[var(--md-sys-color-on-info-container,#1e3a8a)] uppercase mb-1">Info</div>
                        <div class="text-sm text-[var(--md-sys-color-on-info-container,#1e40af)]">
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

                <div v-if="providerActions.length > 0">
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

                <!-- Restart Required Banner -->
                <div v-if="restartRequired" class="p-4 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-sys-color-warning,#f59e0b)] bg-[var(--md-sys-color-warning-container,#fef3c7)] text-[var(--md-sys-color-on-warning-container,#92400e)] flex items-center justify-between gap-4">
                    <div class="flex items-center gap-3">
                        <UIcon name="i-heroicons-exclamation-triangle" class="w-5 h-5 flex-shrink-0" />
                        <div>
                            <div class="font-semibold text-sm">Restart Required</div>
                            <div class="text-xs opacity-80">Some changes will only take effect after a server restart.</div>
                        </div>
                    </div>
                    <UButton
                        size="xs"
                        color="error"
                        variant="solid"
                        :disabled="!isOwner || !status?.admin?.allowRestart"
                        @click="restart"
                    >
                        Restart Now
                    </UButton>
                </div>

                <!-- Grouped Configuration -->
                <div v-if="enrichedEntries.length > 0">
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
	                                <USelectMenu
	                                    v-if="entry.valueType === 'boolean' && !entry.masked"
	                                    :model-value="entry.value ?? undefined"\n                                    @update:model-value="entry.value = $event ?? null"
	                                    size="sm"
	                                    :disabled="!isOwner"
	                                    :items="booleanItems"
	                                    :value-key="'value'"
	                                    class="w-full"
	                                />
	                                <UInput
	                                    v-else
	                                    v-model="entry.value"
	                                    size="sm"
	                                    :disabled="!isOwner"
	                                    :type="entry.valueType === 'number' ? 'number' : 'text'"
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
                    <UButton
                        :disabled="!isOwner || isSaving"
                        :loading="isSaving"
                        @click="saveConfig"
                        color="neutral"
                        variant="solid"
                        icon="i-heroicons-check"
                    >
                        Save Configuration
                    </UButton>
                </div>
            </div>
        </div>
            </template>

            <!-- SSR fallback skeleton -->
            <template #fallback>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6 animate-pulse">
                    <div class="h-64 bg-[var(--md-surface-container-highest)] rounded-[var(--md-sys-shape-corner-medium,12px)]"></div>
                    <div class="h-64 bg-[var(--md-surface-container-highest)] rounded-[var(--md-sys-shape-corner-medium,12px)]"></div>
                </div>
            </template>
        </ClientOnly>
    </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { ADMIN_HEADERS } from '~/composables/admin/useAdminExtensions';
import { useAdminSystemConfigEnriched, useAdminSystemStatus } from '~/composables/admin/useAdminData';
import { useServerRestart } from '~/composables/admin/useServerRestart';
import { useConfirmDialog } from '~/composables/admin/useConfirmDialog';
import { parseErrorMessage } from '~/utils/admin/parse-error';
import type { ConfigGroup, EnrichedConfigEntry, ProviderAction } from '~/composables/admin/useAdminTypes';

definePageMeta({
    layout: 'admin',
});

const { data: statusData, status: statusFetchStatus } = useAdminSystemStatus();
const { data: enrichedConfigData, status: configFetchStatus } = useAdminSystemConfigEnriched();

// Use fetch status for pending state to avoid hydration mismatch.
// With lazy: true, data may differ between SSR and client.
const pending = computed(
    () => statusFetchStatus.value === 'pending' || configFetchStatus.value === 'pending'
);
const status = computed(() => statusData.value?.status);
	const warnings = computed(() => statusData.value?.warnings ?? []);
	type EnrichedConfigEntryUi = Omit<EnrichedConfigEntry, 'value'> & {
	    value: string | null;
	};
	const enrichedEntries = ref<EnrichedConfigEntryUi[]>([]);
	const restartRequired = ref(false);
    const isSaving = ref(false);
		const role = computed(() => statusData.value?.session?.role);
		const isOwner = computed(() => role.value === 'owner');
		const booleanItems: Array<{ label: string; value: string }> = [
		    { label: 'Enabled', value: 'true' },
		    { label: 'Disabled', value: 'false' },
	];

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

		function normalizeUiValue(entry: EnrichedConfigEntry): string | null {
		    if (entry.masked) return entry.value ?? null;
		    if (entry.valueType === 'boolean') return entry.value ?? null;
		    return entry.value ?? '';
		}

	function normalizeForSave(value: string | null | undefined, masked: boolean): string | null {
	    if (masked && value === '******') return '******';
	    if (value === null || value === undefined || value === '') return null;
	    return value;
	}

	const originalValues = ref<Record<string, string | null | undefined>>({});

		watch(
		    () => enrichedConfigData.value?.entries,
		    (next) => {
		        if (next) {
		            const uiEntries: EnrichedConfigEntryUi[] = next.map((e) => ({
		                ...e,
		                value: normalizeUiValue(e),
		            }));
		            originalValues.value = Object.fromEntries(
		                uiEntries.map((e) => [e.key, e.value])
		            );

	            enrichedEntries.value = uiEntries.sort((a, b) => {
	                const groupCompare = configGroups.indexOf(a.group as ConfigGroup) - configGroups.indexOf(b.group as ConfigGroup);
	                if (groupCompare !== 0) return groupCompare;
	                return a.order - b.order;
	            });
	        }
	    },
		    { immediate: true }
		);

	function getEntriesForGroup(group: ConfigGroup): EnrichedConfigEntryUi[] {
	    return enrichedEntries.value.filter((e) => e.group === group);
	}

const GROUP_COLORS: Record<ConfigGroup, string> = {
    'Auth': 'bg-[var(--md-sys-color-primary)]',
    'Sync': 'bg-[var(--md-sys-color-secondary)]',
    'Storage': 'bg-[var(--md-sys-color-tertiary)]',
    'UI & Branding': 'bg-[var(--md-sys-color-primary-container)]',
    'Features': 'bg-[var(--md-sys-color-secondary-container)]',
    'Limits & Security': 'bg-[var(--md-sys-color-error)]',
    'Background Processing': 'bg-[var(--md-sys-color-tertiary-container)]',
    'Admin': 'bg-[var(--md-outline)]',
    'External Services': 'bg-[var(--md-sys-color-surface-tint)]',
};

function getGroupColor(group: ConfigGroup): string {
    return GROUP_COLORS[group] || 'bg-[var(--md-outline)]';
}

	async function saveConfig() {
        if (isSaving.value) return;
	    const updates = enrichedEntries.value
	        .map((entry) => {
	            const prev = originalValues.value[entry.key];
	            const prevNormalized = normalizeForSave(prev, entry.masked);
	            const nextNormalized = normalizeForSave(entry.value, entry.masked);
	            return prevNormalized === nextNormalized
	                ? null
	                : { key: entry.key, value: nextNormalized };
	        })
	        .filter(Boolean) as Array<{ key: string; value: string | null }>;

        if (updates.length === 0) {
            toast.add({
                title: 'No changes detected',
                description: 'Update a setting before saving.',
                color: 'neutral',
            });
            return;
        }

        isSaving.value = true;
        try {
	        const res = await $fetch<{ ok: boolean; restartRequired?: boolean }>('/api/admin/system/config/write', {
	            method: 'POST',
	            body: {
	                entries: updates,
	            },
	            headers: { 'x-or3-admin-intent': 'admin' },
	        });

	        if (res.restartRequired) {
	            restartRequired.value = true;
	        }

	        originalValues.value = Object.fromEntries(
	            enrichedEntries.value.map((e) => [e.key, e.value])
	        );

            toast.add({
                title: 'Configuration saved',
                description: 'Settings have been updated successfully.',
                color: 'success',
            });
        } catch (error: unknown) {
            const message = parseErrorMessage(error, 'Failed to save configuration');
            toast.add({ title: 'Error', description: message, color: 'error' });
        } finally {
            isSaving.value = false;
        }
	}

const { confirm } = useConfirmDialog();
const toast = useToast();

// Use composable for basic restart, but system page has extra rebuild functionality
const serverRestart = useServerRestart(
    isOwner,
    computed(() => status.value?.admin?.allowRestart)
);

// Override restart to use composable's implementation
async function restart() {
    await serverRestart.restart();
}

async function rebuildRestart() {
    const confirmed = await confirm({
        title: 'Rebuild & Restart Server',
        message: 'Are you sure you want to rebuild and restart the server now? This process may take several minutes.',
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
            description: 'The server is rebuilding and will restart...',
            color: 'success',
        });
    } catch (error: unknown) {
        const message = parseErrorMessage(error, 'Rebuild failed');
        toast.add({ title: 'Error', description: message, color: 'error' });
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
                action.description ? action.description : null,
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
            description: `${action.label} executed successfully`,
            color: 'success',
        });
    } catch (error: unknown) {
        const message = parseErrorMessage(error, 'Action failed');
        toast.add({ title: 'Error', description: message, color: 'error' });
    }
}
</script>
