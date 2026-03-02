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

        <template v-else>
            <div
                v-if="rebuildRequired"
                class="p-4 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-sys-color-warning,#f59e0b)] bg-[var(--md-sys-color-warning-container,#fef3c7)] text-[var(--md-sys-color-on-warning-container,#92400e)]"
            >
                <div class="flex items-center gap-3">
                    <UIcon name="i-heroicons-exclamation-triangle" class="w-5 h-5 flex-shrink-0" />
                    <div>
                        <div class="font-semibold text-sm">Rebuild + Restart Required</div>
                        <div class="text-xs opacity-80">
                            Newly installed or removed themes are bundled at build time. In production,
                            run Rebuild + Restart from Admin &gt; System. In development, restart the
                            dev server manually to rescan theme modules.
                        </div>
                    </div>
                </div>
            </div>

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
                    size="sm"
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
                    <UButton size="sm" :disabled="!isOwner" @click="showUrlModal = true" icon="i-heroicons-link">
                        Import from URL
                    </UButton>
                    <UButton size="sm" :disabled="!isOwner" @click="triggerFileInput" icon="i-heroicons-arrow-up-tray">
                        Install .zip
                    </UButton>
                </div>
            </div>

            <!-- URL Import Modal -->
            <AdminUrlImportModal v-model="showUrlModal" label="Theme" :loading="urlInstalling" @install="installThemeFromUrl" />

            <div v-if="adminThemes.length === 0" class="text-sm opacity-70 py-8 text-center bg-[var(--md-surface-container-low)] rounded">
                No themes installed.
            </div>

            <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div
                    v-for="theme in adminThemes"
                    :key="theme.id"
                    class="p-4 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-lowest)] hover:bg-[var(--md-surface-container-low)] transition-colors flex flex-col"
                >
                    <!-- Header -->
                    <div class="flex items-start justify-between gap-2 mb-1">
                        <h4 class="font-semibold text-base leading-tight">{{ theme.name }}</h4>
                        <div class="flex items-center gap-1 shrink-0">
                            <UBadge v-if="activeTheme === theme.id" color="success" variant="subtle" size="xs">Active</UBadge>
                            <UBadge v-if="defaultTheme === theme.id" color="primary" variant="subtle" size="xs">Default</UBadge>
                            <UBadge v-if="disabledThemes.has(theme.id)" color="error" variant="subtle" size="xs">Disabled</UBadge>
                            <UBadge v-if="theme.isBuiltIn && !theme.isInstalledExtension" color="neutral" variant="subtle" size="xs">Built-in</UBadge>
                        </div>
                    </div>

                    <!-- Meta -->
                    <div class="text-xs opacity-50 font-mono mb-2">
                        {{ theme.id }}<span v-if="theme.version"> • v{{ theme.version }}</span>
                    </div>

                    <!-- Description -->
                    <p v-if="theme.description" class="text-sm opacity-70 line-clamp-2 mb-0 flex-1">
                        {{ theme.description }}
                    </p>
                    <div v-else class="flex-1" />

                    <!-- Actions -->
                    <div class="pt-3 mt-3 border-t border-[var(--md-outline-variant)]/30 flex items-center gap-2">
                        <UButton
                            size="xs"
                            class="w-fit px-1.5!"
                            color="neutral"
                            variant="soft"
                            :disabled="activeTheme === theme.id || disabledThemes.has(theme.id)"
                            @click="activateTheme(theme.id)"
                        >
                            Activate
                        </UButton>
                        <UButton
                            size="xs"
                            class="w-fit px-1.5!"
                            variant="soft"
                            :disabled="!isOwner || defaultTheme === theme.id"
                            @click="setDefaultTheme(theme.id)"
                        >
                            Set Default
                        </UButton>
                        <UButton
                            size="xs"
                            class="w-fit px-1.5!"
                            :color="disabledThemes.has(theme.id) ? 'success' : 'warning'"
                            variant="soft"
                            :disabled="!isOwner || defaultTheme === theme.id"
                            @click="toggleThemeDisabled(theme.id)"
                        >
                            {{ disabledThemes.has(theme.id) ? 'Enable' : 'Disable' }}
                        </UButton>
                        <div class="flex-1" />
                        <UButton
                            v-if="theme.isInstalledExtension"
                            size="xs"
                            icon="i-lucide-trash-2"
                            class="aspect-square p-0!"
                            color="error"
                            variant="ghost"
                            :disabled="!isOwner"
                            :aria-label="`Uninstall ${theme.id}`"
                            @click="uninstallTheme(theme.id)"
                        />
                    </div>
                </div>
            </div>
            </div>
        </template>
    </div>
</template>

