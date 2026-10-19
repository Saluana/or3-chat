<template>
    <div class="space-y-6">
        <div>
            <h2 class="text-2xl font-semibold mb-1">Themes</h2>
            <p class="text-sm opacity-70">
                Try a different look in this browser. Your preview is saved here and does not change anyone else's theme.
            </p>
        </div>

        <div v-if="pending" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-pulse">
            <div class="h-40 bg-[var(--md-surface-container-highest)] rounded-[var(--md-sys-shape-corner-medium,12px)]"></div>
            <div class="h-40 bg-[var(--md-surface-container-highest)] rounded-[var(--md-sys-shape-corner-medium,12px)]"></div>
            <div class="h-40 bg-[var(--md-surface-container-highest)] rounded-[var(--md-sys-shape-corner-medium,12px)]"></div>
        </div>

        <UAlert v-else-if="pageError" color="error" title="Could not load themes" description="Try again to see installed themes.">
            <template #actions><UButton color="neutral" variant="soft" @click="refreshPage()">Try again</UButton></template>
        </UAlert>
        <template v-else>
            <section class="rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-low)] p-4 space-y-2">
                <h3 class="font-medium">Changing the site default</h3>
                <p class="text-sm opacity-70">The site default is the starting theme for users who have not chosen one. Change the default or hide themes in UI & Branding. Saved changes apply when people reload; no restart is needed.</p>
                <UButton to="/admin/branding" color="neutral" variant="link" class="px-0">Open UI & Branding</UButton>
            </section>
            <div
                v-if="rebuildRequired"
                class="p-4 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-sys-color-warning,#f59e0b)] bg-[var(--md-sys-color-warning-container,#fef3c7)] text-[var(--md-sys-color-on-warning-container,#92400e)]"
            >
                <div class="flex items-center gap-3">
                    <UIcon name="i-heroicons-exclamation-triangle" class="w-5 h-5 flex-shrink-0" />
                    <div>
                        <div class="font-semibold text-sm">Build required</div>
                        <div class="text-xs opacity-80">
                            Newly installed or removed themes are bundled at build time. In production,
                            use the supported build or update workflow. A routine server restart
                            does not rebuild application bundles.
                        </div>
                    </div>
                </div>
            </div>

            <div
                v-if="extensionInstallDisabled"
                class="p-4 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-low)]"
            >
                <div class="text-sm">
                    This installation includes a fixed set of themes. Custom theme uploads are not available here.
                </div>
                <div class="text-xs opacity-70 mt-1">
                    You can preview the included themes below. Custom themes need an installation that can build OR3 from source.
                </div>
            </div>

            <!-- Restart Required Banner -->
            <div v-if="restartRequired" class="p-4 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-sys-color-warning,#f59e0b)] bg-[var(--md-sys-color-warning-container,#fef3c7)] text-[var(--md-sys-color-on-warning-container,#92400e)] flex items-center justify-between gap-4">
                <div class="flex items-center gap-3">
                    <UIcon name="i-heroicons-exclamation-triangle" class="w-5 h-5 flex-shrink-0" />
                    <div>
                        <div class="font-semibold text-sm">Restart Required</div>
                        <div class="text-xs opacity-80">Restart the development server to rescan installed theme modules.</div>
                    </div>
                </div>
                <UButton
                    size="sm"
                    color="error"
                    variant="solid"
                    :disabled="!serverRestart.canRestart.value"
                    :loading="serverRestart.busy.value"
                    @click="restart()"
                >
                    Restart Now
                </UButton>
            </div>
            <p v-if="serverRestart.progress.value" role="status" aria-live="polite" class="text-sm">{{ serverRestart.progress.value }}</p>

            <div class="p-4 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-outline-variant)] bg-[var(--md-surface)]">
            <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h3 class="text-lg font-medium">Installed</h3>
                <div class="flex flex-wrap items-center gap-2">
                     <!-- Hidden file input -->
                    <input
                        ref="fileInput"
                        type="file"
                        accept=".zip"
                        class="hidden"
                        @change="installTheme"
                    />
                    <UButton v-if="extensionInstallEnabled" size="sm" :disabled="!isOwner" @click="showUrlModal = true" icon="i-heroicons-link">
                        Import from link
                    </UButton>
                    <UButton v-if="extensionInstallEnabled" size="sm" :disabled="!isOwner" @click="triggerFileInput" icon="i-heroicons-arrow-up-tray">
                        Upload .zip
                    </UButton>
                </div>
            </div>
            <p v-if="extensionInstallEnabled" class="mb-4 text-sm opacity-70">Only install themes from people you trust. Some themes include code with access to your server and its data.</p>

            <!-- URL Import Modal -->
            <AdminUrlImportModal v-model="showUrlModal" label="Theme" :loading="urlInstalling" :code-trust-warning="true" @install="installThemeFromUrl" />

            <div v-if="adminThemes.length === 0" class="text-sm opacity-70 py-8 text-center bg-[var(--md-surface-container-low)] rounded">
                No themes installed.
            </div>

            <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <article
                    v-for="theme in adminThemes"
                    :key="theme.id"
                    :aria-label="theme.name"
                    class="p-4 rounded-[var(--md-sys-shape-corner-medium,12px)] border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-lowest)] hover:bg-[var(--md-surface-container-low)] transition-colors flex flex-col"
                >
                    <!-- Header -->
                    <div class="space-y-2 mb-2">
                        <h4 class="font-semibold text-base leading-tight break-words">{{ theme.name }}</h4>
                        <div class="flex flex-wrap items-center gap-2">
                            <UBadge v-if="activeTheme === theme.id" color="success" variant="subtle" size="xs">Previewing here</UBadge>
                            <UBadge v-if="defaultTheme === theme.id" color="primary" variant="subtle" size="xs">Site default</UBadge>
                            <UBadge v-if="disabledThemes.has(theme.id)" color="error" variant="subtle" size="xs">Disabled</UBadge>
                            <UBadge v-if="theme.isBuiltIn && !theme.isInstalledExtension" color="neutral" variant="subtle" size="xs">Built-in</UBadge>
                        </div>
                    </div>

                    <!-- Meta -->
                    <div class="text-xs opacity-50 font-mono mb-2">
                        {{ theme.id }}<span v-if="theme.version"> • v{{ theme.version }}</span>
                    </div>

                    <!-- Description -->
                    <p v-if="theme.description" class="text-sm opacity-70 mb-0 flex-1 break-words">
                        {{ theme.description }}
                    </p>
                    <div v-else class="flex-1" />

                    <!-- Actions -->
                    <div class="pt-3 mt-3 border-t border-[var(--md-outline-variant)]/30 flex flex-wrap items-center gap-2">
                        <UButton
                            size="sm"
                            color="neutral"
                            variant="soft"
                            :disabled="activeTheme === theme.id || disabledThemes.has(theme.id)"
                            @click="activateTheme(theme.id)"
                        >
                            Preview here
                        </UButton>
                        <div class="flex-1" />
                        <UButton
                            v-if="theme.isInstalledExtension"
                            size="xs"
                            icon="i-lucide-trash-2"
                            class="aspect-square p-0!"
                            color="error"
                            variant="ghost"
                            :disabled="!isOwner || defaultTheme === theme.id"
                            :aria-label="`Uninstall ${theme.id}`"
                            @click="uninstallTheme(theme.id)"
                        />
                    </div>
                </article>
            </div>
            </div>
        </template>
    </div>
