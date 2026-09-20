import { readonly, ref } from 'vue';

const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const selectedPluginId = ref<string | null>(null);

/**
 * The dashboard has one registered configure page, while the plugin id is
 * selected at runtime from Installed or Discover. Keep that selection in a
 * small host-owned store instead of putting a plugin-specific route inside
 * the dashboard modal.
 */
export function setMarketplaceSetupPlugin(pluginId: string | null): void {
    selectedPluginId.value =
        pluginId !== null && PLUGIN_ID_PATTERN.test(pluginId) ? pluginId : null;
}

export function useMarketplaceSetupPlugin() {
    return readonly(selectedPluginId);
}
