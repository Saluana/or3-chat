<template>
    <div class="space-y-6">
        <!-- Workspace Selector Modal - shown if no workspace selected -->
        <WorkspaceSelector
            v-model="showWorkspaceSelector"
            @select="onWorkspaceSelected"
        />
        <div>
            <h2 class="text-2xl font-semibold mb-1">Themes</h2>
            <p class="text-sm opacity-70">
                Manage and switch active themes.
            </p>
        </div>

        <div v-if="pending" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-pulse">
            <div class="h-40 bg-[var(--md-surface-container-highest)] rounded-[var(--md-sys-shape-corner-medium,12px)]"></div>
            <div class="h-40 bg-[var(--md-surface-container-highest)] rounded-[var(--md-sys-shape-corner-medium,12px)]"></div>
            <div class="h-40 bg-[var(--md-surface-container-highest)] rounded-[var(--md-sys-shape-corner-medium,12px)]"></div>
        </div>

        <div v-else-if="themes.length === 0" class="text-sm opacity-70 py-8 text-center bg-[var(--md-surface-container-low)] rounded">
                No themes installed.
        </div>

        <div v-else class="space-y-6">
            <!-- Restart Required Banner -->
            <div v-if="restartRequired" class="p-4 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-sys-color-warning,#f59e0b)] bg-[var(--md-sys-color-warning-container,#fef3c7)] text-[var(--md-sys-color-on-warning-container,#92400e)] flex items-center justify-between gap-4">
                <div class="flex items-center gap-3">
                    <UIcon name="i-heroicons-exclamation-triangle" class="w-5 h-5 flex-shrink-0" />
                    <div>
                        <div class="font-semibold text-sm">Restart Required</div>
                        <div class="text-xs opacity-80">Default theme change will only take effect after a server restart.</div>
                    </div>
                </div>
                <UButton
                    size="xs"
                    color="error"
                    variant="solid"
                    :disabled="!isOwner || !statusData?.status?.admin?.allowRestart"
                    @click="restart"
                >
                    Restart Now
                </UButton>
            </div>

            <div class="p-4 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-outline-variant)] bg-[var(--md-surface)]">
            <div class="mb-4 flex items-center justify-between">
                <h3 class="text-lg font-medium">Installed</h3>
                <div class="flex items-center gap-3">
                     <!-- Hidden file input -->
                    <input
                        ref="fileInput"
                        type="file"
                        accept=".zip"
                        class="hidden"
                        @change="installTheme"
                    />
                    <UButton size="xs" :disabled="!isOwner" @click="triggerFileInput" icon="i-heroicons-arrow-up-tray">
                        Install .zip
                    </UButton>
                </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div
                    v-for="theme in themes"
                    :key="theme.id"
                    class="p-4 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-lowest)] hover:bg-[var(--md-surface-container-low)] transition-colors flex flex-col h-full"
                >
                    <div class="flex-1">
                        <div class="flex items-center justify-between mb-2">
                             <div class="font-semibold text-lg">{{ theme.name }}</div>
                             <UBadge v-if="defaultTheme === theme.id" color="primary" variant="subtle">Default</UBadge>
                        </div>
                        <div class="text-xs opacity-70 font-mono mb-2">{{ theme.id }} • v{{ theme.version }}</div>
                        <div v-if="theme.description" class="text-sm opacity-80 line-clamp-2 mb-4">
                            {{ theme.description }}
                        </div>
                    </div>
                    
                    <div class="pt-4 mt-auto border-t border-[var(--md-outline-variant)]/50 flex items-center justify-between gap-2">
                        <UButton
                            size="xs"
                            :color="defaultTheme === theme.id ? 'neutral' : 'primary'"
                            :variant="defaultTheme === theme.id ? 'soft' : 'solid'"
                            :disabled="!isOwner || defaultTheme === theme.id"
                            @click="setDefaultTheme(theme.id)"
                        >
                            {{ defaultTheme === theme.id ? 'Active' : 'Set Default' }}
                        </UButton>
                         <UButton
                            size="xs"
                            color="error"
                            variant="ghost"
                            :disabled="!isOwner"
                            @click="uninstallTheme(theme.id)"
                        >
                            Uninstall
                        </UButton>
                    </div>
                </div>
            </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { installExtension, uninstallExtension, ADMIN_HEADERS, type ExtensionItem } from '~/composables/admin/useAdminExtensions';
