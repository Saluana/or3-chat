/**
 * @module server/utils/auth/is-ssr-auth-enabled
 *
 * Purpose:
 * Central gate for SSR-only authentication features.
 * This keeps static builds free of SSR auth code paths.
 *
 * Responsibilities:
 * - Read runtime config to determine whether SSR auth is enabled.
 * - Provide a single decision point for SSR middleware and endpoints.
 *
 * Non-Goals:
 * - Per-request overrides or feature flag evaluation.
 * - Authorization checks. Use `can()` for access control.
 *
 * Constraints:
 * - SSR-only usage. Do not import into client bundles.
 */

import type { H3Event } from 'h3';
import { useRuntimeConfig } from '#imports';

/**
 * Purpose:
 * Determine whether SSR auth features should be active.
 *
 * Behavior:
 * - Reads `runtimeConfig.auth.enabled`.
 * - Returns `true` only when explicitly enabled.
 *
 * Constraints:
 * - Intended for SSR server context only.
 */
export function isSsrAuthEnabled(_event?: H3Event): boolean {
    const config = useRuntimeConfig();
    return config.auth.enabled === true;
}
