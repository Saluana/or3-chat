/**
 * @module server/api/admin/auth/session.get
 *
 * Purpose:
 * Verifies the validity of the current admin session.
 *
 * Responsibilities:
 * - Checks for valid admin JWT cookie
 * - Returns the admin "kind" (e.g. super_admin, workspace_admin)
 */
import { defineEventHandler, createError } from 'h3';
import { requireAdminApiContext } from '../../../admin/api';
import { isAdminEnabled } from '../../../utils/admin/is-admin-enabled';

/**
 * GET /api/admin/auth/session
 *
 * Purpose:
 * Used by the client-side Admin UI to gate route access.
 *
 * Behavior:
 * - Returns 200 { authenticated: true } if session is valid.
 * - Throws 401/404 if invalid or disabled.
 *
 * Use Cases:
 * - Route guards in Nuxt
 * - Initial app hydration
 */
export default defineEventHandler(async (event) => {
    if (!isAdminEnabled(event)) {
        throw createError({
            statusCode: 404,
            statusMessage: 'Not Found',
        });
    }

    const context = await requireAdminApiContext(event);

    return {
        authenticated: true,
        kind: context.principal.kind,
    };
});