import { useAdminExtensions, useAdminSystemConfig, useAdminWorkspace, useAdminSystemStatus } from '~/composables/admin/useAdminData';
import { useAdminAuth } from '~/composables/admin/useAdminAuth';
import { useExtensionManagement } from '~/composables/admin/useExtensionManagement';
import { useServerRestart } from '~/composables/admin/useServerRestart';
import { useConfirmDialog } from '~/composables/admin/useConfirmDialog';
import { parseErrorMessage } from '~/utils/admin/parse-error';
import { useAdminWorkspaceContext } from '~/composables/admin/useAdminWorkspaceContext';
import WorkspaceSelector from '~/components/admin/WorkspaceSelector.vue';

definePageMeta({
    layout: 'admin',
    middleware: ['admin-auth'],
});

const { hasWorkspace, selectWorkspace, selectedWorkspaceId } = useAdminWorkspaceContext();
const showWorkspaceSelector = ref(false);

// Show workspace selector if no workspace selected
if (!hasWorkspace.value) {
    showWorkspaceSelector.value = true;
}

// Handle workspace selection
function onWorkspaceSelected(workspace: any) {
    selectWorkspace(workspace);
}

const { data, status: extStatus, refresh: refreshExtensions } = useAdminExtensions();
const { data: workspaceData, status: workspaceStatus, refresh: refreshWorkspace } = useAdminWorkspace(selectedWorkspaceId.value ?? undefined);

watch(selectedWorkspaceId, (newId) => {
    if (newId) {
        refreshWorkspace();
    }
});
const { data: configData, status: configStatus, refresh: refreshConfig } = useAdminSystemConfig();
const { data: statusData } = useAdminSystemStatus();

const pending = computed(() => extStatus.value === 'pending' || workspaceStatus.value === 'pending' || configStatus.value === 'pending');

const themes = computed(
    () => (data.value?.items ?? []).filter((i) => i.kind === 'theme')
);

const { isOwner } = useAdminAuth(workspaceData);
const { fileInput, triggerFileInput, install, uninstall } = useExtensionManagement(isOwner);
const { restart, restartRequired } = useServerRestart(
    isOwner,
    computed(() => statusData.value?.status?.admin?.allowRestart)
);
const { confirm } = useConfirmDialog();
const toast = useToast();

const defaultTheme = computed(() => {
    const entry = configData.value?.entries?.find((e) => e.key === 'OR3_DEFAULT_THEME');
    return entry?.value ?? '';
});

async function installTheme() {
    try {
        await install('theme', refresh);
        toast.add({
            title: 'Theme installed',
            description: 'The theme has been installed successfully.',
            color: 'success',
        });
    } catch (error: unknown) {
        const message = parseErrorMessage(error, 'Failed to install theme');
        toast.add({ title: 'Error', description: message, color: 'error' });
    }
}

async function uninstallTheme(themeId: string) {
    try {
        await uninstall(themeId, 'theme', refresh);
        toast.add({
            title: 'Theme uninstalled',
            description: 'The theme has been removed.',
            color: 'success',
        });
    } catch (error: unknown) {
        const message = parseErrorMessage(error, 'Failed to uninstall theme');
        toast.add({ title: 'Error', description: message, color: 'error' });
    }
}

async function setDefaultTheme(themeId: string) {
    if (!isOwner.value) return;
    const confirmed = await confirm({
        title: 'Set Default Theme',
        message: `Are you sure you want to set "${themeId}" as the default theme?`,
        confirmText: 'Set Default',
    });
    if (!confirmed) return;
    try {
        const res = await $fetch<{ ok: boolean; restartRequired?: boolean }>('/api/admin/system/config/write', {
            method: 'POST',
            headers: ADMIN_HEADERS,
            body: { entries: [{ key: 'OR3_DEFAULT_THEME', value: themeId }] },
        });
        
        if (res.restartRequired) {
            restartRequired.value = true;
        }
        
        toast.add({
            title: 'Default theme updated',
            description: `Default theme set to "${themeId}".`,
            color: 'success',
        });
        await refresh();
    } catch (error: unknown) {
        const message = parseErrorMessage(error, 'Failed to update default theme');
        toast.add({ title: 'Error', description: message, color: 'error' });
    }
}



async function refresh() {
    await Promise.all([refreshExtensions(), refreshWorkspace(), refreshConfig()]);
}
</script>