<script setup lang="ts">
import { ADMIN_HEADERS } from '~/composables/admin/useAdminExtensions';
import { useAdminExtensions, useAdminSystemConfig, useAdminWorkspace, useAdminSystemStatus } from '~/composables/admin/useAdminData';
import { useAdminAuth } from '~/composables/admin/useAdminAuth';
import { useExtensionManagement } from '~/composables/admin/useExtensionManagement';
import { useServerRestart } from '~/composables/admin/useServerRestart';
import { useConfirmDialog } from '~/composables/admin/useConfirmDialog';
import { parseErrorMessage } from '~/utils/admin/parse-error';
import { useAdminWorkspaceGate } from '~/composables/admin/useAdminWorkspaceGate';
import { useNuxtApp } from '#imports';
import WorkspaceSelector from '~/components/admin/WorkspaceSelector.vue';

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

const { data, status: extStatus, refresh: refreshExtensions } = useAdminExtensions();
const { data: workspaceData, status: workspaceStatus, refresh: refreshWorkspace } = useAdminWorkspace(selectedWorkspaceId);
const { data: configData, status: configStatus, refresh: refreshConfig } = useAdminSystemConfig();
const { data: statusData } = useAdminSystemStatus();

const pending = computed(() => extStatus.value === 'pending' || workspaceStatus.value === 'pending' || configStatus.value === 'pending');

const themes = computed(
    () => (data.value?.items ?? []).filter((i) => i.kind === 'theme')
);
const builtInThemes = ref<Array<{ id: string; name: string; description?: string }>>([]);

const adminThemes = computed(() => {
    const map = new Map<string, {
        id: string;
        name: string;
        description?: string;
        version?: string;
        isBuiltIn: boolean;
        isInstalledExtension: boolean;
    }>();

    for (const theme of builtInThemes.value) {
        map.set(theme.id, {
            id: theme.id,
            name: theme.name,
            description: theme.description,
            isBuiltIn: true,
            isInstalledExtension: false,
        });
    }

    for (const theme of themes.value) {
        const existing = map.get(theme.id);
        map.set(theme.id, {
            id: theme.id,
            name: theme.name,
            description: theme.description || existing?.description,
            version: theme.version,
            isBuiltIn: Boolean(existing?.isBuiltIn),
            isInstalledExtension: true,
        });
    }

    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
});

const { isOwner } = useAdminAuth(workspaceData);
const { fileInput, triggerFileInput, install, installFromUrl } = useExtensionManagement(isOwner);
const { restart, restartRequired } = useServerRestart(
    isOwner,
    computed(() => statusData.value?.status?.admin?.allowRestart)
);
const { confirm } = useConfirmDialog();
const nuxtApp = useNuxtApp();
const toast = useToast();
const rebuildRequired = ref(false);

// URL import state
const showUrlModal = ref(false);
const urlInstalling = ref(false);

function notifyThemeBundleChange(action: 'install' | 'uninstall', source: 'file' | 'url' = 'file') {
    const actionLabel = action === 'install' ? 'installed' : 'removed';
    const sourceLabel = source === 'url' ? ' from URL' : '';

    if (import.meta.dev) {
        restartRequired.value = true;
        toast.add({
            title: `Theme ${action === 'install' ? 'installed' : 'uninstalled'}`,
            description: `The theme has been ${actionLabel}${sourceLabel}. Restart the dev server to reload theme modules.`,
            color: 'info',
        });
        toast.add({
            title: 'Manual restart required in dev',
            description: 'Please restart the dev server manually (Ctrl+C, then bun run dev:ssr).',
            color: 'warning',
        });
        return;
    }

    rebuildRequired.value = true;
    toast.add({
        title: `Theme ${action === 'install' ? 'installed' : 'uninstalled'}`,
        description: `The theme has been ${actionLabel}${sourceLabel}. Rebuild + Restart is required before theme bundles update in production.`,
        color: 'info',
    });
}

async function installThemeFromUrl(url: string) {
    urlInstalling.value = true;
    try {
        const installed = await installFromUrl('theme', url, refresh);
        if (!installed) return;
        showUrlModal.value = false;
        notifyThemeBundleChange('install', 'url');
    } catch (error: unknown) {
        const message = parseErrorMessage(error, 'Failed to install theme from URL');
        toast.add({ title: 'Error', description: message, color: 'error' });
    } finally {
        urlInstalling.value = false;
    }
}
const activeTheme = computed(() => {
    const themeApi = (nuxtApp as unknown as {
        $theme?: { activeTheme?: { value?: string } };
    }).$theme;
    return themeApi?.activeTheme?.value ?? '';
});

