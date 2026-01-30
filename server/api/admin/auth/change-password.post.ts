import { defineEventHandler, readBody, createError } from 'h3';
import {
    readAdminCredentials,
    updateAdminCredentials,
} from '../../../admin/auth/credentials';
import {
    verifyPassword,
    hashPassword,
    validatePasswordStrength,
} from '../../../admin/auth/hash';
import { getAdminFromCookie } from '../../../admin/auth/jwt';
import { isAdminEnabled } from '../../../utils/admin/is-admin-enabled';

interface ChangePasswordBody {
    currentPassword?: string;
    newPassword?: string;
}

/**
 * POST /api/admin/auth/change-password
 * 
 * Super admin password change endpoint.
 * - Requires current password verification
 * - Validates new password strength
 * - Updates credentials file atomically
 */
export default defineEventHandler(async (event) => {
    // Admin must be enabled
    if (!isAdminEnabled(event)) {
        throw createError({
            statusCode: 404,
            statusMessage: 'Not Found',
        });
    }

    // Require valid admin session
    const adminClaims = await getAdminFromCookie(event);
    if (!adminClaims) {
        throw createError({
            statusCode: 401,
            statusMessage: 'Unauthorized',
        });
    }

    const body = await readBody<ChangePasswordBody>(event);
    const { currentPassword, newPassword } = body;

    // Validate input
    if (!currentPassword || !newPassword) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Current password and new password are required',
        });
    }

    // Read current credentials
    const credentials = await readAdminCredentials();
    if (!credentials) {
        throw createError({
            statusCode: 500,
            statusMessage: 'Admin credentials not found',
        });
    }

    // Verify current password
    const passwordValid = await verifyPassword(currentPassword, credentials.password_hash_bcrypt);
    if (!passwordValid) {
        throw createError({
            statusCode: 401,
            statusMessage: 'Current password is incorrect',
        });
    }

    // Validate new password strength
    const strengthCheck = validatePasswordStrength(newPassword);
    if (!strengthCheck.valid) {
        throw createError({
            statusCode: 400,
            statusMessage: `Password does not meet requirements: ${strengthCheck.errors.join(', ')}`,
        });
    }

    // Hash and save new password
    const newHash = await hashPassword(newPassword);
    await updateAdminCredentials({
        password_hash_bcrypt: newHash,
    });

    return {
        success: true,
    };
});
