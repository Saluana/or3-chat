/**
 * @module server/api/admin/admin-users/grant.post
 *
 * Purpose:
 * Promotes a user to a deployment-level administrator.
 */
import { defineEventHandler, readBody, createError } from 'h3';
import { requireAdminApiContext } from '../../../admin/api';
import { getAdminUserStore } from '../../../admin/stores/registry';
import { isAdminEnabled } from '../../../utils/admin/is-admin-enabled';
import { enforceGenericAdminRateLimit } from '../../../admin/auth/rate-limit';

interface GrantAdminBody {
    userId: string;
}

/**
 * POST /api/admin/admin-users/grant
 *
 * Purpose:
 * Elevates privileges of a specific user.
 *
 * Behavior:
 * - Rate limited to prevent mass-elevation attacks.
 * - Updates user store to reflect admin status.
 *
 * Security:
 * - Highly privileged operation; gated by `requireAdminApiContext`.
 */
export default defineEventHandler(async (event) => {
    // Admin must be enabled
    if (!isAdminEnabled(event)) {
        throw createError({
            statusCode: 404,
            statusMessage: 'Not Found',
        });
    }

    // Rate limit check
    enforceGenericAdminRateLimit(event);

    // Require super admin context
    await requireAdminApiContext(event, {
        mutation: true,
        superAdminOnly: true,
    });

    const body = await readBody<GrantAdminBody | Record<string, unknown> | null>(event);
    const userId =
        body && typeof body === 'object' && typeof body.userId === 'string'
            ? body.userId.trim()
            : '';

    if (!userId) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Valid user ID is required',
        });
    }

    // Get admin user store
    const store = getAdminUserStore(event);

    // Grant admin access
    await store.grantAdmin({ userId });

    return { success: true };
});
