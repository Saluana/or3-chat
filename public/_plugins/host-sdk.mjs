// or3-plugin-host-esm-facade:v1
// or3-plugin-sdk-host-singleton:v2
// Re-exports the plugin SDK instance the host app installed.
const host = globalThis.__or3HostAbi?.sdk;
if (!host) {
    throw new Error('OR3 host plugin SDK singleton is not installed');
}

export const {
    createPortablePlugin,
    defineOr3Plugin,
    definePortableUi,
    pluginError,
    pluginOk,
} = host;

export default host;
