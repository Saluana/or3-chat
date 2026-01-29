/**
 * Rate limiting for admin login attempts.
 * Uses in-memory storage with sliding window (15 minutes).
 * 5 attempts per IP + username combination.
 * 
 * Storage is cleared on server restart (acceptable for simplicity).
 */

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5;

interface RateLimitEntry {
    count: number;
    windowStart: number;
}

// In-memory storage: Map<key, RateLimitEntry>
const rateLimitStore = new Map<string, RateLimitEntry>();

/**
 * Generate the rate limit key from IP and username.
 */
function getRateLimitKey(ip: string, username: string): string {
    return `admin-login:${ip}:${username}`;
}

/**
 * Check if a login attempt should be rate limited.
 * @param ip - Client IP address
 * @param username - Username being attempted
 * @returns Rate limit status
 */
export function checkRateLimit(
    ip: string,
    username: string
): {
    allowed: boolean;
    remaining: number;
    resetAt: number;
} {
    const key = getRateLimitKey(ip, username);
    const now = Date.now();
    const entry = rateLimitStore.get(key);

    if (!entry) {
        // First attempt
        return {
            allowed: true,
            remaining: MAX_ATTEMPTS - 1,
            resetAt: now + WINDOW_MS,
        };
    }

    // Check if window has expired
    if (now - entry.windowStart > WINDOW_MS) {
        // Reset the window
        rateLimitStore.set(key, {
            count: 1,
            windowStart: now,
        });
        return {
            allowed: true,
            remaining: MAX_ATTEMPTS - 1,
            resetAt: now + WINDOW_MS,
        };
    }

    // Within window - check count
    if (entry.count >= MAX_ATTEMPTS) {
        return {
            allowed: false,
            remaining: 0,
            resetAt: entry.windowStart + WINDOW_MS,
        };
    }

    return {
        allowed: true,
        remaining: MAX_ATTEMPTS - entry.count - 1,
        resetAt: entry.windowStart + WINDOW_MS,
    };
}

/**
 * Record a failed login attempt.
 * @param ip - Client IP address
 * @param username - Username being attempted
 */
export function recordFailedAttempt(ip: string, username: string): void {
    const key = getRateLimitKey(ip, username);
    const now = Date.now();
    const entry = rateLimitStore.get(key);

    if (!entry || now - entry.windowStart > WINDOW_MS) {
        // Start new window
        rateLimitStore.set(key, {
            count: 1,
            windowStart: now,
        });
    } else {
        // Increment count
        entry.count++;
    }
}

/**
 * Clear rate limit entry for a successful login.
 * @param ip - Client IP address
 * @param username - Username being attempted
 */
export function clearRateLimit(ip: string, username: string): void {
    const key = getRateLimitKey(ip, username);
    rateLimitStore.delete(key);
}

/**
 * Get client IP from H3 event.
 * Falls back to 'unknown' if cannot be determined.
 */
export function getClientIp(event: import('h3').H3Event): string {
    const headers = getRequestHeaders(event);
    const forwarded = headers['x-forwarded-for'];
    if (forwarded) {
        return forwarded.split(',')[0].trim();
    }
    return headers['x-real-ip'] ?? 'unknown';
}

// Import for headers
import { getRequestHeaders } from 'h3';
