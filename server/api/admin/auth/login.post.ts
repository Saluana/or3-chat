import { defineEventHandler, readBody, createError } from 'h3';
import {
    credentialsFileExists,
    readAdminCredentials,
    bootstrapAdminCredentialsFromEnv,
} from '../../../admin/auth/credentials';
import { verifyPassword } from '../../../admin/auth/hash';
import { setAdminCookie } from '../../../admin/auth/jwt';
import {
    checkRateLimit,
    recordFailedAttempt,
    clearRateLimit,
    getClientIp,
} from '../../../admin/auth/rate-limit';
import { isAdminEnabled } from '../../../utils/admin/is-admin-enabled';

interface LoginBody {
    username?: string;
    password?: string;
}

/**
 * POST /api/admin/auth/login
 * 
 * Super admin login endpoint.
 * - Rate limited to 5 attempts per 15 minutes per IP+username
 * - Sets httpOnly, secure, sameSite=strict cookie on success
 * - Returns 404 if admin is not enabled
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

    const body = await readBody<LoginBody>(event);
    const { username, password } = body;

    // Validate input
    if (!username || !password) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Username and password are required',
        });
    }

    // Check rate limit
    const clientIp = getClientIp(event);
    const rateLimit = checkRateLimit(clientIp, username);

    if (!rateLimit.allowed) {
        throw createError({
            statusCode: 429,
            statusMessage: 'Too many login attempts. Please try again later.',
        });
    }

    // Bootstrap credentials from env if needed (first boot)
    const config = useRuntimeConfig(event);
    const envUsername = config.admin?.auth?.username;
    const envPassword = config.admin?.auth?.password;

    if (envUsername && envPassword) {
        await bootstrapAdminCredentialsFromEnv(envUsername, envPassword);
    }

    // Check if credentials file exists
    const exists = await credentialsFileExists();
    if (!exists) {
        throw createError({
            statusCode: 500,
            statusMessage: 'Admin credentials not configured',
        });
    }

    // Read and verify credentials
    const credentials = await readAdminCredentials();
    if (!credentials) {
        throw createError({
            statusCode: 500,
            statusMessage: 'Failed to read admin credentials',
        });
    }

    // Check username match
    if (credentials.username !== username) {
        recordFailedAttempt(clientIp, username);
        throw createError({
            statusCode: 401,
            statusMessage: 'Invalid credentials',
        });
    }

    // Verify password
    const passwordValid = await verifyPassword(password, credentials.password_hash_bcrypt);
    if (!passwordValid) {
        recordFailedAttempt(clientIp, username);
        throw createError({
            statusCode: 401,
            statusMessage: 'Invalid credentials',
        });
    }

    // Success! Clear rate limit and set cookie
    clearRateLimit(clientIp, username);
    await setAdminCookie(event, username);

    return {
        success: true,
        username: credentials.username,
    };
});
