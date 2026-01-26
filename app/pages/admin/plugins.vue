<template>
    <div class="space-y-4">
        <UCard>
            <template #header>
                <h2 class="text-lg font-semibold">Installed Plugins</h2>
            </template>
            <div class="mb-4 flex items-center gap-3">
                <input
                    ref="fileInput"
                    type="file"
                    accept=".zip"
                    class="text-sm"
                    :disabled="!isOwner"
                />
                <UButton size="xs" :disabled="!isOwner" @click="installPlugin">
                    Install .zip
                </UButton>
            </div>
            <div v-if="plugins.length === 0" class="text-sm opacity-70">
                No plugins installed.
            </div>
            <div v-else class="space-y-3 text-sm">
                <div
                    v-for="plugin in plugins"
                    :key="plugin.id"
                    class="border-b border-[var(--md-outline-variant)] pb-3"
                >
                    <div class="font-medium">{{ plugin.name }}</div>
                    <div class="opacity-70">{{ plugin.id }} • {{ plugin.version }}</div>
                    <div v-if="plugin.description" class="mt-1 opacity-80">
                        {{ plugin.description }}
                    </div>
                    <div class="mt-2 flex items-center gap-2">
                        <UButton
                            size="xs"
                            :color="enabledSet.has(plugin.id) ? 'primary' : 'neutral'"
                            :disabled="!isOwner"
                            @click="togglePlugin(plugin.id)"
                        >
                            {{ enabledSet.has(plugin.id) ? 'Enabled' : 'Enable' }}
                        </UButton>
                        <UButton
                            v-if="enabledSet.has(plugin.id)"
                            size="xs"
                            color="neutral"
                            :disabled="!isOwner"
                            @click="disablePlugin(plugin.id)"
                        >
                            Disable
                        </UButton>
                        <UButton
                            size="xs"
                            color="error"
                            variant="soft"
                            :disabled="!isOwner"
                            @click="uninstallPlugin(plugin.id)"
                        >
                            Uninstall
                        </UButton>
                    </div>
                    <div class="mt-3 space-y-2">
                        <div class="text-xs uppercase opacity-60">Settings (JSON)</div>
                        <UTextarea
                            v-model="settingsByPlugin[plugin.id]"
                            size="sm"
                            :disabled="!isOwner"
                            placeholder="{ }"
                            @focus="loadSettings(plugin.id)"
                        />
                        <div class="flex items-center gap-2">
                            <UButton
                                size="xs"
                                :disabled="!isOwner"
                                @click="saveSettings(plugin.id)"
                            >
                                Save Settings
                            </UButton>
                        </div>
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

const { data } = await useFetch<{ items: ExtensionItem[] }>(
    '/api/admin/extensions'
);

const plugins = computed(
    () => (data.value?.items ?? []).filter((i) => i.kind === 'plugin')
);

const enabledSet = ref<Set<string>>(new Set());
const role = ref<string | undefined>();
const isOwner = computed(() => role.value === 'owner');
const settingsByPlugin = reactive<Record<string, string>>({});

const fileInput = ref<HTMLInputElement | null>(null);

async function refreshEnabled() {
    const res = await $fetch<{
        workspace: { id: string; name: string };
        role: string;
        members: Array<{ userId: string; email?: string; role: string }>;
        enabledPlugins: string[];
        guestAccessEnabled: boolean;
    }>('/api/admin/workspace');
    const enabled = res?.enabledPlugins;
    role.value = res?.role;
    if (Array.isArray(enabled)) {
        enabledSet.value = new Set(enabled);
    }
}

async function setEnabled(pluginId: string, enabled: boolean) {
    const res = await $fetch<{ ok: boolean; enabled: string[] }>(
        '/api/admin/plugins/workspace-enable',
        {
            method: 'POST',
            body: { pluginId, enabled },
            headers: { 'x-or3-admin-intent': 'admin' },
        }
    );
    enabledSet.value = new Set(res.enabled);
}

async function togglePlugin(pluginId: string) {
    await setEnabled(pluginId, !enabledSet.value.has(pluginId));
}

async function disablePlugin(pluginId: string) {
    await setEnabled(pluginId, false);
}

async function installPlugin() {
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
        await refresh();
    } catch (error: unknown) {
        const message =
            (error as { data?: { statusMessage?: string } })?.data?.statusMessage ??
            (error as Error)?.message ??
            '';
        if (message.toLowerCase().includes('already installed')) {
            if (!confirm('Plugin already installed. Replace it?')) return;
            const retryForm = new FormData();
            retryForm.append('file', file);
            retryForm.append('force', 'true');
            await $fetch('/api/admin/extensions/install', {
                method: 'POST',
                body: retryForm,
                headers: { 'x-or3-admin-intent': 'admin' },
            });
            await refresh();
            return;
        }
        throw error;
    }
}

async function uninstallPlugin(pluginId: string) {
    if (!confirm(`Uninstall ${pluginId}?`)) return;
    await $fetch('/api/admin/extensions/uninstall', {
        method: 'POST',
        body: { id: pluginId, kind: 'plugin' },
        headers: { 'x-or3-admin-intent': 'admin' },
    });
    await refresh();
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
        headers: { 'x-or3-admin-intent': 'admin' },
    });
}

async function refresh() {
    await refreshEnabled();
    await refreshNuxtData();
}

onMounted(() => {
    refreshEnabled();
});
</script>
