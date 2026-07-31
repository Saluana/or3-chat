<template>
    <div class="space-y-6">
        <!-- Workspace Selector Modal - shown if no workspace selected -->
        <WorkspaceSelector
            v-model="showWorkspaceSelector"
            @select="onWorkspaceSelected"
        />

        <div>
            <div class="mb-1 flex flex-wrap items-center gap-2">
                <h2 class="text-2xl font-semibold">Plugins</h2>
                <UBadge v-if="workspaceContextName" color="neutral" variant="soft">
                    {{ workspaceContextName }}
                </UBadge>
            </div>
            <p class="text-sm opacity-70">
                Activate plugins for the selected workspace. Installation and
                diagnostics are available under advanced controls.
            </p>
        </div>

        <div
            v-if="rebuildRequired"
            class="p-4 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-sys-color-warning,#f59e0b)] bg-[var(--md-sys-color-warning-container,#fef3c7)] text-[var(--md-sys-color-on-warning-container,#92400e)]"
        >
            <div class="font-semibold text-sm">Rebuild + Restart Required</div>
            <div class="text-xs opacity-80 mt-1">
                Newly installed client plugins are bundled at build time. In production, run
                Rebuild + Restart from Admin &gt; System before enabling them. In development,
                restart the dev server to pick up new client modules.
            </div>
        </div>

        <div class="p-4 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-outline-variant)] bg-[var(--md-surface)]">
            <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h3 class="text-lg font-medium">Available on this site</h3>
                    <p class="text-xs opacity-70">
                        Add or uninstall site-wide; activate per workspace.
                    </p>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                     <!-- Input hidden mostly, custom button triggers it -->
                    <input
                        ref="fileInput"
                        type="file"
                        accept=".zip"
                        class="hidden"
                        @change="installPlugin"
                    />
                    <UButton size="sm" :disabled="!isOwner" @click="showUrlModal = true" icon="i-heroicons-link">
                        Add from URL
                    </UButton>
                    <UButton size="sm"  :disabled="!isOwner" @click="triggerFileInput" icon="i-heroicons-arrow-up-tray">
                        Add from .zip
                    </UButton>
                </div>
            </div>

            <!-- URL Import Modal -->
            <AdminUrlImportModal v-model="showUrlModal" label="Plugin" :loading="urlInstalling" @install="installPluginFromUrl" />

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
                    <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div class="min-w-0">
                            <div class="font-semibold text-base">{{ plugin.name }}</div>
                            <div class="text-xs opacity-70 font-mono mt-0.5">{{ plugin.id }} • v{{ plugin.version }}</div>
                            <div v-if="plugin.description" class="mt-2 text-sm opacity-80 max-w-2xl">
                                {{ plugin.description }}
                            </div>
                        </div>
                        <div class="flex flex-wrap items-center gap-2">
                            <UBadge :color="enabledSet.has(plugin.id) ? 'success' : 'neutral'" variant="subtle">
                                {{ enabledSet.has(plugin.id) ? 'Active' : 'Inactive' }}
                            </UBadge>
                        </div>
                    </div>

                    <div class="mt-4 pt-4 border-t border-[var(--md-outline-variant)]/50 flex flex-wrap items-center gap-2">
                        <UButton
                            size="sm"
                            :color="enabledSet.has(plugin.id) ? 'neutral' : 'primary'"
                            :variant="enabledSet.has(plugin.id) ? 'soft' : 'solid'"
                            :disabled="!isOwner || toggleLoading[plugin.id]"
                            :loading="toggleLoading[plugin.id]"
                            @click="togglePlugin(plugin.id)"
                        >
                            {{ enabledSet.has(plugin.id) ? 'Deactivate' : 'Activate' }}
                        </UButton>
                        <UButton
                            size="sm"
                            color="error"
                            variant="ghost"
                            :disabled="!isOwner"
                            @click="uninstallPlugin(plugin.id)"
                        >
                            Uninstall
                        </UButton>
                        
                        <div class="flex-1"></div>

                        <UPopover
                            :content="{
                                side: 'left',
                                align: 'end',
                                sideOffset: 8,
                                collisionPadding: 16,
                            }"
                        >
                            <UButton color="neutral" variant="ghost" size="sm" label="Advanced" trailing-icon="i-heroicons-chevron-down-20-solid" />
                            <template #content>
                                <div class="p-4 w-80 max-h-[min(28rem,calc(100vh-4rem))] overflow-y-auto space-y-3">
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

        <details class="rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-outline-variant)] bg-[var(--md-surface)]">
            <summary class="cursor-pointer px-4 py-3 text-sm font-medium">
                Advanced runtime diagnostics
            </summary>
            <div class="border-t border-[var(--md-outline-variant)] p-4">
                <PluginRuntimeInspector />
            </div>
        </details>
    </div>
