/**
 * @module server/utils/rate-limit
 *
 * Purpose:
 * Simple in-memory rate limiter used for admin endpoints.
 *
 * Responsibilities:
 * - Track request counts in a fixed time window.
 * - Return allow or deny decisions based on max limits.
 * - Provide basic status lookup for debugging.
 *
 * Non-Goals:
 * - Distributed rate limiting across instances.
 * - Sliding window or token bucket semantics.
 *
 * Constraints:
 * - In-memory only and resets on server restart.
 * - Expired entries are pruned opportunistically without a process timer.
 */

type RateLimitEntry = {
    count: number;
    resetAt: number;
};

const store = new Map<string, RateLimitEntry>();
const MAX_STORE_SIZE = 10_000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let nextCleanupAt = 0;

function pruneExpired(now: number): void {
    if (now < nextCleanupAt) return;
    nextCleanupAt = now + CLEANUP_INTERVAL_MS;
    for (const [key, entry] of store) {
        if (now > entry.resetAt) store.delete(key);
    }
}

/**
 * Purpose:
 * Configuration for the admin rate limiter.
 *
 * Constraints:
 * - `window` is expressed in seconds.
 */
export type RateLimitOptions = {
    max: number;
    window: number;
};

/**
 * Purpose:
 * Check whether a request is allowed within the configured window.
 *
 * Behavior:
 * - Starts a new window on first request or after expiry.
 * - Increments the request count for the current window.
 *
 * Constraints:
 * - Fixed window algorithm.
 */
export async function checkRateLimit(
    key: string,
    options: RateLimitOptions
): Promise<boolean> {
    const now = Date.now();
    const windowMs = options.window * 1000;
    pruneExpired(now);

    const entry = store.get(key);

    if (!entry || now > entry.resetAt) {
        // New window
        if (!entry && store.size >= MAX_STORE_SIZE) {
            const oldestKey = store.keys().next().value as string | undefined;
            if (oldestKey) store.delete(oldestKey);
        }
        store.set(key, {
            count: 1,
            resetAt: now + windowMs,
        });
        return true;
    }

    if (entry.count >= options.max) {
        return false;
    }

    entry.count++;
    return true;
}

/**
 * Purpose:
 * Return the current status for a key.
 *
 * Behavior:
 * - Returns `null` when the key has no active window.
 * - Returns the current count and reset time for the window.
 *
 * Constraints:
 * - `remaining` reflects the current count, not the remaining allowance.
 */
export function getRateLimitStatus(
    key: string
): { remaining: number; resetAt: number } | null {
    pruneExpired(Date.now());
    const entry = store.get(key);
    if (!entry) return null;

    return {
        remaining: Math.max(0, entry.count),
        resetAt: entry.resetAt,
    };
}
