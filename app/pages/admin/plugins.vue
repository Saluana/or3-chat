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
            v-if="rebuildRequired && rebuildAvailable"
            class="p-4 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-sys-color-warning,#f59e0b)] bg-[var(--md-sys-color-warning-container,#fef3c7)] text-[var(--md-sys-color-on-warning-container,#92400e)]"
        >
            <div class="font-semibold text-sm">Rebuild + Restart Required</div>
            <div class="text-xs opacity-80 mt-1">
                Newly installed client plugins are bundled at build time. In production, run
                Rebuild + Restart from Admin &gt; System before enabling them. In development,
                restart the dev server to pick up new client modules.
            </div>
        </div>

        <div
            v-if="extensionInstallDisabled"
            class="p-4 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-low)]"
        >
            <div class="text-sm">
                Custom plugin upload and install are disabled on this managed deployment.
                This image is immutable and cannot rebuild installed source extensions.
            </div>
            <div class="text-xs opacity-70 mt-1">
                Bundled plugins remain available above. To install custom plugins, deploy OR3
                from source and restart the process after installing.
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
                <div v-if="canManageSitePlugins && extensionInstallEnabled" class="flex flex-wrap items-center gap-2">
                     <!-- Input hidden mostly, custom button triggers it -->
                    <input
                        ref="fileInput"
                        type="file"
                        accept=".zip"
                        class="hidden"
                        :disabled="fileInstalling"
                        @change="requestPluginFileInstall"
                    />
                    <UButton size="sm" :disabled="urlInstalling || fileInstalling" @click="showUrlModal = true" icon="i-heroicons-link">
                        Add from URL
                    </UButton>
                    <UButton size="sm" :disabled="fileInstalling || urlInstalling" :loading="fileInstalling" @click="triggerFileInput" icon="i-heroicons-arrow-up-tray">
                        Add from .zip
                    </UButton>
                </div>
            </div>

            <!-- URL Import Modal -->
            <AdminUrlImportModal v-model="showUrlModal" label="Plugin" :loading="urlInstalling" :code-trust-warning="true" @install="installPluginFromUrl" />

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
                            :disabled="!canManageSitePlugins"
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

        <div
            v-if="canManageSitePlugins && v2Packages.length > 0"
            class="p-4 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-outline-variant)] bg-[var(--md-surface)]"
        >
            <div class="mb-4">
                <h3 class="text-lg font-medium">Managed V2 packages</h3>
                <p class="text-xs opacity-70">
                    Deployment-wide candidate, promotion, rollback, and removal controls. Activation remains per workspace.
                </p>
            </div>
            <div class="space-y-3">
                <div
                    v-for="packagePlugin in v2Packages"
                    :key="packagePlugin.pluginId"
                    class="p-3 rounded border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-lowest)]"
                >
                    <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                            <div class="font-semibold">{{ packagePlugin.pluginId }}</div>
                            <div class="mt-1 text-xs font-mono opacity-70">
                                current: {{ packagePlugin.pointer?.current?.packageDigest ?? 'none' }}
                            </div>
                            <div v-if="packagePlugin.pointer?.candidate" class="text-xs font-mono opacity-70">
                                candidate: {{ packagePlugin.pointer.candidate.packageDigest }}
                            </div>
                            <div v-if="packagePlugin.startup.issueCodes.length" class="mt-1 text-xs text-[var(--md-sys-color-error,#b91c1c)]">
                                {{ packagePlugin.startup.issueCodes.join(', ') }}
                            </div>
                        </div>
                        <UBadge :color="enabledSet.has(packagePlugin.pluginId) ? 'success' : 'neutral'" variant="subtle">
                            {{ enabledSet.has(packagePlugin.pluginId) ? 'Active in workspace' : packagePlugin.startup.status }}
                        </UBadge>
                    </div>
                    <div class="mt-3 flex flex-wrap gap-2 border-t border-[var(--md-outline-variant)]/50 pt-3">
                        <UButton
                            size="xs"
                            :disabled="!packagePlugin.pointer?.candidate || v2ActionLoading[packagePlugin.pluginId]"
                            :loading="v2ActionLoading[packagePlugin.pluginId]"
                            @click="runV2Canary(packagePlugin.pluginId)"
                        >
                            Run canary
                        </UButton>
                        <UButton
                            size="xs"
                            color="primary"
                            :disabled="!packagePlugin.pointer?.candidate || v2ActionLoading[packagePlugin.pluginId]"
                            :loading="v2ActionLoading[packagePlugin.pluginId]"
                            @click="promoteV2Candidate(packagePlugin.pluginId, packagePlugin.pointer?.candidate?.packageDigest)"
                        >
                            Promote
                        </UButton>
                        <UButton
                            size="xs"
                            :disabled="!packagePlugin.pointer?.previous || v2ActionLoading[packagePlugin.pluginId]"
                            :loading="v2ActionLoading[packagePlugin.pluginId]"
                            @click="rollbackV2Package(packagePlugin.pluginId)"
                        >
                            Roll back
                        </UButton>
                        <UButton
                            size="xs"
                            :color="enabledSet.has(packagePlugin.pluginId) ? 'neutral' : 'primary'"
                            :disabled="!packagePlugin.pointer?.current || toggleLoading[packagePlugin.pluginId]"
                            :loading="toggleLoading[packagePlugin.pluginId]"
                            @click="togglePlugin(packagePlugin.pluginId)"
                        >
                            {{ enabledSet.has(packagePlugin.pluginId) ? 'Deactivate workspace' : 'Activate workspace' }}
                        </UButton>
                        <UButton
                            size="xs"
                            color="error"
                            variant="ghost"
                            :disabled="v2ActionLoading[packagePlugin.pluginId]"
                            @click="uninstallV2Package(packagePlugin.pluginId)"
                        >
                            Uninstall package
                        </UButton>
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

        <ConfirmDialog
            v-model="showInstallTrustConfirm"
            title="Install plugin from source?"
            message="This plugin zip is application code. It will execute with OR3 server privileges once activated and is not sandboxed."
            confirm-text="Install anyway"
            important-note="Only install plugins you wrote or that you trust from a reviewed source."
            note-tone="warning"
            @confirm="confirmPluginFileInstall"
        />
    </div>
