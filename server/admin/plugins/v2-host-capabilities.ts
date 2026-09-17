import type { PluginV2HostCapabilities } from '../../../shared/plugins/v2-compatibility';

/** The first public V2 host contract. Keep it independent from app package
 * releases so package compatibility follows the documented plugin ABI.
 *
 * `isolated-client` is declared because the host now runs contained portable
 * clients: the entry bytes are served digest-addressed, verified in the browser,
 * and executed inside the opaque-origin sandbox. `trusted-host` remains declared
 * for server-side packages. Only grants the host actually honors appear here —
 * a package requesting anything else is refused rather than trusted. */
export const OR3_PLUGIN_V2_HOST_CAPABILITIES: PluginV2HostCapabilities = Object.freeze({
    or3Version: '0.3.0',
    pluginApiVersion: '2.0.0',
    supportedTrustModes: Object.freeze(['trusted-host', 'isolated-client'] as const),
    supportedGrants: Object.freeze([
        'ui.dashboard.register',
        'ui.command-palette.register',
        'settings.read',
        'settings.write',
        'network.http',
    ]),
    supportedFeatures: Object.freeze(['or3-portable-client-v1']),
});
