import { getRegisteredDashboardPlugin } from '~/composables/dashboard/useDashboardPlugins';

export function getPluginCapabilities(pluginId: string): string[] {
    const capabilities =
        getRegisteredDashboardPlugin(pluginId)?.capabilities;
    return Array.isArray(capabilities) ? [...capabilities] : [];
}

export function hasCapability(
    pluginId: string,
    capability: string
): boolean {
    return getPluginCapabilities(pluginId).includes(capability);
}

export function hasAllCapabilities(
    pluginId: string,
    capabilities: string[]
): boolean {
    const declared = getPluginCapabilities(pluginId);
    return (
        declared.length > 0 &&
        capabilities.every((capability) => declared.includes(capability))
    );
}

export function hasAnyCapability(
    pluginId: string,
    capabilities: string[]
): boolean {
    const declared = getPluginCapabilities(pluginId);
    return capabilities.some((capability) => declared.includes(capability));
}