</template>

<script setup lang="ts">
import { ADMIN_HEADERS, type ExtensionItem } from '~/composables/admin/useAdminExtensions';
import { useAdminSession } from '~/composables/admin/useAdminData';
import { useExtensionManagement } from '~/composables/admin/useExtensionManagement';
import { useConfirmDialog } from '~/composables/admin/useConfirmDialog';
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

type ManagedV2Package = {
    pluginId: string;
    pointer: {
        current: { packageDigest: string } | null;
        candidate: { packageDigest: string } | null;
        previous: { packageDigest: string } | null;
    } | null;
    workspaceEnabled: boolean;
    startup: {
        status: string;
        selectedSlot: string | null;
        selectedDigest: string | null;
        issueCodes: string[];
    };
};

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
    canManageSitePlugins: boolean;
    workspaceId: string;
    workspaceName?: string;
    enabledPlugins: string[];
    packagePlugins: ManagedV2Package[];
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
const canManageSitePlugins = computed(() => pageData.value?.canManageSitePlugins === true);
const { selectedWorkspace } = useAdminWorkspaceContext();
const workspaceContextName = computed(
    () => selectedWorkspace.value?.name || pageData.value?.workspaceName
);

// 4. Extension Management
const { fileInput, triggerFileInput, install, installFromUrl, uninstall } = useExtensionManagement(
    canManageSitePlugins
);
const runtimeConfig = useRuntimeConfig();
const publicAdminConfig = (runtimeConfig.public as {
    admin?: {
        pluginZipInstallEnabled?: boolean;
        allowRebuild?: boolean;
    };
}).admin ?? {};
const extensionInstallEnabled = publicAdminConfig.pluginZipInstallEnabled !== false;
const rebuildAvailable = publicAdminConfig.allowRebuild === true;
const extensionInstallDisabled = !extensionInstallEnabled;

// URL import state
const showUrlModal = ref(false);
const urlInstalling = ref(false);
const fileInstalling = ref(false);
const showInstallTrustConfirm = ref(false);
const toast = useToast();
const rebuildRequired = ref(false);

function requestPluginFileInstall() {
    if (!canManageSitePlugins.value) return;
    const file = fileInput.value?.files?.[0];
    if (!file) return;
    showInstallTrustConfirm.value = true;
}

watch(showInstallTrustConfirm, (open) => {
    if (!open && fileInput.value) fileInput.value.value = '';
});

