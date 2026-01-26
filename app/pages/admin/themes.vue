<template>
    <div class="space-y-4">
        <UCard>
            <template #header>
                <h2 class="text-lg font-semibold">Installed Themes</h2>
            </template>
            <div class="mb-4 flex items-center gap-3">
                <input
                    ref="fileInput"
                    type="file"
                    accept=".zip"
                    class="text-sm"
                    :disabled="!isOwner"
                />
                <UButton size="xs" :disabled="!isOwner" @click="installTheme">
                    Install .zip
                </UButton>
            </div>
            <div v-if="themes.length === 0" class="text-sm opacity-70">
                No themes installed.
            </div>
            <div v-else class="space-y-3 text-sm">
                <div
                    v-for="theme in themes"
                    :key="theme.id"
                    class="border-b border-[var(--md-outline-variant)] pb-3"
                >
                    <div class="font-medium">{{ theme.name }}</div>
                    <div class="opacity-70">{{ theme.id }} • {{ theme.version }}</div>
                    <div v-if="theme.description" class="mt-1 opacity-80">
                        {{ theme.description }}
                    </div>
                    <div class="mt-2 flex items-center gap-2">
                        <UButton
                            size="xs"
                            color="error"
                            variant="soft"
                            :disabled="!isOwner"
                            @click="uninstallTheme(theme.id)"
                        >
                            Uninstall
                        </UButton>
                        <UButton
                            size="xs"
                            :disabled="!isOwner || defaultTheme === theme.id"
                            @click="setDefaultTheme(theme.id)"
                        >
                            {{ defaultTheme === theme.id ? 'Default' : 'Set Default' }}
                        </UButton>
                    </div>
                </div>
            </div>
        </UCard>
    </div>
</template>

<script setup lang="ts">
definePageMeta({
    layout: 'admin',
});

type ExtensionItem = {
    id: string;
    name: string;
    version: string;
    kind: 'plugin' | 'theme' | 'admin_plugin';
    description?: string;
};

const { data } = await useFetch<{ items: ExtensionItem[] }>('/api/admin/extensions');
const { data: workspaceData } = await useFetch<{ role: string }>('/api/admin/workspace');
const { data: configData } = await useFetch<{ entries: Array<{ key: string; value: string | null }> }>(
    '/api/admin/system/config'
);

const themes = computed(
    () => (data.value?.items ?? []).filter((i) => i.kind === 'theme')
);
const role = computed(() => workspaceData.value?.role);
const isOwner = computed(() => role.value === 'owner');
const defaultTheme = computed(() => {
    const entry = configData.value?.entries?.find((e) => e.key === 'OR3_DEFAULT_THEME');
    return entry?.value ?? '';
});

const fileInput = ref<HTMLInputElement | null>(null);

async function installTheme() {
    if (!isOwner.value) return;
    const file = fileInput.value?.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
        await $fetch('/api/admin/extensions/install', {
            method: 'POST',
            body: formData,
            headers: { 'x-or3-admin-intent': 'admin' },
        });
        await refreshNuxtData();
    } catch (error: unknown) {
        const message =
            (error as { data?: { statusMessage?: string } })?.data?.statusMessage ??
            (error as Error)?.message ??
            '';
        if (message.toLowerCase().includes('already installed')) {
            if (!confirm('Theme already installed. Replace it?')) return;
            const retryForm = new FormData();
            retryForm.append('file', file);
            retryForm.append('force', 'true');
            await $fetch('/api/admin/extensions/install', {
                method: 'POST',
                body: retryForm,
                headers: { 'x-or3-admin-intent': 'admin' },
            });
            await refreshNuxtData();
            return;
        }
        throw error;
    }
}

async function uninstallTheme(themeId: string) {
    if (!confirm(`Uninstall ${themeId}?`)) return;
    await $fetch('/api/admin/extensions/uninstall', {
        method: 'POST',
        body: { id: themeId, kind: 'theme' },
        headers: { 'x-or3-admin-intent': 'admin' },
    });
    await refreshNuxtData();
}

async function setDefaultTheme(themeId: string) {
    if (!isOwner.value) return;
    if (!confirm(`Set default theme to ${themeId}?`)) return;
    await $fetch('/api/admin/system/config/write', {
        method: 'POST',
        headers: { 'x-or3-admin-intent': 'admin' },
        body: { entries: [{ key: 'OR3_DEFAULT_THEME', value: themeId }] },
    });
    await refreshNuxtData();
}
</script>
