import type { H3Event } from 'h3';

/**
 * Check if the admin dashboard is enabled.
 * Admin is enabled only when OR3_ADMIN_USERNAME and OR3_ADMIN_PASSWORD are configured.
 * 
 * This is used for 404 gating - when admin is not enabled, all admin routes
 * and APIs should return 404.
 * 
 * @param event - H3 event (optional, checks runtime config)
 * @returns true if admin is enabled
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
 * Require admin to be enabled, throwing 404 if not.
 * Use this in admin routes and APIs.
 * 
 * @param event - H3 event
 */
export function requireAdminEnabled(event: H3Event): void {
    if (!isAdminEnabled(event)) {
        throw createError({
            statusCode: 404,
            statusMessage: 'Not Found',
        });
    }
}