function confirmPluginFileInstall() {
    showInstallTrustConfirm.value = false;
    void installPlugin();
}

async function installPluginFromUrl(url: string) {
    if (!canManageSitePlugins.value) return;
    urlInstalling.value = true;
    try {
        const installed = await installFromUrl(
            'plugin',
            url,
            refresh,
            selectedWorkspaceId.value || undefined
        );
        if (!installed) return;
        showUrlModal.value = false;
        if ('kind' in installed && installed.kind === 'v2-candidate') {
            toast.add({
                title: 'V2 candidate prepared',
                description: `Digest ${installed.packageDigest} is inactive. Run its canary, promote it, then activate it for this workspace.`,
                color: 'info',
            });
            return;
        }
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
const v2Packages = computed(() => pageData.value?.packagePlugins ?? []);

const enabledSet = ref<Set<string>>(new Set());
const settingsByPlugin = reactive<Record<string, string>>({});
const accessByPlugin = reactive<
    Record<
        string,
        AccessEditorState
    >
>({});
const toggleLoading = reactive<Record<string, boolean>>({});
const v2ActionLoading = reactive<Record<string, boolean>>({});
const { confirm } = useConfirmDialog();

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
    if (!canManageSitePlugins.value || fileInstalling.value) return;
    fileInstalling.value = true;
    try {
        const installed = await install(
            'plugin',
            refresh,
            selectedWorkspaceId.value || undefined
        );
        if (!installed) return;
        if ('kind' in installed && installed.kind === 'v2-candidate') {
            toast.add({
                title: 'V2 candidate prepared',
                description: `Digest ${installed.packageDigest} is inactive. Run its canary, promote it, then activate it for this workspace.`,
                color: 'info',
            });
            return;
        }
        rebuildRequired.value = true;
        toast.add({
            title: 'Plugin installed',
            description:
                'The plugin has been installed. Rebuild + Restart is required before new client runtime modules can load in production.',
            color: 'info',
        });
    } catch (error: unknown) {
        const message = parseErrorMessage(error, 'Failed to install plugin');
        toast.add({ title: 'Error', description: message, color: 'error' });
    } finally {
        fileInstalling.value = false;
        if (fileInput.value) fileInput.value.value = '';
    }
}

async function uninstallPlugin(pluginId: string) {
    if (!canManageSitePlugins.value) return;
    await uninstall(pluginId, 'plugin', refresh);
}

async function runV2PackageAction(
    pluginId: string,
    action: 'canary' | 'promote' | 'rollback' | 'uninstall',
    body: Record<string, unknown> = {}
) {
    if (!canManageSitePlugins.value || v2ActionLoading[pluginId]) return;
    v2ActionLoading[pluginId] = true;
    try {
        const result = await $fetch<{ ok: boolean; code?: string }>(
            `/api/admin/plugins/packages/${encodeURIComponent(pluginId)}/${action}`,
            {
                method: 'POST',
                body: {
                    workspaceId: selectedWorkspaceId.value,
                    ...body,
                },
                headers: ADMIN_HEADERS,
            }
        );
        if (!result.ok) {
            throw new Error(result.code ?? `V2 package ${action} was blocked`);
        }
        await refresh();
        requestWorkspacePluginReconcile('manifest-revision-change');
        toast.add({
            title: `V2 package ${action} complete`,
            color: 'success',
        });
    } catch (error: unknown) {
        toast.add({
            title: 'V2 package action failed',
            description: parseErrorMessage(error, `Failed to ${action} V2 package`),
            color: 'error',
        });
    } finally {
        v2ActionLoading[pluginId] = false;
    }
}

async function runV2Canary(pluginId: string) {
    await runV2PackageAction(pluginId, 'canary');
}

async function promoteV2Candidate(pluginId: string, candidateDigest?: string) {
    if (!candidateDigest) return;
    await runV2PackageAction(pluginId, 'promote', { candidateDigest });
}

async function rollbackV2Package(pluginId: string) {
    await runV2PackageAction(pluginId, 'rollback');
}

async function uninstallV2Package(pluginId: string) {
    const confirmed = await confirm({
        title: 'Uninstall V2 package',
        message: `Remove the global V2 package pointer for "${pluginId}"? Package bytes and workspace data are retained.`,
        danger: true,
        confirmText: 'Uninstall package',
    });
    if (!confirmed) return;
    await runV2PackageAction(pluginId, 'uninstall');
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
