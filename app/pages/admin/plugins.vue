<template>
    <div class="space-y-6">
        <!-- Workspace Selector Modal - shown if no workspace selected -->
        <WorkspaceSelector
            v-model="showWorkspaceSelector"
            @select="onWorkspaceSelected"
        />

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

            <div
                v-if="configuredPluginModules.length > 0"
                class="mb-4 p-3 text-xs rounded border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-low)]"
            >
                Some plugins are configured via package modules in config and require install + rebuild/restart:
                <span class="font-mono">{{ configuredPluginModules.join(', ') }}</span>
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
                            <UBadge color="primary" variant="subtle">Installed</UBadge>
                            <UBadge :color="enabledSet.has(plugin.id) ? 'success' : 'neutral'" variant="subtle">
                                {{ enabledSet.has(plugin.id) ? 'Enabled' : 'Disabled' }}
                            </UBadge>
                            <UBadge
                                :color="loadedSet.has(plugin.id) ? 'success' : 'neutral'"
                                variant="subtle"
                            >
                                {{ loadedSet.has(plugin.id) ? 'Runtime Enabled' : 'Not Runtime Enabled' }}
                            </UBadge>
                        </div>
                    </div>

                    <p
                        v-if="enabledSet.has(plugin.id) && !loadedSet.has(plugin.id)"
                        class="mt-2 text-xs opacity-75"
                    >
                        Enabled in workspace settings, but runtime manifest does not currently include it. Check plugin manifest/runtime config and logs.
                    </p>

                    <div class="mt-4 pt-4 border-t border-[var(--md-outline-variant)]/50 flex flex-wrap items-center gap-2">
                        <UButton
                            size="xs"
                            :color="enabledSet.has(plugin.id) ? 'neutral' : 'primary'"
                            :variant="enabledSet.has(plugin.id) ? 'soft' : 'solid'"
                            :disabled="!isOwner || toggleLoading[plugin.id]"
                            :loading="toggleLoading[plugin.id]"
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
                                    <div class="text-xs font-semibold uppercase opacity-60">Access policy</div>
                                    <div class="space-y-2 p-2 rounded border border-[var(--md-outline-variant)]/50">
                                        <label class="flex items-center gap-2 text-xs">
                                            <input
                                                v-model="getAccessEditor(plugin.id).authRequired"
                                                type="checkbox"
                                                :disabled="!isOwner"
                                            />
                                            Require authentication
                                        </label>

                                        <label class="flex flex-col gap-1 text-xs">
                                            <span>Required tier</span>
                                            <select
                                                v-model="getAccessEditor(plugin.id).tier"
                                                class="border rounded px-2 py-1 bg-[var(--md-surface)]"
                                                :disabled="!isOwner"
                                            >
                                                <option value="">None</option>
                                                <option value="paid">paid</option>
                                                <option value="enterprise">enterprise</option>
                                            </select>
                                        </label>

                                        <label class="flex flex-col gap-1 text-xs">
                                            <span>Required role</span>
                                            <select
                                                v-model="getAccessEditor(plugin.id).role"
                                                class="border rounded px-2 py-1 bg-[var(--md-surface)]"
                                                :disabled="!isOwner"
                                            >
                                                <option value="">Any</option>
                                                <option value="owner">owner</option>
                                                <option value="editor">editor</option>
                                                <option value="viewer">viewer</option>
                                            </select>
                                        </label>

                                        <p class="text-[11px] opacity-70">
                                            Server enforces access policy. Admin overrides win over plugin defaults.
                                        </p>
                                    </div>

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
import { installExtension, uninstallExtension, ADMIN_HEADERS, type ExtensionItem } from '~/composables/admin/useAdminExtensions';
import { useAdminExtensions, useAdminWorkspace } from '~/composables/admin/useAdminData';
import { useAdminAuth } from '~/composables/admin/useAdminAuth';
import { useExtensionManagement } from '~/composables/admin/useExtensionManagement';
import { parseErrorMessage } from '~/utils/admin/parse-error';
import {
    createDefaultAccessEditor,
    deserializeAccessEditor,
    withSerializedAccessPolicy,
    type AccessEditorState,
} from '~/utils/admin/plugin-access-policy';
import { useAdminWorkspaceGate } from '~/composables/admin/useAdminWorkspaceGate';
import WorkspaceSelector from '~/components/admin/WorkspaceSelector.vue';
import { useRuntimeConfig } from '#imports';

definePageMeta({
    layout: 'admin',
    middleware: ['admin-auth'],
});

