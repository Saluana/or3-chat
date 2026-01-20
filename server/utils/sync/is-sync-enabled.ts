import type { H3Event } from 'h3';

/**
 * Check if sync is enabled.
 * Uses runtime config sync.enabled flag.
 */
export function isSyncEnabled(_event?: H3Event): boolean {
    const config = useRuntimeConfig();
    return config.sync.enabled === true;
}
