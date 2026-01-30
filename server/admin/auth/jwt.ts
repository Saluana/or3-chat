/**
 * JWT utilities for admin authentication.
 * Server-side only.
 */
import type { H3Event } from 'h3';
import { getCookie, setCookie, deleteCookie } from 'h3';
import jwt from 'jsonwebtoken';
import { useRuntimeConfig } from '#imports';

const COOKIE_NAME = 'or3_admin';
const COOKIE_PATH = '/admin';

/**
 * Parse JWT expiry string to seconds.
 * Supports: s (seconds), m (minutes), h (hours), d (days)
 * Defaults to 24 hours if parsing fails.
 */
function parseExpiryToSeconds(expiry: string): number {
    const match = expiry.match(/^(\d+)([smhd])$/);
    if (!match) {
        return 24 * 60 * 60; // Default: 24 hours
    }
    
    const value = parseInt(match[1]!, 10);
    const unit = match[2]!;
    
    switch (unit) {
        case 's': return value;
        case 'm': return value * 60;
        case 'h': return value * 60 * 60;
        case 'd': return value * 24 * 60 * 60;
        default: return 24 * 60 * 60;
    }
}

export type AdminJwtClaims = {
    kind: 'super_admin';
    username: string;
    iat: number;
    exp: number;
};

/**
 * Get the JWT secret from runtime config or generate one.
 * The secret is persisted in .data/admin-jwt-secret if auto-generated.
 */
async function getJwtSecret(event: H3Event): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unnecessary-condition
    const config = (useRuntimeConfig(event) || {}) as any;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const configuredSecret = config.admin?.auth?.jwtSecret;

    if (configuredSecret) {
        return configuredSecret;
    }

    // Auto-generate and persist a secret
    const { readFile, writeFile, mkdir } = await import('fs/promises');
    const { join } = await import('path');
    const { randomBytes } = await import('crypto');

    const secretFile = join('.data', 'admin-jwt-secret');

    try {
        const secret = await readFile(secretFile, 'utf-8');
        return secret.trim();
    } catch {
        // Generate new secret - ensure .data directory exists
        try {
            await mkdir('.data', { recursive: true });
        } catch {
            // Directory might already exist
        }
        const secret = randomBytes(32).toString('hex');
        await writeFile(secretFile, secret, { mode: 0o600 });
        return secret;
    }
}

/**
 * Sign a JWT for super admin authentication.
 */
export async function signAdminJwt(
    event: H3Event,
    username: string
): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unnecessary-condition
    const config = (useRuntimeConfig(event) || {}) as any;
    const secret = await getJwtSecret(event);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const expiry = config.admin?.auth?.jwtExpiry || '24h';

    const claims: Omit<AdminJwtClaims, 'iat' | 'exp'> = {
        kind: 'super_admin',
        username,
    };

    return jwt.sign(claims, secret, {
        expiresIn: expiry as jwt.SignOptions['expiresIn'],
    });
}

/**
 * Verify a JWT and return the claims.
 * Returns null if invalid or expired.
 */
export async function verifyAdminJwt(
    event: H3Event,
    token: string
): Promise<AdminJwtClaims | null> {
    const secret = await getJwtSecret(event);

    try {
        const decoded = jwt.verify(token, secret, {
            algorithms: ['HS256'],
        }) as AdminJwtClaims;

        // Validate the claims structure
        if (decoded.kind !== 'super_admin' || !decoded.username) {
            return null;
        }

        return decoded;
    } catch {
        return null;
    }
}

/**
 * Set the admin JWT cookie.
 */
export async function setAdminCookie(
    event: H3Event,
    username: string
): Promise<void> {
    const token = await signAdminJwt(event, username);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unnecessary-condition
    const config = (useRuntimeConfig(event) || {}) as any;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const expiry = config.admin?.auth?.jwtExpiry || '24h';
    const maxAgeSeconds = parseExpiryToSeconds(expiry);

    setCookie(event, COOKIE_NAME, token, {
        httpOnly: true,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        secure: config.security?.forceHttps ?? process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: COOKIE_PATH,
        maxAge: maxAgeSeconds,
    });
}

/**
 * Get admin JWT claims from the cookie.
 * Returns null if no cookie or invalid token.
 */
export async function getAdminFromCookie(
    event: H3Event
): Promise<AdminJwtClaims | null> {
    const token = getCookie(event, COOKIE_NAME);

    if (!token) {
        return null;
    }

    return await verifyAdminJwt(event, token);
}

/**
 * Clear the admin JWT cookie (logout).
 */
export function clearAdminCookie(event: H3Event): void {
    deleteCookie(event, COOKIE_NAME, {
        path: COOKIE_PATH,
    });
    // Clear legacy cookie path (/admin) from earlier versions
    deleteCookie(event, COOKIE_NAME, {
        path: '/admin',
    });
}

/**
 * Check if the request has a valid admin session.
 */
export async function hasAdminSession(event: H3Event): Promise<boolean> {
    const claims = await getAdminFromCookie(event);
    return claims !== null;
}