const { selectedWorkspaceId, showWorkspaceSelector, onWorkspaceSelected } =
    useAdminWorkspaceGate(async (workspaceId) => {
        if (workspaceId.value) {
            await refreshWorkspace();
        }
    });

// 1. Fetch Extensions
const { data, status, refresh: refreshNuxtData } = useAdminExtensions();

// 2. Fetch Workspace (for role and enabled plugins)
const { data: workspaceData, refresh: refreshWorkspace } = useAdminWorkspace(selectedWorkspaceId);

// 3. Auth & Permissions
const { isOwner } = useAdminAuth(workspaceData);

// 4. Extension Management
const { fileInput, triggerFileInput, install, uninstall } = useExtensionManagement(isOwner);
const runtimeConfig = useRuntimeConfig();
const configuredPluginModules =
    (runtimeConfig.public as {
        or3?: { plugins?: { modules?: string[] } };
    }).or3?.plugins?.modules ?? [];

// Computed & State
const pending = computed(() => status.value === 'pending');
const plugins = computed(
    () => (data.value?.items ?? []).filter((i) => i.kind === 'plugin')
);

const enabledSet = ref<Set<string>>(new Set());
const settingsByPlugin = reactive<Record<string, string>>({});
const accessByPlugin = reactive<
    Record<
        string,
        AccessEditorState
    >
>({});
const toggleLoading = reactive<Record<string, boolean>>({});
const loadedSet = ref<Set<string>>(new Set());
const toast = useToast();

async function refreshLoadedState() {
    try {
        const runtimeLoaderEnabled =
            (runtimeConfig.public as { admin?: { pluginRuntimeLoaderEnabled?: boolean } })
                .admin?.pluginRuntimeLoaderEnabled !== false;
        if (!runtimeLoaderEnabled) {
            loadedSet.value = new Set();
            return;
        }

        const manifest = await $fetch<{
            enabledPluginIds: string[];
        }>('/api/plugins/runtime-manifest', {
            cache: 'no-store',
        });
        loadedSet.value = new Set(manifest.enabledPluginIds ?? []);
    } catch {
        loadedSet.value = new Set();
    }
}

function getAccessEditor(pluginId: string) {
    if (!accessByPlugin[pluginId]) {
        accessByPlugin[pluginId] = createDefaultAccessEditor();
    }
    return accessByPlugin[pluginId]!;
}

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
    if (toggleLoading[pluginId]) return;
    toggleLoading[pluginId] = true;
    try {
        await setEnabled(pluginId, !enabledSet.value.has(pluginId));
    } finally {
        toggleLoading[pluginId] = false;
    }
}

async function installPlugin() {
    await install('plugin', refresh);
}

async function uninstallPlugin(pluginId: string) {
    await uninstall(pluginId, 'plugin', refresh);
}

async function loadSettings(pluginId: string) {
    if (settingsByPlugin[pluginId]) return;
    const res = await $fetch<{
        settings: Record<string, unknown>;
        effectiveAccessPolicy?: {
            authRequired?: boolean;
            requiredEntitlements?: string[];
            requiredWorkspaceRoles?: string[];
        };
    }>(
        '/api/admin/plugins/workspace-settings',
        { query: { pluginId } }
    );
    settingsByPlugin[pluginId] = JSON.stringify(res.settings ?? {}, null, 2);
    accessByPlugin[pluginId] = deserializeAccessEditor(
        res.effectiveAccessPolicy
    );
}

async function saveSettings(pluginId: string) {
    if (!isOwner.value) return;
    const raw = settingsByPlugin[pluginId] || '{}';
    let parsed: Record<string, unknown> = {};
    try {
        parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
        toast.add({
            title: 'Invalid JSON',
            description: 'Settings must be valid JSON.',
            color: 'error',
        });
        return;
    }
    
    try {
        const accessEditor = getAccessEditor(pluginId);
        await $fetch('/api/admin/plugins/workspace-settings', {
            method: 'POST',
            body: {
                pluginId,
                settings: withSerializedAccessPolicy(parsed, accessEditor),
            },
            headers: ADMIN_HEADERS,
        });
        toast.add({
            title: 'Settings saved',
            description: 'Plugin configuration has been updated.',
            color: 'success',
        });
    } catch (error: unknown) {
        const message = parseErrorMessage(error, 'Failed to save settings');
        toast.add({ title: 'Error', description: message, color: 'error' });
    }
}

async function refresh() {
    await Promise.all([refreshNuxtData(), refreshWorkspace()]);
    await refreshLoadedState();
}

onMounted(() => {
    void refreshLoadedState();
});
</script>
