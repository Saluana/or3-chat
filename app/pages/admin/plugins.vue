<template>
    <div class="space-y-6">
        <div>
            <h2 class="text-2xl font-semibold mb-1">Plugins</h2>
            <p class="text-sm opacity-70">
                Manage installed extensions and plugins.
            </p>
        </div>

        <div class="p-4 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-outline-variant)] bg-[var(--md-surface)]">
            <div class="mb-4 flex items-center justify-between">
                <h3 class="text-lg font-medium">Installed</h3>
                <div class="flex items-center gap-3">
                     <!-- Input hidden mostly, custom button triggers it -->
                    <input
                        ref="fileInput"
                        type="file"
                        accept=".zip"
                        class="hidden"
                        @change="installPlugin"
                    />
                    <UButton size="xs" :disabled="!isOwner" @click="triggerFileInput" icon="i-heroicons-arrow-up-tray">
                        Install .zip
                    </UButton>
                </div>
            </div>

            <div v-if="pending" class="space-y-4 animate-pulse">
                <div class="h-10 bg-[var(--md-surface-container-highest)] rounded w-full"></div>
                <div class="h-24 bg-[var(--md-surface-container-highest)] rounded w-full"></div>
                <div class="h-24 bg-[var(--md-surface-container-highest)] rounded w-full"></div>
            </div>

            <div v-else-if="plugins.length === 0" class="text-sm opacity-70 py-8 text-center bg-[var(--md-surface-container-low)] rounded">
                No plugins installed.
            </div>

            <div v-else class="space-y-4">
                <div
                    v-for="plugin in plugins"
                    :key="plugin.id"
                    class="p-4 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-lowest)] hover:bg-[var(--md-surface-container-low)] transition-colors"
                >
                    <div class="flex items-start justify-between">
                        <div>
                            <div class="font-semibold text-base">{{ plugin.name }}</div>
                            <div class="text-xs opacity-70 font-mono mt-0.5">{{ plugin.id }} • v{{ plugin.version }}</div>
                            <div v-if="plugin.description" class="mt-2 text-sm opacity-80 max-w-2xl">
                                {{ plugin.description }}
                            </div>
                        </div>
                        <div class="flex items-center gap-2">
                             <UBadge :color="enabledSet.has(plugin.id) ? 'success' : 'neutral'" variant="subtle">
                                {{ enabledSet.has(plugin.id) ? 'Active' : 'Inactive' }}
                            </UBadge>
                        </div>
                    </div>

                    <div class="mt-4 pt-4 border-t border-[var(--md-outline-variant)]/50 flex flex-wrap items-center gap-2">
                        <UButton
                            size="xs"
                            :color="enabledSet.has(plugin.id) ? 'neutral' : 'primary'"
                            :variant="enabledSet.has(plugin.id) ? 'soft' : 'solid'"
                            :disabled="!isOwner"
                            @click="togglePlugin(plugin.id)"
                        >
                            {{ enabledSet.has(plugin.id) ? 'Disable' : 'Enable' }}
                        </UButton>
                        <UButton
                            size="xs"
                            color="error"
                            variant="ghost"
                            :disabled="!isOwner"
                            @click="uninstallPlugin(plugin.id)"
                        >
                            Uninstall
                        </UButton>
                        
                        <div class="flex-1"></div>

                        <UPopover>
                            <UButton color="neutral" variant="ghost" size="xs" label="Settings" trailing-icon="i-heroicons-chevron-down-20-solid" />
                            <template #panel>
                                <div class="p-4 w-96 space-y-3">
                                    <div class="text-xs font-semibold uppercase opacity-60">Configuration (JSON)</div>
                                    <UTextarea
                                        v-model="settingsByPlugin[plugin.id]"
                                        :rows="6"
                                        size="xs"
                                        :disabled="!isOwner"
                                        placeholder="{}"
                                        class="font-mono text-xs"
                                        @focus="loadSettings(plugin.id)"
                                    />
                                    <UButton
                                        size="xs"
                                        block
                                        :disabled="!isOwner"
                                        @click="saveSettings(plugin.id)"
                                    >
                                        Save Configuration
                                    </UButton>
                                </div>
                            </template>
                        </UPopover>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { installExtension, uninstallExtension, useFileInput, ADMIN_HEADERS, type ExtensionItem } from '~/composables/admin/useAdminExtensions';
import { useAdminExtensions, useAdminWorkspace } from '~/composables/admin/useAdminData';

definePageMeta({
    layout: 'admin',
});

// 1. Fetch Extensions
const { data, status, refresh: refreshNuxtData } = useAdminExtensions();

// 2. Fetch Workspace (for role and enabled plugins)
const { data: workspaceData, refresh: refreshWorkspace } = useAdminWorkspace();

// Computed & State
const pending = computed(() => status.value === 'pending');
const plugins = computed(
    () => (data.value?.items ?? []).filter((i) => i.kind === 'plugin')
);

const enabledSet = ref<Set<string>>(new Set());
const role = computed(() => workspaceData.value?.role);
const isOwner = computed(() => role.value === 'owner');
const settingsByPlugin = reactive<Record<string, string>>({});
const { fileInput, triggerFileInput } = useFileInput();

// Watcher
watch(() => workspaceData.value, (val) => {
    if (val?.enabledPlugins) {
        enabledSet.value = new Set(val.enabledPlugins);
    }
}, { immediate: true });

// Actions
async function setEnabled(pluginId: string, enabled: boolean) {
    const res = await $fetch<{ ok: boolean; enabled: string[] }>(
        '/api/admin/plugins/workspace-enable',
        {
            method: 'POST',
            body: { pluginId, enabled },
            headers: ADMIN_HEADERS,
        }
    );
    enabledSet.value = new Set(res.enabled);
}

async function togglePlugin(pluginId: string) {
    await setEnabled(pluginId, !enabledSet.value.has(pluginId));
}

async function installPlugin() {
    if (!isOwner.value) return;
    const file = fileInput.value?.files?.[0];
    if (!file) return;
    await installExtension({ kind: 'plugin', file, onSuccess: refresh });
}

async function uninstallPlugin(pluginId: string) {
    if (!isOwner.value) return;
    await uninstallExtension(pluginId, 'plugin', refresh);
}

async function loadSettings(pluginId: string) {
    if (settingsByPlugin[pluginId]) return;
    const res = await $fetch<{ settings: Record<string, unknown> }>(
        '/api/admin/plugins/workspace-settings',
        { query: { pluginId } }
    );
    settingsByPlugin[pluginId] = JSON.stringify(res.settings ?? {}, null, 2);
}

async function saveSettings(pluginId: string) {
    if (!isOwner.value) return;
    const raw = settingsByPlugin[pluginId] || '{}';
    let parsed: Record<string, unknown> = {};
    try {
        parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
        alert('Settings must be valid JSON.');
        return;
    }
    await $fetch('/api/admin/plugins/workspace-settings', {
        method: 'POST',
        body: { pluginId, settings: parsed },
        headers: ADMIN_HEADERS,
    });
}

async function refresh() {
    await Promise.all([refreshNuxtData(), refreshWorkspace()]);
}
</script>
