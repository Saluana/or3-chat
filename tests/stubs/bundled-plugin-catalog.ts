import type { BundledPluginCatalog } from '../../shared/plugins/bundled-plugin-catalog';

export const bundledPluginCatalog: BundledPluginCatalog = {
    schemaVersion: 1,
    marker: 'or3-bundled-plugin-catalog:v1',
    hostBuildId: 'test-host-build',
    entries: [
        {
            pluginId: 'alpha',
            clientEntry: 'client/main.client.ts',
            moduleKey: '../../extensions/plugins/alpha/client/main.client.ts',
        },
        {
            pluginId: 'alpha',
            clientEntry: 'plugin.client.ts',
            moduleKey: '../../extensions/plugins/alpha/plugin.client.ts',
        },
    ],
};
