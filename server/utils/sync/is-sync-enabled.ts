/**
 * @module server/utils/sync/is-sync-enabled
 *
 * Purpose:
 * Central gate for sync endpoints in SSR.
 *
 * Responsibilities:
 * - Read runtime config to determine whether sync is enabled.
 *
 * Non-Goals:
 * - Authorization or feature flag evaluation beyond config.
 *
 * Constraints:
 * - Intended for SSR server usage only.
 */

import type { H3Event } from 'h3';

/**
 * Purpose:
 * Determine whether sync functionality should be active.
 *
 * Behavior:
 * - Reads `runtimeConfig.sync.enabled`.
 * - Returns `true` only when explicitly enabled.
 */
export function isSyncEnabled(_event?: H3Event): boolean {
    const config = useRuntimeConfig();
    return config.sync.enabled === true;
}
