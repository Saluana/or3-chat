/**
 * @module server/utils/admin/is-admin-enabled
 *
 * Purpose:
 * Gate admin routes and APIs based on configured credentials.
 * This supports SSR-only admin access that is disabled by default.
 *
 * Responsibilities:
 * - Determine whether admin credentials exist.
 * - Provide a 404 fail-closed guard for admin routes.
 *
 * Non-Goals:
 * - Authorization beyond credential presence.
 * - Auth session creation or validation.
 *
 * Constraints:
 * - Server-only usage. Never imported into client code paths.
 */

import type { H3Event } from 'h3';
import { createError } from 'h3';
import { useRuntimeConfig } from '#imports';

/**
 * Purpose:
 * Check if the admin dashboard is enabled via credentials.
 *
 * Behavior:
 * - When an event is provided, uses runtime config values.
 * - Without an event, falls back to `process.env` for server-only calls.
 *
 * Constraints:
 * - Admin is enabled only if both username and password are present.
 * - This check is used for 404 gating, not authorization.
 */
export function isAdminEnabled(event?: H3Event): boolean {
    // If event is provided, use runtime config
    if (event) {
        const config = useRuntimeConfig(event);
        const username = config.admin.auth.username;
        const password = config.admin.auth.password;
        return Boolean(username && password);
    }

    // Otherwise, check process.env directly (for server-only code)
    const username = process.env.OR3_ADMIN_USERNAME;
    const password = process.env.OR3_ADMIN_PASSWORD;
    return Boolean(username && password);
}

/**
 * Purpose:
 * Enforce that admin is enabled, returning a 404 when disabled.
 *
 * Behavior:
 * - Throws an H3 error with status 404 when admin is not enabled.
 * - Acts as a fail-closed guard to keep admin surfaces hidden.
 *
 * Constraints:
 * - Intended for SSR admin routes and server API handlers.
 *
 * Non-Goals:
 * - Checking admin permissions or roles.
 */
export function requireAdminEnabled(event: H3Event): void {
    if (!isAdminEnabled(event)) {
        throw createError({
            statusCode: 404,
            statusMessage: 'Not Found',
        });
    }
}
