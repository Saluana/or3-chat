/**
 * @module server/utils/storage/is-storage-enabled
 *
 * Purpose:
 * Central gate for storage features in SSR endpoints.
 *
 * Responsibilities:
 * - Read runtime config to determine whether storage is enabled.
 *
 * Non-Goals:
 * - Authorization checks for specific storage operations.
 * - Provider availability checks.
 *
 * Constraints:
 * - Intended for SSR server usage only.
 */

import type { H3Event } from 'h3';

/**
 * Purpose:
 * Determine whether storage endpoints should be active.
 *
 * Behavior:
 * - Reads `runtimeConfig.storage.enabled`.
 * - Returns `true` only when explicitly enabled.
 */
export function isStorageEnabled(_event?: H3Event): boolean {
    const config = useRuntimeConfig();
    return config.storage.enabled === true;
}