onMounted(async () => {
    try {
        const { loadThemeManifest } = await import('~/theme/_shared/theme-manifest');
        const manifest = await loadThemeManifest();
        builtInThemes.value = manifest.entries.map((entry) => ({
            id: entry.name,
            name: entry.definition?.displayName || entry.name,
            description: entry.definition?.description,
        }));
    } catch {
        builtInThemes.value = [
            { id: 'retro', name: 'Retro' },
            { id: 'blank', name: 'Blank' },
        ];
    }
});

const defaultTheme = computed(() => {
    const entry = configData.value?.entries?.find((e) => e.key === 'OR3_DEFAULT_THEME');
    return entry?.value ?? '';
});

const disabledThemes = computed(() => {
    const entry = configData.value?.entries?.find((e) => e.key === 'OR3_DISABLED_THEMES');
    const raw = entry?.value ?? '';
    return new Set(raw.split(',').map(s => s.trim()).filter(Boolean));
});

async function toggleThemeDisabled(themeId: string) {
    if (!isOwner.value) return;
    const current = new Set(disabledThemes.value);
    const enabling = current.has(themeId);
    if (enabling) {
        current.delete(themeId);
    } else {
        current.add(themeId);
    }
    try {
        const res = await $fetch<{ ok: boolean; restartRequired?: boolean }>('/api/admin/system/config/write', {
            method: 'POST',
            headers: ADMIN_HEADERS,
            body: { entries: [{ key: 'OR3_DISABLED_THEMES', value: [...current].join(',') }] },
        });
        if (res.restartRequired) {
            restartRequired.value = true;
        }
        toast.add({
            title: enabling ? 'Theme enabled' : 'Theme disabled',
            description: enabling
                ? `"${themeId}" is now available to users.`
                : `"${themeId}" is now hidden from users.`,
            color: 'success',
        });
        await refresh();
    } catch (error: unknown) {
        const message = parseErrorMessage(error, 'Failed to update disabled themes');
        toast.add({ title: 'Error', description: message, color: 'error' });
    }
}

async function installTheme() {
    try {
        const installed = await install('theme', refresh);
        if (!installed) return;
        notifyThemeBundleChange('install');
    } catch (error: unknown) {
        const message = parseErrorMessage(error, 'Failed to install theme');
        toast.add({ title: 'Error', description: message, color: 'error' });
    }
}

async function uninstallTheme(themeId: string) {
    try {
        if (!isOwner.value) return;

        const confirmed = await confirm({
            title: 'Uninstall Theme',
            message: `Are you sure you want to uninstall "${themeId}"?`,
            confirmText: 'Uninstall',
            danger: true,
            importantNote:
                'Important: In development mode you must restart the dev server manually after install/uninstall to fully apply theme and icon changes.',
            noteTone: 'warning',
        });

        if (!confirmed) return;

        const themeApi = (nuxtApp as unknown as {
            $theme?: {
                activeTheme?: { value?: string };
                setActiveTheme?: (name: string) => Promise<void>;
            };
        }).$theme;

        const activeThemeName = themeApi?.activeTheme?.value;
        if (activeThemeName === themeId && themeApi?.setActiveTheme) {
            const fallback = defaultTheme.value && defaultTheme.value !== themeId
                ? defaultTheme.value
                : 'retro';
            await themeApi.setActiveTheme(fallback);
        }

        if (defaultTheme.value === themeId) {
            const fallbackDefault = themeId === 'retro' ? 'blank' : 'retro';
            await $fetch('/api/admin/system/config/write', {
                method: 'POST',
                headers: ADMIN_HEADERS,
                body: { entries: [{ key: 'OR3_DEFAULT_THEME', value: fallbackDefault }] },
            });
        }

        await $fetch('/api/admin/extensions/uninstall', {
            method: 'POST',
            headers: ADMIN_HEADERS,
            body: { id: themeId, kind: 'theme' },
        });
        await refresh();
        notifyThemeBundleChange('uninstall');
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

        try {
            const themeApi = (nuxtApp as unknown as {
                $theme?: { setActiveTheme?: (name: string) => Promise<void> };
            }).$theme;
            if (themeApi?.setActiveTheme) {
                await themeApi.setActiveTheme(themeId);
            }
        } catch {
            // Non-fatal: config update succeeded.
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

async function activateTheme(themeId: string) {
    try {
        const themeApi = (nuxtApp as unknown as {
            $theme?: { setActiveTheme?: (name: string) => Promise<void> };
        }).$theme;
        if (!themeApi?.setActiveTheme) return;
        await themeApi.setActiveTheme(themeId);
    } catch (error: unknown) {
        const message = parseErrorMessage(error, 'Failed to activate theme');
        toast.add({ title: 'Error', description: message, color: 'error' });
    }
}



async function refresh() {
    await Promise.all([refreshExtensions(), refreshWorkspace(), refreshConfig()]);
}
</script>
