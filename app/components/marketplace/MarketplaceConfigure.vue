<script setup lang="ts">
import { onUnmounted } from 'vue';
import { useDashboardNavigation } from '~/composables/dashboard/useDashboardPlugins';
import {
    setMarketplaceSetupPlugin,
    useMarketplaceSetupPlugin,
} from '~/composables/marketplace/useMarketplaceSetup';
import PluginSetupPage from '~/components/plugins/PluginSetupPage.vue';

const navigation = useDashboardNavigation();
const pluginId = useMarketplaceSetupPlugin();

// Do not leave a stale plugin selection behind when the dashboard page closes.
onUnmounted(() => setMarketplaceSetupPlugin(null));

function backToInstalled(): void {
    void navigation.openPage('marketplace', 'installed');
}
</script>

<template>
    <div class="dashboard-page-frame" data-testid="marketplace-configure">
        <div v-if="!pluginId" class="flex flex-col gap-3 p-4" role="alert">
            <h2 class="text-lg font-semibold">Choose a plugin to configure</h2>
            <p class="text-sm text-(--ui-text-muted)">
                Open Configure from an installed plugin to edit its settings and connections.
            </p>
            <div>
                <UButton
                    color="neutral"
                    variant="soft"
                    icon="i-lucide-arrow-left"
                    @click="backToInstalled"
                >
                    Back to Installed
                </UButton>
            </div>
        </div>
        <template v-else>
            <div class="flex flex-wrap items-center justify-between gap-3 border-b border-(--ui-border) px-4 py-3">
                <div>
                    <p class="text-xs uppercase tracking-wide text-(--ui-text-muted)">Plugin configuration</p>
                    <h2 class="text-base font-semibold">{{ pluginId }}</h2>
                </div>
                <UButton
                    color="neutral"
                    variant="ghost"
                    icon="i-lucide-arrow-left"
                    @click="backToInstalled"
                >
                    Back to Installed
                </UButton>
            </div>
            <PluginSetupPage :plugin-id="pluginId" embedded />
        </template>
    </div>
</template>
