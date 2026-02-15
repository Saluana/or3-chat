/**
 * @module server/api/admin/auth/logout.post
 *
 * Purpose:
 * Terminates the admin session.
 */
import { defineEventHandler, createError, getCookie } from 'h3';
import { clearAdminCookie } from '../../../admin/auth/jwt';
import { isAdminEnabled } from '../../../utils/admin/is-admin-enabled';

/**
 * POST /api/admin/auth/logout
 *
 * Purpose:
 * Invalidates compliance session by clearing the `or3_admin` cookie.
 *
 * Behavior:
 * - Sets the cookie to expire immediately.
 * - Requires POST method to prevent CSRF via GET.
 *
 * Debugging:
 * - Logs cookie presence before clearing for audit/diagnostic purposes.
 */
export default defineEventHandler(async (event) => {
    // Admin must be enabled
    if (!isAdminEnabled(event)) {
        throw createError({
            statusCode: 404,
            statusMessage: 'Not Found',
        });
    }

    // Only POST allowed
    if (event.method !== 'POST') {
        throw createError({
            statusCode: 405,
            statusMessage: 'Method Not Allowed',
        });
    }

    // Clear the cookie
    clearAdminCookie(event);

    return {
        success: true,
    };
});
