import type { PluginV2HostCapabilities } from '../../../shared/plugins/v2-compatibility';

/** The first public V2 host contract. Keep it independent from app package
 * releases so package compatibility follows the documented plugin ABI. */
export const OR3_PLUGIN_V2_HOST_CAPABILITIES: PluginV2HostCapabilities = Object.freeze({
    or3Version: '0.3.0',
    pluginApiVersion: '2.0.0',
    supportedTrustModes: Object.freeze(['trusted-host'] as const),
    supportedGrants: Object.freeze([] as string[]),
    supportedFeatures: Object.freeze([] as string[]),
});
