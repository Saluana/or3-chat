import { defineEventHandler, createError } from 'h3';
import { clearAdminCookie } from '../../../admin/auth/jwt';
import { isAdminEnabled } from '../../../utils/admin/is-admin-enabled';

/**
 * POST /api/admin/auth/logout
 * 
 * Super admin logout endpoint.
 * Clears the admin JWT cookie.
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