</template>

<script setup lang="ts">
import { ADMIN_HEADERS } from '~/composables/admin/useAdminExtensions';
import { useAdminSystemStatus } from '~/composables/admin/useAdminData';
import type { ExtensionItem } from '~/composables/admin/useAdminExtensions';
import { useExtensionManagement } from '~/composables/admin/useExtensionManagement';
import { useServerRestart } from '~/composables/admin/useServerRestart';
import { useConfirmDialog } from '~/composables/admin/useConfirmDialog';
import { parseErrorMessage } from '~/utils/admin/parse-error';
import { useNuxtApp } from '#imports';

definePageMeta({
    layout: 'admin',
    middleware: ['admin-auth'],
});

const {
    data: pageData,
    status: pageStatus,
    error: pageError,
    refresh: refreshPage,
} = useFetch<{
    themes: ExtensionItem[];
    role?: string;
    defaultTheme: string;
    disabledThemes: string;
}>('/api/admin/themes-page', {
    credentials: 'include',
    server: false,
    dedupe: 'defer',
});
const { data: statusData } = useAdminSystemStatus();

const pending = computed(() => !pageData.value && pageStatus.value !== 'error');

const themes = computed(
    () => pageData.value?.themes ?? []
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

const isOwner = computed(() => pageData.value?.role === 'owner');
const { fileInput, triggerFileInput, install, installFromUrl } = useExtensionManagement(isOwner);
const serverRestart = useServerRestart(
    isOwner,
    computed(() => statusData.value?.status?.admin?.allowRestart)
);
const { restart, restartRequired } = serverRestart;
const { confirm } = useConfirmDialog();
const nuxtApp = useNuxtApp();
const toast = useToast();
const rebuildRequired = ref(false);
const runtimeConfig = useRuntimeConfig();
const publicAdminConfig = (runtimeConfig.public as {
    admin?: {
        pluginZipInstallEnabled?: boolean;
        allowRebuild?: boolean;
    };
}).admin ?? {};
const extensionInstallEnabled = publicAdminConfig.pluginZipInstallEnabled !== false;
const extensionInstallDisabled = !extensionInstallEnabled;

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
        return;
    }

    rebuildRequired.value = true;
    toast.add({
        title: `Theme ${action === 'install' ? 'installed' : 'uninstalled'}`,
        description: `The theme has been ${actionLabel}${sourceLabel}. Use the supported build or update workflow to change production bundles.`,
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

onMounted(() => {
    const themeApi = (nuxtApp as unknown as {
        $theme?: {
            availableThemes?: Array<{
                name: string;
                displayName?: string;
                description?: string;
            }>;
        };
    }).$theme;
    if (themeApi?.availableThemes) {
        builtInThemes.value = themeApi.availableThemes.map((entry) => ({
            id: entry.name,
            name: entry.displayName || entry.name,
            description: entry.description,
        }));
    } else {
        builtInThemes.value = [
            { id: 'retro', name: 'Retro' },
            { id: 'blank', name: 'Blank' },
        ];
    }
});

const defaultTheme = computed(() => {
    return pageData.value?.defaultTheme ?? '';
});

const disabledThemes = computed(() => {
    const raw = pageData.value?.disabledThemes ?? '';
    return new Set(raw.split(',').map(s => s.trim()).filter(Boolean));
});

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
                'In development, restart through Operations after install/uninstall to rescan theme and icon modules.',
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

        if (defaultTheme.value === themeId) throw new Error("Choose a different site default in UI & Branding before removing this theme.");

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
    await refreshPage();
}
</script>
