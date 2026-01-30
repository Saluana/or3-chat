import { defineEventHandler, createError } from 'h3';
import { requireAdminApiContext } from '../../../admin/api';
import { isAdminEnabled } from '../../../utils/admin/is-admin-enabled';

/**
 * GET /api/admin/auth/session
 *
 * Returns admin session status for client-side route gating.
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