</template>

<script setup lang="ts">
import { ADMIN_HEADERS, type ExtensionItem } from '~/composables/admin/useAdminExtensions';
import { useAdminSession } from '~/composables/admin/useAdminData';
import { useExtensionManagement } from '~/composables/admin/useExtensionManagement';
import { parseErrorMessage } from '~/utils/admin/parse-error';
import { requestWorkspacePluginReconcile } from '~/composables/plugins/bundled-v1-manager-runtime';
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
    useAdminWorkspaceGate(async () => {
        await refreshPage();
    });

const { data: session } = useAdminSession();
const {
    data: pageData,
    status,
    refresh: refreshPage,
} = useFetch<{
    plugins: ExtensionItem[];
    role?: string;
    workspaceId: string;
    workspaceName?: string;
    enabledPlugins: string[];
}>('/api/admin/plugins-page', {
    query: computed(() => ({
        workspaceId: selectedWorkspaceId.value || undefined,
    })),
    credentials: 'include',
    server: false,
    immediate: false,
    dedupe: 'defer',
});
const isOwner = computed(() => pageData.value?.role === 'owner');
const { selectedWorkspace } = useAdminWorkspaceContext();
const workspaceContextName = computed(
    () => selectedWorkspace.value?.name || pageData.value?.workspaceName
);

// 4. Extension Management
const { fileInput, triggerFileInput, install, installFromUrl, uninstall } = useExtensionManagement(isOwner);
const runtimeConfig = useRuntimeConfig();

// URL import state
const showUrlModal = ref(false);
const urlInstalling = ref(false);
const toast = useToast();
const rebuildRequired = ref(false);

async function installPluginFromUrl(url: string) {
    urlInstalling.value = true;
    try {
        const installed = await installFromUrl('plugin', url, refresh);
        if (!installed) return;
        showUrlModal.value = false;
        rebuildRequired.value = true;
        toast.add({
            title: 'Plugin installed',
            description:
                'The plugin has been installed from URL. Rebuild + Restart is required before new client runtime modules can load in production.',
            color: 'info',
        });
    } catch (error: unknown) {
        const message = parseErrorMessage(error, 'Failed to install plugin from URL');
        toast.add({ title: 'Error', description: message, color: 'error' });
    } finally {
        urlInstalling.value = false;
    }
}
const configuredPluginModules =
    (runtimeConfig.public as {
        or3?: { plugins?: { modules?: string[] } };
    }).or3?.plugins?.modules ?? [];

// Computed & State
const pending = computed(() => status.value === 'pending');
const plugins = computed(
    () => pageData.value?.plugins ?? []
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

function getAccessEditor(pluginId: string) {
    if (!accessByPlugin[pluginId]) {
        accessByPlugin[pluginId] = createDefaultAccessEditor();
    }
    return accessByPlugin[pluginId]!;
}

// Watcher
watch(() => pageData.value, (val) => {
    if (val?.enabledPlugins) {
        enabledSet.value = new Set(val.enabledPlugins);
    }
}, { immediate: true });

watch(
    [() => session.value?.kind, selectedWorkspaceId],
    ([kind, workspaceId]) => {
        if (
            kind === 'workspace_admin' ||
            (kind === 'super_admin' && workspaceId)
        ) {
            void refreshPage();
        }
    },
    { immediate: true }
);

// Actions
async function setEnabled(pluginId: string, enabled: boolean) {
    const res = await $fetch<{ ok: boolean; enabled: string[] }>(
        '/api/admin/plugins/workspace-enable',
        {
            method: 'POST',
            body: {
                pluginId,
                enabled,
                workspaceId: selectedWorkspaceId.value,
            },
            headers: ADMIN_HEADERS,
        }
    );
    enabledSet.value = new Set(res.enabled);
    requestWorkspacePluginReconcile('local-admin-change');
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
    const installed = await install('plugin', refresh);
    if (!installed) return;
    rebuildRequired.value = true;
    toast.add({
        title: 'Plugin installed',
        description:
            'The plugin has been installed. Rebuild + Restart is required before new client runtime modules can load in production.',
        color: 'info',
    });
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
        {
            query: {
                pluginId,
                workspaceId: selectedWorkspaceId.value,
            },
        }
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
                workspaceId: selectedWorkspaceId.value,
            },
            headers: ADMIN_HEADERS,
        });
        requestWorkspacePluginReconcile('manifest-revision-change');
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
    await refreshPage();
}
</script>
