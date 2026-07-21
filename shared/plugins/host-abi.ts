/**
 * Versioned host ABI bare imports that a V2 package may leave unresolved.
 * Everything else must be relative to the immutable package root.
 */
export const MODULE_V2_HOST_ABI_EXTERNALS = Object.freeze([
    '@or3/plugin-sdk',
    '@or3/plugin-sdk/manifest',
    'vue',
] as const);

export type ModuleV2HostAbiExternal = (typeof MODULE_V2_HOST_ABI_EXTERNALS)[number];

export const MODULE_V2_REQUIRED_LOGIC_EXTERNALS = Object.freeze([
    '@or3/plugin-sdk',
] as const satisfies readonly ModuleV2HostAbiExternal[]);

export const MODULE_V2_REQUIRED_UI_EXTERNALS = Object.freeze([
    '@or3/plugin-sdk',
    'vue',
] as const satisfies readonly ModuleV2HostAbiExternal[]);

export function isModuleV2HostAbiExternal(specifier: string): specifier is ModuleV2HostAbiExternal {
    return (MODULE_V2_HOST_ABI_EXTERNALS as readonly string[]).includes(specifier);
}
