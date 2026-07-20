export type NonCorePluginSafeModeConfig = {
    disableNonCorePlugins?: boolean;
};

/**
 * Safe mode is deliberately fail-open for existing installations: only an
 * explicit true value disables non-core plugin discovery.
 */
export function isNonCorePluginDiscoveryDisabled(
    config: NonCorePluginSafeModeConfig | null | undefined
): boolean {
    return config?.disableNonCorePlugins === true;
}

/**
 * Keeps the safe-mode check immediately outside a discovery/import boundary.
 * The callback is never evaluated while safe mode is active.
 */
export function discoverNonCorePlugins<T>(
    config: NonCorePluginSafeModeConfig | null | undefined,
    discover: () => T
): T | undefined {
    if (isNonCorePluginDiscoveryDisabled(config)) return undefined;
    return discover();
}

