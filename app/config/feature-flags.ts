/**
 * Feature Flags
 *
 * Runtime feature flags for gradual rollout of new functionality.
 */

/**
 * When true, legacy composable functions proxy through or3client.
 * Set to false as a rollback mechanism if issues are discovered.
 *
 * Environment variable: NUXT_PUBLIC_OR3CLIENT_PROXY
 */
export const FEATURE_OR3CLIENT_PROXY = true;

/**
 * Helper to check the feature flag at runtime.
 * Checks both the static flag and runtime config if available.
 */
export function isOR3ClientProxyEnabled(): boolean {
    // Check runtime config if available (allows env override)
    if (typeof useRuntimeConfig !== 'undefined') {
        try {
            const config = useRuntimeConfig();
            if (config.public?.or3clientProxy !== undefined) {
                return Boolean(config.public.or3clientProxy);
            }
        } catch {
            // Outside of Nuxt context, fall back to static flag
        }
    }
    return FEATURE_OR3CLIENT_PROXY;
}
