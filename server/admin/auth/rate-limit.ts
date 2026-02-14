import { getRequestIP, type H3Event } from 'h3';

/**
 * Rate limiting for admin login attempts.
 * Uses in-memory storage with sliding window (15 minutes).
 * 5 attempts per IP + username combination.
 * 
 * Storage is cleared on server restart (acceptable for simplicity).
 * Includes periodic cleanup to prevent memory growth.
 */

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // Clean up every 5 minutes
const MAX_STORE_SIZE = 10000; // Bound memory usage - evict oldest when full

function isRateLimitDisabled(): boolean {
    return process.env.DISABLE_RATE_LIMIT === '1';
}

interface RateLimitEntry {
    count: number;
    windowStart: number;
}

// In-memory storage: Map<key, RateLimitEntry>
const rateLimitStore = new Map<string, RateLimitEntry>();

// Periodic cleanup to prevent unbounded memory growth
// Use unref() to allow process to exit cleanly
const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitStore) {
        if (now - entry.windowStart > WINDOW_MS) {
            rateLimitStore.delete(key);
        }
    }
}, CLEANUP_INTERVAL_MS);

// Allow process to exit even if interval is pending
if (typeof cleanupInterval.unref === 'function') {
    cleanupInterval.unref();
}

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
    if (isRateLimitDisabled()) {
        return {
            allowed: true,
            remaining: MAX_ATTEMPTS,
            resetAt: Date.now() + WINDOW_MS,
        };
    }

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

    // Evict oldest entry if at capacity (LRU-style: Map preserves insertion order)
    if (rateLimitStore.size >= MAX_STORE_SIZE && !rateLimitStore.has(key)) {
        const oldestKey = rateLimitStore.keys().next().value;
        if (oldestKey) {
            rateLimitStore.delete(oldestKey);
        }
    }

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
export function getClientIp(event: H3Event): string {
    return getRequestIP(event, { xForwardedFor: true }) ?? 'unknown';
}

/**
 * Generic rate limiter for admin API endpoints.
 * Uses IP-based rate limiting with 20 requests per minute per IP.
 * 
 * @param ip - Client IP address
 * @param category - Rate limit category (e.g., 'admin-api', 'admin-mutation')
 * @returns Rate limit status
 */
export function checkGenericRateLimit(
    ip: string,
    category: string
): {
    allowed: boolean;
    remaining: number;
    resetAt: number;
} {
    if (isRateLimitDisabled()) {
        return {
            allowed: true,
            remaining: 20,
            resetAt: Date.now() + 60 * 1000,
        };
    }

    const key = `${category}:${ip}`;
    const now = Date.now();
    const entry = rateLimitStore.get(key);
    
    // 20 requests per minute for generic admin API operations
    const maxRequests = 20;
    const windowMs = 60 * 1000; // 1 minute

    if (!entry) {
        // First attempt
        return {
            allowed: true,
            remaining: maxRequests - 1,
            resetAt: now + windowMs,
        };
    }

    // Check if window has expired
    if (now - entry.windowStart > windowMs) {
        // Reset the window
        rateLimitStore.set(key, {
            count: 1,
            windowStart: now,
        });
        return {
            allowed: true,
            remaining: maxRequests - 1,
            resetAt: now + windowMs,
        };
    }

    // Within window - check count
    if (entry.count >= maxRequests) {
        return {
            allowed: false,
            remaining: 0,
            resetAt: entry.windowStart + windowMs,
        };
    }

    // Increment count
    entry.count++;

    return {
        allowed: true,
        remaining: maxRequests - entry.count,
        resetAt: entry.windowStart + windowMs,
    };
}
