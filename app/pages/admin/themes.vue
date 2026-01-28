<template>
    <div class="space-y-6">
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
import { installExtension, uninstallExtension, useFileInput, ADMIN_HEADERS, type ExtensionItem } from '~/composables/admin/useAdminExtensions';
import { useAdminExtensions, useAdminSystemConfig, useAdminWorkspace } from '~/composables/admin/useAdminData';

definePageMeta({
    layout: 'admin',
});

const { data, status: extStatus, refresh: refreshExtensions } = useAdminExtensions();
const { data: workspaceData, status: workspaceStatus, refresh: refreshWorkspace } = useAdminWorkspace();
const { data: configData, status: configStatus, refresh: refreshConfig } = useAdminSystemConfig();
const { data: statusData } = useAdminSystemStatus();

const restartRequired = ref(false);

const pending = computed(() => extStatus.value === 'pending' || workspaceStatus.value === 'pending' || configStatus.value === 'pending');

const themes = computed(
    () => (data.value?.items ?? []).filter((i) => i.kind === 'theme')
);
const role = computed(() => workspaceData.value?.role);
const isOwner = computed(() => role.value === 'owner');
const defaultTheme = computed(() => {
    const entry = configData.value?.entries?.find((e) => e.key === 'OR3_DEFAULT_THEME');
    return entry?.value ?? '';
});

const { fileInput, triggerFileInput } = useFileInput();

async function installTheme() {
    if (!isOwner.value) return;
    const file = fileInput.value?.files?.[0];
    if (!file) return;
    await installExtension({ kind: 'theme', file, onSuccess: refresh });
}

async function uninstallTheme(themeId: string) {
    if (!isOwner.value) return;
    await uninstallExtension(themeId, 'theme', refresh);
}

async function setDefaultTheme(themeId: string) {
    if (!isOwner.value) return;
    if (!confirm(`Set default theme to ${themeId}?`)) return;
    const res = await $fetch<{ ok: boolean; restartRequired?: boolean }>('/api/admin/system/config/write', {
        method: 'POST',
        headers: ADMIN_HEADERS,
        body: { entries: [{ key: 'OR3_DEFAULT_THEME', value: themeId }] },
    });
    
    if (res.restartRequired) {
        restartRequired.value = true;
    }
    
    await refresh();
}

async function restart() {
    if (!confirm('Restart the server now?')) return;
    await $fetch('/api/admin/system/restart', {
        method: 'POST',
        headers: ADMIN_HEADERS,
    });
}

async function refresh() {
    await Promise.all([refreshExtensions(), refreshWorkspace(), refreshConfig()]);
}
</script>
