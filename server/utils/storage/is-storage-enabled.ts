import type { H3Event } from 'h3';

/**
 * Check if storage is enabled.
 * Uses runtime config storage.enabled flag.
 */
export function isStorageEnabled(_event?: H3Event): boolean {
    const config = useRuntimeConfig();
    return config.storage?.enabled === true;
}
