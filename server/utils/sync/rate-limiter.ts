import { LRUCache } from 'lru-cache';

/**
 * Sync Rate Limiter
 *
 * In-memory sliding window rate limiter for sync and storage operations.
 * Limits are per-user to prevent abuse while allowing normal usage.
 *
 * Memory bounds:
 * - Maximum 10,000 users tracked concurrently (LRU eviction)
 * - Entries expire after 10 minutes of inactivity
 * - Each entry stores ~100 bytes (timestamps array)
 * - Total memory: ~1MB worst case
 *
 * Note: This is in-memory and resets on server restart. This is acceptable
 * for soft limits - it prevents sustained abuse but won't persist across
 * deployments. For distributed deployments, consider Redis.
 */

import type {
    RateLimitConfig,
    RateLimitResult,
} from '../rate-limit/types';

interface RateLimitEntry {
    /** Timestamps of requests in the current window */
    timestamps: number[];
}

/**
 * Rate limit configurations for sync operations.
 * These are tuned for a chat/document editor application.
 */
export const SYNC_RATE_LIMITS: Record<string, RateLimitConfig> = {
    // Push: 200 ops/min - allows rapid typing and batch edits
    'sync:push': { windowMs: 60_000, maxRequests: 200 },
    // Pull: 120 req/min - sufficient for bootstrap and reconnect scenarios
    'sync:pull': { windowMs: 60_000, maxRequests: 120 },
    // Cursor updates: 60 req/min - less frequent than push/pull
    'sync:cursor': { windowMs: 60_000, maxRequests: 60 },
} as const;

export const STORAGE_RATE_LIMITS: Record<string, RateLimitConfig> = {
    'storage:upload': { windowMs: 60_000, maxRequests: 50 },
    'storage:download': { windowMs: 60_000, maxRequests: 100 },
};

// Merge with existing SYNC_RATE_LIMITS
export const ALL_RATE_LIMITS = {
    ...SYNC_RATE_LIMITS,
    ...STORAGE_RATE_LIMITS,
};

/** Maximum age for entries before cleanup (10 minutes) */
const MAX_ENTRY_AGE_MS = 10 * 60 * 1000;

/**
 * Rate limit store using LRU cache to prevent unbounded growth.
 * Max 10k users tracked, entries expire after 10 minutes of inactivity.
 */
const rateLimitStore = new LRUCache<string, RateLimitEntry>({
    max: 10_000,
    ttl: MAX_ENTRY_AGE_MS,
    updateAgeOnGet: false,
    updateAgeOnHas: false,
});

/**
 * Get the rate limit key for a user and operation
 */
function getRateLimitKey(userId: string, operation: string): string {
    return `${userId}:${operation}`;
}

/**
 * Check if a request is allowed under rate limits.
 * Does NOT record the request - call recordSyncRequest separately if allowed.
 *
 * @param userId - The user making the request
 * @param operation - The operation type (e.g., 'sync:push', 'sync:pull')
 * @returns Rate limit result with allowed status and remaining requests
 */
export function checkSyncRateLimit(userId: string, operation: string): RateLimitResult {
    const config = ALL_RATE_LIMITS[operation as keyof typeof ALL_RATE_LIMITS];
    if (!config) {
        // Unknown operation - allow by default
        return { allowed: true, remaining: Infinity };
    }

    const key = getRateLimitKey(userId, operation);
    const entry = rateLimitStore.get(key);
    const now = Date.now();
    const windowStart = now - config.windowMs;

    if (!entry) {
        return { allowed: true, remaining: config.maxRequests };
    }

    // Filter to only requests within the current window
    const recentRequests = entry.timestamps.filter((ts) => ts > windowStart);
    const requestCount = recentRequests.length;
    const remaining = Math.max(0, config.maxRequests - requestCount);

    if (requestCount >= config.maxRequests) {
        // Find when the oldest request in the window will expire
        const oldestInWindow = recentRequests[0]!;
        const retryAfterMs = oldestInWindow + config.windowMs - now;

        return {
            allowed: false,
            remaining: 0,
            retryAfterMs: Math.max(0, retryAfterMs),
        };
    }

    return { allowed: true, remaining };
}

/**
 * Record a request for rate limiting.
 * Call this AFTER the request is allowed and processed.
 *
 * @param userId - The user making the request
 * @param operation - The operation type
 */
export function recordSyncRequest(userId: string, operation: string): void {
    const config = ALL_RATE_LIMITS[operation as keyof typeof ALL_RATE_LIMITS];
    if (!config) {
        return;
    }

    const key = getRateLimitKey(userId, operation);
    const now = Date.now();
    const windowStart = now - config.windowMs;

    let entry = rateLimitStore.get(key);
    if (!entry) {
        entry = { timestamps: [] };
    }

    // Add current request timestamp
    entry.timestamps.push(now);

    // Prune old timestamps outside the window
    entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart);

    rateLimitStore.set(key, entry);
}

/**
 * Reset rate limits for a user (useful for testing)
 *
 * @param userId - The user to reset, or undefined to reset all
 */
export function resetSyncRateLimits(userId?: string): void {
    if (userId) {
        for (const operation of Object.keys(ALL_RATE_LIMITS)) {
            rateLimitStore.delete(getRateLimitKey(userId, operation));
        }
    } else {
        rateLimitStore.clear();
    }
}

/**
 * Get current rate limit stats for a user (useful for debugging/headers)
 *
 * @param userId - The user to check
 * @param operation - The operation type
 */
export function getSyncRateLimitStats(
    userId: string,
    operation: string
): { limit: number; remaining: number; resetMs: number } | null {
    const config = ALL_RATE_LIMITS[operation as keyof typeof ALL_RATE_LIMITS];
    if (!config) {
        return null;
    }

    const result = checkSyncRateLimit(userId, operation);
    return {
        limit: config.maxRequests,
        remaining: result.remaining,
        resetMs: config.windowMs,
    };
}
